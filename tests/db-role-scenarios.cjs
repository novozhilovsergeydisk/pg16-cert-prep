// Functional checks use the real controllers and a separate, restricted LOGIN connection.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
module.exports=async function runMatrix({admin,runtime,adapter,root,onCheck}) {
const previous={query:adapter.query,connect:adapter.connect};
adapter.query=runtime.query.bind(runtime);adapter.connect=runtime.connect.bind(runtime);
let server,passed=0;const results=[];
function check(name,fn){return fn().then(()=>{passed++;results.push({name,result:'passed'});onCheck?.(name)})}
async function denied(name,sql,args){await check(name,async()=>{await assert.rejects(runtime.query(sql,args),e=>e.code==='42501')})}
try {
 await admin.query('INSERT INTO snapshot_storage_usage VALUES(0,0,0) ON CONFLICT DO NOTHING');
 const cat=(await admin.query("INSERT INTO categories(name) VALUES('Roles spike') RETURNING id")).rows[0].id;
 const q=(await admin.query(`INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes) VALUES($1,'Roles fixture',$2,'A','Fixture explanation',$3) RETURNING id`,[cat,{A:'Right',B:'Wrong'},{A:'Right note',B:'Wrong note'}])).rows[0];
 const app=require(root+'/server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 let cookie;async function request(path,body){await new Promise(r=>setTimeout(r,120));const r=await fetch(url+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const payload=await r.json();return {status:r.status,body:payload,headers:r.headers}}
 const email='roles-'+crypto.randomUUID()+'@example.test';
 const req=await request('/auth/request',{email});assert.equal(req.status,200);
 const text=require(root+'/src/services/mailer').outbox.at(-1).text;const code=text.match(/(\d{6})\s*$/)[1];
 const login=await request('/auth/verify-code',{email,code,request_id:req.body.request_id});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];passed++;results.push({name:'Real controllers: login code, user upsert, session',result:'passed'});
 const uid=(await admin.query('SELECT id FROM users WHERE email=$1',[email])).rows[0].id;
 await check('Profile allowed columns',async()=>{assert.equal((await request('/me/accent',{accent:'green'})).status,200);assert.equal((await request('/me/theme',{theme:'dark'})).status,200)});
 let batch,option;
 await check('Training insert and quota definer without counter grants',async()=>{batch=await request('/training/batches',{category_id:cat});assert.equal(batch.status,201);assert.equal((await request('/answers',{training_batch_id:batch.body.id,question_id:q.id,answer:'A'})).status,200);assert.equal((await request('/training/batches/'+batch.body.id+'/resume')).status,200)});
 await check('Option cards and answers',async()=>{option=await request('/option-checks/batches',{category_id:cat});assert.equal(option.status,201);assert.equal((await request('/option-checks',{batch_id:option.body.id,question_id:q.id,fits:true})).status,200)});
 await check('Exam and idempotent replay',async()=>{const body={answers:[{question_id:q.id,answer:'A'}],submission_id:crypto.randomUUID()};assert.equal((await request('/exam/check',body)).status,200);assert.equal((await request('/exam/check',body)).status,200);assert.equal((await request('/exam/history')).status,200)});
 await check('Statistics queries and admin read path',async()=>{assert.equal((await request('/stats')).status,200);await admin.query("UPDATE users SET role='admin' WHERE id=$1",[uid]);assert.equal((await request('/admin/users')).status,200);assert.equal((await request('/admin/users/'+uid)).status,200);assert.equal((await request('/admin/hard-questions')).status,200)});
 const {createAiHistory}=require(root+'/src/ai/history');const history=createAiHistory(runtime),now=Date.now();let accepted;
 await check('AI accept/start/finish, identity sequences without grants',async()=>{accepted=await history.accept({userId:uid,requestId:crypto.randomUUID(),fingerprint:'a'.repeat(64),scope:'general',mode:'general',context:{scope:'general'},message:'Fixture',now,elapsed:()=>0});assert.equal(accepted.row.state,'pending');await history.start(accepted.row,accepted.lease,now,0);await history.finish({row:accepted.row,answer:'Fixture answer',finishedAt:now+1,durationMs:1,transportMs:1,preparationMs:0,metrics:{model:'fixture',cost:0,provider_call_started:false}},accepted.lease);await accepted.lease.release();assert.equal((await history.job(accepted.row.id,uid,now+2)).state,'done')});
 await check('AI continuation and rejection counter permissions',async()=>{assert.equal((await history.conversation(accepted.row.conversation_id,uid,now+2)).turns,1);const r=await history.accept({userId:uid,requestId:crypto.randomUUID(),fingerprint:'b'.repeat(64),scope:'general',mode:'general',message:'No stored rejection text',now:now+3,elapsed:()=>0,rejectCode:'AI_LOCAL_RATE_LIMIT',rejectStatus:429});assert.equal(r.row.state,'rejected');assert.equal((await runtime.query('SELECT total FROM ai_rejection_daily WHERE user_id=$1',[uid])).rows[0].total,'1');assert.equal((await runtime.query('SELECT * FROM ai_messages WHERE request_id=$1',[r.row.id])).rowCount,0)});
 await check('Seven-section AI report under runtime',async()=>{assert.equal((await runtime.query(fs.readFileSync(root+'/scripts/ai-usage-report.sql','utf8'))).length,7)});
 for(const [name,sql,args] of [
 ['No role escalation',"UPDATE users SET role='admin' WHERE id=$1",[uid]],
 ['No privileged user insert',"INSERT INTO users(email,role) VALUES('blocked@example.test','admin')"],
 ['No question changes',"UPDATE questions SET explanation='blocked' WHERE id=$1",[q.id]],
 ['No category insertion',"INSERT INTO categories(name) VALUES('blocked')"],
 ['No archive access','SELECT * FROM question_archive'],
 ['No quota counter access','SELECT * FROM snapshot_storage_usage'],
 ['No quota tampering','UPDATE snapshot_storage_usage SET snapshots=0'],
 ['No DDL','ALTER TABLE questions ADD COLUMN blocked integer'],
 ['No DROP','DROP TABLE questions'],
 ['No TRUNCATE','TRUNCATE sessions'],
 ['No disabled quota trigger','ALTER TABLE training_batches DISABLE TRIGGER snapshot_storage_quota'],
 ['No function replacement','ALTER FUNCTION enforce_snapshot_storage_quota() SECURITY INVOKER'],
 ['No CREATE schema','CREATE SCHEMA blocked'],
 ['No CREATE table','CREATE TABLE public.blocked(id integer)'],
 ['No TEMP objects','CREATE TEMP TABLE blocked(id integer)'],
 ['No SET ROLE owner','SET ROLE pg16_owner'],
 ['No identity sequence reset',"SELECT setval('ai_messages_id_seq',1)"],
 ['No serial sequence reset',"SELECT setval('users_id_seq',1)"],
 ['No direct identity sequence usage',"SELECT nextval('ai_messages_id_seq')"]
 ])await denied(name,sql,args);
 await check('Quota function is private and has fixed search_path',async()=>{const r=(await admin.query("SELECT prosecdef,proconfig,has_function_privilege('fixture_runtime',oid,'EXECUTE') AS runtime_execute FROM pg_proc WHERE oid='enforce_snapshot_storage_quota()'::regprocedure")).rows[0];assert.equal(r.prosecdef,true);assert.equal(r.runtime_execute,false);assert.ok(r.proconfig.includes('search_path=pg_catalog, public, pg_temp'))});
 await check('Quota boundary still serialized under restricted runtime',async()=>{await admin.query(`INSERT INTO training_batches(user_id,category_name,mode,questions) SELECT $1,'Fixture','mistakes','[{}]'::jsonb FROM generate_series(1,997)`,[uid]);const queries=[runtime.query("INSERT INTO training_batches(user_id,category_name,mode,questions) VALUES($1,'Fixture','mistakes','[{}]')",[uid]),runtime.query("INSERT INTO option_check_batches(user_id,category_name,cards) VALUES($1,'Fixture','[{}]')",[uid])];const r=await Promise.allSettled(queries);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.constraint,'snapshot_storage_quota');assert.equal((await request('/training/batches',{category_id:cat})).status,429);assert.equal((await request('/training/batches/'+batch.body.id+'/resume')).status,200)});
 await check('Future owner objects are closed by default',async()=>{const c=await admin.connect();try{await c.query('SET ROLE pg16_owner');await c.query('CREATE TABLE public.future_fixture(id integer)');await c.query('CREATE FUNCTION public.future_fixture() RETURNS integer LANGUAGE sql AS $$SELECT 1$$');await c.query('RESET ROLE')}finally{c.release()}await assert.rejects(runtime.query('SELECT * FROM public.future_fixture'),e=>e.code==='42501');await assert.rejects(runtime.query('SELECT public.future_fixture()'),e=>e.code==='42501');await admin.query('DROP TABLE public.future_fixture');await admin.query('DROP FUNCTION public.future_fixture()')});
 await check('Logout deletes session',async()=>{assert.equal((await request('/auth/logout',{})).status,200);assert.equal((await request('/me')).status,401)});
 await check('Administrative account deletion preserves counter consistency',async()=>{await admin.query('DELETE FROM users WHERE id=$1',[uid]);assert.equal((await admin.query('SELECT snapshots FROM snapshot_storage_usage WHERE scope_id=0')).rows[0].snapshots,'0');assert.equal((await admin.query('SELECT * FROM ai_rejection_daily WHERE user_id=$1',[uid])).rowCount,0)});
 return {passed,results};
} finally { if(server)await new Promise(r=>server.close(r));adapter.query=previous.query;adapter.connect=previous.connect; }
};
