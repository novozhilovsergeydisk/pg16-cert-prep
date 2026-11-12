const pool = require('../config/db');
const { noteError } = require('../middleware/requestLog');

const BATCH_SIZE = 16;

function parseId(value) {
    if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

const pick = (items) => items[Math.floor(Math.random() * items.length)];

// Карточки порции: каждый вопрос один раз, показывается один вариант. Верных и неверных вариантов поровну
// (при нечётном числе вопросов лишняя карточка случайно достаётся одной из сторон). Если у вопроса нет
// неверных вариантов, на нём показывается верный.
function buildCards(rows) {
    const total = rows.length;
    const trueCount = Math.floor(total / 2) + (total % 2 && Math.random() < 0.5 ? 1 : 0);
    const wanted = shuffle(rows.map((_, i) => i < trueCount));
    return rows.map((q, i) => {
        const keys = Object.keys(q.options);
        const right = keys.filter((key) => q.correct_answer.includes(key));
        const wrong = keys.filter((key) => !q.correct_answer.includes(key));
        const isCorrect = wanted[i] || wrong.length === 0;
        const key = pick(isCorrect ? right : wrong);
        return { question_id: q.id, key, is_correct: isCorrect,
            snapshot: { question_text: q.question_text, option_text: q.options[key], multi: q.correct_answer.length > 1,
                explanation: q.explanation, option_note: (q.option_notes || {})[key] || '',
                question: { question_text: q.question_text, options: q.options, correct_answer: q.correct_answer,
                    explanation: q.explanation, option_notes: q.option_notes } } };
    });
}

// Браузеру уходит вопрос и один вариант; верный он или нет, остаётся только на сервере.
function publicCard(card, question) {
    return {
        question_id: card.question_id,
        question_text: question.question_text,
        option_text: question.options[card.key],
        multi: question.correct_answer.length > 1,
    };
}

async function createOptionCheckBatch(req, res) {
    const body = req.body || {};
    const categoryId = parseId(body.category_id);
    if (!categoryId) return res.status(400).json({ error: 'Некорректные параметры' });
    try {
        const category = await pool.query('SELECT name FROM categories WHERE id=$1', [categoryId]);
        if (!category.rowCount) return res.status(404).json({ error: 'Раздел не найден' });
        // Сначала вопросы, которые пользователь в этом режиме ещё не видел или видел давнее всех.
        const rows = (await pool.query(
            `SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes
             FROM questions q
             LEFT JOIN LATERAL (
                 SELECT max(answered_at) AS last_at FROM option_check_answers WHERE user_id=$1 AND question_id=q.id
             ) seen ON true
             WHERE q.category_id=$2
             ORDER BY seen.last_at ASC NULLS FIRST, random()
             LIMIT $3`, [req.user.id, categoryId, BATCH_SIZE]
        )).rows;
        if (!rows.length) return res.json({ id: null, cards: [] });
        const ordered = shuffle(rows);
        const cards = buildCards(ordered);
        const batch = await pool.query(
            `INSERT INTO option_check_batches(user_id, category_id, category_name, cards)
             VALUES($1,$2,$3,$4) RETURNING id, created_at`,
            [req.user.id, categoryId, category.rows[0].name, JSON.stringify(cards)]
        );
        res.status(201).json({ ...batch.rows[0], category_name: category.rows[0].name,
            cards: cards.map((card, i) => publicCard(card, ordered[i])) });
    } catch (err) {
        if (err.code === 'P0001' && err.constraint === 'snapshot_storage_quota') {
            return res.status(429).json({ error: 'Достигнут лимит сохранённых тренировок. Ранее сохранённые тренировки доступны в истории.' });
        }
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось подготовить карточки' });
    }
}

async function postOptionCheck(req, res) {
    const body = req.body || {};
    const batchId = parseId(body.batch_id);
    const questionId = parseId(body.question_id);
    if (!batchId || !questionId || typeof body.fits !== 'boolean') {
        return res.status(400).json({ error: 'Некорректные параметры ответа' });
    }
    try {
        const batch = await pool.query('SELECT cards FROM option_check_batches WHERE id=$1 AND user_id=$2', [batchId, req.user.id]);
        if (!batch.rowCount) return res.status(404).json({ error: 'Порция не найдена' });
        const card = batch.rows[0].cards.find((item) => item.question_id === questionId);
        if (!card) return res.status(400).json({ error: 'Вопрос не входит в эту порцию' });
        const question = card.snapshot ? { explanation: card.snapshot.explanation, option_notes: { [card.key]: card.snapshot.option_note } } : (await pool.query(
            'SELECT explanation, option_notes FROM questions WHERE id=$1', [questionId]
        )).rows[0];
        if (!question) return res.status(404).json({ error: 'Вопрос не найден' });
        const right = body.fits === card.is_correct;
        const inserted = await pool.query(
            `INSERT INTO option_check_answers(user_id, batch_id, question_id, option_key, fits, option_is_correct, is_right)
             VALUES($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (batch_id, question_id) DO NOTHING RETURNING id`,
            [req.user.id, batchId, questionId, card.key, body.fits, card.is_correct, right]
        );
        if (!inserted.rowCount) {
            const previous = await pool.query(
                'SELECT fits FROM option_check_answers WHERE batch_id=$1 AND question_id=$2 AND user_id=$3',
                [batchId, questionId, req.user.id]
            );
            if (previous.rows[0]?.fits !== body.fits) {
                return res.status(409).json({ error: 'Ответ на эту карточку уже сохранён' });
            }
        }
        res.json({ right, option_fits: card.is_correct, option_note: (question.option_notes || {})[card.key] || '',
            explanation: question.explanation });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить ответ' });
    }
}

async function resumeOptionCheckBatch(req, res) {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный номер порции' });
    try {
        const row = await pool.query('SELECT id,category_id,category_name,cards FROM option_check_batches WHERE id=$1 AND user_id=$2', [id, req.user.id]);
        if (!row.rowCount) return res.status(404).json({ error: 'Порция не найдена' });
        const batch = row.rows[0];
        const answers = (await pool.query('SELECT question_id,fits,is_right,option_is_correct FROM option_check_answers WHERE batch_id=$1 AND user_id=$2', [id, req.user.id])).rows;
        const saved = new Map(answers.map(a => [a.question_id, a]));
        const missing = batch.cards.filter(c => !c.snapshot).map(c => c.question_id);
        const oldQuestions = missing.length ? (await pool.query('SELECT id,question_text,options,correct_answer,explanation,option_notes FROM questions WHERE id=ANY($1::int[])', [missing])).rows : [];
        const byId = new Map(oldQuestions.map(q => [q.id, q]));
        const cards = batch.cards.map(card => {
            const q = byId.get(card.question_id);
            const snapshot = card.snapshot || (q && { ...publicCard(card, q), explanation: q.explanation, option_note: (q.option_notes || {})[card.key] || '' });
            if (!snapshot) return null;
            const answer = saved.get(card.question_id);
            return { question_id: card.question_id, question_text: snapshot.question_text, option_text: snapshot.option_text, multi: snapshot.multi,
                answer: answer ? { fits: answer.fits } : null,
                result: answer ? { right: answer.is_right, option_fits: answer.option_is_correct, explanation: snapshot.explanation, option_note: snapshot.option_note } : null };
        });
        if (cards.some(c => !c)) return res.status(409).json({ error: 'Часть старой порции больше недоступна. Откройте тему для новой тренировки.' });
        res.json({ id: batch.id, category_id: batch.category_id, category_name: batch.category_name, cards });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось восстановить карточки. Попробуйте ещё раз.' });
    }
}

module.exports = { createOptionCheckBatch, postOptionCheck, resumeOptionCheckBatch };
