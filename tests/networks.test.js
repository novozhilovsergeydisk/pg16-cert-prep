const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');
const source = require('../scripts/questions/149_networks').questions;
const { isLengthBiased, longestCorrectShare, absoluteOnlyInWrong } = require('../scripts/lib/option-length');
const fetch = require('./paced-fetch')();
let server, base, user, cookie, category;
async function query(sql, args) {
    try { return await pool.query(sql, args); }
    catch { throw new Error('Networks fixture query failed'); }
}
async function request(path, body, auth = true) {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { ...(auth ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
}
before(async () => {
    category = (await query("SELECT * FROM categories WHERE name='21. Основы сетей'")).rows[0];
    assert.ok(category, 'Нужны миграции 148 и 149');
    user = (await query('INSERT INTO users(email,role) VALUES($1,$2) RETURNING id', ['networks-'+crypto.randomUUID()+'@example.test','user'])).rows[0].id;
    const sid = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(sid).digest(),user]);
    cookie = 'sid='+sid;
    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening',r));
    base = 'http://127.0.0.1:'+server.address().port;
});
after(async () => {
    if (server) await new Promise(r => server.close(r));
    if (user) await query('DELETE FROM users WHERE id=$1',[user]);
    await pool.end();
});
test('48 уникальных вопросов с полными пояснениями, без подсказки длиной; источник совпадает с БД', async () => {
    assert.equal(source.length,48);
    assert.ok(source.every(q => !isLengthBiased(q) && !absoluteOnlyInWrong(q)));
    assert.ok(longestCorrectShare(source)<=1/3);
    const rows=(await query('SELECT * FROM questions WHERE category_id=$1',[category.id])).rows;
    assert.equal(rows.length,48);
    for (const item of source) {
        const q=rows.find(r=>r.question_text===item.q);
        assert.ok(q,item.q);
        assert.equal(q.explanation,item.e);
        const keys=[];
        for (const [text,correct,note] of item.opts) {
            const key=Object.keys(q.options).find(k=>q.options[k]===text);
            assert.ok(key); assert.equal(q.option_notes[key],note);
            if(correct)keys.push(key);
        }
        assert.equal(q.correct_answer,keys.sort().join(''));
    }
});
test('Тема доступна в тренировке, но исключена из экзамена при любом выборе и прямой проверке', async () => {
    const list=await request('/api/categories');
    const item=list.body.find(c=>c.id===category.id);
    assert.equal(item.question_count,48);assert.equal(item.in_exam,false);assert.equal(item.exam_allowed,false);
    const question=(await query('SELECT id,correct_answer FROM questions WHERE category_id=$1 LIMIT 1',[category.id])).rows[0];
    for (const path of ['/api/exam?count=200','/api/exam?categories='+category.id,'/api/exam?categories=1,'+category.id]) {
        const r=await request(path);assert.equal(r.status,200);
        assert.ok(r.body.every(q=>q.category_id!==category.id));
    }
    const historyBefore=(await request('/api/exam/history')).body;
    const blocked=await request('/api/exam/check',{answers:[{question_id:question.id,answer:question.correct_answer}]});
    assert.equal(blocked.status,404);
    assert.deepEqual((await request('/api/exam/history')).body,historyBefore);
    assert.equal((await query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1',[user])).rows[0].n,0);
    // Остальные дополнительные темы по-прежнему доступны при ручном выборе.
    const planner=(await query("SELECT id FROM categories WHERE left(name,3)='20.'")).rows[0].id;
    const chosen=await request('/api/exam?count=5&categories='+planner);
    assert.equal(chosen.body.length,5);assert.ok(chosen.body.every(q=>q.category_id===planner));
});
test('Порции по 16, пояснения, история, статистика и исправление ошибки используют обычные маршруты', async () => {
    const batch=await request('/api/training/batches',{category_id:category.id});
    assert.equal(batch.status,201);assert.equal(batch.body.questions.length,16);
    for(const q of batch.body.questions) for(const secret of ['correct_answer','explanation','option_notes']) assert.equal(secret in q,false);
    const shown=batch.body.questions[0];
    const actual=(await query('SELECT * FROM questions WHERE id=$1',[shown.id])).rows[0];
    const wrong=Object.keys(actual.options).find(k=>k!==actual.correct_answer);
    const result=await request('/api/answers',{training_batch_id:batch.body.id,question_id:actual.id,answer:wrong});
    assert.equal(result.status,200);assert.equal(result.body.correct,false);assert.deepEqual(result.body.option_notes,actual.option_notes);
    const history=(await request('/api/training/batches/'+batch.body.id)).body;
    assert.equal(history.questions.length,16);assert.equal(history.questions[0].answer.correct,false);
    assert.equal(history.questions[0].answer.selected_answer,wrong);
    const stats=(await request('/api/stats')).body.topics.find(c=>c.id===category.id);
    assert.equal(stats.answered,1);assert.equal(stats.mistakes,1);
    assert.ok((await request('/api/mistakes')).body.some(q=>q.id===actual.id));
    const retry=await request('/api/training/batches',{mode:'mistakes'});
    assert.equal(retry.status,201);assert.ok(retry.body.questions.some(q=>q.id===actual.id));
    const fixed=await request('/api/answers',{training_batch_id:retry.body.id,question_id:actual.id,answer:actual.correct_answer});
    assert.equal(fixed.body.correct,true);
    assert.ok(!(await request('/api/mistakes')).body.some(q=>q.id===actual.id));
    assert.equal((await request('/api/stats')).body.topics.find(c=>c.id===category.id).mistakes,0);
    assert.ok((await request('/api/training/batches')).body.batches.some(b=>b.id===batch.body.id));
    // Ответив на первый набор, получаем новую полную порцию из невиденных вопросов.
    for(const q of batch.body.questions.slice(1)) {
        const key=(await query('SELECT correct_answer FROM questions WHERE id=$1',[q.id])).rows[0].correct_answer;
        assert.equal((await request('/api/answers',{training_batch_id:batch.body.id,question_id:q.id,answer:key})).status,200);
    }
    const next=(await request('/api/training/batches',{category_id:category.id})).body;
    assert.equal(next.questions.length,16);
    assert.ok(next.questions.every(q=>!batch.body.questions.some(old=>old.id===q.id)));
});
test('Материал доступен только после входа; изложение содержит все основные этапы диагностики', async () => {
    const anonymous=await fetch(base+'/api/materials/networks');assert.equal(anonymous.status,401);
    const r=await fetch(base+'/api/materials/networks',{headers:{Cookie:cookie}});
    assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/markdown/);
    const text=await r.text();assert.match(text,/^# Основы сетей/);
    for(let n=1;n<=12;n++)assert.ok(text.includes('\n## '+n+'. '));
});
