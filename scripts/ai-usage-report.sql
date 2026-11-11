-- Только агрегаты, без текстов, email и содержимого контекста.
-- Окно отчётов: последние 7 суток. SQL выполняется под существующим доступом к БД.
-- Явная зона группировки и результат timestamptz сохраняют UTC при JSON-сериализации.
SELECT date_trunc('hour',received_at,'UTC') AS hour_utc,
    scope,mode,model,count(*) AS admissions,
    count(*) FILTER (WHERE state<>'rejected') AS accepted,
    count(*) FILTER (WHERE state='done') AS done,
    count(*) FILTER (WHERE state='failed') AS failed,
    count(*) FILTER (WHERE state='rejected') AS rejected,
    count(*) FILTER (WHERE started_at IS NOT NULL) AS dispatched,
    count(*) FILTER (WHERE provider_call_started IS TRUE) AS provider_calls_confirmed_started,
    count(*) FILTER (WHERE started_at IS NOT NULL AND provider_call_started IS NULL) AS provider_calls_unknown,
    count(DISTINCT user_id) AS users,
    round((avg(duration_ms) FILTER (WHERE state='done'))::numeric,1) AS success_avg_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE state='done') AS success_p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE state='done') AS success_p95_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY transport_ms) AS transport_p95_ms,
    sum(request_bytes) AS ssh_payload_bytes,
    sum(gateway_response_bytes) AS ssh_response_payload_bytes,
    sum(provider_request_bytes) AS generation_request_payload_bytes,
    sum(provider_response_bytes) AS generation_response_payload_bytes,
    sum(prompt_tokens) AS known_prompt_tokens,
    sum(completion_tokens) AS known_completion_tokens,
    count(*) FILTER (WHERE prompt_tokens IS NOT NULL) AS prompt_usage_samples,
    sum(cost) AS known_cost,
    sum(poll_count) AS polls_for_these_jobs
FROM ai_requests WHERE received_at>=now()-interval '7 days' AND received_at<=now()
GROUP BY 1,2,3,4 ORDER BY 1 DESC,2,3,4;

WITH sizes AS (
    SELECT request_id,
        sum(char_count) FILTER (WHERE role='user') AS input_chars,
        sum(byte_count) FILTER (WHERE role='user') AS input_bytes,
        sum(char_count) FILTER (WHERE role='assistant') AS output_chars,
        sum(byte_count) FILTER (WHERE role='assistant') AS output_bytes
    FROM ai_messages GROUP BY request_id
), gaps AS (
    SELECT id,extract(epoch FROM (received_at-lag(received_at) OVER
        (PARTITION BY user_id ORDER BY received_at,sequence_id)))*1000 AS gap_ms
    FROM ai_requests WHERE state<>'rejected' AND received_at>=now()-interval '7 days' AND received_at<=now()
)
SELECT r.user_id,count(*) AS admissions,
    count(*) FILTER (WHERE r.state<>'rejected') AS accepted,
    count(*) FILTER (WHERE r.state='rejected') AS rejected,
    sum(s.input_chars) AS input_chars,sum(s.input_bytes) AS input_bytes,
    sum(s.output_chars) AS output_chars,sum(s.output_bytes) AS output_bytes,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_ms) AS median_gap_ms,
    min(g.gap_ms) AS shortest_gap_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY r.duration_ms) AS p95_ms
FROM ai_requests r LEFT JOIN sizes s ON s.request_id=r.id LEFT JOIN gaps g ON g.id=r.id
WHERE r.received_at>=now()-interval '7 days' AND r.received_at<=now() GROUP BY r.user_id ORDER BY accepted DESC,r.user_id;

SELECT error_code,count(*) AS count,
    count(*) FILTER (WHERE started_at IS NOT NULL) AS dispatched,
    count(*) FILTER (WHERE provider_call_started IS TRUE) AS provider_calls_confirmed_started
FROM ai_requests WHERE received_at>=now()-interval '7 days' AND received_at<=now() AND error_code IS NOT NULL
GROUP BY error_code ORDER BY count DESC,error_code;

SELECT date_trunc('minute',received_at,'UTC') AS minute_utc,
    count(*) FILTER (WHERE state<>'rejected') AS accepted,
    count(*) FILTER (WHERE state='rejected') AS rejected
FROM ai_requests WHERE received_at>=now()-interval '7 days' AND received_at<=now()
GROUP BY 1 ORDER BY accepted DESC,minute_utc DESC LIMIT 20;

-- The intervals below describe dispatched jobs, not pure model execution.
-- Interrupted/unfinished intervals lack a reliable end and are counted separately.
WITH events AS (
    SELECT started_at AS at,1 AS delta FROM ai_requests
      WHERE started_at>=now()-interval '7 days' AND started_at<=now() AND state IN ('done','failed') AND error_code IS DISTINCT FROM 'AI_INTERRUPTED'
    UNION ALL
    SELECT finished_at,-1 FROM ai_requests
      WHERE started_at>=now()-interval '7 days' AND started_at<=now() AND state IN ('done','failed') AND error_code IS DISTINCT FROM 'AI_INTERRUPTED'
), grouped AS (SELECT at,sum(delta) AS delta FROM events GROUP BY at),
concurrency AS (SELECT sum(delta) OVER (ORDER BY at) AS running FROM grouped)
SELECT (SELECT max(running) FROM concurrency) AS peak_dispatched_jobs_with_known_end,
    count(*) FILTER (WHERE started_at IS NOT NULL AND (state='pending' OR error_code='AI_INTERRUPTED')) AS incomplete_intervals
FROM ai_requests WHERE received_at>=now()-interval '7 days' AND received_at<=now();

SELECT relname AS table_name,pg_total_relation_size(relid) AS total_bytes,
    pg_relation_size(relid) AS heap_bytes,pg_indexes_size(relid) AS index_bytes,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_pretty
FROM pg_catalog.pg_statio_user_tables
WHERE schemaname='public' AND relname IN ('ai_conversations','ai_requests','ai_messages')
ORDER BY relname;
