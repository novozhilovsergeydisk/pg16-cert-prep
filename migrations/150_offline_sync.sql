-- Offline PWA: immutable catalogues, per-user committed change stream and receipts.
-- Back up the database first. Apply as the schema owner, never as runtime.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS offline_catalogs (
    version text PRIMARY KEY CHECK (version ~ '^[0-9a-f]{64}$'),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_heads (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_changes (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision bigint NOT NULL,
    collection text NOT NULL,
    entity_id text NOT NULL,
    data jsonb,
    PRIMARY KEY(user_id,revision)
);
CREATE TABLE IF NOT EXISTS sync_attempts (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id text NOT NULL,
    state jsonb NOT NULL,
    PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS sync_receipts (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    fingerprint text NOT NULL,
    result jsonb NOT NULL,
    PRIMARY KEY(user_id,event_id)
);
CREATE TABLE IF NOT EXISTS sync_devices (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    sequence bigint NOT NULL DEFAULT 0,
    last_occurred_at timestamptz,
    PRIMARY KEY(user_id,id)
);

ALTER TABLE answer_log ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE option_check_answers ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE exam_history ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();
-- Historical answers belong to versioned exercises even after a question is removed.
ALTER TABLE answer_log DROP CONSTRAINT IF EXISTS answer_log_question_id_fkey;
ALTER TABLE option_check_answers DROP CONSTRAINT IF EXISTS option_check_answers_question_id_fkey;

CREATE OR REPLACE FUNCTION record_sync_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
    entry jsonb;
    uid integer;
    rev bigint;
    eid text;
BEGIN
    entry := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    uid := CASE WHEN TG_TABLE_NAME='users' THEN (entry->>'id')::integer ELSE (entry->>'user_id')::integer END;
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=uid) THEN RETURN NULL; END IF;
    IF TG_TABLE_NAME='users' THEN
        entry := jsonb_build_object('id',uid,'accent',entry->'accent','theme',entry->'theme');
        IF TG_OP='UPDATE' AND OLD.accent IS NOT DISTINCT FROM NEW.accent AND OLD.theme IS NOT DISTINCT FROM NEW.theme THEN
            RETURN NULL;
        END IF;
    END IF;
    IF TG_TABLE_NAME='sync_attempts' AND TG_OP='UPDATE' THEN
        IF OLD.state->'questions' IS DISTINCT FROM NEW.state->'questions' THEN
            RAISE EXCEPTION 'Attempt questions are immutable';
        END IF;
        -- Draft updates must not duplicate the whole question package in the journal.
        entry := jsonb_set(entry,'{state}',(entry->'state')-'questions') || '{"partial":true}'::jsonb;
    END IF;
    eid := entry->>'id';
    INSERT INTO public.sync_heads(user_id) VALUES(uid) ON CONFLICT DO NOTHING;
    UPDATE public.sync_heads SET revision=revision+1 WHERE user_id=uid RETURNING revision INTO rev;
    INSERT INTO public.sync_changes(user_id,revision,collection,entity_id,data)
    VALUES(uid,rev,TG_TABLE_NAME,eid,CASE WHEN TG_OP='DELETE' THEN NULL ELSE entry END);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION record_sync_change() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','training_batches','answer_log','option_check_batches','option_check_answers','exam_history','sync_attempts'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS record_sync_change ON %I',t);
        EXECUTE format('CREATE TRIGGER record_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_sync_change()',t);
    END LOOP;
END $$;

-- A second application must not duplicate the bootstrap history.
DO $$
DECLARE u record; t text; r record; rev bigint;
BEGIN
    FOR u IN SELECT id,accent,theme FROM users ORDER BY id LOOP
        INSERT INTO sync_heads(user_id) VALUES(u.id) ON CONFLICT DO NOTHING;
        SELECT revision INTO rev FROM sync_heads WHERE user_id=u.id FOR UPDATE;
        IF rev <> 0 THEN CONTINUE; END IF;
        rev := 1;
        INSERT INTO sync_changes VALUES(u.id,rev,'users',u.id::text,to_jsonb(u));
        FOREACH t IN ARRAY ARRAY['training_batches','answer_log','option_check_batches','option_check_answers','exam_history','sync_attempts'] LOOP
            FOR r IN EXECUTE format('SELECT id::text AS id,to_jsonb(x) AS data FROM %I x WHERE user_id=$1 ORDER BY id',t) USING u.id LOOP
                rev := rev+1;
                INSERT INTO sync_changes VALUES(u.id,rev,t,r.id,r.data);
            END LOOP;
        END LOOP;
        UPDATE sync_heads SET revision=rev WHERE user_id=u.id;
    END LOOP;
END $$;

-- Production runtime retains no DDL rights or membership in the owner role.
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pg16_cert') AND current_user<>'pg16_cert' THEN
        GRANT SELECT,INSERT ON offline_catalogs TO pg16_cert;
        GRANT SELECT,INSERT,UPDATE ON sync_heads,sync_attempts,sync_devices TO pg16_cert;
        GRANT SELECT ON sync_changes TO pg16_cert;
        GRANT SELECT,INSERT ON sync_receipts TO pg16_cert;
        GRANT INSERT(received_at,answered_at),UPDATE(selected_answer,correct,answered_at),DELETE ON answer_log TO pg16_cert;
        GRANT INSERT(received_at,answered_at),UPDATE(fits,is_right,answered_at) ON option_check_answers TO pg16_cert;
        GRANT INSERT(received_at,finished_at),UPDATE(total,correct,percent,passed,duration_seconds,snapshot,finished_at) ON exam_history TO pg16_cert;
        GRANT INSERT(created_at) ON training_batches,option_check_batches TO pg16_cert;
    END IF;
END $$;
COMMIT;
