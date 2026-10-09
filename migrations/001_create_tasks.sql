CREATE TABLE IF NOT EXISTS tasks (
    id          bigserial PRIMARY KEY,
    title       text        NOT NULL,
    status      text        NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','in_progress','done','failed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz
);
