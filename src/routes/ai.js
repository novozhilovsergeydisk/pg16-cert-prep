const express = require('express');
const { randomUUID, createHash } = require('node:crypto');
const { requireAuth: authenticate } = require('../middleware/auth');
const { noteError, logError } = require('../middleware/requestLog');
const { runGateway: transport } = require('../ai/transport');
const { loadContext } = require('../ai/context');

const TTL_MS = 15 * 60 * 1000;
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
};

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
    runGateway = transport, configuration = settings, now = Date.now } = {}) {
    const router = express.Router();
    const conversations = new Map();
    const jobs = new Map();
    const requests = new Map();
    const active = new Set();
    let attempts = [];
    const allowed = (user) => {
        const config = configuration();
        return config.enabled && user && user.id === config.ownerId;
    };
    const clean = () => {
        for (const [key, value] of conversations) if (value.expires <= now() && !active.has(value.userId)) conversations.delete(key);
        for (const [key, value] of jobs) if (value.expires <= now() && value.state !== 'pending') jobs.delete(key);
        for (const [key, value] of requests) if (!jobs.has(value.jobId)) requests.delete(key);
        attempts = attempts.filter((time) => time > now() - 86400000);
    };

    router.use('/ai', requireAuth);
    router.use('/ai', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/ai/status', (req, res) => res.json({ enabled: Boolean(allowed(req.user)) }));
    router.use('/ai', (req, res, next) => {
        if (!allowed(req.user)) return res.status(404).json({ error: 'ИИ недоступен для этого аккаунта' });
        clean();
        next();
    });

    function repeated(req, res, fingerprint) {
        const previous = requests.get(req.body.request_id);
        if (!previous) return false;
        if (previous.userId !== req.user.id || previous.fingerprint !== fingerprint) {
            res.status(409).json({ error: 'Параметры повторного запроса изменились. Повторите действие.' });
        } else {
            const job = jobs.get(previous.jobId);
            res.status(202).json({ job_id: job.id, conversation_id: job.conversationId });
        }
        return true;
    }

    function reserve(req, res) {
        if (active.has(req.user.id)) {
            res.status(409).json({ error: MESSAGES.AI_BUSY });
            return false;
        }
        if (attempts.length >= 30 || attempts.filter((time) => time > now() - 600000).length >= 10) {
            res.status(429).json({ error: 'Достигнут лимит запросов к ИИ. Попробуйте позже.' });
            return false;
        }
        if (conversations.size >= 20 || jobs.size >= 120) {
            res.status(429).json({ error: 'Слишком много диалогов. Подождите 15 минут.' });
            return false;
        }
        attempts.push(now());
        active.add(req.user.id);
        return true;
    }

    function enqueue(req, res, conversation, message, fingerprint) {
        const job = { id: randomUUID(), userId: req.user.id, conversationId: conversation.id,
            state: 'pending', expires: now() + TTL_MS };
        jobs.set(job.id, job);
        requests.set(req.body.request_id, { userId: req.user.id, fingerprint, jobId: job.id });
        conversation.expires = job.expires;
        const messages = [...conversation.messages, { role: 'user', content: message }];
        // Сразу возвращаем 202: ни один HTTP-запрос не ждёт генерацию модели.
        res.status(202).json({ job_id: job.id, conversation_id: conversation.id });
        Promise.resolve().then(() => runGateway({ context: conversation.context, messages })).then((result) => {
            if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 12000) {
                const err = new Error('Invalid AI answer'); err.code = 'AI_INVALID'; throw err;
            }
            conversation.messages = [...messages, { role: 'assistant', content: result.answer }];
            conversation.turns += 1;
            job.state = 'done';
            job.answer = result.answer;
            job.turns = conversation.turns;
            job.sources = (conversation.context.references || []).map(({ title, url }) => ({ title, url }));
        }).catch((err) => {
            logError('ai_gateway', err);
            job.state = 'failed';
            job.error = MESSAGES[err.code] || MESSAGES.AI_UNAVAILABLE;
        }).finally(() => {
            active.delete(req.user.id);
        });
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
        if (repeated(req, res, fingerprint) || !reserve(req, res)) return;
        try {
            const context = standalone ? { scope: 'general' }
                : await loadContext(pool, req.user.id, { mode: body.mode, batch_id: batchId, question_id: questionId });
            if (!context) {
                active.delete(req.user.id);
                return res.status(404).json({ error: 'Сначала ответьте на вопрос в этой порции' });
            }
            const conversation = { id: randomUUID(), userId: req.user.id,
                context: scope === 'general' ? { scope: 'general' } : context,
                messages: [], turns: 0, expires: now() + TTL_MS };
            conversations.set(conversation.id, conversation);
            enqueue(req, res, conversation, message, fingerprint);
        } catch (err) {
            active.delete(req.user.id);
            noteError(res, err);
            res.status(503).json({ error: MESSAGES[err.code] || 'Не удалось прочитать вопрос. Попробуйте позже.' });
        }
    });

    router.post('/ai/conversations/:id/messages', (req, res) => {
        const body = req.body || {};
        if (typeof body.request_id !== 'string' || !UUID.test(body.request_id) || typeof body.message !== 'string'
            || !body.message.trim() || body.message.length > 1000) {
            return res.status(400).json({ error: 'Введите уточнение длиной от 1 до 1000 символов' });
        }
        const conversation = conversations.get(req.params.id);
        if (!conversation || conversation.userId !== req.user.id) {
            return res.status(404).json({ error: 'Диалог истёк. Начните новый диалог.' });
        }
        const message = body.message.trim();
        const fingerprint = createHash('sha256').update(JSON.stringify([conversation.id, message])).digest('hex');
        if (repeated(req, res, fingerprint)) return;
        if (conversation.turns >= MAX_TURNS || Buffer.byteLength(JSON.stringify(conversation.messages)) > 48000) {
            return res.status(409).json({ error: 'Диалог слишком длинный. Начните новый диалог.' });
        }
        if (!reserve(req, res)) return;
        enqueue(req, res, conversation, message, fingerprint);
    });

    router.get('/ai/jobs/:id', (req, res) => {
        const job = jobs.get(req.params.id);
        if (!job || job.userId !== req.user.id) {
            return res.status(404).json({ error: 'Запрос не найден или истёк. Начните новый диалог.' });
        }
        res.json({ state: job.state, answer: job.answer, error: job.error, sources: job.sources,
            turns: job.turns, max_turns: MAX_TURNS });
    });

    return router;
}

module.exports = { createAiRouter };
