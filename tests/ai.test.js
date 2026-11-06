const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { createAiRouter } = require('../src/routes/ai');
const { runGateway } = require('../src/ai/transport');

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
