-- Квоты постоянных снимков и ограниченный журнал отказов ИИ.
-- Перед применением резервная копия; повторное применение допустимо.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE training_batches, option_check_batches IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS snapshot_storage_usage (
    scope_id integer PRIMARY KEY CHECK (scope_id >= 0),
    snapshots bigint NOT NULL CHECK (snapshots >= 0),
    json_bytes bigint NOT NULL CHECK (json_bytes >= 0)
);
-- scope_id=0 — проект; положительный scope_id — пользователь.
DELETE FROM snapshot_storage_usage;
INSERT INTO snapshot_storage_usage
SELECT user_id, count(*), sum(size) FROM (
    SELECT user_id, octet_length(questions::text) AS size FROM training_batches
    UNION ALL
    SELECT user_id, octet_length(cards::text) FROM option_check_batches
) s GROUP BY user_id;
INSERT INTO snapshot_storage_usage SELECT 0, coalesce(sum(snapshots),0), coalesce(sum(json_bytes),0)
FROM snapshot_storage_usage;

CREATE OR REPLACE FUNCTION enforce_snapshot_storage_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    old_bytes bigint := 0;
    new_bytes bigint := 0;
    old_count integer := 0;
    new_count integer := 0;
    used snapshot_storage_usage%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_bytes := octet_length((to_jsonb(OLD)->TG_ARGV[0])::text);
        old_count := 1;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_bytes := octet_length((to_jsonb(NEW)->TG_ARGV[0])::text);
        new_count := 1;
    END IF;
    -- Общая строка сериализует изменения обеих таблиц, включая разные аккаунты.
    UPDATE snapshot_storage_usage SET snapshots=snapshots+new_count-old_count,
        json_bytes=json_bytes+new_bytes-old_bytes WHERE scope_id=0 RETURNING * INTO used;
    IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot accounting unavailable'; END IF;
    IF new_bytes > old_bytes AND used.json_bytes > 524288000 THEN
        RAISE EXCEPTION 'Snapshot quota exceeded' USING CONSTRAINT='snapshot_storage_quota';
    END IF;
    IF old_count=1 THEN
        UPDATE snapshot_storage_usage SET snapshots=snapshots-1, json_bytes=json_bytes-old_bytes
        WHERE scope_id=OLD.user_id;
    END IF;
    IF new_count=1 THEN
        INSERT INTO snapshot_storage_usage VALUES (NEW.user_id,1,new_bytes)
        ON CONFLICT(scope_id) DO UPDATE SET snapshots=snapshot_storage_usage.snapshots+1,
            json_bytes=snapshot_storage_usage.json_bytes+EXCLUDED.json_bytes RETURNING * INTO used;
        IF (TG_OP='INSERT' OR NEW.user_id<>OLD.user_id OR new_bytes>old_bytes)
           AND (used.snapshots>1000 OR used.json_bytes>52428800) THEN
            RAISE EXCEPTION 'Snapshot quota exceeded' USING CONSTRAINT='snapshot_storage_quota';
        END IF;
    END IF;
    DELETE FROM snapshot_storage_usage WHERE scope_id<>0 AND snapshots=0;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS snapshot_storage_quota ON training_batches;
CREATE TRIGGER snapshot_storage_quota AFTER INSERT OR UPDATE OR DELETE ON training_batches
FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_storage_quota('questions');
DROP TRIGGER IF EXISTS snapshot_storage_quota ON option_check_batches;
CREATE TRIGGER snapshot_storage_quota AFTER INSERT OR UPDATE OR DELETE ON option_check_batches
FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_storage_quota('cards');

CREATE TABLE IF NOT EXISTS ai_rejection_daily (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_utc date NOT NULL,
    total bigint NOT NULL CHECK(total>0),
    PRIMARY KEY(user_id,day_utc)
);
-- Старые отказы и тексты сохраняются; только учитываем их в квоте при повторном запуске.
INSERT INTO ai_rejection_daily(user_id,day_utc,total)
SELECT user_id,(received_at AT TIME ZONE 'UTC')::date,count(*) FROM ai_requests WHERE state='rejected'
GROUP BY 1,2 ON CONFLICT(user_id,day_utc) DO UPDATE SET total=greatest(ai_rejection_daily.total,EXCLUDED.total);
COMMIT;
