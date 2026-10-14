-- История выданных порций с неизменяемым снимком вопросов и порядком показа.
-- Старые ответы остаются без порции: восстанавливать её по времени недостоверно.
BEGIN;

CREATE TABLE IF NOT EXISTS training_batches (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id integer REFERENCES categories(id) ON DELETE SET NULL,
    category_name text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('category', 'mistakes')),
    created_at timestamptz NOT NULL DEFAULT now(),
    questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0)
);
CREATE INDEX IF NOT EXISTS training_batches_user_created_idx
    ON training_batches(user_id, id DESC);

ALTER TABLE answer_log ADD COLUMN IF NOT EXISTS training_batch_id integer
    REFERENCES training_batches(id) ON DELETE SET NULL;
ALTER TABLE answer_log ADD COLUMN IF NOT EXISTS selected_answer varchar(8);
CREATE UNIQUE INDEX IF NOT EXISTS answer_log_training_question_key
    ON answer_log(training_batch_id, question_id) WHERE training_batch_id IS NOT NULL;

COMMIT;
