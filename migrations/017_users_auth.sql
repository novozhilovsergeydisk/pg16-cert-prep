-- Пользователи, вход по ссылке из письма, сеансы и роли (user, admin).
-- Журнал ответов и история экзаменов становятся личными: у каждой записи есть пользователь.
-- Накопленные записи переходят к владельцу сайта, он же первый админ.
--
-- Запуск (email владельца передаётся параметром и в репозиторий не попадает):
--   psql -v ON_ERROR_STOP=1 -v owner_email=<email> -f migrations/017_users_auth.sql
-- Без параметра owner_email миграция завершится ошибкой и ничего не изменит.
-- Повторно не запускать: таблицы уже будут созданы.

BEGIN;

CREATE TABLE users (
    id            serial PRIMARY KEY,
    email         text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Одноразовые ссылки для входа: хранится только SHA-256 токена.
CREATE TABLE login_tokens (
    token_hash bytea PRIMARY KEY,
    email      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX login_tokens_email_idx ON login_tokens (email, created_at DESC);

-- Сеансы: хранится только SHA-256 идентификатора из cookie.
CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

INSERT INTO users (email, role) VALUES (lower(trim(:'owner_email')), 'admin');

ALTER TABLE answer_log ADD COLUMN user_id integer REFERENCES users (id) ON DELETE CASCADE;
UPDATE answer_log SET user_id = (SELECT id FROM users WHERE role = 'admin');
ALTER TABLE answer_log ALTER COLUMN user_id SET NOT NULL;
DROP INDEX answer_log_question_idx;
CREATE INDEX answer_log_user_question_idx ON answer_log (user_id, question_id, answered_at DESC, id DESC);
CREATE INDEX answer_log_question_idx ON answer_log (question_id);

ALTER TABLE exam_history ADD COLUMN user_id integer REFERENCES users (id) ON DELETE CASCADE;
UPDATE exam_history SET user_id = (SELECT id FROM users WHERE role = 'admin');
ALTER TABLE exam_history ALTER COLUMN user_id SET NOT NULL;
DROP INDEX exam_history_finished_idx;
CREATE INDEX exam_history_user_finished_idx ON exam_history (user_id, finished_at DESC, id DESC);

DO $check$
BEGIN
    IF (SELECT count(*) FROM users WHERE role = 'admin') <> 1 THEN
        RAISE EXCEPTION 'Ожидался ровно один админ';
    END IF;
    IF EXISTS (SELECT 1 FROM answer_log WHERE user_id IS NULL) OR EXISTS (SELECT 1 FROM exam_history WHERE user_id IS NULL) THEN
        RAISE EXCEPTION 'Остались записи без пользователя';
    END IF;
END
$check$;

COMMIT;
