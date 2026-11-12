-- Административная миграция: только через scripts/db-role-separation.js apply.
-- Транзакция, backup, manifest, передача владения и GRANT выполняются runner.
DO $migration$ BEGIN
    IF current_setting('pg16.role_separation',true) IS DISTINCT FROM 'apply-v1'
       OR current_user <> 'pg16_owner'
       OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database()
           AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
        RAISE EXCEPTION 'Administrative role migration runner required';
    END IF;
    EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.enforce_snapshot_storage_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    old_bytes bigint := 0;
    new_bytes bigint := 0;
    old_count integer := 0;
    new_count integer := 0;
    used public.snapshot_storage_usage%ROWTYPE;
BEGIN
    IF TG_RELID NOT IN ('public.training_batches'::regclass, 'public.option_check_batches'::regclass)
       OR TG_NARGS <> 1
       OR TG_ARGV[0] <> (CASE TG_RELID WHEN 'public.training_batches'::regclass THEN 'questions' ELSE 'cards' END) THEN
        RAISE EXCEPTION 'Unexpected quota trigger';
    END IF;
    IF TG_OP <> 'INSERT' THEN
        old_bytes := octet_length((to_jsonb(OLD)->TG_ARGV[0])::text);
        old_count := 1;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_bytes := octet_length((to_jsonb(NEW)->TG_ARGV[0])::text);
        new_count := 1;
    END IF;
    -- Общая строка сериализует изменения обеих таблиц, включая разные аккаунты.
    UPDATE public.snapshot_storage_usage SET snapshots=snapshots+new_count-old_count,
        json_bytes=json_bytes+new_bytes-old_bytes WHERE scope_id=0 RETURNING * INTO used;
    IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot accounting unavailable'; END IF;
    IF new_bytes > old_bytes AND used.json_bytes > 524288000 THEN
        RAISE EXCEPTION 'Snapshot quota exceeded' USING CONSTRAINT='snapshot_storage_quota';
    END IF;
    IF old_count=1 THEN
        UPDATE public.snapshot_storage_usage SET snapshots=snapshots-1, json_bytes=json_bytes-old_bytes
        WHERE scope_id=OLD.user_id;
    END IF;
    IF new_count=1 THEN
        INSERT INTO public.snapshot_storage_usage VALUES (NEW.user_id,1,new_bytes)
        ON CONFLICT(scope_id) DO UPDATE SET snapshots=public.snapshot_storage_usage.snapshots+1,
            json_bytes=public.snapshot_storage_usage.json_bytes+EXCLUDED.json_bytes RETURNING * INTO used;
        IF (TG_OP='INSERT' OR NEW.user_id<>OLD.user_id OR new_bytes>old_bytes)
           AND (used.snapshots>1000 OR used.json_bytes>52428800) THEN
            RAISE EXCEPTION 'Snapshot quota exceeded' USING CONSTRAINT='snapshot_storage_quota';
        END IF;
    END IF;
    DELETE FROM public.snapshot_storage_usage WHERE scope_id<>0 AND snapshots=0;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
$definition$;
END $migration$;
