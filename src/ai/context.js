const { forTopic } = require('./references');
const { failure } = require('./transport');

async function loadContext(pool, userId, { mode, batch_id: batchId, question_id: questionId }) {
    let row;
    if (mode === 'training') {
        row = (await pool.query(
            `SELECT q AS question, a.selected_answer, c.name AS category_name
             FROM training_batches b
             JOIN answer_log a ON a.training_batch_id=b.id AND a.user_id=b.user_id AND a.question_id=$3
             CROSS JOIN LATERAL jsonb_array_elements(b.questions) q
             LEFT JOIN categories c ON c.id=(q->>'category_id')::int
             WHERE b.id=$1 AND b.user_id=$2 AND (q->>'id')::int=$3`,
            [batchId, userId, questionId]
        )).rows[0];
    } else {
        row = (await pool.query(
            `SELECT COALESCE(card->'snapshot'->'question', jsonb_build_object('question_text', q.question_text, 'options', q.options,
                    'correct_answer', q.correct_answer, 'explanation', q.explanation,
                    'option_notes', q.option_notes)) AS question,
                    a.option_key, a.fits, b.category_name
             FROM option_check_answers a
             JOIN option_check_batches b ON b.id=a.batch_id AND b.user_id=a.user_id
             CROSS JOIN LATERAL jsonb_array_elements(b.cards) card
             JOIN questions q ON q.id=a.question_id
             WHERE a.batch_id=$1 AND a.user_id=$2 AND a.question_id=$3 AND (card->>'question_id')::int=$3`,
            [batchId, userId, questionId]
        )).rows[0];
    }
    if (!row) return null;
    const q = row.question;
    const order = mode === 'training' && Array.isArray(q.order) ? q.order : Object.keys(q.options);
    const letter = (key) => String.fromCharCode(65 + order.indexOf(key));
    const letters = (answer) => [...(answer || '')].map(letter).sort().join('');
    const context = {
        version: 'PostgreSQL 16', mode, topic: row.category_name,
        question: q.question_text,
        options: Object.fromEntries(order.map((key) => [letter(key), q.options[key]])),
        correct_answer: letters(q.correct_answer), explanation: q.explanation || '',
        option_notes: Object.fromEntries(order.map((key) => [letter(key), (q.option_notes || {})[key] || ''])),
        selected_answer: mode === 'training' ? letters(row.selected_answer)
            : { option_text: q.options[row.option_key], fits: row.fits },
        references: forTopic(row.category_name),
    };
    // Не обрезаем пояснения посередине: это могло бы изменить смысл вопроса.
    if (Buffer.byteLength(JSON.stringify(context)) > 32000) throw failure('AI_INVALID');
    return context;
}

module.exports = { loadContext };
