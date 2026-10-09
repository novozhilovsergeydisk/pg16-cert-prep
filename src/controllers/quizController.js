const pool = require('../config/db');

const INT4_MAX = 2147483647;

function parseId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id >= 1 && id <= INT4_MAX ? id : null;
}

async function getCategories(req, res) {
    try {
        const result = await pool.query('SELECT id, name FROM categories ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function getQuestions(req, res) {
    const categoryId = parseId(req.query.category_id);
    if (categoryId === null) {
        return res.status(400).json({ error: 'Некорректный category_id' });
    }
    try {
        const result = await pool.query(
            'SELECT id, category_id, question_text, options FROM questions WHERE category_id = $1 ORDER BY id',
            [categoryId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function postAnswer(req, res) {
    const body = req.body || {};
    const questionId = parseId(body.question_id);
    const answer = body.answer;
    if (questionId === null || typeof answer !== 'string' || !/^[A-Z]$/.test(answer)) {
        return res.status(400).json({ error: 'Некорректные question_id или answer' });
    }
    try {
        const result = await pool.query(
            'SELECT correct_answer, explanation FROM questions WHERE id = $1',
            [questionId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        const { correct_answer, explanation } = result.rows[0];
        res.json({
            correct: answer === correct_answer.trim(),
            correct_answer: correct_answer.trim(),
            explanation,
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

module.exports = { getCategories, getQuestions, postAnswer };
