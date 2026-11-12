const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const fetch = require('./paced-fetch')();

let server;
let base;
let user;

// Перехват строк журнала службы (console.error и console.warn) на время одного действия.
async function captureLog(action) {
    const lines = [];
    const original = { error: console.error, warn: console.warn };
    console.error = (...args) => lines.push(args.join(' '));
    console.warn = (...args) => lines.push(args.join(' '));
    try {
        const result = await action();
        // Строка журнала пишется по событию close ответа, чуть позже, чем клиент получил ответ.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { result, lines };
    } finally {
        Object.assign(console, original);
    }
}

async function request(path, { method = 'GET', body, cookie, raw, ip } = {}) {
    const headers = {};
    // Сервер доверяет X-Forwarded-For от локального адреса: так у каждого теста свой IP и свой лимит.
    if (ip) headers['X-Forwarded-For'] = ip;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: response.status, json, text };
}

// Подмена запросов к БД: ошибка с адресом сервера в тексте — он не должен попасть ни в ответ, ни в журнал.
async function withDbFailure(fn) {
    const original = pool.query;
    pool.query = async () => {
        const err = new Error('connect to secret-db-host.example failed for user secret_role');
        err.code = '57014';
        throw err;
    };
    try {
        return await fn();
    } finally {
        pool.query = original;
    }
}

before(async () => {
    // Свой префикс: очистка api.test.js удаляет пользователей test-…@example.test, а файлы идут параллельно.
    const email = 'logging-' + crypto.randomBytes(6).toString('hex') + '@example.test';
    const created = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, 'user']);
    const sid = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), created.rows[0].id]
    );
    user = { id: created.rows[0].id, email, cookie: 'sid=' + sid };
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            base = 'http://127.0.0.1:' + server.address().port;
            resolve();
        });
    });
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await pool.end();
});

test('Пул БД: ограничения по времени 3 с, 5 с и 6 с', () => {
    assert.equal(pool.options.connectionTimeoutMillis, 3000);
    assert.equal(pool.options.statement_timeout, 5000);
    assert.equal(pool.options.query_timeout, 6000);
});

test('Ошибка БД: ответ 500 с фиксированным текстом, в журнале класс и код без текста ошибки', async () => {
    const { result, lines } = await captureLog(() => withDbFailure(() => request('/api/stats', { cookie: user.cookie })));
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, { error: 'Ошибка запроса к БД' });
    const line = lines.find((l) => l.startsWith('api GET /api/stats 500'));
    assert.ok(line, 'нет строки журнала: ' + lines.join(' | '));
    assert.match(line, /err=Error\/57014$/);
    for (const text of [...lines, result.text]) {
        assert.ok(!/secret|example|@/.test(text), 'утечка в ' + text);
    }
});

test('Вторичная запись ответа в журнал: сбой пишется в журнал службы', async () => {
    const { logError } = require('../src/middleware/requestLog');
    const { lines } = await captureLog(async () => logError('answer_log', Object.assign(new Error('secret'), { code: '23503' })));
    assert.deepEqual(lines, ['error answer_log err=Error/23503']);
});

test('Медленный запрос попадает в журнал с пометкой slow', async () => {
    const original = pool.query;
    pool.query = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 2100));
        return original.apply(pool, args);
    };
    try {
        const { result, lines } = await captureLog(() => request('/api/categories', { cookie: user.cookie }));
        assert.equal(result.status, 200);
        assert.ok(lines.some((l) => /^api GET \/api\/categories 200 \d+ms user=\d+ err=- slow$/.test(l)), lines.join(' | '));
    } finally {
        pool.query = original;
    }
});

test('Обычный быстрый запрос в журнал не пишется', async () => {
    const { result, lines } = await captureLog(() => request('/api/categories', { cookie: user.cookie }));
    assert.equal(result.status, 200);
    assert.deepEqual(lines, []);
});

test('Некорректный JSON: ответ 400 в JSON без подробностей', async () => {
    const { result } = await captureLog(() => request('/api/answers', { method: 'POST', raw: '{bad', cookie: user.cookie }));
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { error: 'Ошибка запроса' });
});

test('Отчёт страницы без входа: 204, в журнале только разрешённые значения, свободного текста нет', async () => {
    const report = {
        kind: 'timeout', path: '/api/training/batches/123', status: 0, ms: 15003, screen: 'question',
        message: 'текст со secret@example.test', source: 'app.js', line: 42, email: user.email, answer: 'ABCD',
    };
    const { result, lines } = await captureLog(() => request('/api/client-errors', { method: 'POST', body: report, ip: '203.0.113.1' }));
    assert.equal(result.status, 204);
    assert.deepEqual(lines, ['client timeout path=/api/training/batches/:id status=0 ms=15003 screen=question user=- source=app.js:42']);
});

test('Отчёт страницы: путь, экран и файл вне списков заменяются на «-», числа вне пределов — на 0', async () => {
    const report = { kind: 'js', path: '/api/' + user.email, screen: 'Secret\nScreen', source: '../etc/passwd', line: -5, status: 9999, ms: 'x' };
    const { lines } = await captureLog(() => request('/api/client-errors', { method: 'POST', body: report, ip: '203.0.113.2' }));
    assert.deepEqual(lines, ['client js path=- status=0 ms=0 screen=- user=- source=-:0']);
});

test('Отчёт страницы после входа содержит номер пользователя; неизвестный вид не пишется', async () => {
    const ok = await captureLog(() => request('/api/client-errors', { method: 'POST', cookie: user.cookie, body: { kind: 'network', path: '/api/answers' }, ip: '203.0.113.3' }));
    assert.equal(ok.result.status, 204);
    assert.match(ok.lines[0], new RegExp('^client network path=/api/answers .* user=' + user.id + ' '));
    const unknown = await captureLog(() => request('/api/client-errors', { method: 'POST', body: { kind: 'other' }, ip: '203.0.113.3' }));
    assert.equal(unknown.result.status, 204);
    assert.deepEqual(unknown.lines, []);
});

test('Отчёт страницы больше 2 КБ отклоняется, ошибка разбора тела попадает в журнал', async () => {
    const { result, lines } = await captureLog(() => request('/api/client-errors', { method: 'POST', body: { kind: 'js', x: 'x'.repeat(3000) }, ip: '203.0.113.4' }));
    assert.equal(result.status, 413);
    assert.deepEqual(result.json, { error: 'Ошибка запроса' });
    assert.ok(lines.some((l) => /^api POST unknown 413 \d+ms user=- err=PayloadTooLargeError$/.test(l)), lines.join(' | '));
});

test('Лимит отчётов: ровно 30 в час с IP, отклонённые тела тоже расходуют лимит и после него не разбираются', async () => {
    const ip = '203.0.113.5';
    const statuses = [];
    await captureLog(async () => {
        for (let i = 0; i < 15; i += 1) statuses.push((await request('/api/client-errors', { method: 'POST', raw: '{bad', ip })).status);
        for (let i = 0; i < 15; i += 1) statuses.push((await request('/api/client-errors', { method: 'POST', body: { kind: 'js' }, ip })).status);
        statuses.push((await request('/api/client-errors', { method: 'POST', body: { kind: 'js' }, ip })).status);
        statuses.push((await request('/api/client-errors', { method: 'POST', body: { kind: 'js', x: 'x'.repeat(3000) }, ip })).status);
    });
    assert.deepEqual(statuses.slice(0, 15), Array(15).fill(400));
    assert.deepEqual(statuses.slice(15, 30), Array(15).fill(204));
    assert.deepEqual(statuses.slice(30), [429, 429]);
});

test('Некорректный JSON: ответ 400 и строка журнала с классом ошибки разбора', async () => {
    const { result, lines } = await captureLog(() => request('/api/answers', { method: 'POST', raw: '{bad', cookie: user.cookie }));
    assert.equal(result.status, 400);
    assert.ok(lines.some((l) => /^api POST unknown 400 \d+ms user=- err=SyntaxError$/.test(l)), lines.join(' | '));
});

test('Журнал пишет шаблон маршрута, а не фактический путь', async () => {
    const admin = await pool.query("UPDATE users SET role='admin' WHERE id=$1 RETURNING id", [user.id]);
    assert.equal(admin.rowCount, 1);
    try {
        const { lines } = await captureLog(() => withDbFailure(() => request('/api/admin/users/123456', { cookie: user.cookie })));
        assert.ok(lines.some((l) => l.startsWith('api GET /api/admin/users/:id 500 ')), lines.join(' | '));
        assert.ok(!lines.some((l) => l.includes('123456')));
    } finally {
        await pool.query("UPDATE users SET role='user' WHERE id=$1", [user.id]);
    }
});

test('Неудачный ROLLBACK: соединение не возвращается в пул, сбой отката — в журнале', async () => {
    const original = pool.connect;
    let released;
    pool.connect = async () => ({
        query: async () => { throw Object.assign(new Error('secret-db-host.example'), { code: '57014' }); },
        release: (arg) => { released = arg; },
    });
    try {
        const { result, lines } = await captureLog(() => request('/api/auth/request', { method: 'POST', body: { email: 'rollback' + Date.now() + '@example.test' }, ip: '203.0.113.6' }));
        assert.equal(result.status, 500);
        assert.equal(released, true);
        assert.ok(lines.includes('error rollback err=Error/57014'), lines.join(' | '));
        assert.ok(!lines.some((l) => /secret|@/.test(l)));
    } finally {
        pool.connect = original;
    }
});

test('Ошибка после отправки заголовков: соединение обрывается, а не завершается как успешное', () => {
    const handler = app.router.stack.filter((layer) => layer.handle.length === 4).pop().handle;
    let destroyed = false;
    let ended = false;
    const res = { headersSent: true, locals: {}, destroy: () => { destroyed = true; }, end: () => { ended = true; } };
    handler(new Error('secret'), {}, res, () => {});
    assert.equal(destroyed, true);
    assert.equal(ended, false);
    assert.equal(res.locals.errorKind, 'Error');
});

test('statement_timeout действует: запрос дольше 5 с прерывается с кодом 57014', async () => {
    const started = Date.now();
    await assert.rejects(pool.query('SELECT pg_sleep(7)'), (err) => err.code === '57014');
    const ms = Date.now() - started;
    assert.ok(ms >= 4500 && ms < 6500, 'прервано через ' + ms + ' мс');
});

test('Сбой в обработчике тренировки: в журнале причина, а не err=-', async () => {
    const original = pool.query;
    pool.query = async (...args) => {
        if (String(args[0]).includes('training_batches')) throw Object.assign(new Error('secret'), { code: '53300' });
        return original.apply(pool, args);
    };
    try {
        const { result, lines } = await captureLog(() => request('/api/answers', { method: 'POST', cookie: user.cookie,
            body: { question_id: 1, answer: 'A', training_batch_id: 1 } }));
        assert.equal(result.status, 500);
        assert.ok(lines.some((l) => /^api POST \/api\/answers 500 \d+ms user=\d+ err=Error\/53300$/.test(l)), lines.join(' | '));
    } finally {
        pool.query = original;
    }
});

test('Маршрут самого приложения записывается без двойного префикса /api', async () => {
    const { lines } = await captureLog(() => withDbFailure(() => request('/api/test')));
    assert.ok(lines.some((l) => l.startsWith('api GET /api/test 500 ')), lines.join(' | '));
});

test('Оборванный клиентом запрос записывается в журнал как aborted', async () => {
    const original = pool.query;
    pool.query = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return original.apply(pool, args);
    };
    try {
        const { lines } = await captureLog(async () => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 200);
            await fetch(base + '/api/categories', { headers: { Cookie: user.cookie }, signal: controller.signal }).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 1600));
        });
        assert.ok(lines.some((l) => /^api GET (\/api\/categories|unknown) aborted \d+ms /.test(l)), lines.join(' | '));
    } finally {
        pool.query = original;
    }
});

test('Пул БД: без свободного соединения ожидание прерывается через 3 с', async () => {
    const held = [];
    try {
        for (let i = 0; i < pool.options.max; i += 1) held.push(await pool.connect());
        const started = Date.now();
        await assert.rejects(pool.connect());
        const ms = Date.now() - started;
        assert.ok(ms >= 2800 && ms < 4000, 'прервано через ' + ms + ' мс');
    } finally {
        held.forEach((client) => client.release());
    }
});

test('query_timeout: если PostgreSQL не прервал запрос сам, клиент прекращает ждать через 6 с', async () => {
    const client = await pool.connect();
    let broken = false;
    try {
        await client.query('SET statement_timeout = 0');
        const started = Date.now();
        await assert.rejects(client.query('SELECT pg_sleep(8)'));
        broken = true;
        const ms = Date.now() - started;
        assert.ok(ms >= 5800 && ms < 7000, 'прервано через ' + ms + ' мс');
    } finally {
        client.release(broken);
    }
});

test('Письмо: общий срок отправки закрывает соединение, даже если SMTP-сервер молчит', async () => {
    const net = require('net');
    const sockets = [];
    const smtp = net.createServer((socket) => sockets.push(socket));
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const saved = { NODE_ENV: process.env.NODE_ENV, SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT };
    // Подставной сервер не отвечает приветствием, поэтому до учётных данных дело не доходит.
    Object.assign(process.env, { NODE_ENV: 'development', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port) });
    try {
        const { sendMail } = require('../src/services/mailer');
        const started = Date.now();
        await assert.rejects(
            sendMail({ to: 'nobody@example.test', subject: 's', text: 't', deadlineAt: Date.now() + 1500 }),
            (err) => err.code === 'EMAILDEADLINE'
        );
        const ms = Date.now() - started;
        assert.ok(ms >= 1300 && ms < 2500, 'прервано через ' + ms + ' мс');
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(sockets.length, 1);
        assert.equal(sockets[0].destroyed || sockets[0].readableEnded, true, 'соединение с SMTP-сервером не закрыто');
        await assert.rejects(
            sendMail({ to: 'nobody@example.test', subject: 's', text: 't', deadlineAt: Date.now() + 500 }),
            (err) => err.code === 'EMAILDEADLINE'
        );
        assert.equal(sockets.length, 1, 'при исчерпанном сроке письмо не должно отправляться');
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        sockets.forEach((socket) => socket.destroy());
        await new Promise((resolve) => smtp.close(resolve));
    }
});

test('Запрос письма для входа укладывается в общий срок 12 с, даже если каждый запрос к БД медленный', async () => {
    const original = pool.connect;
    const sent = [];
    let released;
    // Каждый запрос отвечает за 2,5 с и соблюдает query_timeout, как настоящий клиент pg.
    pool.connect = async () => ({
        query: (config) => {
            sent.push(typeof config === 'string' ? config : config.text);
            const limit = config.query_timeout;
            return new Promise((resolve, reject) => {
                if (limit && limit < 2500) setTimeout(() => reject(new Error('Query read timeout')), limit);
                else setTimeout(() => resolve({ rows: [{ minute: 0, hour: 0 }], rowCount: 1 }), 2500);
            });
        },
        release: (arg) => { released = arg; },
    });
    try {
        const started = Date.now();
        const { result } = await captureLog(() => request('/api/auth/request', { method: 'POST', body: { email: 'budget' + Date.now() + '@example.test' }, ip: '203.0.113.7' }));
        const ms = Date.now() - started;
        assert.equal(result.status, 500);
        assert.ok(ms >= 11500 && ms < 13000, 'ответ через ' + ms + ' мс');
        assert.equal(released, true, 'соединение с незавершённым запросом не должно вернуться в пул');
        assert.ok(!sent.includes('ROLLBACK'), 'после истечения срока откат на занятом соединении не выполняется');
    } finally {
        pool.connect = original;
    }
});
