const pool = require('../config/db');
const { noteError } = require('../middleware/requestLog');

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

// Правильные ответы и пояснения остаются только в серверном снимке.
function publicQuestion(q) {
    return { id: q.id, category_id: q.category_id, question_text: q.question_text,
        options: q.options, correct_count: q.correct_answer.length, order: q.order };
}

async function createTrainingBatch(req, res) {
    const body = req.body || {};
    const mode = body.mode === undefined ? 'category' : body.mode;
    const categoryId = parseId(body.category_id);
    const limit = body.limit === undefined ? 16 : parseId(body.limit);
    if (!['category', 'mistakes'].includes(mode) || (mode === 'category' && (!categoryId || !limit || limit > 200))) {
        return res.status(400).json({ error: 'Некорректные параметры тренировки' });
    }
    try {
        let name = 'Работа над ошибками';
        let rows;
        if (mode === 'category') {
            const category = await pool.query('SELECT name FROM categories WHERE id=$1', [categoryId]);
            if (!category.rowCount) return res.status(404).json({ error: 'Раздел не найден' });
            name = category.rows[0].name;
            rows = (await pool.query(
                `SELECT q.id, q.category_id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes
                 FROM questions q
                 LEFT JOIN LATERAL (
                     SELECT correct, answered_at FROM answer_log
                     WHERE user_id=$1 AND question_id=q.id
                     ORDER BY answered_at DESC, id DESC LIMIT 1
                 ) last ON true
                 WHERE q.category_id=$2
                 ORDER BY CASE WHEN last.answered_at IS NULL THEN 0 WHEN NOT last.correct THEN 1 ELSE 2 END,
                          CASE WHEN last.correct THEN last.answered_at END ASC NULLS FIRST, random()
                 LIMIT $3`, [req.user.id, categoryId, limit]
            )).rows;
        } else {
            rows = (await pool.query(
                `SELECT q.id, q.category_id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes
                 FROM questions q JOIN (
                     SELECT DISTINCT ON (question_id) question_id, correct FROM answer_log
                     WHERE user_id=$1 ORDER BY question_id, answered_at DESC, id DESC
                 ) last ON last.question_id=q.id WHERE NOT last.correct`, [req.user.id]
            )).rows;
        }
        if (!rows.length) return res.json({ id: null, questions: [] });
        const questions = shuffle(rows).map((q) => ({ ...q, order: shuffle(Object.keys(q.options)) }));
        const batch = await pool.query(
            `INSERT INTO training_batches(user_id, category_id, category_name, mode, questions)
             VALUES($1,$2,$3,$4,$5) RETURNING id, created_at`,
            [req.user.id, mode === 'category' ? categoryId : null, name, mode, JSON.stringify(questions)]
        );
        res.status(201).json({ ...batch.rows[0], questions: questions.map(publicQuestion) });
    } catch (err) {
        if (err.code === 'P0001' && err.constraint === 'snapshot_storage_quota') {
            return res.status(429).json({ error: 'Достигнут лимит сохранённых тренировок. Ранее сохранённые тренировки доступны в истории.' });
        }
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить порцию вопросов' });
    }
}

async function answerTrainingQuestion(req, res, questionId, answer) {
    const batchId = parseId(req.body.training_batch_id);
    if (!batchId) return res.status(400).json({ error: 'Некорректный номер порции' });
    try {
        const batch = await pool.query('SELECT questions FROM training_batches WHERE id=$1 AND user_id=$2', [batchId, req.user.id]);
        if (!batch.rowCount) return res.status(404).json({ error: 'Порция не найдена' });
        const question = batch.rows[0].questions.find((q) => q.id === questionId);
        if (!question) return res.status(400).json({ error: 'Вопрос не входит в эту порцию' });
        const correct = answer === question.correct_answer;
        const inserted = await pool.query(
            `INSERT INTO answer_log(user_id, question_id, correct, training_batch_id, selected_answer)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (training_batch_id, question_id) WHERE training_batch_id IS NOT NULL DO NOTHING
             RETURNING id`, [req.user.id, questionId, correct, batchId, answer]
        );
        if (!inserted.rowCount) {
            const previous = await pool.query(
                'SELECT selected_answer FROM answer_log WHERE training_batch_id=$1 AND question_id=$2 AND user_id=$3',
                [batchId, questionId, req.user.id]
            );
            if (previous.rows[0]?.selected_answer !== answer) {
                return res.status(409).json({ error: 'В этой порции ответ на вопрос уже сохранён' });
            }
        }
        res.json({ correct, correct_answer: question.correct_answer,
            explanation: question.explanation, option_notes: question.option_notes });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить ответ' });
    }
}

async function getTrainingBatches(req, res) {
    const before = req.query.before === undefined ? null : parseId(req.query.before);
    if (req.query.before !== undefined && before === null) return res.status(400).json({ error: 'Некорректный номер порции' });
    try {
        const result = await pool.query(
            `SELECT b.id, b.category_id, b.category_name, b.mode, b.created_at,
                    jsonb_array_length(b.questions) AS question_count,
                    (SELECT count(*)::int FROM answer_log l WHERE l.training_batch_id=b.id AND l.user_id=b.user_id) AS answered
             FROM training_batches b WHERE b.user_id=$1 AND ($2::int IS NULL OR b.id<$2)
             ORDER BY b.id DESC LIMIT 51`, [req.user.id, before]
        );
        const batches = result.rows.slice(0, 50);
        res.json({ batches, next_before: result.rows.length > 50 ? batches[49].id : null });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось прочитать историю тренировок' });
    }
}

async function getTrainingBatch(req, res) {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный номер порции' });
    try {
        const result = await pool.query(
            'SELECT id, category_id, category_name, mode, created_at, questions FROM training_batches WHERE id=$1 AND user_id=$2',
            [id, req.user.id]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Порция не найдена' });
        const batch = result.rows[0];
        const answers = (await pool.query(
            'SELECT question_id, selected_answer, correct, answered_at FROM answer_log WHERE training_batch_id=$1 AND user_id=$2',
            [id, req.user.id]
        )).rows;
        const byId = new Map(answers.map((a) => [a.question_id, a]));
        res.json({ ...batch, questions: batch.questions.map((q, index) => ({ ...publicQuestion(q),
            position: index + 1, answer: byId.get(q.id) || null })) });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось прочитать порцию вопросов' });
    }
}

async function resumeTrainingBatch(req, res) {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный номер порции' });
    try {
        const row = await pool.query('SELECT id,category_id,category_name,mode,questions FROM training_batches WHERE id=$1 AND user_id=$2', [id, req.user.id]);
        if (!row.rowCount) return res.status(404).json({ error: 'Порция не найдена' });
        const batch = row.rows[0];
        const answers = (await pool.query('SELECT question_id,selected_answer,correct FROM answer_log WHERE training_batch_id=$1 AND user_id=$2', [id, req.user.id])).rows;
        const saved = new Map(answers.map(a => [a.question_id, a]));
        res.json({ ...batch, questions: batch.questions.map(q => {
            const answer = saved.get(q.id);
            return { ...publicQuestion(q), answer: answer || null,
                result: answer ? { correct: answer.correct, correct_answer: q.correct_answer, explanation: q.explanation, option_notes: q.option_notes } : null };
        }) });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось восстановить тренировку. Попробуйте ещё раз.' });
    }
}

module.exports = { createTrainingBatch, answerTrainingQuestion, getTrainingBatches, getTrainingBatch, resumeTrainingBatch };
