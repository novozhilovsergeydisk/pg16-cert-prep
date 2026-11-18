const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {chromium}=require('playwright');
process.env.NODE_ENV='test';process.env.DOTENV_CONFIG_QUIET='true';
const app=require('../server'),pool=require('../src/config/db');
let server,base,browser,nextIp=30;
async function query(sql,args){try{return await pool.query(sql,args);}catch(e){throw Object.assign(new Error('PWA test database operation failed'),{code:e.code});}}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r));await pool.end();});
async function fixture(t){
    const uid=(await query('INSERT INTO users(email) VALUES($1) RETURNING id',['offline-browser-'+crypto.randomUUID()+'@example.test'])).rows[0].id;
    const token=crypto.randomBytes(32).toString('base64url');await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(token).digest(),uid]);
    const contexts=[];t.after(async()=>{for(const c of contexts)await c.close();await query('DELETE FROM users WHERE id=$1',[uid]);});
    async function device(){
        const context=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'X-Forwarded-For':'198.51.100.'+(++nextIp)}});contexts.push(context);
        await context.addCookies([{name:'sid',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const errors=[];page.on('pageerror',()=>errors.push(true));t.after(()=>assert.equal(errors.length,0,'No unhandled browser errors'));
        await page.goto(base);await page.waitForFunction(()=>PGOffline.inspect().ready,null,{timeout:60000});
        await page.locator('#categories .card').first().waitFor();
        await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
        return {context,page};
    }
    return {uid,token,device};
}
async function synced(page){
    const since=Date.now();
    await page.evaluate(()=>PGOffline.sync());
    try {await page.waitForFunction(since=>{const s=PGOffline.inspect();return s.pending===0&&!s.busy&&s.syncedAt>=since;},since,{timeout:30000});}
    catch {assert.fail(JSON.stringify(await page.evaluate(()=>({state:PGOffline.inspect(),message:document.getElementById('sync-status').textContent}))));}
}
async function create(page,kind){
    return page.evaluate(async kind=>{
        const c=(await PGOffline.request('/api/categories')).value.find(c=>c.in_exam&&c.exam_allowed);
        const route=kind==='check'?'/api/option-checks/batches':'/api/training/batches';
        return (await PGOffline.request(route,{method:'POST',body:JSON.stringify({category_id:c.id,limit:2})})).value;
    },kind);
}
async function answer(page,batch,kind='training'){
    const body=kind==='check'?{batch_id:batch.id,question_id:batch.cards[0].question_id,fits:true}:
        {training_batch_id:batch.id,question_id:batch.questions[0].id,answer:Object.keys(batch.questions[0].options)[0]};
    return page.evaluate(async({body,kind})=>(await PGOffline.request(kind==='check'?'/api/option-checks':'/api/answers',{method:'POST',body:JSON.stringify(body)})).value,{body,kind});
}
test('PWA cold launch offline, all learning modes, materials and recovery without duplicate results',async t=>{
    const f=await fixture(t),{context,page}=await f.device();
    const manifest=await page.evaluate(async()=>await (await fetch('/manifest.webmanifest')).json());assert.equal(manifest.display,'standalone');
    await context.setOffline(true);await page.close();const offline=await context.newPage();offline.setDefaultTimeout(15000);
    await offline.goto(base);await offline.locator('#categories .card').first().waitFor();
    assert.equal(await offline.evaluate(()=>PGOffline.inspect().ready),true);
    await offline.locator('#categories .card').first().click();
    await offline.locator('#options input').first().check({force:true});await offline.locator('#submit').click();
    await offline.locator('#result').waitFor({state:'visible'});assert.match(await offline.locator('#sync-status').textContent(),/устройстве|связи/);
    const cards=await create(offline,'check');await answer(offline,cards,'check');
    const summary=await offline.evaluate(async()=>{
        const categories=(await PGOffline.request('/api/categories')).value.filter(c=>c.exam_allowed&&c.in_exam);
        const qs=(await PGOffline.request('/api/exam?count=2&categories='+categories[0].id)).value;
        const result=(await PGOffline.request('/api/exam/check',{method:'POST',body:JSON.stringify({submission_id:crypto.randomUUID(),answers:qs.map(q=>({question_id:q.id,answer:Object.keys(q.options)[0],order:Object.keys(q.options)})),duration_seconds:10})})).value;
        return {result,material:PGOffline.document('/api/practice/01'),stats:(await PGOffline.request('/api/stats')).value,history:(await PGOffline.request('/api/exam/history')).value};
    });assert.equal(summary.result.total,2);assert.ok(summary.material.length>100);assert.equal(summary.history.length,1);
    assert.ok(summary.stats.topics.some(c=>c.answered>0));
    await context.setOffline(false);await synced(offline);
    const first=(await query('SELECT count(*)::int n FROM answer_log WHERE user_id=$1',[f.uid])).rows[0].n;
    assert.equal(first,3);assert.equal((await query('SELECT count(*)::int n FROM option_check_answers WHERE user_id=$1',[f.uid])).rows[0].n,1);
    await synced(offline);assert.equal((await query('SELECT count(*)::int n FROM answer_log WHERE user_id=$1',[f.uid])).rows[0].n,first);
});
test('Two devices exchange independent exercises, profile and results in both directions',async t=>{
    const f=await fixture(t),a=await f.device(),b=await f.device();
    await a.context.setOffline(true);await b.context.setOffline(true);
    const x=await create(a.page,'training'),y=await create(b.page,'training');
    await answer(a.page,x);await answer(b.page,y);
    await a.page.evaluate(()=>PGOffline.request('/api/me/theme',{method:'POST',body:JSON.stringify({theme:'dark'})}));
    await a.context.setOffline(false);await synced(a.page);await b.context.setOffline(false);await synced(b.page);await synced(a.page);
    for(const page of [a.page,b.page]){
        const history=await page.evaluate(async()=>(await PGOffline.request('/api/training/batches')).value.batches);
        assert.equal(history.length,2);assert.equal(history.reduce((n,r)=>n+r.answered,0),2);
    }
    assert.equal(await b.page.evaluate(()=>PGOffline.profile().theme),'dark');
});
test('Interrupted receipt retries safely; expired session preserves queue for the same account',async t=>{
    const f=await fixture(t),{context,page}=await f.device();
    await context.setOffline(true);const batch=await create(page,'training');await answer(page,batch);
    await query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE user_id=$1',[f.uid]);
    await context.setOffline(false);await page.evaluate(()=>PGOffline.sync());
    await page.waitForFunction(()=>document.getElementById('sync-status').textContent.includes('войдите снова'),null,{timeout:30000});
    assert.ok(await page.evaluate(()=>PGOffline.inspect().pending>0));
    await query('UPDATE sessions SET expires_at=now()+interval \'1 hour\' WHERE user_id=$1',[f.uid]);
    await synced(page);assert.equal((await query('SELECT count(*)::int n FROM answer_log WHERE user_id=$1',[f.uid])).rows[0].n,1);
});
test('Exam draft survives offline reload and finishes with the original deadline',async t=>{
    const f=await fixture(t),{context,page}=await f.device();await context.setOffline(true);
    await page.locator('a[href="#/exam"]').click();await page.locator('#exam-start').click();
    await page.locator('#exam-options input').first().check({force:true});
    await page.waitForFunction(()=>PGOffline.inspect().pending>0);
    const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('pg16-exam:')))));
    await page.reload();await page.locator('#exam-view').waitFor({state:'visible'});
    await page.locator('#exam-timer').waitFor({state:'visible'});
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('pg16-exam:')))));
    assert.equal(restored.deadline,draft.deadline);assert.deepEqual(restored.answers,draft.answers);
    await context.setOffline(false);await synced(page);
});
test('Manual sync mode keeps results local until the user asks to sync',async t=>{
    const f=await fixture(t),{page}=await f.device();
    assert.equal(await page.locator('#sync-mode-select').inputValue(),'auto');
    await page.evaluate(()=>PGOffline.setSyncMode('manual'));
    assert.equal(await page.locator('#sync-mode-select').inputValue(),'manual');
    const batch=await create(page,'training');await answer(page,batch);
    await page.waitForFunction(()=>PGOffline.inspect().pending>=2,null,{timeout:30000});
    await page.waitForTimeout(300);
    assert.equal((await query('SELECT count(*)::int n FROM answer_log WHERE user_id=$1',[f.uid])).rows[0].n,0);
    assert.match(await page.locator('#sync-status').textContent(),/вручную/);
    await page.locator('#sync-retry').click();
    await page.waitForFunction(()=>{const s=PGOffline.inspect();return s.pending===0&&!s.busy;},null,{timeout:30000});
    assert.equal((await query('SELECT count(*)::int n FROM answer_log WHERE user_id=$1',[f.uid])).rows[0].n,1);
    await page.evaluate(()=>PGOffline.setSyncMode('auto'));
});
