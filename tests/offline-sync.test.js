const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.NODE_ENV='test';process.env.DOTENV_CONFIG_QUIET='true';
const app=require('../server'),pool=require('../src/config/db');
const core=require('../public/js/offline-core');
const fetch=require('./paced-fetch')();
let server,base,ip=100;
async function query(sql,args){try{return await pool.query(sql,args);}catch(e){throw Object.assign(new Error('Offline fixture database query failed'),{code:e.code});}}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));await pool.end();});
async function fixture(t){
    const user=(await query('INSERT INTO users(email) VALUES($1) RETURNING id',['offline-'+crypto.randomUUID()+'@example.test'])).rows[0].id;
    const token=crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(token).digest(),user]);
    const addr='198.51.100.'+(++ip);
    t.after(()=>query('DELETE FROM users WHERE id=$1',[user]));
    async function req(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:'sid='+token,'Content-Type':'application/json','X-Forwarded-For':addr},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json()};}
    const manifest=await req('/api/offline/catalog');assert.equal(manifest.status,200);
    const cat=(await query('SELECT payload FROM offline_catalogs WHERE version=$1',[manifest.body.version])).rows[0].payload;
    const q=cat.questions.find(q=>cat.categories.find(c=>c.id===q.category_id)?.exam_allowed);
    const device=crypto.randomUUID();let seq=0;
    const event=(kind,id,payload,revision=0)=>({event_id:crypto.randomUUID(),device_sequence:++seq,attempt_id:id,base_revision:revision,
        occurred_at:new Date().toISOString(),catalog_version:manifest.body.version,kind,payload});
    const send=events=>req('/api/sync/events',{protocol_version:1,device_id:device,events});
    const create=kind=>event('create',crypto.randomUUID(),{kind,mode:'category',category_id:q.category_id,questions:[{id:q.id,order:Object.keys(q.options),...(kind==='check'?{key:Object.keys(q.options)[0]}:{})}]});
    return {user,req,cat,q,event,send,create};
}
test('Offline delivery is idempotent after a lost response, validates fingerprint and ownership',async t=>{
    const f=await fixture(t),e=f.create('training');
    assert.equal((await f.send([e])).status,200);
    const a=f.event('answer',e.attempt_id,{question_id:f.q.id,value:f.q.correct_answer});
    const results=await Promise.all([f.send([a]),f.send([a])]);
    assert.deepEqual(results[0].body.receipts,results[1].body.receipts);assert.equal(results[0].status,200);assert.equal(results[1].status,200);
    assert.equal((await query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1',[f.user])).rows[0].n,1);
    const changed={...a,payload:{...a.payload,value:'ZZ'}};
    assert.equal((await f.send([changed])).status,409);
    const other=await fixture(t);
    assert.equal((await other.send([other.event('answer',e.attempt_id,a.payload)])).status,409);
    const changes=await other.req('/api/sync/changes');assert.ok(changes.body.changes.every(c=>c.collection==='users'));
});
test('Concurrent answers retain conflict and resolving it updates legacy statistics without duplicates',async t=>{
    const f=await fixture(t),e=f.create('training');await f.send([e]);
    const wrong=Object.keys(f.q.options).find(k=>k!==f.q.correct_answer);
    await f.send([f.event('answer',e.attempt_id,{question_id:f.q.id,value:wrong})]);
    const conflict=f.event('answer',e.attempt_id,{question_id:f.q.id,value:f.q.correct_answer});
    const r=await f.send([conflict]);assert.equal(r.status,200);assert.equal(r.body.receipts[0].conflict,true);
    let s=(await query('SELECT state FROM sync_attempts WHERE user_id=$1 AND id=$2',[f.user,e.attempt_id])).rows[0].state;
    assert.equal(s.conflicts.length,1);assert.equal(s.answers[f.q.id].value,wrong);
    assert.equal((await f.send([f.event('resolve',s.id,{event_id:conflict.event_id,choice:'local'},s.revision)])).status,200);
    const rows=(await query('SELECT correct,selected_answer FROM answer_log WHERE user_id=$1',[f.user])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].correct,true);
});
test('Legacy writes enter committed change stream; cursor pages and replay reconstruct all changes',async t=>{
    const f=await fixture(t);
    const first=await f.req('/api/sync/bootstrap');const cursor=first.body.cursor;
    const batch=await f.req('/api/training/batches',{category_id:f.q.category_id,limit:1});assert.equal(batch.status,201);
    const next=await f.req('/api/sync/changes?cursor='+cursor);assert.equal(next.status,200);
    assert.ok(next.body.changes.some(c=>c.collection==='training_batches'&&c.data.id===batch.body.id));
    assert.deepEqual((await f.req('/api/sync/changes?cursor='+cursor+'&until='+next.body.until)).body.changes,next.body.changes);
});
test('Versioned scoring survives question changes; exam and cards also sync to existing history',async t=>{
    const f=await fixture(t),e=f.create('exam');
    assert.equal((await f.send([e])).status,200);
    const finish=f.event('finish',e.attempt_id,{answers:[f.q.correct_answer],duration_seconds:20});
    assert.equal((await f.send([finish])).status,200);assert.equal((await f.send([finish])).status,200);
    const exams=(await query('SELECT correct,snapshot FROM exam_history WHERE user_id=$1',[f.user])).rows;
    assert.equal(exams.length,1);assert.equal(exams[0].correct,1);assert.equal(exams[0].snapshot.results[0].correct_answer,f.q.correct_answer);
    const card=f.create('check');assert.equal((await f.send([card])).status,200);
    assert.equal((await f.send([f.event('answer',card.attempt_id,{question_id:f.q.id,value:true})])).status,200);
    assert.equal((await query('SELECT count(*)::int AS n FROM option_check_answers WHERE user_id=$1',[f.user])).rows[0].n,1);
    const forbidden=f.cat.questions.find(q=>!f.cat.categories.find(c=>c.id===q.category_id)?.exam_allowed);
    const invalid=f.create('exam');invalid.payload.questions=[{id:forbidden.id,order:Object.keys(forbidden.options)}];
    assert.equal((await f.send([invalid])).status,400);
});
test('Content chunks reconstruct and verify immutable catalogue; malformed events roll back',async t=>{
    const f=await fixture(t);const m=(await f.req('/api/offline/catalog')).body;
    let text='';for(const part of m.parts){const r=await f.req('/api/offline/catalog/'+m.version+'/'+part.part);assert.equal(r.status,200);
        assert.equal(crypto.createHash('sha256').update(r.body.text).digest('hex'),part.hash);text+=r.body.text;}
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'),m.version);assert.ok(JSON.parse(text).documents['/api/practice/01']);
    const invalid=f.create('training');invalid.payload.questions[0].order=['ZZ'];assert.equal((await f.send([invalid])).status,400);
    assert.equal((await query('SELECT count(*)::int AS n FROM sync_receipts WHERE user_id=$1',[f.user])).rows[0].n,0);
    assert.equal((await query('SELECT count(*)::int AS n FROM training_batches WHERE user_id=$1',[f.user])).rows[0].n,0);
});
test('Shared evaluation never accepts supplied score or unknown answer keys',()=>{
    const q={id:1,category_id:1,options:{A:'one',B:'two'},correct_answer:'AB',explanation:'why'};
    assert.equal(core.answer(q,'BA'),'AB');assert.throws(()=>core.answer(q,'C'));
    const event={attempt_id:crypto.randomUUID(),occurred_at:new Date().toISOString(),payload:{kind:'exam',questions:[{id:1,order:['B','A']}]}};
    const s=core.create(event,{questions:[q],categories:[{id:1,name:'test',exam_allowed:true}]});
    const completed=core.apply(s,{kind:'finish',payload:{answers:['A'],duration_seconds:1,score:100}});
    assert.equal(core.examResult(completed).correct,0);
});
