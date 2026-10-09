-- Журнал ответов для режима «Работа над ошибками».
-- Вопрос считается ошибочным, пока последний ответ на него был неверным.
-- Повторный запуск безопасен.

BEGIN;

CREATE TABLE IF NOT EXISTS answer_log (
    id          bigserial PRIMARY KEY,
    question_id integer     NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    correct     boolean     NOT NULL,
    answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_log_question_idx ON answer_log (question_id, answered_at DESC, id DESC);

COMMIT;
