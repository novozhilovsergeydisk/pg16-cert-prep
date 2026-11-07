const express = require('express');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { requireAuth: authenticate } = require('../middleware/auth');
const { noteError, logError } = require('../middleware/requestLog');
const { runGateway: transport } = require('../ai/transport');
const { loadContext } = require('../ai/context');
const { createAiHistory } = require('../ai/history');

const MAX_TURNS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRST_MESSAGE = 'Объясни ответ на этот вопрос и почему остальные варианты не подходят. '
    + 'Учитывай выбранный мной ответ. Используй пояснения и проверенные сведения из контекста.';
const MESSAGES = {
    AI_RATE_LIMIT: 'Бесплатная модель временно недоступна или исчерпана квота. Попробуйте позже.',
    AI_TIMEOUT: 'ИИ не успел ответить. Попробуйте ещё раз позже; ответ на вопрос уже сохранён.',
    AI_CREDENTIAL: 'Доступ к ИИ требует обновления ключа. Сообщите администратору.',
    AI_PRICING: 'Бесплатная модель сейчас недоступна. Платный запрос не отправлен.',
    AI_TRUNCATED: 'Пояснение получилось слишком длинным. Попробуйте ещё раз позже.',
    AI_BUSY: 'ИИ уже обрабатывает запрос. Дождитесь его завершения.',
    AI_INVALID: 'Не удалось подготовить пояснение. Попробуйте другой вопрос.',
    AI_UNAVAILABLE: 'Нет соединения с ИИ. Попробуйте позже; тренажёр продолжает работать.',
    AI_INTERRUPTED: 'Запрос прервался при перезапуске или потере соединения. Отправьте новый запрос.',
    AI_EXPIRED: 'Диалог истёк. Начните новый диалог.',
    AI_DIALOG_LIMIT: 'Диалог слишком длинный. Начните новый диалог.',
    AI_LOCAL_RATE_LIMIT: 'Достигнут лимит запросов к ИИ. Попробуйте позже.',
    AI_CAPACITY: 'Слишком много диалогов. Подождите 15 минут.',
};
const STORAGE_MESSAGE = 'Не удалось сохранить историю ИИ. Попробуйте получить результат позже; повторная генерация не запущена.';

function settings() {
    const raw = process.env.AI_OWNER_USER_ID || '';
    const ownerId = /^\d+$/.test(raw) ? Number(raw) : 0;
    return { enabled: process.env.AI_ENABLED === '1' && Number.isSafeInteger(ownerId) && ownerId > 0, ownerId };
}

function id(value) {
    const result = typeof value === 'number' ? value
        : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
    return Number.isInteger(result) && result > 0 && result <= 2147483647 ? result : null;
}

function createAiRouter({ pool = require('../config/db'), requireAuth = authenticate,
    runGateway = transport, configuration = settings, now = Date.now,
    monotonic = () => performance.now(), history = createAiHistory(pool) } = {}) {
    const router = express.Router();
    // Retain completed external results during a temporary database failure.
    const unsaved = new Map();
    const allowed = (user) => {
        const config = configuration();
        return config.enabled && user && user.id === config.ownerId;
    };
    router.use('/ai', requireAuth);
    router.use('/ai', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/ai/status', (req, res) => res.json({ enabled: Boolean(allowed(req.user)) }));
    router.use('/ai', (req, res, next) => {
        if (!allowed(req.user)) return res.status(404).json({ error: 'ИИ недоступен для этого аккаунта' });
        req.aiReceived = { wall: now(), tick: monotonic() };
        next();
    });

    async function flush(userId) {
        for (const [key, completion] of unsaved) {
            if (completion.row.user_id !== userId) continue;
            await history.finish(completion);
            unsaved.delete(key);
        }
    }

    function respond(res, accepted, fingerprint) {
        const row = accepted.row;
        if (row.fingerprint !== fingerprint) return res.status(409).json({ error: 'Параметры повторного запроса изменились. Повторите действие.' });
        if (row.state === 'rejected') return res.status(row.admission_status).json({ error: MESSAGES[row.error_code] || MESSAGES.AI_INVALID });
        if (accepted.repeated && row.expires_at.getTime() <= now()) {
            return res.status(409).json({ error: 'Этот запрос уже сохранён. Начните новый диалог.' });
        }
        return res.status(202).json({ job_id: row.id, conversation_id: row.conversation_id });
    }

    async function repeated(req, res, fingerprint) {
        const row = await history.previous(req.user.id, req.body.request_id);
        if (!row) return false;
        respond(res, { row, repeated: true }, fingerprint);
        return true;
    }

    async function execute(accepted, received) {
        const { row, lease, payload } = accepted;
        let started, result, code;
        try {
            await history.start(row, lease, now(), monotonic() - received.tick);
            started = monotonic();
            result = await runGateway(payload);
            if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 12000) {
                const err = new Error('Invalid AI answer'); err.code = 'AI_INVALID'; throw err;
            }
        } catch (err) {
            logError('ai_gateway', err);
            code = MESSAGES[err.code] ? err.code : 'AI_UNAVAILABLE';
            result = { metrics: err.metrics };
        }
        const completion = { row, answer: code ? undefined : result.answer.trim(), code,
            metrics: result.metrics, finishedAt: now(), durationMs: monotonic() - received.tick,
            preparationMs: started === undefined ? null : started - received.tick,
            transportMs: started === undefined ? null : monotonic() - started };
        try { await history.finish(completion, lease); }
        catch (err) { unsaved.set(row.id, completion); logError('ai_history_finalize', err); }
        finally { await lease.release(); }
    }

    async function enqueue(req, res, input) {
        const accepted = await history.accept({ ...input, userId: req.user.id, requestId: req.body.request_id,
            now: req.aiReceived.wall, wallNow: now, elapsed: () => monotonic() - req.aiReceived.tick });
        try {
            respond(res, accepted, input.fingerprint);
        } finally {
            if (accepted.lease) {
                // Persisted work continues even if the browser disconnected before HTTP 202.
                execute(accepted, req.aiReceived).catch((err) => logError('ai_job', err));
            }
        }
    }

    router.post('/ai/conversations', async (req, res) => {
        const body = req.body || {};
        const scope = body.scope === undefined ? 'question' : body.scope;
        const standalone = body.mode === 'general' && scope === 'general';
        const batchId = id(body.batch_id), questionId = id(body.question_id);
        if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)
            || (!standalone && (!batchId || !questionId || !['training', 'option-check'].includes(body.mode)))
            || !['question', 'general'].includes(scope)) {
            return res.status(400).json({ error: 'Некорректные параметры вопроса' });
        }
        if (scope === 'general' && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000)) {
            return res.status(400).json({ error: 'Введите вопрос длиной от 1 до 1000 символов' });
        }
        const message = scope === 'general' ? body.message.trim() : FIRST_MESSAGE;
        const fingerprint = createHash('sha256').update(JSON.stringify([scope, body.mode, batchId, questionId, message])).digest('hex');
        try {
            await flush(req.user.id);
            if (await repeated(req, res, fingerprint)) return;
            const context = standalone ? { scope: 'general' }
                : await loadContext(pool, req.user.id, { mode: body.mode, batch_id: batchId, question_id: questionId });
            await enqueue(req, res, { scope, mode: body.mode, batchId, questionId, message, fingerprint,
                context: scope === 'general' ? { scope: 'general' } : context,
                ...(context ? {} : { rejectCode: 'AI_INVALID', rejectStatus: 404 }) });
        } catch (err) {
            noteError(res, err);
            if (!res.headersSent && !res.destroyed) res.status(503).json({ error: STORAGE_MESSAGE });
        }
    });

    router.post('/ai/conversations/:id/messages', async (req, res) => {
        const body = req.body || {};
        if (typeof body.request_id !== 'string' || !UUID.test(body.request_id) || typeof body.message !== 'string'
            || !body.message.trim() || body.message.length > 1000) {
            return res.status(400).json({ error: 'Введите уточнение длиной от 1 до 1000 символов' });
        }
        if (!UUID.test(req.params.id)) return res.status(404).json({ error: MESSAGES.AI_EXPIRED });
        const message = body.message.trim();
        const fingerprint = createHash('sha256').update(JSON.stringify([req.params.id, message])).digest('hex');
        try {
            await flush(req.user.id);
            if (await repeated(req, res, fingerprint)) return;
            const conv = await history.conversation(req.params.id, req.user.id, now());
            await enqueue(req, res, { conversationId: req.params.id, scope: conv?.scope || 'question',
                mode: conv?.mode || 'training', message, fingerprint,
                ...(conv ? {} : { rejectCode: 'AI_EXPIRED', rejectStatus: 404 }) });
        } catch (err) {
            noteError(res, err);
            if (!res.headersSent && !res.destroyed) res.status(503).json({ error: STORAGE_MESSAGE });
        }
    });

    router.get('/ai/jobs/:id', async (req, res) => {
        if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Запрос не найден или истёк. Начните новый диалог.' });
        try {
            await flush(req.user.id);
            const job = await history.job(req.params.id, req.user.id, now());
            if (!job) return res.status(404).json({ error: 'Запрос не найден или истёк. Начните новый диалог.' });
            res.json({ state: job.state === 'rejected' ? 'failed' : job.state, answer: job.answer,
                error: job.error_code ? MESSAGES[job.error_code] || MESSAGES.AI_UNAVAILABLE : undefined,
                sources: job.sources.map(({ title, url }) => ({ title, url })), turns: job.turns, max_turns: MAX_TURNS });
        } catch (err) {
            noteError(res, err);
            if (!res.headersSent && !res.destroyed) res.status(503).json({ error: STORAGE_MESSAGE });
        }
    });
    return router;
}

module.exports = { createAiRouter };
