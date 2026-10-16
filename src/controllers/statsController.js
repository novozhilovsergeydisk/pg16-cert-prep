const pool = require('../config/db');
const { noteError } = require('../middleware/requestLog');

const HISTORY_LIMIT = 50;
const HARD_LIMIT = 20;
const HARD_MIN_ANSWERS = 3;

// Практика по темам: сколько вопросов решено хотя бы раз, доля верных ответов,
// сколько вопросов сейчас в ошибках (последний ответ неверный).
async function topicStats(userId) {
    const result = await pool.query(
        `SELECT c.id, c.name,
                count(q.id)::int AS question_count,
                count(s.question_id)::int AS answered,
                CASE WHEN sum(s.total) > 0 THEN round(100.0 * sum(s.correct) / sum(s.total))::int END AS correct_percent,
                count(*) FILTER (WHERE s.mistake)::int AS mistakes
         FROM categories c
         LEFT JOIN questions q ON q.category_id = c.id
         LEFT JOIN (
             SELECT question_id,
                    count(*) AS total,
                    count(*) FILTER (WHERE correct) AS correct,
                    NOT (array_agg(correct ORDER BY answered_at DESC, id DESC))[1] AS mistake
             FROM answer_log
             WHERE user_id = $1
             GROUP BY question_id
         ) s ON s.question_id = q.id
         GROUP BY c.id
         ORDER BY c.name`,
        [userId]
    );
    return result.rows;
}

async function examHistory(userId) {
    const result = await pool.query(
        `SELECT id, finished_at, total, correct, percent, passed, duration_seconds
         FROM exam_history
         WHERE user_id = $1
         ORDER BY finished_at DESC, id DESC
         LIMIT $2`,
        [userId, HISTORY_LIMIT]
    );
    return result.rows;
}

async function getMyStats(req, res) {
    try {
        res.json({ topics: await topicStats(req.user.id) });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function getAdminUsers(req, res) {
    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.role, u.created_at, u.last_login_at,
                    coalesce(a.answers, 0)::int AS answers,
                    CASE WHEN a.answers > 0 THEN round(100.0 * a.correct / a.answers)::int END AS correct_percent,
                    coalesce(e.exams, 0)::int AS exams,
                    le.percent AS last_exam_percent,
                    le.passed AS last_exam_passed
             FROM users u
             LEFT JOIN (
                 SELECT user_id, count(*) AS answers, count(*) FILTER (WHERE correct) AS correct
                 FROM answer_log GROUP BY user_id
             ) a ON a.user_id = u.id
             LEFT JOIN (SELECT user_id, count(*) AS exams FROM exam_history GROUP BY user_id) e ON e.user_id = u.id
             LEFT JOIN LATERAL (
                 SELECT h.percent, h.passed FROM exam_history h
                 WHERE h.user_id = u.id
                 ORDER BY h.finished_at DESC, h.id DESC
                 LIMIT 1
             ) le ON true
             ORDER BY u.last_login_at DESC NULLS LAST, u.id`
        );
        res.json(result.rows);
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function getAdminUser(req, res) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Некорректный id' });
    }
    try {
        const user = await pool.query('SELECT id, email, role, created_at, last_login_at FROM users WHERE id = $1', [id]);
        if (user.rowCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json({ user: user.rows[0], topics: await topicStats(id), exams: await examHistory(id) });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

// Вопросы с самой высокой долей ошибок среди всех пользователей; учитываются вопросы,
// на которые ответили не меньше HARD_MIN_ANSWERS раз и хотя бы раз ошиблись.
async function getHardQuestions(req, res) {
    try {
        const result = await pool.query(
            `SELECT q.id, c.name AS category_name, q.question_text,
                    count(*)::int AS answers,
                    round(100.0 * count(*) FILTER (WHERE NOT l.correct) / count(*))::int AS error_percent
             FROM answer_log l
             JOIN questions q ON q.id = l.question_id
             JOIN categories c ON c.id = q.category_id
             GROUP BY q.id, c.name
             HAVING count(*) >= $1 AND count(*) FILTER (WHERE NOT l.correct) > 0
             ORDER BY count(*) FILTER (WHERE NOT l.correct)::numeric / count(*) DESC, count(*) DESC, q.id
             LIMIT $2`,
            [HARD_MIN_ANSWERS, HARD_LIMIT]
        );
        res.json(result.rows);
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

module.exports = { examHistory, getMyStats, getAdminUsers, getAdminUser, getHardQuestions };
