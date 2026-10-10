const pool = require('../config/db');
const { examHistory } = require('./statsController');

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
const MAX_DURATION_SECONDS = 24 * 3600;

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

// Журнал ответов пользователя нужен режиму «Работа над ошибками» и статистике. Сбой записи не должен ломать проверку ответа.
async function logAnswers(userId, entries) {
    if (entries.length === 0) return;
    try {
        await pool.query(
            'INSERT INTO answer_log (user_id, question_id, correct) SELECT $1::int, * FROM unnest($2::int[], $3::boolean[])',
            [userId, entries.map((e) => e.questionId), entries.map((e) => e.correct)]
        );
    } catch (err) {
        // журнал вторичен: ответ пользователю всё равно отдаётся
    }
}

// История экзаменов вторична: сбой записи не должен ломать выдачу результата.
async function saveExam(userId, { total, correct, percent, passed, durationSeconds }) {
    try {
        await pool.query(
            'INSERT INTO exam_history (user_id, total, correct, percent, passed, duration_seconds) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, total, correct, percent, passed, durationSeconds]
        );
    } catch (err) {
        // результат всё равно отдаётся пользователю
    }
}

async function getCategories(req, res) {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.in_exam, count(q.id)::int AS question_count
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
    const limit = req.query.limit === undefined ? null : parseId(req.query.limit);
    if (req.query.limit !== undefined && (limit === null || limit > EXAM_MAX_COUNT)) {
        return res.status(400).json({ error: 'Некорректный limit' });
    }
    try {
        // Без limit — все вопросы темы. С limit — порция с умным выбором по ответам этого пользователя:
        // сначала невиденные, затем те, где последний ответ неверный, затем отвеченные верно — давно отвеченные раньше.
        const result = limit === null
            ? await pool.query(
                'SELECT id, category_id, question_text, options, length(correct_answer) AS correct_count FROM questions WHERE category_id = $1 ORDER BY id',
                [categoryId]
            )
            : await pool.query(
                `SELECT q.id, q.category_id, q.question_text, q.options, length(q.correct_answer) AS correct_count
                 FROM questions q
                 LEFT JOIN LATERAL (
                     SELECT l.correct, l.answered_at
                     FROM answer_log l
                     WHERE l.user_id = $3 AND l.question_id = q.id
                     ORDER BY l.answered_at DESC, l.id DESC
                     LIMIT 1
                 ) last ON true
                 WHERE q.category_id = $1
                 ORDER BY CASE WHEN last.answered_at IS NULL THEN 0 WHEN NOT last.correct THEN 1 ELSE 2 END,
                          CASE WHEN last.correct THEN last.answered_at END ASC NULLS FIRST,
                          random()
                 LIMIT $2`,
                [categoryId, limit, req.user.id]
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
            'SELECT correct_answer, explanation, option_notes FROM questions WHERE id = $1',
            [questionId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        const { correct_answer, explanation, option_notes } = result.rows[0];
        const correct = answer === correct_answer;
        await logAnswers(req.user.id, [{ questionId, correct }]);
        res.json({
            correct,
            correct_answer,
            explanation,
            option_notes,
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
                // Без явного выбора тем — только темы, входящие в экзамен.
                `SELECT q.id, q.category_id, q.question_text, q.options, length(q.correct_answer) AS correct_count
                 FROM questions q JOIN categories c ON c.id = q.category_id
                 WHERE c.in_exam
                 ORDER BY random() LIMIT $1`,
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
    let durationSeconds = null;
    if (body.duration_seconds !== undefined && body.duration_seconds !== null) {
        const d = body.duration_seconds;
        if (!Number.isInteger(d) || d < 0 || d > MAX_DURATION_SECONDS) {
            return res.status(400).json({ error: 'Некорректный duration_seconds' });
        }
        durationSeconds = d;
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
            'SELECT id, category_id, correct_answer, explanation, option_notes FROM questions WHERE id = ANY($1::int[])',
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
                option_notes: row.option_notes,
            };
        });
        await logAnswers(req.user.id, results.filter((r) => r.answer !== null).map((r) => ({ questionId: r.question_id, correct: r.correct })));
        const correct = results.filter((r) => r.correct).length;
        const percent = Math.round((correct * 100) / results.length);
        await saveExam(req.user.id, {
            total: results.length,
            correct,
            percent,
            passed: percent >= EXAM_PASS_PERCENT,
            durationSeconds,
        });
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

// Вопросы, на которые последний ответ пользователя был неверным.
async function getMistakes(req, res) {
    try {
        const result = await pool.query(
            `SELECT q.id, q.category_id, q.question_text, q.options, length(q.correct_answer) AS correct_count
             FROM questions q
             JOIN (
                 SELECT DISTINCT ON (question_id) question_id, correct
                 FROM answer_log
                 WHERE user_id = $1
                 ORDER BY question_id, answered_at DESC, id DESC
             ) last ON last.question_id = q.id
             WHERE NOT last.correct
             ORDER BY q.id`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

// Последние завершённые экзамены пользователя, новые сверху.
async function getExamHistory(req, res) {
    try {
        res.json(await examHistory(req.user.id));
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

module.exports = { getCategories, getQuestions, postAnswer, getExam, postExamCheck, getMistakes, getExamHistory };
