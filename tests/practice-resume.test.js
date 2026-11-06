const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const crypto=require('node:crypto');const {chromium}=require('playwright');
process.env.NODE_ENV='test';process.env.DOTENV_CONFIG_QUIET='true';
const app=require('../server'),pool=require('../src/config/db');let server,base,browser;
async function query(sql,args){try{return await pool.query(sql,args)}catch{throw new Error('Resume fixture database query failed')}}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined})});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));await pool.end()});
async function fixture(t){
 const name='UX продолжение '+crypto.randomUUID();
 const id=(await query("INSERT INTO users(email,role) VALUES($1,'user') RETURNING id",['resume-'+crypto.randomUUID()+'@example.test'])).rows[0].id;
 const other=(await query("INSERT INTO users(email,role) VALUES($1,'user') RETURNING id",['resume-'+crypto.randomUUID()+'@example.test'])).rows[0].id;
 const category=(await query('INSERT INTO categories(name) VALUES($1) RETURNING id',[name])).rows[0].id;
 const ids=[];for(let i=1;i<=3;i++)ids.push((await query("INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes) VALUES($1,$2,$3,'A',$4,$5) RETURNING id",[category,'Вопрос продолжения '+i,{A:'Верный вариант '+i,B:'Неверный вариант '+i},'Исходное пояснение',{A:'Исходная заметка A',B:'Исходная заметка B'}])).rows[0].id);
 const token=crypto.randomBytes(32).toString('base64url'),otherToken=crypto.randomBytes(32).toString('base64url');
 for(const [uid,sid]of[[id,token],[other,otherToken]])await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(sid).digest(),uid]);
 let context;t.after(async()=>{await context?.close();await query('DELETE FROM users WHERE id=ANY($1::int[])',[[id,other]]);await query('DELETE FROM questions WHERE id=ANY($1::int[])',[ids]);await query('DELETE FROM categories WHERE id=$1',[category])});
 async function request(path,body,auth=token){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{...(auth?{Cookie:'sid='+auth}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});return{status:r.status,body:await r.json()}}
 async function page(){context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'sid',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);const p=await context.newPage();p.setDefaultTimeout(7000);const errors=[];p.on('pageerror',()=>errors.push(true));t.after(()=>assert.equal(errors.length,0));await p.goto(base);await p.locator('#categories .card').filter({hasText:name}).waitFor();return p}
 return{id,otherToken,category,name,ids,request,page};
}
for(const mode of ['training','check'])test('Resume API preserves snapshot and hides unearned answers: '+mode,async t=>{
 const f=await fixture(t),training=mode==='training';const path=training?'/training':'/option-checks';
 const created=await f.request(path+'/batches',{category_id:f.category});const id=created.body.id;const cards=training?created.body.questions:created.body.cards;
 const qid=training?cards[0].id:cards[0].question_id;
 const before=await f.request(path+'/batches/'+id+'/resume');assert.equal(before.status,200);
 const items=training?before.body.questions:before.body.cards;assert.equal(items.length,3);
 for(const item of items){assert.equal(item.result,null);assert.equal(item.answer,null);assert.equal(item.correct_answer,undefined);assert.equal(item.is_correct,undefined);assert.equal(item.snapshot,undefined)}
 assert.equal((await f.request(path+'/batches/'+id+'/resume',null,f.otherToken)).status,404);
 assert.equal((await f.request(path+'/batches/'+id+'/resume',null,null)).status,401);
 assert.equal((await f.request(path+'/batches/invalid/resume')).status,400);
 await query("UPDATE questions SET question_text='Изменённый текст',explanation='Новое пояснение',option_notes='{}'::jsonb,options=$2 WHERE id=$1",[qid,{A:'Новый вариант A',B:'Новый вариант B'}]);
 const answered=await f.request(training?'/answers':'/option-checks',training?{training_batch_id:id,question_id:qid,answer:'A'}:{batch_id:id,question_id:qid,fits:true});assert.equal(answered.status,200);assert.equal(answered.body.explanation,'Исходное пояснение');
 const restored=await f.request(path+'/batches/'+id+'/resume');const restoredItems=training?restored.body.questions:restored.body.cards;
 assert.equal(restoredItems[0].question_text,cards[0].question_text);assert.equal(restoredItems[0].result.explanation,'Исходное пояснение');assert.equal(restoredItems[1].result,null);
 if(training)assert.deepEqual(restoredItems.map(q=>q.order),cards.map(q=>q.order));else assert.equal(restoredItems[0].option_text,cards[0].option_text);
 const {loadContext}=require('../src/ai/context');const context=await loadContext(pool,f.id,{mode:training?'training':'option-check',batch_id:id,question_id:qid});assert.equal(context.question,cards[0].question_text);assert.equal(context.explanation,'Исходное пояснение');
});
for(const mode of ['training','check'])test('Reload preserves position, draft, confirmed result, score and focus: '+mode,async t=>{
 const f=await fixture(t),p=await f.page(),training=mode==='training';if(!training)await p.locator('#mode-check').click();
 await p.locator('#categories .card').filter({hasText:f.name}).click();const view=training?'#question-view':'#option-check-view';await p.locator(view).waitFor({state:'visible'});
 const text=await p.locator(training?'#question-text':'#check-question-text').textContent();const order=training?await p.locator('#options input').evaluateAll(ns=>ns.map(n=>n.value)):await p.locator('#check-option').textContent();
 if(training)await p.locator('#options .option:has(input[value="A"])').click();
 await p.reload();await p.locator('#practice-resume-button').click();await p.locator(view).waitFor({state:'visible'});
 assert.equal(await p.locator(training?'#question-text':'#check-question-text').textContent(),text);
 if(training){assert.deepEqual(await p.locator('#options input').evaluateAll(ns=>ns.map(n=>n.value)),order);assert.equal(await p.locator('#options input[value="A"]').isChecked(),true)}else assert.equal(await p.locator('#check-option').textContent(),order);
 async function answer(){if(training){await p.locator('#options .option:has(input[value="A"])').click();await p.locator('#submit').click()}else{const good=(await p.locator('#check-option').textContent()).startsWith('Верный');await p.locator(good?'#check-yes':'#check-no').click()}await p.locator(training?'#result':'#check-result').waitFor({state:'visible'})}
 await answer();await p.reload();await p.locator('#practice-resume-button').click();await p.locator(training?'#result':'#check-result').waitFor({state:'visible'});
 assert.equal(await p.locator(training?'#result-status':'#check-status').textContent(),'Верно');
 await p.locator(training?'#next':'#check-next').click();assert.equal(await p.evaluate(()=>document.activeElement.id),training?'question-text':'check-question-text');
 assert.ok(await p.locator(training?'#question-text':'#check-question-text').evaluate(n=>n.getBoundingClientRect().top>=0&&n.getBoundingClientRect().top<innerHeight));
 await p.reload();await p.locator('#practice-resume-button').click();await p.locator(view).waitFor({state:'visible'});assert.match(await p.locator(training?'#progress':'#check-progress').textContent(),/2 из 3/);
 await answer();await p.locator(training?'#next':'#check-next').click();await answer();await p.locator(training?'#next':'#check-next').click();await p.locator('#finish-view').waitFor({state:'visible'});assert.match(await p.locator('#finish-text').textContent(),/верно 3 из 3/);
 await p.locator('#finish-back').click();assert.equal(await p.locator('#practice-resume').isVisible(),false);
 const table=training?'answer_log':'option_check_answers';assert.equal((await query('SELECT count(*)::int n FROM '+table+' WHERE user_id=$1',[f.id])).rows[0].n,3);
});
for(const mode of ['training','check'])for(const saved of [false,true])test('Lost confirmation is reconciled after reload without duplicate answers: '+mode+' saved='+saved,async t=>{
 const f=await fixture(t),p=await f.page(),training=mode==='training';if(!training)await p.locator('#mode-check').click();await p.locator('#categories .card').filter({hasText:f.name}).click();await p.locator(training?'#question-view':'#option-check-view').waitFor({state:'visible'});
 await p.route(training?'**/api/answers':'**/api/option-checks',async r=>{if(saved)await r.fetch();await r.abort()},{times:1});
 if(training){await p.locator('#options .option:has(input[value="A"])').click();await p.locator('#submit').click()}else await p.locator('#check-yes').click();
 await p.locator('#error').waitFor({state:'visible'});assert.match(await p.locator('#error').textContent(),/подтвердить сохранение/);
 await p.reload();await p.locator('#practice-resume-button').click();await p.locator(training?'#question-view':'#option-check-view').waitFor({state:'visible'});
 if(saved)await p.locator(training?'#result':'#check-result').waitFor({state:'visible'});else{
  if(training){assert.equal(await p.locator('#options input:enabled').count(),0);assert.equal(await p.locator('#options input[value="A"]').isChecked(),true);await p.locator('#submit').click()}else{assert.equal(await p.locator('#check-no').isDisabled(),true);await p.locator('#check-yes').click()}
  await p.locator(training?'#result':'#check-result').waitFor({state:'visible'});
 }
 assert.equal((await query('SELECT count(*)::int n FROM '+(training?'answer_log':'option_check_answers')+' WHERE user_id=$1',[f.id])).rows[0].n,1);
});
test('Legacy option batches restore safely or report a missing question without changing the portion',async t=>{
 const f=await fixture(t);const batch=(await f.request('/option-checks/batches',{category_id:f.category})).body;
 await query("UPDATE option_check_batches SET cards=(SELECT jsonb_agg(c-'snapshot') FROM jsonb_array_elements(cards) c) WHERE id=$1",[batch.id]);
 const restored=await f.request('/option-checks/batches/'+batch.id+'/resume');assert.equal(restored.status,200);assert.deepEqual(restored.body.cards.map(c=>c.option_text),batch.cards.map(c=>c.option_text));
 await query('DELETE FROM questions WHERE id=$1',[batch.cards[0].question_id]);
 assert.equal((await f.request('/option-checks/batches/'+batch.id+'/resume')).status,409);
});
test('Resume loading is visible, prevents duplicate requests and scopes the pointer to its account',async t=>{
 const f=await fixture(t),p=await f.page();await p.locator('#categories .card').filter({hasText:f.name}).click();await p.locator('#question-view').waitFor({state:'visible'});await p.reload();await p.locator('#practice-resume-button').waitFor({state:'visible'});
 let release,reached;const gate=new Promise(r=>{release=r}),arrived=new Promise(r=>{reached=r});t.after(release);let calls=0;
 await p.route('**/api/training/batches/*/resume',async r=>{calls++;reached();await gate;await r.continue()});
 await p.locator('#practice-resume-button').click();await arrived;assert.equal(await p.locator('#practice-loading').isVisible(),true);assert.equal(await p.locator('#practice-resume-button').isDisabled(),true);release();await p.locator('#question-view').waitFor({state:'visible'});assert.equal(calls,1);
 await p.context().addCookies([{name:'sid',value:f.otherToken,url:base,httpOnly:true,sameSite:'Lax'}]);await p.reload();await p.locator('#categories .card').filter({hasText:f.name}).waitFor();assert.equal(await p.locator('#practice-resume').isVisible(),false);
});
for(const mode of ['training','check'])test('A background final answer is counted once when returning to finish: '+mode,async t=>{
 const f=await fixture(t),p=await f.page(),training=mode==='training';if(!training)await p.locator('#mode-check').click();await p.locator('#categories .card').filter({hasText:f.name}).click();await p.locator(training?'#question-view':'#option-check-view').waitFor({state:'visible'});
 async function answer(){if(training){await p.locator('#options .option:has(input[value="A"])').click();await p.locator('#submit').click()}else{const good=(await p.locator('#check-option').textContent()).startsWith('Верный');await p.locator(good?'#check-yes':'#check-no').click()}}
 for(let i=0;i<2;i++){await answer();await p.locator(training?'#result':'#check-result').waitFor({state:'visible'});await p.locator(training?'#next':'#check-next').click()}
 let release,reached;const gate=new Promise(r=>{release=r}),arrived=new Promise(r=>{reached=r});t.after(release);
 await p.route(training?'**/api/answers':'**/api/option-checks',async r=>{const response=await r.fetch();reached();await gate;await r.fulfill({response})},{times:1});
 await answer();await arrived;await p.locator('#nav-results').click();release();await p.waitForTimeout(100);
 await p.locator('#nav-training').click();await p.locator(training?'#result':'#check-result').waitFor({state:'visible'});await p.locator(training?'#next':'#check-next').click();await p.locator('#finish-view').waitFor({state:'visible'});assert.match(await p.locator('#finish-text').textContent(),/верно 3 из 3/);
});
