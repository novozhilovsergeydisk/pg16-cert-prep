const pool = require('../config/db');

const INT4_MAX = 2147483647;

function parseId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id >= 1 && id <= INT4_MAX ? id : null;
}

const EXAM_DEFAULT_COUNT = 30;
const EXAM_MAX_COUNT = 200;
const EXAM_PASS_PERCENT = 70;

// Ответ — одна или несколько букв A–Z без повторов (до 8); порядок не важен, приводится к алфавитному.
function normalizeAnswer(value) {
    if (typeof value !== 'string' || !/^[A-Z]{1,8}$/.test(value)) return null;
    const letters = value.split('');
    if (new Set(letters).size !== letters.length) return null;
    return letters.sort().join('');
}

function parseIdList(value) {
    if (typeof value !== 'string' || value === '') return null;
    const parts = value.split(',');
    if (parts.length > 50) return null;
    const ids = parts.map(parseId);
    if (ids.some((id) => id === null)) return null;
    return [...new Set(ids)];
}

// Журнал ответов нужен режиму «Работа над ошибками». Сбой записи не должен ломать проверку ответа.
async function logAnswers(entries) {
    if (entries.length === 0) return;
    try {
        await pool.query(
            'INSERT INTO answer_log (question_id, correct) SELECT * FROM unnest($1::int[], $2::boolean[])',
            [entries.map((e) => e.questionId), entries.map((e) => e.correct)]
        );
    } catch (err) {
        // журнал вторичен: ответ пользователю всё равно отдаётся
    }
}

async function getCategories(req, res) {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, count(q.id)::int AS question_count
             FROM categories c
             LEFT JOIN questions q ON q.category_id = c.id
             GROUP BY c.id
             ORDER BY c.name`
        );
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
            'SELECT id, category_id, question_text, options, length(correct_answer) AS correct_count FROM questions WHERE category_id = $1 ORDER BY id',
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
    const answer = normalizeAnswer(body.answer);
    if (questionId === null || answer === null) {
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
        const correct = answer === correct_answer;
        await logAnswers([{ questionId, correct }]);
        res.json({
            correct,
            correct_answer,
            explanation,
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function getExam(req, res) {
    const count = req.query.count === undefined ? EXAM_DEFAULT_COUNT : parseId(req.query.count);
    if (count === null || count > EXAM_MAX_COUNT) {
        return res.status(400).json({ error: 'Некорректный count' });
    }
    let categoryIds = null;
    if (req.query.categories !== undefined) {
        categoryIds = parseIdList(req.query.categories);
        if (categoryIds === null) {
            return res.status(400).json({ error: 'Некорректный categories' });
        }
    }
    try {
        const result = categoryIds === null
            ? await pool.query(
                'SELECT id, category_id, question_text, options, length(correct_answer) AS correct_count FROM questions ORDER BY random() LIMIT $1',
                [count]
            )
            : await pool.query(
                'SELECT id, category_id, question_text, options, length(correct_answer) AS correct_count FROM questions WHERE category_id = ANY($1::int[]) ORDER BY random() LIMIT $2',
                [categoryIds, count]
            );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function postExamCheck(req, res) {
    const body = req.body || {};
    const items = body.answers;
    if (!Array.isArray(items) || items.length < 1 || items.length > EXAM_MAX_COUNT) {
        return res.status(400).json({ error: 'Некорректные answers' });
    }
    const submitted = [];
    const seen = new Set();
    for (const item of items) {
        const questionId = item && typeof item === 'object' ? parseId(item.question_id) : null;
        const raw = item ? item.answer : undefined;
        const answer = raw === null ? null : normalizeAnswer(raw);
        if (questionId === null || (raw !== null && answer === null) || seen.has(questionId)) {
            return res.status(400).json({ error: 'Некорректные answers' });
        }
        seen.add(questionId);
        submitted.push({ questionId, answer });
    }
    try {
        const result = await pool.query(
            'SELECT id, category_id, correct_answer, explanation FROM questions WHERE id = ANY($1::int[])',
            [submitted.map((s) => s.questionId)]
        );
        if (result.rowCount !== submitted.length) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        const byId = new Map(result.rows.map((row) => [row.id, row]));
        const results = submitted.map(({ questionId, answer }) => {
            const row = byId.get(questionId);
            const correctAnswer = row.correct_answer;
            return {
                question_id: questionId,
                category_id: row.category_id,
                answer,
                correct_answer: correctAnswer,
                correct: answer === correctAnswer,
                explanation: row.explanation,
            };
        });
        await logAnswers(results.filter((r) => r.answer !== null).map((r) => ({ questionId: r.question_id, correct: r.correct })));
        const correct = results.filter((r) => r.correct).length;
        const percent = Math.round((correct * 100) / results.length);
        res.json({
            total: results.length,
            correct,
            percent,
            pass_percent: EXAM_PASS_PERCENT,
            passed: percent >= EXAM_PASS_PERCENT,
            results,
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

// Вопросы, на которые последний ответ был неверным.
async function getMistakes(req, res) {
    try {
        const result = await pool.query(
            `SELECT q.id, q.category_id, q.question_text, q.options, length(q.correct_answer) AS correct_count
             FROM questions q
             JOIN (
                 SELECT DISTINCT ON (question_id) question_id, correct
                 FROM answer_log
                 ORDER BY question_id, answered_at DESC, id DESC
             ) last ON last.question_id = q.id
             WHERE NOT last.correct
             ORDER BY q.id`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

module.exports = { getCategories, getQuestions, postAnswer, getExam, postExamCheck, getMistakes };
