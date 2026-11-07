const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');
let server, base;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
});

async function post(route, body, encoding) {
    return fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(encoding ? { 'Content-Encoding': encoding } : {}) },
        body,
        signal: AbortSignal.timeout(5000),
    });
}

test('Security: ordinary JSON still reaches login validation and client reports', async () => {
    const login = await post('/api/auth/verify', '{}');
    assert.equal(login.status, 400);
    assert.deepEqual(await login.json(), { error: 'Ссылка недействительна или устарела' });
    assert.equal((await post('/api/client-errors', '{}', 'identity')).status, 204);
});

for (const [encoding, compress] of [
    ['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync],
]) test('Security: ' + encoding + ' JSON is rejected by both parsers before routing', async () => {
    for (const route of ['/api/auth/verify', '/api/client-errors']) {
        const response = await post(route, compress(Buffer.from('{}')), encoding);
        assert.equal(response.status, 415);
        assert.deepEqual(await response.json(), { error: 'Ошибка запроса' });
    }
});

test('Security: malformed and trailing compressed bytes are rejected without terminating the server', async () => {
    for (const body of [Buffer.from('invalid'), Buffer.concat([zlib.gzipSync('{}'), Buffer.from('trailing')])]) {
        assert.equal((await post('/api/auth/verify', body, 'gzip')).status, 415);
    }
    assert.equal((await fetch(base, { signal: AbortSignal.timeout(5000) })).status, 200);
});

test('Security: original JSON size limits and malformed JSON rejection are preserved', async () => {
    assert.equal((await post('/api/auth/verify', JSON.stringify({ data: 'x'.repeat(105000) }))).status, 413);
    assert.equal((await post('/api/client-errors', JSON.stringify({ data: 'x'.repeat(2100) }))).status, 413);
    assert.equal((await post('/api/auth/verify', '{')).status, 400);
});

test('Security: nodemon still matches watched and ignored files with patched minimatch', () => {
    const match = require('nodemon/lib/monitor/match');
    const monitored = match(['src/services/mailer.js', 'node_modules/example/index.js', 'public/css/style.css'],
        ['**/*', '!**/node_modules/**'], 'js,json');
    assert.deepEqual(monitored.result, [path.resolve('src/services/mailer.js')]);
});
