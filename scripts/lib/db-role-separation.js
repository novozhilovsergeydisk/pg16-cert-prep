const fs = require('node:fs');
const path = require('node:path');

const OWNER = 'pg16_owner';
const MATRIX = {
    categories: {}, questions: {},
    users: { insert: 'email last_login_at', update: 'last_login_at accent theme' },
    login_tokens: { insert: 'token_hash email expires_at code_hash request_hash', update: 'used_at attempts', delete: true },
    sessions: { insert: 'token_hash user_id expires_at', delete: true },
    answer_log: { insert: 'user_id question_id correct training_batch_id selected_answer' },
    exam_history: { insert: 'user_id total correct percent passed duration_seconds snapshot submission_id' },
    training_batches: { insert: 'user_id category_id category_name mode questions' },
    option_check_batches: { insert: 'user_id category_id category_name cards' },
    option_check_answers: { insert: 'user_id batch_id question_id option_key fits option_is_correct is_right' },
    ai_conversations: { insert: 'id user_id scope mode batch_id question_id context created_at expires_at', update: 'expires_at' },
    ai_requests: {
        insert: 'id user_id client_request_id fingerprint conversation_id scope mode state admission_status error_code received_at finished_at expires_at duration_ms context_bytes history_bytes request_bytes history_message_ids queue_ms',
        update: 'state error_code finished_at duration_ms transport_ms preparation_ms started_at poll_count last_polled_at prompt_tokens completion_tokens total_tokens provider_request_bytes provider_response_bytes gateway_response_bytes gateway_ms provider_ms cost provider_call_started model provider_request_id prompt_version',
    },
    ai_messages: { insert: 'request_id role content created_at' },
    ai_rejection_daily: { insert: 'user_id day_utc total', update: 'total' },
    question_archive: { select: false }, snapshot_storage_usage: { select: false },
};
const SEQUENCES = ['users', 'categories', 'questions', 'question_archive', 'answer_log', 'exam_history',
    'training_batches', 'option_check_batches', 'option_check_answers', 'ai_messages'].map(t => t + '_id_seq')
    .concat('ai_requests_sequence_id_seq');
const USAGE = ['users', 'answer_log', 'exam_history', 'training_batches', 'option_check_batches', 'option_check_answers'].map(t => t + '_id_seq');
const qi = s => '"' + String(s).replaceAll('"', '""') + '"';
const relation = name => 'public.' + qi(name);
const requireState = ok => { if (!ok) throw Object.assign(new Error('Role migration precondition failed'), { code: 'EROLESTATE' }); };
const listEqual = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function identity(c, runtime) {
    const r = (await c.query(`SELECT current_database() AS database,d.oid AS database_oid,
        (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
        (SELECT oid FROM pg_roles WHERE rolname=$1) AS runtime_oid,
        current_setting('server_version_num')::int AS version,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS admin
        FROM pg_database d WHERE datname=current_database()`, [runtime])).rows[0];
    requireState(r?.admin && r.runtime_oid && r.version >= 160000 && r.version < 170000);
    return { ...r, runtime, owner: OWNER };
}

async function inventory(c) {
    const r = (await c.query(`SELECT c.oid,c.relname AS name,c.relkind AS kind,
        pg_get_userbyid(c.relowner) AS owner FROM pg_class c
        WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','S','v','m','f') ORDER BY c.relname`)).rows;
    requireState(listEqual(r.filter(t => t.kind === 'r').map(t => t.name), Object.keys(MATRIX)));
    requireState(listEqual(r.filter(t => t.kind === 'S').map(t => t.name), SEQUENCES));
    requireState(r.length === Object.keys(MATRIX).length + SEQUENCES.length);
    return r;
}

async function roleChecks(c, runtime, state) {
    const r = (await c.query(`SELECT oid,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships
        FROM pg_roles r WHERE rolname=$1`, [runtime])).rows[0];
    requireState(r?.rolcanlogin && !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication && !r.rolbypassrls && !r.memberships);
    const owner = (await c.query(`SELECT oid,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
        shobj_description(oid,'pg_authid') AS marker,
        (SELECT count(*)::int FROM pg_auth_members WHERE roleid=r.oid OR member=r.oid) AS memberships
        FROM pg_roles r WHERE rolname=$1`, [OWNER])).rows[0];
    if (owner) {
        requireState(state && owner.marker === marker(state) && !owner.rolcanlogin && !owner.rolsuper && !owner.rolcreatedb
            && !owner.rolcreaterole && !owner.rolreplication && !owner.rolbypassrls && !owner.memberships);
        const foreign = (await c.query(`SELECT count(*)::int AS n FROM pg_shdepend
            WHERE refclassid='pg_authid'::regclass AND refobjid=$1
              AND ((dbid<>0 AND dbid<>$2) OR (dbid=0 AND NOT(classid='pg_database'::regclass AND objid=$2)))`, [owner.oid, state.database_oid])).rows[0].n;
        requireState(!foreign);
    }
    return owner;
}
const marker = s => `pg16-cert-prep:role-separation-v1:${s.cluster}:${s.database_oid}:${s.runtime_oid}`;
async function columns(c) {
    return (await c.query(`SELECT a.attrelid,a.attnum,a.attname,a.atttypid,a.attnotnull,a.attidentity,a.attgenerated,
        pg_get_expr(d.adbin,d.adrelid) AS default_expression
        FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE t.relnamespace='public'::regnamespace AND t.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY a.attrelid,a.attnum`)).rows;
}

async function acl(c, kind, oid, column) {
    const sources = {
        TABLE: ['pg_class', 'relacl', 'relowner', 'r'], SEQUENCE: ['pg_class', 'relacl', 'relowner', 'S'],
        DATABASE: ['pg_database', 'datacl', 'datdba', 'd'], SCHEMA: ['pg_namespace', 'nspacl', 'nspowner', 'n'],
        FUNCTION: ['pg_proc', 'proacl', 'proowner', 'f'],
    };
    if (column) return (await c.query(`SELECT pg_get_userbyid(a.grantor) AS grantor,
        CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
        FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE t.attrelid=$1 AND t.attname=$2`, [oid, column])).rows;
    const [catalog, field, owner, type] = sources[kind];
    return (await c.query(`SELECT pg_get_userbyid(a.grantor) AS grantor,
        CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
        FROM ${catalog} t CROSS JOIN LATERAL aclexplode(coalesce(t.${field},acldefault('${type}',t.${owner}))) a WHERE t.oid=$1`, [oid])).rows;
}

async function capture(c, runtime) {
    const id = await identity(c, runtime);
    requireState(!(await roleChecks(c, runtime, null)));
    const relations = await inventory(c);
    requireState(relations.every(t => t.owner === runtime));
    const outside = (await c.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relowner=$1 AND n.nspname NOT IN ('public','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%'`, [id.runtime_oid])).rows[0].n;
    requireState(!outside);
    const shared = (await c.query(`SELECT
        (SELECT count(*) FROM pg_database WHERE datdba=$1 AND oid<>$2)::int AS databases,
        (SELECT count(*) FROM pg_tablespace WHERE spcowner=$1)::int AS tablespaces,
        (SELECT count(*) FROM pg_namespace WHERE nspowner=$1 AND nspname<>'public' AND nspname NOT LIKE 'pg_temp_%')::int AS schemas,
        (SELECT count(*) FROM pg_type WHERE typowner=$1 AND typtype IN ('e','d','r','m'))::int AS types`, [id.runtime_oid, id.database_oid])).rows[0];
    requireState(Object.values(shared).every(n => n === 0));
    const db = (await c.query('SELECT datdba=$1 AS owned FROM pg_database WHERE oid=$2', [id.runtime_oid, id.database_oid])).rows[0];
    requireState(db.owned);
    const fn = (await c.query(`SELECT p.oid,pg_get_userbyid(p.proowner) AS owner,pg_get_functiondef(p.oid) AS definition,
        p.prosrc,p.prosecdef,p.proconfig
        FROM pg_proc p WHERE p.oid='public.enforce_snapshot_storage_quota()'::regprocedure`)).rows[0];
    requireState(fn.owner === runtime);
    const oldBody = fs.readFileSync(path.join(__dirname, '../../migrations/145_security_limits.sql'), 'utf8').match(/AS \$\$([\s\S]*?)\$\$;/)[1];
    requireState(!fn.prosecdef && !fn.proconfig && fn.prosrc.trim() === oldBody.trim());
    const ownedFunctions = (await c.query('SELECT count(*)::int AS n FROM pg_proc WHERE proowner=$1', [id.runtime_oid])).rows[0].n;
    requireState(ownedFunctions === 1);
    const ns = (await c.query("SELECT oid,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'")).rows[0];
    const objects = [{ kind: 'DATABASE', name: id.database, oid: id.database_oid, owner: runtime },
        { kind: 'SCHEMA', name: 'public', ...ns }, ...relations.map(t => ({ ...t, kind: t.kind === 'S' ? 'SEQUENCE' : 'TABLE' })),
        { kind: 'FUNCTION', name: 'enforce_snapshot_storage_quota', ...fn }];
    for (const o of objects) {
        o.acl = await acl(c, o.kind, o.oid);
        // Other explicit readers/writers must be reviewed, never silently revoked.
        requireState(o.acl.every(a => [runtime, o.owner, 'PUBLIC'].includes(a.grantee)));
        o.columns = [];
        if (o.kind === 'TABLE') {
            const cols = (await c.query('SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL', [o.oid])).rows;
            for (const col of cols) {
                const a = await acl(c, 'TABLE', o.oid, col.attname);
                requireState(a.every(v => [runtime, 'PUBLIC'].includes(v.grantee)));
                o.columns.push({ name: col.attname, acl: a });
            }
        }
    }
    const defaults = (await c.query('SELECT defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl WHERE defaclrole=$1 ORDER BY 1,2', [id.runtime_oid])).rows;
    return { format: 1, ...id, objects, defaults, columns: await columns(c) };
}

async function validateState(c, state) {
    requireState(state?.format === 1 && state.owner === OWNER);
    const id = await identity(c, state.runtime);
    requireState(['cluster', 'database_oid', 'runtime_oid', 'database'].every(k => id[k] === state[k]));
    const r = await inventory(c);
    requireState(listEqual(r.map(t => t.oid), state.objects.filter(o => ['TABLE', 'SEQUENCE'].includes(o.kind)).map(o => o.oid)));
    await roleChecks(c, state.runtime, state);
    const defaults = (await c.query('SELECT defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl WHERE defaclrole=$1 ORDER BY 1,2', [state.runtime_oid])).rows;
    requireState(JSON.stringify(defaults) === JSON.stringify(state.defaults));
    requireState(JSON.stringify(await columns(c)) === JSON.stringify(state.columns));
    const fn = (await c.query("SELECT 'public.enforce_snapshot_storage_quota()'::regprocedure::oid AS oid")).rows[0];
    requireState(fn.oid === state.objects.find(o => o.kind === 'FUNCTION').oid);
}
function target(o) {
    if (o.kind === 'FUNCTION') return 'public.enforce_snapshot_storage_quota()';
    return ['DATABASE', 'SCHEMA'].includes(o.kind) ? qi(o.name) : relation(o.name);
}
const grantee = name => name === 'PUBLIC' ? 'PUBLIC' : qi(name);

async function clearColumns(c, o, roles) {
    const cols = (await c.query('SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL', [o.oid])).rows;
    for (const col of cols) await c.query(`REVOKE SELECT (${qi(col.attname)}), INSERT (${qi(col.attname)}), UPDATE (${qi(col.attname)}), REFERENCES (${qi(col.attname)}) ON ${target(o)} FROM ${roles.map(grantee).join(',')}`);
}

async function verify(c, state) {
    await validateState(c, state);
    const runtime = state.runtime;
    const relations = await inventory(c);
    requireState(relations.every(o => o.owner === OWNER));
    const flags = (await c.query(`SELECT has_database_privilege($1,current_database(),'CREATE') AS db_create,
        has_database_privilege($1,current_database(),'TEMP') AS temp,has_database_privilege($1,current_database(),'CONNECT') AS connect,
        has_database_privilege($1,current_database(),'CONNECT WITH GRANT OPTION') AS grant_connect,
        has_schema_privilege($1,'public','CREATE') AS schema_create,has_schema_privilege($1,'public','USAGE') AS usage,
        has_schema_privilege($1,'public','USAGE WITH GRANT OPTION') AS grant_usage,
        (SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=$2) FROM pg_database WHERE datname=current_database()) AS database_owner`, [runtime, OWNER])).rows[0];
    requireState(!flags.db_create && !flags.temp && flags.connect && !flags.grant_connect && !flags.schema_create && flags.usage && !flags.grant_usage && flags.database_owner);
    for (const [name, m] of Object.entries(MATRIX)) {
        const o = relations.find(r => r.name === name);
        const cols = (await c.query(`SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped`, [o.oid])).rows;
        const checks = (await c.query(`SELECT has_table_privilege($1,$2::oid,'SELECT') AS s,has_table_privilege($1,$2::oid,'DELETE') AS d,
            has_table_privilege($1,$2::oid,'TRUNCATE,REFERENCES,TRIGGER') AS extra`, [runtime, o.oid])).rows[0];
        requireState(checks.s === (m.select !== false) && checks.d === !!m.delete && !checks.extra);
        for (const col of cols) {
            for (const [priv, allowed] of [['SELECT', m.select !== false], ['REFERENCES', false], ['INSERT', m.insert], ['UPDATE', m.update]]) {
                const yes = (await c.query('SELECT has_column_privilege($1,$2::oid,$3,$4) AS yes', [runtime, o.oid, col.attname, priv])).rows[0].yes;
                requireState(yes === (typeof allowed === 'boolean' ? allowed : !!allowed?.split(' ').includes(col.attname)));
            }
        }
        const grants = await acl(c, 'TABLE', o.oid);
        requireState(!grants.some(a => a.grantee === runtime && a.is_grantable));
        const columnGrants = (await c.query(`SELECT count(*)::int AS n FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) p WHERE a.attrelid=$1
            AND p.grantee=$2 AND p.is_grantable`, [o.oid, state.runtime_oid])).rows[0].n;
        requireState(!columnGrants);
    }
    for (const o of relations.filter(r => r.kind === 'S')) {
        const r = (await c.query(`SELECT has_sequence_privilege($1,$2::oid,'USAGE') AS usage,
            has_sequence_privilege($1,$2::oid,'SELECT,UPDATE') AS extra,
            has_sequence_privilege($1,$2::oid,'USAGE WITH GRANT OPTION') AS grant_usage`, [runtime, o.oid])).rows[0];
        requireState(r.usage === USAGE.includes(o.name) && !r.extra && !r.grant_usage);
    }
    const fn = (await c.query(`SELECT prosecdef,proconfig,prosrc,pg_get_userbyid(proowner) AS owner,
        has_function_privilege($1,oid,'EXECUTE') AS runtime_execute
        FROM pg_proc WHERE oid='public.enforce_snapshot_storage_quota()'::regprocedure`, [runtime])).rows[0];
    requireState(fn.prosecdef && fn.owner === OWNER && !fn.runtime_execute && fn.proconfig?.includes('search_path=pg_catalog, public, pg_temp'));
    const body = fs.readFileSync(path.join(__dirname, '../../migrations/146_runtime_roles.sql'), 'utf8').match(/AS \$\$([\s\S]*?)\$\$;/)[1];
    requireState(fn.prosrc.trim() === body.trim());
    requireState((await acl(c, 'FUNCTION', state.objects.find(o => o.kind === 'FUNCTION').oid)).every(a => a.grantee === OWNER));
    const triggers = (await c.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='snapshot_storage_quota'
        AND tgenabled='O' AND tgfoid='public.enforce_snapshot_storage_quota()'::regprocedure
        AND tgrelid IN ('public.training_batches'::regclass,'public.option_check_batches'::regclass)`)).rows[0].n;
    requireState(triggers === 2);
    const future = (await c.query(`SELECT count(*)::int AS n FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=$1) AND a.grantee<>d.defaclrole`, [OWNER])).rows[0].n;
    requireState(!future);
}

async function transaction(c, fn) {
    await c.query('BEGIN');
    try {
        await c.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s'");
        await c.query('SELECT pg_advisory_xact_lock(235,146)');
        const result = await fn();
        await c.query('COMMIT');
        return result;
    } catch (e) {
        try { await c.query('ROLLBACK'); } catch { e.connectionBroken = true; }
        throw e;
    }
}

async function apply(c, state) {
    return transaction(c, async () => {
        await validateState(c, state);
        const existing = await roleChecks(c, state.runtime, state);
        if ((await inventory(c)).every(t => t.owner === OWNER)) { await verify(c, state); return 'already_applied'; }
        requireState((await inventory(c)).every(t => t.owner === state.runtime));
        await checkOriginal(c, state);
        if (!existing) {
            await c.query(`CREATE ROLE ${qi(OWNER)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await c.query(`COMMENT ON ROLE ${qi(OWNER)} IS '${marker(state)}'`);
        }
        for (const o of state.objects) await c.query(`ALTER ${o.kind} ${target(o)} OWNER TO ${qi(OWNER)}`);
        for (const o of state.objects.filter(o => ['TABLE', 'SEQUENCE'].includes(o.kind))) {
            if (o.kind === 'TABLE') await clearColumns(c, o, ['PUBLIC', state.runtime]);
            await c.query(`REVOKE ALL ON ${o.kind} ${target(o)} FROM PUBLIC,${qi(state.runtime)}`);
        }
        await c.query(`REVOKE CREATE,TEMPORARY ON DATABASE ${qi(state.database)} FROM PUBLIC`);
        await c.query(`REVOKE ALL ON DATABASE ${qi(state.database)} FROM ${qi(state.runtime)}`);
        await c.query(`GRANT CONNECT ON DATABASE ${qi(state.database)} TO ${qi(state.runtime)}`);
        await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
        await c.query(`REVOKE ALL ON SCHEMA public FROM ${qi(state.runtime)}`);
        await c.query(`GRANT USAGE ON SCHEMA public TO ${qi(state.runtime)}`);
        for (const [name, m] of Object.entries(MATRIX)) {
            if (m.select !== false) await c.query(`GRANT SELECT ON ${relation(name)} TO ${qi(state.runtime)}`);
            if (m.delete) await c.query(`GRANT DELETE ON ${relation(name)} TO ${qi(state.runtime)}`);
            for (const [priv, cols] of [['INSERT', m.insert], ['UPDATE', m.update]]) {
                if (cols) await c.query(`GRANT ${priv} (${cols.split(' ').map(qi).join(',')}) ON ${relation(name)} TO ${qi(state.runtime)}`);
            }
        }
        await c.query(`GRANT USAGE ON SEQUENCE ${USAGE.map(relation).join(',')} TO ${qi(state.runtime)}`);
        await c.query(`SET LOCAL ROLE ${qi(OWNER)}`);
        await c.query("SELECT set_config('pg16.role_separation','apply-v1',true)");
        await c.query(fs.readFileSync(path.join(__dirname, '../../migrations/146_runtime_roles.sql'), 'utf8'));
        await c.query(`REVOKE ALL ON FUNCTION public.enforce_snapshot_storage_quota() FROM PUBLIC,${qi(state.runtime)}`);
        await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(OWNER)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
        await c.query('RESET ROLE');
        await verify(c, state);
        return 'applied';
    });
}

async function restoreAcl(c, o, entries, column) {
    const current = await acl(c, o.kind, o.oid, column);
    const roles = [...new Set(current.map(a => a.grantee).concat(entries.map(a => a.grantee)))];
    if (roles.length) {
        if (column) await c.query(`REVOKE SELECT (${qi(column)}), INSERT (${qi(column)}), UPDATE (${qi(column)}), REFERENCES (${qi(column)}) ON ${target(o)} FROM ${roles.map(grantee).join(',')}`);
        else await c.query(`REVOKE ALL ON ${o.kind} ${target(o)} FROM ${roles.map(grantee).join(',')}`);
    }
    for (const a of entries) {
        requireState(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'USAGE', 'CREATE', 'CONNECT', 'TEMPORARY', 'EXECUTE'].includes(a.privilege_type));
        await c.query(`SET LOCAL ROLE ${qi(a.grantor)}`);
        await c.query(`GRANT ${a.privilege_type}${column ? ' (' + qi(column) + ')' : ''} ON ${o.kind} ${target(o)} TO ${grantee(a.grantee)}${a.is_grantable ? ' WITH GRANT OPTION' : ''}`);
        await c.query('RESET ROLE');
    }
}
const normalized = rows => rows.map(r => JSON.stringify(r, Object.keys(r).sort())).sort();

async function checkOriginal(c, state) {
    const catalogs = { TABLE: ['pg_class', 'relowner'], SEQUENCE: ['pg_class', 'relowner'],
        DATABASE: ['pg_database', 'datdba'], SCHEMA: ['pg_namespace', 'nspowner'], FUNCTION: ['pg_proc', 'proowner'] };
    for (const o of state.objects) {
        const [catalog, field] = catalogs[o.kind];
        const owner = (await c.query(`SELECT pg_get_userbyid(${field}) AS owner FROM ${catalog} WHERE oid=$1`, [o.oid])).rows[0];
        requireState(owner?.owner === o.owner);
        requireState(listEqual(normalized(await acl(c, o.kind, o.oid)), normalized(o.acl)));
        if (o.kind === 'TABLE') {
            const all = (await c.query('SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped', [o.oid])).rows;
            for (const col of all) requireState(listEqual(normalized(await acl(c, o.kind, o.oid, col.attname)), normalized(o.columns.find(v => v.name === col.attname)?.acl || [])));
        }
        if (o.kind === 'FUNCTION') requireState((await c.query('SELECT pg_get_functiondef($1) AS definition', [o.oid])).rows[0].definition === o.definition);
    }
}

async function rollback(c, state) {
    return transaction(c, async () => {
        await validateState(c, state);
        // Refuse drift/new objects; do not accidentally overwrite another deployment.
        await verify(c, state);
        await c.query(state.objects.find(o => o.kind === 'FUNCTION').definition);
        for (const o of state.objects) await c.query(`ALTER ${o.kind} ${target(o)} OWNER TO ${qi(o.owner)}`);
        for (const o of state.objects) {
            if (o.kind === 'TABLE') {
                const columns = (await c.query('SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL', [o.oid])).rows;
                for (const col of columns) await restoreAcl(c, o, [], col.attname);
            }
            await restoreAcl(c, o, o.acl);
            // Table-level REVOKE also affects column grants: replay originals last.
            for (const col of o.columns) await restoreAcl(c, o, col.acl, col.name);
        }
        await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(OWNER)} GRANT EXECUTE ON FUNCTIONS TO PUBLIC`);
        await checkOriginal(c, state);
        return 'rolled_back';
    });
}

module.exports = { OWNER, MATRIX, SEQUENCES, USAGE, capture, apply, verify, rollback, requireState };
