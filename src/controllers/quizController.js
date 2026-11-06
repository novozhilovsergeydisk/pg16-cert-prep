const pool = require('../config/db');
const { noteError, logError } = require('../middleware/requestLog');
const { examHistory } = require('./statsController');
const { answerTrainingQuestion } = require('./trainingController');

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
        logError('answer_log', err);
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
        noteError(res, err);
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
        noteError(res, err);
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
    if (body.training_batch_id !== undefined) return answerTrainingQuestion(req, res, questionId, answer);
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
        noteError(res, err);
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
        noteError(res, err);
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
    const submissionId = body.submission_id ?? null;
    if (submissionId !== null && (typeof submissionId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId))) {
        return res.status(400).json({ error: 'Некорректный идентификатор экзамена' });
    }
    const replay = (row) => {
        const snapshot = row.snapshot;
        const same = snapshot.results.length === submitted.length && submitted.every((s, i) =>
            snapshot.results[i].question_id === s.questionId && snapshot.results[i].answer === s.answer
            && (items[i].order === undefined || JSON.stringify(items[i].order) === JSON.stringify(snapshot.questions[i].order)));
        if (!same) return res.status(409).json({ error: 'Этот экзамен уже завершён с другими ответами' });
        return res.json({ ...snapshot, history_id: row.id });
    };
    let client;
    let broken = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        if (submissionId) {
            const saved = await client.query('SELECT id, snapshot FROM exam_history WHERE user_id=$1 AND submission_id=$2', [req.user.id, submissionId]);
            if (saved.rowCount) {
                await client.query('COMMIT');
                return replay(saved.rows[0]);
            }
        }
        const found = await client.query(
            `SELECT q.id, q.category_id, c.name AS category_name, q.question_text, q.options,
                    q.correct_answer, q.explanation, q.option_notes
             FROM questions q JOIN categories c ON c.id=q.category_id WHERE q.id=ANY($1::int[])`,
            [submitted.map(s => s.questionId)]
        );
        if (found.rowCount !== submitted.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        const byId = new Map(found.rows.map(row => [row.id, row]));
        const questions = [];
        const results = [];
        for (const [i, { questionId, answer }] of submitted.entries()) {
            const q = byId.get(questionId);
            const keys = Object.keys(q.options);
            const order = items[i].order === undefined ? keys : items[i].order;
            if (!Array.isArray(order) || order.length !== keys.length || new Set(order).size !== keys.length
                || order.some(k => !keys.includes(k))) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Некорректный порядок вариантов' });
            }
            questions.push({ id: q.id, category_id: q.category_id, category_name: q.category_name,
                question_text: q.question_text, options: q.options, order, correct_count: q.correct_answer.length });
            results.push({ question_id: q.id, category_id: q.category_id, answer,
                correct_answer: q.correct_answer, correct: answer === q.correct_answer,
                explanation: q.explanation, option_notes: q.option_notes });
        }
        const correct = results.filter(r => r.correct).length;
        const percent = Math.round(correct * 100 / results.length);
        const snapshot = { total: results.length, correct, percent, pass_percent: EXAM_PASS_PERCENT,
            passed: percent >= EXAM_PASS_PERCENT, duration_seconds: durationSeconds, questions, results };
        const inserted = await client.query(
            `INSERT INTO exam_history (user_id,total,correct,percent,passed,duration_seconds,snapshot,submission_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
             ON CONFLICT (user_id,submission_id) DO NOTHING RETURNING id`,
            [req.user.id,snapshot.total,correct,percent,snapshot.passed,durationSeconds,JSON.stringify(snapshot),submissionId]
        );
        if (!inserted.rowCount) {
            const saved = await client.query('SELECT id,snapshot FROM exam_history WHERE user_id=$1 AND submission_id=$2', [req.user.id,submissionId]);
            await client.query('COMMIT');
            return replay(saved.rows[0]);
        }
        const answered = results.filter(r => r.answer !== null);
        if (answered.length) await client.query(
            'INSERT INTO answer_log (user_id,question_id,correct) SELECT $1::int,* FROM unnest($2::int[],$3::boolean[])',
            [req.user.id,answered.map(r => r.question_id),answered.map(r => r.correct)]
        );
        await client.query('COMMIT');
        res.json({ ...snapshot, history_id: inserted.rows[0].id });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); }
            catch (rollbackError) { broken = true; logError('exam_rollback', rollbackError); }
        }
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось подтвердить сохранение экзамена. Повторите отправку — результат не продублируется.' });
    } finally {
        if (client) client.release(broken);
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
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

// Последние завершённые экзамены пользователя, новые сверху.
async function getExamHistory(req, res) {
    try {
        res.json(await examHistory(req.user.id));
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

// Снимок доступен только владельцу; отсутствие записи и чужой результат неразличимы.
async function getExamReview(req, res) {
    const id = req.params.id;
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
        return res.status(404).json({ error: 'Разбор экзамена недоступен' });
    }
    try {
        const result = await pool.query(
            'SELECT id,snapshot FROM exam_history WHERE id=$1 AND user_id=$2 AND snapshot IS NOT NULL', [id,req.user.id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Разбор экзамена недоступен' });
        res.json({ ...result.rows[0].snapshot, history_id: result.rows[0].id });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось загрузить разбор экзамена. Попробуйте ещё раз.' });
    }
}

module.exports = { getCategories, getQuestions, postAnswer, getExam, postExamCheck, getMistakes, getExamHistory, getExamReview };
