-- Постоянный учёт ИИ. Полные тексты без автоудаления; удаляются с аккаунтом.
-- Повторный запуск допустим. Перед применением нужна резервная копия БД.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';

CREATE TABLE IF NOT EXISTS ai_conversations (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope text NOT NULL CHECK (scope IN ('question','general')),
    mode text NOT NULL CHECK (mode IN ('training','option-check','general')),
    batch_id integer,
    question_id integer,
    context jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    UNIQUE (id,user_id)
);

CREATE TABLE IF NOT EXISTS ai_requests (
    id uuid PRIMARY KEY,
    sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    conversation_id uuid,
    scope text NOT NULL CHECK (scope IN ('question','general')),
    mode text NOT NULL CHECK (mode IN ('training','option-check','general')),
    state text NOT NULL CHECK (state IN ('pending','done','failed','rejected')),
    admission_status smallint NOT NULL,
    error_code text CHECK (error_code ~ '^AI_[A-Z_]{1,25}$'),
    received_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    expires_at timestamptz NOT NULL,
    duration_ms double precision CHECK (duration_ms >= 0 AND duration_ms < 'Infinity'::float8),
    preparation_ms double precision CHECK (preparation_ms >= 0 AND preparation_ms < 'Infinity'::float8),
    queue_ms double precision CHECK (queue_ms >= 0 AND queue_ms < 'Infinity'::float8),
    transport_ms double precision CHECK (transport_ms >= 0 AND transport_ms < 'Infinity'::float8),
    context_bytes integer CHECK (context_bytes >= 0),
    history_bytes integer CHECK (history_bytes >= 0),
    request_bytes integer CHECK (request_bytes >= 0),
    history_message_ids bigint[] NOT NULL DEFAULT '{}',
    provider_call_started boolean,
    model text,
    provider_request_id text,
    prompt_version text,
    prompt_tokens integer CHECK (prompt_tokens >= 0),
    completion_tokens integer CHECK (completion_tokens >= 0),
    total_tokens integer CHECK (total_tokens >= 0),
    cost numeric CHECK (cost >= 0),
    gateway_ms double precision CHECK (gateway_ms >= 0 AND gateway_ms < 'Infinity'::float8),
    provider_ms double precision CHECK (provider_ms >= 0 AND provider_ms < 'Infinity'::float8),
    provider_request_bytes integer CHECK (provider_request_bytes >= 0),
    provider_response_bytes integer CHECK (provider_response_bytes >= 0),
    gateway_response_bytes integer CHECK (gateway_response_bytes >= 0),
    poll_count bigint NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
    last_polled_at timestamptz,
    FOREIGN KEY (conversation_id,user_id) REFERENCES ai_conversations(id,user_id) ON DELETE CASCADE,
    CHECK ((state = 'pending' AND finished_at IS NULL) OR (state <> 'pending' AND finished_at IS NOT NULL)),
    CHECK ((state IN ('failed','rejected')) = (error_code IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id uuid NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user','assistant')),
    content text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
    created_at timestamptz NOT NULL,
    char_count integer GENERATED ALWAYS AS (char_length(content)) STORED,
    byte_count integer GENERATED ALWAYS AS (octet_length(content)) STORED,
    UNIQUE (request_id,role)
);

CREATE INDEX IF NOT EXISTS ai_conversations_expiry_idx ON ai_conversations(expires_at);
CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_received_idx ON ai_requests(received_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_user_received_idx ON ai_requests(user_id,received_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_conversation_idx ON ai_requests(conversation_id,sequence_id);
CREATE INDEX IF NOT EXISTS ai_requests_pending_idx ON ai_requests(user_id) WHERE state='pending';
-- A refused admission may be retried once its condition changes; it made no model call.
CREATE UNIQUE INDEX IF NOT EXISTS ai_requests_client_request_idx
    ON ai_requests(user_id,client_request_id) WHERE state<>'rejected';
COMMIT;
