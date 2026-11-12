const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { apiLimit } = require('../src/middleware/rateLimit');
const { createAiHistory } = require('../src/ai/history');
after(() => pool.end());

test('Link verification rejects attempt 11 before opening a database connection', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use(require('../src/routes/auth'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const original = pool.connect;
    let connections = 0;
    pool.connect = function (...args) { connections++; return original.apply(this, args); };
    try {
        for (let i = 0; i < 11; i++) {
            const r = await fetch('http://127.0.0.1:' + server.address().port + '/auth/verify', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: crypto.randomBytes(32).toString('base64url') }),
                signal: AbortSignal.timeout(5000),
            });
            assert.equal(r.status, i < 10 ? 400 : 429);
            await r.body.cancel();
        }
        assert.equal(connections, 10);
    } finally { pool.connect = original; await new Promise(resolve => server.close(resolve)); }
});

test('API bucket permits burst 20, refills at 10/s and separates clients', () => {
    let time = 0;
    const limit = apiLimit({ now: () => time });
    function hit(ip = 'a') {
        let status = 200;
        limit({ ip }, { status(s) { status = s; return this; }, json() {} }, () => {});
        return status;
    }
    for (let i = 0; i < 20; i++) assert.equal(hit(), 200);
    assert.equal(hit(), 429);
    assert.equal(hit('b'), 200);
    time = 100;
    assert.equal(hit(), 200);
    assert.equal(hit(), 429);
    time = 2100;
    for (let i = 0; i < 20; i++) assert.equal(hit(), 200);
    assert.equal(hit(), 429);
});

async function user(client) {
    return (await client.query('INSERT INTO users(email) VALUES($1) RETURNING id',
        ['limits-' + crypto.randomUUID() + '@example.test'])).rows[0].id;
}
const training = `INSERT INTO training_batches(user_id,category_name,mode,questions)
    VALUES($1,'Security fixture','mistakes',$2::jsonb) RETURNING id`;
const option = `INSERT INTO option_check_batches(user_id,category_name,cards)
    VALUES($1,'Security fixture',$2::jsonb) RETURNING id`;

test('Snapshot counters match canonical JSON; both modes, update and deletion are accounted', async () => {
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const id = await user(c);
        const a = (await c.query(training, [id, '[{"text":"Пример"}]'])).rows[0].id;
        await c.query(option, [id, '[{"text":"Карточка"}]']);
        await c.query('UPDATE training_batches SET questions=$2 WHERE id=$1', [a, '[{"text":"Длинный пример"}]']);
        const actual = (await c.query(`SELECT count(*)::int AS n,sum(octet_length(data::text))::int AS bytes FROM (
            SELECT questions AS data FROM training_batches WHERE user_id=$1 UNION ALL
            SELECT cards FROM option_check_batches WHERE user_id=$1) x`, [id])).rows[0];
        const usage = (await c.query('SELECT * FROM snapshot_storage_usage WHERE scope_id=$1', [id])).rows[0];
        assert.equal(Number(usage.snapshots), actual.n);
        assert.equal(Number(usage.json_bytes), actual.bytes);
        await c.query('DELETE FROM users WHERE id=$1', [id]);
        assert.equal((await c.query('SELECT * FROM snapshot_storage_usage WHERE scope_id=$1', [id])).rowCount, 0);
    } finally { await c.query('ROLLBACK'); c.release(); }
});

for (const scope of ['user', 'project']) test('Snapshot byte boundary rejects atomically: ' + scope, async () => {
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const id = await user(c);
        await c.query(training, [id, '[0]']);
        const scopeId = scope === 'user' ? id : 0;
        const max = scope === 'user' ? 52428800 : 524288000;
        // Seed the boundary instead of allocating 50/500 MiB in a test.
        await c.query('UPDATE snapshot_storage_usage SET json_bytes=$2 WHERE scope_id=$1', [scopeId, max - 3]);
        await c.query(option, [id, '[0]']);
        await c.query('SAVEPOINT boundary');
        await assert.rejects(c.query(training, [id, '[0]']), e => e.constraint === 'snapshot_storage_quota');
        await c.query('ROLLBACK TO boundary');
        assert.equal(Number((await c.query('SELECT json_bytes FROM snapshot_storage_usage WHERE scope_id=$1', [scopeId])).rows[0].json_bytes), max);
        assert.equal(Number((await c.query('SELECT count(*) FROM training_batches WHERE user_id=$1', [id])).rows[0].count), 1);
    } finally { await c.query('ROLLBACK'); c.release(); }
});

test('Concurrent creation in different modes shares the last available slot', async () => {
    const id = await user(pool);
    try {
        await pool.query(`INSERT INTO training_batches(user_id,category_name,mode,questions)
            SELECT $1,'Security fixture','mistakes','[0]'::jsonb FROM generate_series(1,999)`, [id]);
        const results = await Promise.allSettled([pool.query(training, [id, '[0]']), pool.query(option, [id, '[0]'])]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.find(r => r.status === 'rejected').reason.constraint, 'snapshot_storage_quota');
        assert.equal(Number((await pool.query('SELECT snapshots FROM snapshot_storage_usage WHERE scope_id=$1', [id])).rows[0].snapshots), 1000);
    } finally { await pool.query('DELETE FROM users WHERE id=$1', [id]); }
});

test('AI rejections keep no message, cap details at 100, survive a new store and roll into next UTC day', async () => {
    const id = await user(pool);
    const day = Date.UTC(2026, 0, 1);
    function input(now = day) { return { userId: id, requestId: crypto.randomUUID(), fingerprint: 'a'.repeat(64),
        scope: 'general', mode: 'general', message: 'Private fixture', now, elapsed: () => 0,
        rejectCode: 'AI_LOCAL_RATE_LIMIT', rejectStatus: 429 }; }
    try {
        const store = createAiHistory(pool);
        for (let i = 0; i < 99; i++) assert.equal((await store.accept(input())).row.state, 'rejected');
        await Promise.all(Array.from({ length: 6 }, () => createAiHistory(pool).accept(input())));
        assert.equal(Number((await pool.query("SELECT count(*) FROM ai_requests WHERE user_id=$1", [id])).rows[0].count), 100);
        assert.equal(Number((await pool.query('SELECT total FROM ai_rejection_daily WHERE user_id=$1', [id])).rows[0].total), 105);
        assert.equal(Number((await pool.query('SELECT count(*) FROM ai_messages m JOIN ai_requests r ON r.id=m.request_id WHERE r.user_id=$1', [id])).rows[0].count), 0);
        await createAiHistory(pool).accept(input(day + 86400000));
        assert.equal((await pool.query('SELECT * FROM ai_rejection_daily WHERE user_id=$1', [id])).rowCount, 2);
    } finally { await pool.query('DELETE FROM users WHERE id=$1', [id]); }
});
