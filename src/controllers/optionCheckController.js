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
        return { question_id: q.id, key: pick(isCorrect ? right : wrong), is_correct: isCorrect };
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
            `SELECT q.id, q.question_text, q.options, q.correct_answer
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
        const question = (await pool.query(
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
        res.json({ right, option_fits: card.is_correct, option_note: question.option_notes[card.key] || '',
            explanation: question.explanation });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить ответ' });
    }
}

module.exports = { createOptionCheckBatch, postOptionCheck };
