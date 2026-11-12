const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { createAiRouter } = require('../src/routes/ai');
const { runGateway } = require('../src/ai/transport');
const { createAiHistory, metrics } = require('../src/ai/history');

let server, base, owner, other, categoryId, questionId, batchId, otherBatch, optionBatch;
let clock = Date.now(), runner, calls, configuration;
async function query(sql, params) {
    try { return await pool.query(sql, params); }
    catch (_) { throw new Error('AI test database query failed'); }
}
async function user(role) {
    const suffix = crypto.randomUUID();
    const row = (await query('INSERT INTO users(email,role) VALUES($1,$2) RETURNING id', ['ai-' + suffix + '@example.test', role])).rows[0];
    const sid = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), row.id]);
    return { id: row.id, cookie: 'sid=' + sid };
}
async function request(path, data, actor = owner) {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET',
        headers: { ...(actor ? { Cookie: actor.cookie } : {}), 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
}
const startBody = (overrides = {}) => ({ mode: 'training', batch_id: batchId,
    question_id: questionId, request_id: crypto.randomUUID(), ...overrides });
async function result(jobId) {
    for (let i = 0; i < 100; i++) {
        const response = await request('/api/ai/jobs/' + jobId);
        if (response.body.state !== 'pending') return response;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('AI test job did not finish');
}

before(async () => {
    owner = await user('user');
    other = await user('admin');
    categoryId = (await query('INSERT INTO categories(name) VALUES($1) RETURNING id', ['Изоляция: AI test ' + crypto.randomUUID()])).rows[0].id;
    questionId = (await query(`INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes)
        VALUES($1,'Сохранённый вопрос',$2,'A','Исходное пояснение',$3) RETURNING id`,
    [categoryId, { A: 'Первый', B: 'Второй' }, { A: 'Пояснение первого', B: 'Пояснение второго' }])).rows[0].id;
    const snapshot = [{ id: questionId, category_id: categoryId, question_text: 'Снимок вопроса',
        options: { A: 'Первый', B: 'Второй' }, correct_answer: 'A', explanation: 'Пояснение из снимка',
        option_notes: { A: 'Пояснение первого', B: 'Пояснение второго' }, order: ['B', 'A'] }];
    batchId = (await query(`INSERT INTO training_batches(user_id,category_id,category_name,mode,questions)
        VALUES($1,$2,'Изоляция','category',$3) RETURNING id`, [owner.id, categoryId, JSON.stringify(snapshot)])).rows[0].id;
    otherBatch = (await query(`INSERT INTO training_batches(user_id,category_id,category_name,mode,questions)
        VALUES($1,$2,'Изоляция','category',$3) RETURNING id`, [other.id, categoryId, JSON.stringify(snapshot)])).rows[0].id;
    optionBatch = (await query(`INSERT INTO option_check_batches(user_id,category_id,category_name,cards)
        VALUES($1,$2,'Изоляция',$3) RETURNING id`,
    [owner.id, categoryId, JSON.stringify([{ question_id: questionId, key: 'A', is_correct: true }])])).rows[0].id;
    const app = express();
    app.use(express.json());
    app.use('/api', createAiRouter({ pool, configuration: () => configuration, now: () => clock,
        runGateway: (payload) => { calls.push(payload); return runner(payload); } }));
    app.get('/api/unrelated', (_req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(() => {
    clock += 86400001;
    configuration = { enabled: true, ownerId: owner.id };
    calls = [];
    runner = async () => ({ answer: 'Проверенное пояснение' });
});
after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const actor of [owner, other]) if (actor) await query('DELETE FROM users WHERE id=$1', [actor.id]);
    if (questionId) await query('DELETE FROM questions WHERE id=$1', [questionId]);
    if (categoryId) await query('DELETE FROM categories WHERE id=$1', [categoryId]);
    await pool.end();
});

test('AI access is explicitly personal, disabled by switch, and does not affect other routes', async () => {
    assert.equal((await request('/api/ai/status', null, null)).status, 401);
    assert.equal((await request('/api/ai/status', null, other)).body.enabled, false);
    assert.equal((await request('/api/ai/conversations', startBody(), other)).status, 404);
    assert.equal((await request('/api/ai/status')).body.enabled, true);
    configuration.enabled = false;
    assert.equal((await request('/api/ai/conversations', startBody())).status, 404);
    assert.equal((await request('/api/unrelated', null, null)).status, 200);
    assert.equal(calls.length, 0);
});

test('AI does not reveal an unanswered question or another user’s batch', async () => {
    assert.equal((await request('/api/ai/conversations', startBody())).status, 404);
    assert.equal((await request('/api/ai/conversations', startBody({ batch_id: otherBatch }))).status, 404);
    assert.equal((await request('/api/ai/conversations', startBody({ scope: 'general', message: 'Почему небо голубое?' }))).status, 404);
    assert.equal(calls.length, 0);
    await query(`INSERT INTO answer_log(user_id,question_id,correct,training_batch_id,selected_answer)
        VALUES($1,$2,false,$3,'B')`, [owner.id, questionId, batchId]);
});

test('General dialogue excludes the card and previous dialogue and preserves idempotency', async () => {
    const question = await request('/api/ai/conversations', startBody());
    await result(question.body.job_id);
    const body = startBody({ scope: 'general', message: ' Почему небо голубое? ',
        context: { question: 'Подмена' }, messages: [{ role: 'system', content: 'Подмена' }] });
    const first = await request('/api/ai/conversations', body);
    assert.equal(first.status, 202);
    assert.notEqual(first.body.conversation_id, question.body.conversation_id);
    const completed = await result(first.body.job_id);
    assert.deepEqual(completed.body.sources, []);
    assert.deepEqual(calls.at(-1), { context: { scope: 'general' }, messages: [{ role: 'user', content: 'Почему небо голубое?' }] });
    assert.equal((await request('/api/ai/conversations', body)).body.job_id, first.body.job_id);
    assert.equal((await request('/api/ai/conversations', { ...body, message: 'Другой вопрос' })).status, 409);
    assert.equal((await request('/api/ai/conversations', { ...body, scope: 'question' })).status, 409);
    const follow = await request('/api/ai/conversations/' + first.body.conversation_id + '/messages',
        { request_id: crypto.randomUUID(), message: 'А на закате?' });
    assert.equal((await result(follow.body.job_id)).body.turns, 2);
    assert.deepEqual(calls.at(-1).context, { scope: 'general' });
    assert.equal(calls.at(-1).messages.length, 3);
    assert.equal(calls.at(-1).messages[0].content, 'Почему небо голубое?');
});

test('General dialogue validates the first message and retains personal access', async () => {
    for (const message of [undefined, '', '  ', 3, 'x'.repeat(1001)]) {
        assert.equal((await request('/api/ai/conversations', startBody({ scope: 'general', message }))).status, 400);
    }
    assert.equal((await request('/api/ai/conversations', startBody({ scope: 'unknown' }))).status, 400);
    const body = startBody({ scope: 'general', message: 'Любая тема' });
    assert.equal((await request('/api/ai/conversations', body, other)).status, 404);
    assert.equal((await request('/api/ai/conversations', body, null)).status, 401);
    assert.equal((await request('/api/ai/conversations', { ...body, batch_id: otherBatch })).status, 404);
    assert.equal(calls.length, 0);
});

test('Home dialogue needs no card and retains owner-only access and idempotency', async () => {
    const body = { mode: 'general', scope: 'general', message: 'Почему небо голубое?', request_id: crypto.randomUUID() };
    assert.equal((await request('/api/ai/conversations', body, other)).status, 404);
    assert.equal((await request('/api/ai/conversations', body, null)).status, 401);
    assert.equal((await request('/api/ai/conversations', { ...body, scope: 'question' })).status, 400);
    assert.equal((await request('/api/ai/conversations', { ...body, message: '' })).status, 400);
    const first = await request('/api/ai/conversations', body);
    assert.equal(first.status, 202);
    assert.deepEqual((await result(first.body.job_id)).body.sources, []);
    assert.deepEqual(calls[0], { context: { scope: 'general' }, messages: [{ role: 'user', content: body.message }] });
    assert.equal((await request('/api/ai/conversations', body)).body.job_id, first.body.job_id);
    const follow = await request('/api/ai/conversations/' + first.body.conversation_id + '/messages',
        { message: 'А на закате?', request_id: crypto.randomUUID() });
    assert.equal((await result(follow.body.job_id)).body.turns, 2);
});

test('AI uses the immutable snapshot and the displayed option letters, ignoring browser context', async () => {
    const response = await request('/api/ai/conversations', startBody({ context: { question: 'Подмена' } }));
    assert.equal(response.status, 202);
    const completed = await result(response.body.job_id);
    assert.equal(completed.body.state, 'done');
    const context = calls[0].context;
    assert.equal(context.question, 'Снимок вопроса');
    assert.equal(context.explanation, 'Пояснение из снимка');
    assert.deepEqual(context.options, { A: 'Второй', B: 'Первый' });
    assert.equal(context.correct_answer, 'B');
    assert.equal(context.selected_answer, 'A');
    assert.equal(context.option_notes.B, 'Пояснение первого');
    assert.equal(context.references.length, 1);
    assert.equal(JSON.stringify(calls[0]).includes('@example.test'), false);
    assert.equal((await request('/api/ai/jobs/' + response.body.job_id, null, other)).status, 404);
});

test('AI retry is idempotent, reserves one request, and preserves successful dialogue turns', async () => {
    let release;
    runner = () => new Promise((resolve) => { release = resolve; });
    const body = startBody();
    const first = await request('/api/ai/conversations', body);
    assert.equal((await request('/api/ai/jobs/' + first.body.job_id)).body.state, 'pending');
    const retry = await request('/api/ai/conversations', body);
    assert.equal(retry.body.job_id, first.body.job_id);
    assert.equal(calls.length, 1);
    assert.equal((await request('/api/ai/conversations', startBody())).status, 409);
    assert.equal((await request('/api/ai/conversations', { ...body, question_id: questionId + 1 })).status, 409);
    release({ answer: 'Первый ответ' });
    await result(first.body.job_id);
    runner = async () => ({ answer: 'Уточнение' });
    const followup = await request('/api/ai/conversations/' + first.body.conversation_id + '/messages',
        { request_id: crypto.randomUUID(), message: 'Почему?' });
    assert.equal(followup.status, 202);
    await result(followup.body.job_id);
    assert.deepEqual(calls[1].messages.slice(1), [{ role: 'assistant', content: 'Первый ответ' }, { role: 'user', content: 'Почему?' }]);
    clock += 16 * 60 * 1000;
    assert.equal((await request('/api/ai/jobs/' + first.body.job_id)).status, 404);
});

test('AI option-check mode requires a stored answer and obtains the displayed option from the DB', async () => {
    const body = startBody({ mode: 'option-check', batch_id: optionBatch });
    assert.equal((await request('/api/ai/conversations', body)).status, 404);
    await query(`INSERT INTO option_check_answers(user_id,batch_id,question_id,option_key,fits,option_is_correct,is_right)
        VALUES($1,$2,$3,'A',false,true,false)`, [owner.id, optionBatch, questionId]);
    const response = await request('/api/ai/conversations', body);
    assert.equal(response.status, 202);
    await result(response.body.job_id);
    assert.deepEqual(calls[0].context.selected_answer, { option_text: 'Первый', fits: false });
    const general = await request('/api/ai/conversations', { ...body, request_id: crypto.randomUUID(), scope: 'general', message: 'Почему небо голубое?' });
    assert.equal(general.status, 202);
    assert.deepEqual((await result(general.body.job_id)).body.sources, []);
    assert.deepEqual(calls[1].context, { scope: 'general' });
});

test('AI failures give fixed messages, do not insert failed turns, and allow another attempt', async () => {
    runner = async () => { const err = new Error('Diagnostic text must stay private'); err.code = 'AI_TIMEOUT'; throw err; };
    const response = await request('/api/ai/conversations', startBody());
    const completed = await result(response.body.job_id);
    assert.equal(completed.body.state, 'failed');
    assert.equal(JSON.stringify(completed).includes('Diagnostic text'), false);
    assert.match(completed.body.error, /не успел/);
    runner = async () => ({ answer: 'Новая попытка' });
    const next = await request('/api/ai/conversations', startBody());
    assert.equal((await result(next.body.job_id)).body.state, 'done');
    assert.equal(calls[1].messages.length, 1);
});

for (const scope of ['question', 'general']) test('AI bounds dialogue length and generation frequency: ' + scope, async () => {
    assert.equal((await request('/api/ai/conversations', startBody({ question_id: '1 OR 1=1' }))).status, 400);
    const first = await request('/api/ai/conversations', startBody({ scope, message: 'Почему небо голубое?' }));
    await result(first.body.job_id);
    const path = '/api/ai/conversations/' + first.body.conversation_id + '/messages';
    assert.equal((await request(path, { request_id: crypto.randomUUID(), message: 'x'.repeat(1001) })).status, 400);
    for (let i = 1; i < 6; i++) {
        const turn = await request(path, { request_id: crypto.randomUUID(), message: 'Уточнение ' + i });
        assert.equal(turn.status, 202);
        await result(turn.body.job_id);
    }
    assert.equal((await request(path, { request_id: crypto.randomUUID(), message: 'Ещё' })).status, 409);
    for (let i = 0; i < 4; i++) {
        const response = await request('/api/ai/conversations', startBody({ scope, message: 'Новый вопрос' }));
        assert.equal(response.status, 202);
        await result(response.body.job_id);
    }
    assert.equal((await request('/api/ai/conversations', startBody())).status, 429);
});

function fakeProcess() {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    return child;
}

async function anotherRouter(options, action) {
    const app = express();
    app.use(express.json());
    app.use('/api', createAiRouter({ pool, configuration: () => configuration, now: () => clock,
        runGateway: (payload) => { calls.push(payload); return runner(payload); }, ...options }));
    const local = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => local.once('listening', resolve));
    const localBase = 'http://127.0.0.1:' + local.address().port;
    const send = async (path, data, actor = owner, signal = AbortSignal.timeout(15000)) => {
        const response = await fetch(localBase + path, { method: data ? 'POST' : 'GET',
            headers: { ...(actor ? { Cookie: actor.cookie } : {}), 'Content-Type': 'application/json' },
            body: data ? JSON.stringify(data) : undefined, signal });
        return { status: response.status, body: await response.json() };
    };
    const wait = async (jobId) => {
        for (let i = 0; i < 100; i++) {
            const r = await send('/api/ai/jobs/' + jobId);
            if (r.status !== 200 || r.body.state !== 'pending') return r;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error('History test job did not finish');
    };
    try { await action(send, wait); }
    finally { await new Promise((resolve) => local.close(resolve)); }
}

test('AI ledger preserves texts, Unicode sizes, context, metrics and exact history references', async () => {
    const message = 'Почему 🐘?';
    runner = async () => ({ answer: 'Ответ 🐘', metrics: { model: 'test/model:free', prompt_tokens: 40,
        completion_tokens: 8, total_tokens: 48, cost: 0, provider_call_started: true,
        provider_ms: 2.5, gateway_ms: 3.5, provider_request_bytes: 100, provider_response_bytes: 200,
        prompt_version: 'a'.repeat(64), provider_request_id: 'gen-test', unapproved: 'not stored' } });
    const first = await request('/api/ai/conversations', { mode: 'general', scope: 'general', message, request_id: crypto.randomUUID() });
    await result(first.body.job_id);
    const r = (await query('SELECT * FROM ai_requests WHERE id=$1', [first.body.job_id])).rows[0];
    assert.equal(r.state, 'done');
    assert.equal(r.prompt_tokens, 40);
    assert.equal(r.provider_call_started, true);
    assert.equal(r.queue_ms, 0);
    assert.ok(r.duration_ms >= r.transport_ms && r.preparation_ms >= 0);
    assert.equal(r.request_bytes, Buffer.byteLength(JSON.stringify(calls[0])));
    const texts = (await query('SELECT * FROM ai_messages WHERE request_id=$1 ORDER BY id', [r.id])).rows;
    assert.equal(texts.length, 2);
    assert.equal(texts[0].content, message);
    assert.equal(texts[0].char_count, [...message].length);
    assert.equal(texts[0].byte_count, Buffer.byteLength(message));
    const conv = (await query('SELECT * FROM ai_conversations WHERE id=$1', [r.conversation_id])).rows[0];
    assert.deepEqual(conv.context, { scope: 'general' });
    const follow = await request('/api/ai/conversations/' + r.conversation_id + '/messages',
        { message: 'Уточнение', request_id: crypto.randomUUID() });
    await result(follow.body.job_id);
    const second = (await query('SELECT * FROM ai_requests WHERE id=$1', [follow.body.job_id])).rows[0];
    assert.deepEqual(second.history_message_ids, texts.map((m) => m.id));
    assert.equal(second.history_bytes, Buffer.byteLength(JSON.stringify(calls[1].messages.slice(0, -1))));
    assert.equal(JSON.stringify(second).includes('not stored'), false);
});

test('A fresh router reads committed jobs, preserves idempotency and continues stored dialogue', async () => {
    const body = { mode: 'general', scope: 'general', message: 'Первый вопрос', request_id: crypto.randomUUID() };
    const first = await request('/api/ai/conversations', body);
    await result(first.body.job_id);
    const before = calls.length;
    await anotherRouter({}, async (send, wait) => {
        assert.equal((await send('/api/ai/jobs/' + first.body.job_id)).body.state, 'done');
        assert.equal((await send('/api/ai/conversations', body)).body.job_id, first.body.job_id);
        assert.equal(calls.length, before);
        const follow = await send('/api/ai/conversations/' + first.body.conversation_id + '/messages',
            { request_id: crypto.randomUUID(), message: 'Второй вопрос' });
        assert.equal((await wait(follow.body.job_id)).body.state, 'done');
        assert.equal(calls.at(-1).messages.length, 3);
    });
    clock += 16 * 60000;
    assert.equal((await request('/api/ai/conversations', body)).status, 409);
    assert.equal(Number((await query('SELECT count(*) FROM ai_requests WHERE id=$1', [first.body.job_id])).rows[0].count), 1);
});

test('A second router does not interrupt a live generator holding the database lock', async () => {
    let release;
    runner = () => new Promise((resolve) => { release = resolve; });
    const first = await request('/api/ai/conversations', startBody());
    await anotherRouter({}, async (send) => {
        assert.equal((await send('/api/ai/jobs/' + first.body.job_id)).body.state, 'pending');
        assert.equal((await send('/api/ai/conversations', startBody())).status, 409);
    });
    release({ answer: 'Завершённый ответ' });
    assert.equal((await result(first.body.job_id)).body.state, 'done');
    assert.equal(calls.length, 1);
});

test('An abandoned durable job is marked interrupted and never automatically regenerated', async () => {
    const store = createAiHistory(pool);
    const requestId = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(['general', 'general', null, null, 'Вопрос'])).digest('hex');
    const accepted = await store.accept({ userId: owner.id, requestId, fingerprint, scope: 'general', mode: 'general',
        message: 'Вопрос', context: { scope: 'general' }, now: clock, elapsed: () => 0 });
    await store.start(accepted.row, accepted.lease, clock, 0);
    const backend = (await accepted.lease.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.equal((await query('SELECT pg_terminate_backend($1) AS terminated', [backend])).rows[0].terminated, true);
    await accepted.lease.release();
    await anotherRouter({}, async (send) => {
        const r = await send('/api/ai/jobs/' + accepted.row.id);
        assert.equal(r.body.state, 'failed');
        assert.match(r.body.error, /прервался/);
        const duplicate = await send('/api/ai/conversations', { mode: 'general', scope: 'general', message: 'Вопрос', request_id: requestId });
        assert.equal(duplicate.body.job_id, accepted.row.id);
        assert.equal(calls.length, 0);
    });
    const row = (await query('SELECT * FROM ai_requests WHERE id=$1', [accepted.row.id])).rows[0];
    assert.equal(row.error_code, 'AI_INTERRUPTED');
    assert.equal(row.duration_ms, null);
});

test('Database failure before admission prevents any gateway call', async () => {
    const store = createAiHistory(pool);
    store.accept = async () => { throw new Error('Private storage diagnostic'); };
    await anotherRouter({ history: store }, async (send) => {
        const r = await send('/api/ai/conversations', startBody());
        assert.equal(r.status, 503);
        assert.equal(JSON.stringify(r.body).includes('Private storage diagnostic'), false);
    });
    assert.equal(calls.length, 0);
});

test('A browser disconnect after durable admission does not lose the generated answer', async () => {
    const store = createAiHistory(pool);
    let notify, proceed;
    const admitted = new Promise((resolve) => { notify = resolve; });
    const gate = new Promise((resolve) => { proceed = resolve; });
    const accept = store.accept;
    store.accept = async (input) => {
        const result = await accept(input);
        notify(result.row.id);
        await gate;
        return result;
    };
    await anotherRouter({ history: store }, async (send, wait) => {
        const controller = new AbortController();
        const pending = send('/api/ai/conversations', startBody(), owner, controller.signal)
            .then(() => false, (err) => err.name === 'AbortError');
        const jobId = await admitted;
        controller.abort();
        proceed();
        assert.equal(await pending, true);
        assert.equal((await wait(jobId)).body.state, 'done');
        assert.equal(calls.length, 1);
        assert.equal(Number((await query("SELECT count(*) FROM ai_messages WHERE request_id=$1 AND role='assistant'", [jobId])).rows[0].count), 1);
    });
});

test('Failed result commit rolls back the answer and polling retries storage without regenerating', async () => {
    let fail = true;
    const proxyPool = { query: (...args) => pool.query(...args), connect: async () => {
        const client = await pool.connect();
        return { query: async (...args) => {
            if (fail && args[0].startsWith('UPDATE ai_requests SET state=$2')) throw new Error('Private finalize diagnostic');
            return client.query(...args);
        }, release: (...args) => client.release(...args), on: (...args) => client.on(...args),
        removeListener: (...args) => client.removeListener(...args) };
    } };
    await anotherRouter({ history: createAiHistory(proxyPool) }, async (send, wait) => {
        const first = await send('/api/ai/conversations', startBody());
        let response;
        for (let i = 0; i < 100; i++) {
            response = await send('/api/ai/jobs/' + first.body.job_id);
            if (response.status === 503) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(response.status, 503);
        assert.equal(Number((await query("SELECT count(*) FROM ai_messages WHERE request_id=$1 AND role='assistant'", [first.body.job_id])).rows[0].count), 0);
        assert.equal((await send('/api/ai/conversations', startBody())).status, 503);
        assert.equal(calls.length, 1);
        fail = false;
        assert.equal((await wait(first.body.job_id)).body.state, 'done');
        assert.equal(calls.length, 1);
        assert.equal(Number((await query('SELECT count(*) FROM ai_messages WHERE request_id=$1', [first.body.job_id])).rows[0].count), 2);
    });
});

test('Persistent admission limits survive a fresh router and refusals are recorded separately', async () => {
    for (let i = 0; i < 10; i++) {
        const accepted = await request('/api/ai/conversations', startBody());
        assert.equal(accepted.status, 202);
        await result(accepted.body.job_id);
    }
    await anotherRouter({}, async (send) => {
        const r = await send('/api/ai/conversations', startBody());
        assert.equal(r.status, 429);
    });
    assert.equal(calls.length, 10);
    const row = (await query("SELECT * FROM ai_requests WHERE user_id=$1 AND received_at=$2 AND state='rejected'", [owner.id, new Date(clock)])).rows[0];
    assert.equal(row.error_code, 'AI_LOCAL_RATE_LIMIT');
    assert.equal(row.started_at, null);
});

test('Concurrent duplicates admit at most one generation', async () => {
    const body = startBody();
    const results = await Promise.all([request('/api/ai/conversations', body), request('/api/ai/conversations', body)]);
    const first = results.find((r) => r.status === 202);
    assert.ok(first);
    await result(first.body.job_id);
    assert.equal(calls.length, 1);
    assert.equal((await request('/api/ai/conversations', body)).body.job_id, first.body.job_id);
});

test('Failed turns remain in the ledger but are not replayed as successful dialogue', async () => {
    runner = async () => { const err = new Error('Private provider diagnostic'); err.code = 'AI_TIMEOUT';
        err.metrics = { provider_call_started: true, provider_ms: 25 }; throw err; };
    const first = await request('/api/ai/conversations', startBody());
    await result(first.body.job_id);
    runner = async () => ({ answer: 'Уточнённый ответ' });
    const next = await request('/api/ai/conversations/' + first.body.conversation_id + '/messages',
        { message: 'Повторный вопрос', request_id: crypto.randomUUID() });
    await result(next.body.job_id);
    assert.equal(calls.at(-1).messages.length, 1);
    const row = (await query('SELECT * FROM ai_requests WHERE id=$1', [first.body.job_id])).rows[0];
    assert.equal(row.error_code, 'AI_TIMEOUT');
    assert.equal(row.provider_ms, 25);
    assert.equal(row.prompt_tokens, null);
    assert.equal(Number((await query('SELECT count(*) FROM ai_messages WHERE request_id=$1', [row.id])).rows[0].count), 1);
});

test('Deleting an account cascades to conversations, requests and complete message texts', async () => {
    const actor = await user('user');
    let jobId, conversationId;
    try {
        await anotherRouter({ configuration: () => ({ enabled: true, ownerId: actor.id }) }, async (send) => {
            const r = await send('/api/ai/conversations', { mode: 'general', scope: 'general', message: 'Текст для удаления', request_id: crypto.randomUUID() }, actor);
            jobId = r.body.job_id; conversationId = r.body.conversation_id;
            for (let i = 0; i < 100; i++) {
                if ((await send('/api/ai/jobs/' + jobId, null, actor)).body.state === 'done') break;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        });
    } finally { await query('DELETE FROM users WHERE id=$1', [actor.id]); }
    for (const [table, column, value] of [['ai_requests', 'id', jobId], ['ai_conversations', 'id', conversationId], ['ai_messages', 'request_id', jobId]]) {
        assert.equal(Number((await query('SELECT count(*) FROM ' + table + ' WHERE ' + column + '=$1', [value])).rows[0].count), 0);
    }
});

test('Gateway metadata is allowlisted; unavailable values stay absent instead of becoming zero', () => {
    const m = metrics({ prompt_tokens: -1, completion_tokens: '8', total_tokens: 5, cost: 1,
        provider_ms: Infinity, gateway_ms: NaN, provider_request_id: 'with spaces', headers: 'private', answer: 'private' });
    assert.deepEqual(m, { total_tokens: 5 });
});

test('Usage reports count admissions, refusals, Unicode volumes and latency without exporting dialogue', async () => {
    const actor = await user('user');
    try {
        for (const state of ['done', 'rejected']) {
            const requestId = crypto.randomUUID();
            await query(`INSERT INTO ai_requests(id,user_id,client_request_id,fingerprint,scope,mode,state,
                admission_status,error_code,received_at,started_at,finished_at,expires_at,duration_ms,transport_ms,model,
                provider_call_started,prompt_tokens)
                VALUES($1,$2,$3,$4,'general','general',$5,$6,$7,now()-interval '2 seconds',$8,
                now()-interval '1 second',now()+interval '15 minutes',$9,$10,'test/report:free',$11,$12)`,
            [requestId, actor.id, crypto.randomUUID(), 'b'.repeat(64), state, state === 'done' ? 202 : 409,
                state === 'done' ? null : 'AI_BUSY', state === 'done' ? new Date(Date.now() - 1900) : null,
                state === 'done' ? 100 : 1, state === 'done' ? 80 : null, state === 'done', state === 'done' ? 20 : null]);
            await query("INSERT INTO ai_messages(request_id,role,content,created_at) VALUES($1,'user','Вход',now())", [requestId]);
            if (state === 'done') await query("INSERT INTO ai_messages(request_id,role,content,created_at) VALUES($1,'assistant','Выход',now())", [requestId]);
        }
        const report = await query(require('node:fs').readFileSync(require('node:path').join(__dirname, '../scripts/ai-usage-report.sql'), 'utf8'));
        assert.equal(report.length, 7);
        const byUser = report[1].rows.find((r) => r.user_id === actor.id);
        assert.equal(Number(byUser.admissions), 2);
        assert.equal(Number(byUser.accepted), 1);
        assert.equal(Number(byUser.rejected), 1);
        assert.equal(Number(byUser.input_chars), 8);
        assert.equal(Number(byUser.output_bytes), Buffer.byteLength('Выход'));
        const hour = report[0].rows.find((r) => r.model === 'test/report:free');
        assert.equal(hour.success_p95_ms, 100);
        assert.equal(Number(hour.provider_calls_confirmed_started), 1);
        assert.equal(Number(hour.known_prompt_tokens), 20);
        assert.equal(JSON.stringify(report.map((r) => r.rows)).includes('Вход'), false);
    } finally { await query('DELETE FROM users WHERE id=$1', [actor.id]); }
});
test('Usage report JSON preserves UTC buckets across process and database time zones', async () => {
    const actor = await user('user');
    const model = 'test/report-' + crypto.randomUUID();
    // Both sides of yesterday's UTC midnight remain inside the seven-day report window.
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    midnight.setUTCDate(midnight.getUTCDate() - 1);
    const received = [-1, 20000, 50000].map((offset) => new Date(midnight.getTime() + offset));
    const bucket = (date, unit) => {
        const value = new Date(date);
        if (unit === 'hour') value.setUTCMinutes(0, 0, 0);
        else value.setUTCSeconds(0, 0);
        return value.toISOString();
    };
    try {
        for (const at of received) {
            await query(`INSERT INTO ai_requests(id,user_id,client_request_id,fingerprint,scope,mode,state,
                admission_status,received_at,finished_at,expires_at,model)
                VALUES($1,$2,$3,$4,'general','general','done',202,$5,$5,$5,$6)`,
            [crypto.randomUUID(), actor.id, crypto.randomUUID(), 'c'.repeat(64), at, model]);
        }
        for (const tz of ['UTC', 'Europe/Moscow', 'America/New_York']) {
            for (const dbZone of ['UTC', 'Europe/Moscow', 'Asia/Kathmandu']) {
                const run = spawnSync(process.execPath, [require('node:path').join(__dirname, '../scripts/ai-usage-report.js')], {
                    env: { ...process.env, TZ: tz, PGOPTIONS: (process.env.PGOPTIONS || '') + ' -c timezone=' + dbZone },
                    encoding: 'utf8', timeout: 10000,
                });
                const label = 'Node ' + tz + ', PostgreSQL ' + dbZone;
                assert.equal(run.status, 0, label + ': report process failed');
                let report;
                try { report = JSON.parse(run.stdout); }
                catch (_) { throw new Error(label + ': invalid report JSON'); }
                assert.deepEqual(Object.keys(report), ['hourly', 'users', 'errors', 'peak_minutes', 'concurrency', 'storage', 'rejections_daily']);
                const hours = report.hourly.filter((row) => row.model === model);
                assert.deepEqual(hours.map((row) => [row.hour_utc, Number(row.admissions)]),
                    [[bucket(received[1], 'hour'), 2], [bucket(received[0], 'hour'), 1]], label);
                for (const [at, count] of [[received[0], 1], [received[1], 2]]) {
                    const minute = report.peak_minutes.find((row) => row.minute_utc === bucket(at, 'minute'));
                    assert.ok(minute && Number(minute.accepted) >= count, label + ': missing UTC minute');
                }
                const byUser = report.users.find((row) => row.user_id === actor.id);
                assert.equal(Number(byUser.admissions), 3, label);
            }
        }
    } finally { await query('DELETE FROM users WHERE id=$1', [actor.id]); }
});

test('AI transport invokes only fixed SSH, sends JSON over stdin, and ignores diagnostic stderr', async () => {
    const child = fakeProcess();
    let invocation;
    const response = runGateway({ context: {}, messages: [] }, { configPath: '/test/ssh_config',
        spawnProcess: (...args) => { invocation = args; return child; } });
    child.stderr.write('SSH diagnostics are not part of the answer');
    child.stdout.write(JSON.stringify({ ok: true, answer: 'Ответ', cost: 0 }));
    child.emit('close', 0);
    assert.equal((await response).answer, 'Ответ');
    assert.equal(invocation[0], '/usr/bin/ssh');
    assert.equal(invocation[2].shell, false);
    assert.equal(invocation[1].at(-1), 'pg16-ai-gateway');
    assert.equal(invocation[1].some((arg) => arg.includes('openrouter')), false);
});
test('AI transport terminates on timeout or excessive output without another connection', async () => {
    for (const excessive of [false, true]) {
        let count = 0;
        const child = fakeProcess();
        const response = runGateway({}, { configPath: '/test/ssh_config', deadlineMs: 10,
            spawnProcess: () => { count++; return child; } });
        if (excessive) child.stdout.write(Buffer.alloc(32001));
        await assert.rejects(response, (err) => err.code === (excessive ? 'AI_INVALID' : 'AI_TIMEOUT'));
        assert.equal(child.killed, true);
        assert.equal(count, 1);
    }
});

test('SSH passes only approved metrics on both success and provider failure', async () => {
    for (const ok of [true, false]) {
        const child = fakeProcess();
        const response = runGateway({ context: {}, messages: [] }, { configPath: '/test/ssh_config', spawnProcess: () => child });
        const body = { ok, answer: 'Ответ', cost: 0, code: 'AI_RATE_LIMIT', metrics: {
            prompt_tokens: 25, provider_call_started: true, provider_ms: 10,
            headers: 'Private headers', provider_request_id: 'invalid spaces', completion_tokens: -1 } };
        child.stdout.write(JSON.stringify(body));
        child.emit('close', ok ? 0 : 1);
        if (ok) {
            const r = await response;
            assert.equal(r.metrics.prompt_tokens, 25);
            assert.equal(r.metrics.headers, undefined);
            assert.equal(r.metrics.provider_request_id, undefined);
            assert.equal(r.metrics.completion_tokens, undefined);
            assert.equal(r.metrics.gateway_response_bytes, Buffer.byteLength(JSON.stringify(body)));
        } else {
            await assert.rejects(response, (err) => err.code === 'AI_RATE_LIMIT'
                && err.metrics.provider_call_started && err.metrics.provider_ms === 10 && !('headers' in err.metrics));
        }
    }
});
