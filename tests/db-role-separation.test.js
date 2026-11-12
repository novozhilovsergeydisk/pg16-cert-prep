const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const roles = require('../scripts/lib/db-role-separation');

// Dedicated integration suite: it must fail, rather than silently skip, without PG16 binaries.
test('PG16: role migration, real runtime, repeat, drift guards and exact ACL rollback', async t => {
    const bin = process.env.PG16_TEST_BIN;
    assert.ok(bin && path.isAbsolute(bin), 'Set PG16_TEST_BIN to PostgreSQL 16 binaries');
    const dir = fs.mkdtempSync('/private/tmp/pg16-role-test-');
    fs.chmodSync(dir, 0o700);
    const log = fs.openSync(path.join(dir, 'tools.log'), 'wx', 0o600);
    const call = (file, args, env) => {
        const result = spawnSync(file, args, { env, stdio: ['ignore', log, log], timeout: 120000 });
        assert.equal(result.status, 0, 'Isolated PostgreSQL operation failed (details in private tools.log)');
        return result;
    };
    const version = spawnSync(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' });
    assert.match(version.stdout, /PostgreSQL\) 16\./);
    process.env.NODE_ENV = 'test'; process.env.DOTENV_CONFIG_QUIET = 'true'; process.env.APP_URL = 'http://127.0.0.1';
    const source = require('../src/config/db');
    let started = false, admin, runtime;
    t.after(async () => {
        await runtime?.end(); await admin?.end(); await source.end();
        if (started) call(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), 'stop', '-m', 'fast']);
        fs.closeSync(log);
        // Keep private evidence on failure; no shared DB or user files are removed.
        if (!t.signal.aborted) fs.writeFileSync(path.join(dir, 'complete.json'), JSON.stringify({ stopped: true }), { mode: 0o600 });
    });
    // Schema only from the normal loader. No source data or source privileges are changed.
    const sc = await source.connect();
    try {
        const p = sc.connectionParameters;
        const args = ['--schema-only', '--no-owner', '--no-acl', '--exclude-table=public.tasks', '--exclude-table=public.tasks_id_seq',
            '-f', path.join(dir, 'schema.sql')];
        for (const [v, f] of [[p.host, '-h'], [p.port, '-p'], [p.user, '-U'], [p.database, '-d']]) if (v) args.push(f, String(v));
        call(path.join(bin, 'pg_dump'), args, { ...process.env, PGPASSWORD: p.password });
    } finally { sc.release(); }
    call(path.join(bin, 'initdb'), ['-D', path.join(dir, 'data'), '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
    call(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'), '-o', `-k ${dir} -p 51460 -c listen_addresses=`, 'start']);
    started = true;
    const config = { host: dir, port: 51460, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 6000 };
    const bootstrap = new Pool({ ...config, database: 'postgres', user: os.userInfo().username });
    try {
        await bootstrap.query('CREATE ROLE fixture_runtime LOGIN');
        await bootstrap.query('CREATE DATABASE roles_fixture OWNER fixture_runtime');
    } finally { await bootstrap.end(); }
    admin = new Pool({ ...config, database: 'roles_fixture', user: os.userInfo().username });
    runtime = new Pool({ ...config, database: 'roles_fixture', user: 'fixture_runtime' });
    await admin.query('CREATE EXTENSION pgcrypto');
    call(path.join(bin, 'psql'), ['-X', '-h', dir, '-p', '51460', '-d', 'roles_fixture', '-v', 'ON_ERROR_STOP=1',
        '-c', 'SET ROLE fixture_runtime', '-f', path.join(dir, 'schema.sql')]);
    // Normalize the private fixture to the pre-146 state even if the source has advanced.
    call(path.join(bin, 'psql'), ['-X', '-h', dir, '-p', '51460', '-d', 'roles_fixture', '-v', 'ON_ERROR_STOP=1',
        '-c', 'SET ROLE fixture_runtime', '-f', path.join(__dirname, '../migrations/145_security_limits.sql')]);
    // Include a pre-existing column grant: rollback must restore it, apply must remove it.
    await admin.query('GRANT UPDATE(role) ON users TO fixture_runtime');
    const env = { ...process.env, DB_HOST: dir, DB_PORT: '51460', DB_NAME: 'roles_fixture', DB_USER: 'fixture_runtime', DB_PASS: '' };
    const cli = (mode, expected = 0) => {
        const r = spawnSync(process.execPath, ['scripts/db-role-separation.js', mode, '--state-dir', path.join(dir, 'state'),
            '--admin-socket', dir, '--admin-user', os.userInfo().username, '--admin-os-user', os.userInfo().username, '--pg-bin', bin],
        { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', log, log], timeout: 120000 });
        assert.equal(r.status, expected, 'Administrative CLI unexpected result (private tools.log)');
    };
    let state;
    await t.test('Prepare full backup and private, immutable original manifest', () => {
        cli('prepare');
        state = JSON.parse(fs.readFileSync(path.join(dir, 'state/state.json'), 'utf8'));
        assert.equal(fs.statSync(path.join(dir, 'state/state.json')).mode & 0o777, 0o600);
        assert.ok(fs.statSync(path.join(dir, 'state/before.dump')).size > 0);
        cli('prepare', 1);
    });
    await t.test('Role-name collision rejects before ownership changes', async () => {
        await admin.query('CREATE ROLE pg16_owner NOLOGIN');
        cli('apply', 1);
        assert.equal((await admin.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='users'::regclass")).rows[0].owner, 'fixture_runtime');
        await admin.query('DROP ROLE pg16_owner');
    });
    await t.test('Direct psql without ON_ERROR_STOP cannot bypass the administrative guard', async () => {
        spawnSync(path.join(bin, 'psql'), ['-X', '-h', dir, '-p', '51460', '-U', 'fixture_runtime', '-d', 'roles_fixture',
            '-f', path.join(__dirname, '../migrations/146_runtime_roles.sql')], { stdio: ['ignore', log, log], timeout: 10000 });
        const fn = (await admin.query("SELECT pg_get_functiondef('enforce_snapshot_storage_quota()'::regprocedure) AS definition")).rows[0];
        assert.equal(fn.definition, state.objects.find(o => o.kind === 'FUNCTION').definition);
    });
    await t.test('Failure after ownership transfer rolls back the entire transaction', async () => {
        const c = await admin.connect();
        try {
            const failing = { query(sql, args) {
                if (typeof sql === 'string' && sql.startsWith('GRANT SELECT ON public."questions"')) {
                    throw Object.assign(new Error('Fixture failure'), { code: 'EFIXTURE' });
                }
                return c.query(sql, args);
            } };
            await assert.rejects(roles.apply(failing, state), e => e.code === 'EFIXTURE');
            assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='pg16_owner'")).rows[0].n, 0);
            assert.equal((await c.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='users'::regclass")).rows[0].owner, 'fixture_runtime');
        } finally { c.release(); }
    });
    await t.test('Apply twice, verify, original manifest retained', () => {
        const before = fs.readFileSync(path.join(dir, 'state/state.json'));
        cli('apply'); cli('apply'); cli('verify');
        assert.ok(fs.readFileSync(path.join(dir, 'state/state.json')).equals(before));
    });
    await t.test('Wrong cluster manifest and unsafe state-file permissions are rejected', async () => {
        const c = await admin.connect();
        try { await assert.rejects(roles.verify(c, { ...state, cluster: '0' }), e => e.code === 'EROLESTATE'); }
        finally { c.release(); }
        fs.chmodSync(path.join(dir, 'state/state.json'), 0o644);
        try { cli('verify', 1); } finally { fs.chmodSync(path.join(dir, 'state/state.json'), 0o600); }
        cli('verify');
    });
    await t.test('Runtime matrix through real controllers and real LOGIN connection', async () => {
        const result = await require('./db-role-scenarios.cjs')({ admin, runtime, adapter: source, root: path.join(__dirname, '..') });
        assert.equal(result.passed, 33);
    });
    await t.test('Unsafe replay of migration 145 is detected and rolls back in runner', async () => {
        const c = await admin.connect();
        try {
            await c.query('BEGIN'); await c.query('SET ROLE pg16_owner');
            await c.query(fs.readFileSync(path.join(__dirname, '../migrations/145_security_limits.sql'), 'utf8').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
            await c.query('RESET ROLE');
            await assert.rejects(roles.verify(c, state), e => e.code === 'EROLESTATE');
            await c.query('ROLLBACK');
        } finally { c.release(); }
        cli('verify');
    });
    await t.test('Changed quota body with preserved security attributes is rejected', async () => {
        const c = await admin.connect();
        try {
            await c.query('BEGIN');
            await c.query(`CREATE OR REPLACE FUNCTION public.enforce_snapshot_storage_quota() RETURNS trigger
                LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN RETURN NEW; END$$`);
            await assert.rejects(roles.verify(c, state), e => e.code === 'EROLESTATE');
        } finally { await c.query('ROLLBACK'); c.release(); }
        cli('verify');
    });
    await t.test('Unknown object causes fail-closed verification and rollback', async () => {
        const c = await admin.connect();
        try { await c.query('SET ROLE pg16_owner'); await c.query('CREATE TABLE public.unexpected_fixture(id integer)'); await c.query('RESET ROLE'); }
        finally { c.release(); }
        cli('verify', 1); cli('rollback', 1);
        await admin.query('DROP TABLE public.unexpected_fixture');
    });
    await t.test('Unexpected column and column grant option are detected', async () => {
        await admin.query('ALTER TABLE questions ADD COLUMN unexpected integer');
        cli('verify', 1);
        await admin.query('ALTER TABLE questions DROP COLUMN unexpected');
        await admin.query('GRANT UPDATE(accent) ON users TO fixture_runtime WITH GRANT OPTION');
        cli('verify', 1);
        await admin.query('REVOKE GRANT OPTION FOR UPDATE(accent) ON users FROM fixture_runtime');
        cli('verify');
    });
    await t.test('Rollback restores owners, function, ACLs and original column grant', async () => {
        cli('rollback');
        assert.equal((await runtime.query("SELECT has_column_privilege(current_user,'users','role','UPDATE') AS yes")).rows[0].yes, true);
        assert.equal((await admin.query("SELECT prosecdef FROM pg_proc WHERE oid='enforce_snapshot_storage_quota()'::regprocedure")).rows[0].prosecdef, false);
        await runtime.query('CREATE TABLE public.rollback_fixture(id integer)');
        await runtime.query('DROP TABLE public.rollback_fixture');
    });
    await t.test('Reapply after rollback and full restore of pre-change backup', async () => {
        cli('apply'); cli('verify');
        await admin.query('CREATE DATABASE restore_fixture OWNER fixture_runtime');
        call(path.join(bin, 'pg_restore'), ['--exit-on-error', '-h', dir, '-p', '51460', '-d', 'restore_fixture', path.join(dir, 'state/before.dump')]);
        const restored = new Pool({ ...config, database: 'restore_fixture', user: os.userInfo().username });
        try {
            assert.equal((await restored.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 16);
            assert.equal((await restored.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='users'::regclass")).rows[0].owner, 'fixture_runtime');
        } finally { await restored.end(); }
    });
});
