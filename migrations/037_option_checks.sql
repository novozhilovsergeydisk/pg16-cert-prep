-- Режим «Подходит или нет»: порция карточек «вопрос и один вариант ответа» и ответы на них.
-- Таблицы отдельные: ответы нового режима не влияют на «решено N из M», работу над ошибками и статистику.
-- Повторный запуск безопасен.

BEGIN;

CREATE TABLE IF NOT EXISTS option_check_batches (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id integer REFERENCES categories(id) ON DELETE SET NULL,
    category_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- [{question_id, key, is_correct}]: какой вариант показан и верный ли он; правильность задаётся при выдаче порции
    cards jsonb NOT NULL CHECK (jsonb_typeof(cards) = 'array' AND jsonb_array_length(cards) > 0)
);
CREATE INDEX IF NOT EXISTS option_check_batches_user_idx ON option_check_batches(user_id, id DESC);

CREATE TABLE IF NOT EXISTS option_check_answers (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id integer NOT NULL REFERENCES option_check_batches(id) ON DELETE CASCADE,
    question_id integer NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_key varchar(1) NOT NULL,
    fits boolean NOT NULL,
    option_is_correct boolean NOT NULL,
    is_right boolean NOT NULL,
    answered_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, question_id)
);
CREATE INDEX IF NOT EXISTS option_check_answers_user_idx ON option_check_answers(user_id, answered_at DESC);

COMMIT;
