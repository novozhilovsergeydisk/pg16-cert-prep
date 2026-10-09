-- История экзаменов: одна строка на завершённый экзамен.
-- Повторный запуск безопасен.

BEGIN;

CREATE TABLE IF NOT EXISTS exam_history (
    id               bigserial PRIMARY KEY,
    finished_at      timestamptz NOT NULL DEFAULT now(),
    total            integer     NOT NULL CHECK (total > 0),
    correct          integer     NOT NULL CHECK (correct >= 0 AND correct <= total),
    percent          integer     NOT NULL CHECK (percent BETWEEN 0 AND 100),
    passed           boolean     NOT NULL,
    duration_seconds integer     CHECK (duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS exam_history_finished_idx ON exam_history (finished_at DESC, id DESC);

COMMIT;
