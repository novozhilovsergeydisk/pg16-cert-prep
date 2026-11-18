const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const crypto=require('node:crypto');const {chromium}=require('playwright');
process.env.NODE_ENV='test';process.env.DOTENV_CONFIG_QUIET='true';
const app=require('../server'),pool=require('../src/config/db');let server,browser,base;
async function query(sql,args){try{return await pool.query(sql,args)}catch{throw new Error('Exam overview fixture query failed')}}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined})});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));await pool.end()});
async function fixture(t,width=390,setup=async()=>{}){
 const uid=(await query("INSERT INTO users(email,role,theme,accent) VALUES($1,'user','dark','graphite') RETURNING id",['exam-overview-'+crypto.randomUUID()+'@example.test'])).rows[0].id;
 const token=crypto.randomBytes(32).toString('base64url');await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(token).digest(),uid]);
 const context=await browser.newContext({viewport:{width,height:844}});await context.addCookies([{name:'sid',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',()=>errors.push(true));t.after(async()=>{await context.close();await query('DELETE FROM users WHERE id=$1',[uid]);assert.equal(errors.length,0)});await page.route('**/js/offline.js',r=>r.abort());await setup(page);await page.goto(base);await page.locator('#categories .card').first().waitFor();await page.locator('#open-exam').click();await page.locator('#exam-setup-view').waitFor({state:'visible'});return page;
}
async function start(page){await page.locator('#exam-count .chip').filter({hasText:'20'}).click();await page.locator('#exam-start').click();await page.locator('#exam-view').waitFor({state:'visible'})}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('pg16-exam:')))))}
async function openMap(page){if(!await page.locator('#exam-overview').evaluate(n=>n.open))await page.locator('#exam-overview summary').click()}
test('Compact launch fits the first mobile screen and summary follows the selected themes',async t=>{
 const p=await fixture(t);assert.equal(await p.locator('#exam-topics-settings').evaluate(n=>n.open),false);
 for(const w of [320,390,1280]){await p.setViewportSize({width:w,height:844});const bounds=await p.locator('#exam-start').boundingBox();const nav=await p.locator('#main-nav').boundingBox();assert.ok(bounds.y+bounds.height<(w<=600?nav.y:844));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),w)}
 await p.locator('#exam-count .chip').filter({hasText:'20'}).click();assert.match(await p.locator('#exam-time-note').textContent(),/20.*30 мин/);
 await p.locator('#exam-topics-settings summary').click();await p.locator('#exam-categories input').evaluateAll(ns=>{ns.forEach(n=>{n.checked=false});ns[0].dispatchEvent(new Event('change',{bubbles:true}))});assert.equal(await p.locator('#exam-start').isDisabled(),true);assert.match(await p.locator('#exam-topics-note').textContent(),/Выберите/);
 await p.locator('#exam-categories .option').first().click();assert.equal(await p.locator('#exam-start').isEnabled(),true);assert.match(await p.locator('#exam-topics-note').textContent(),/1 из /);
});
for(const width of [390,1280])test('Question overview preserves answers, visited states and deadline: '+width,async t=>{
 const p=await fixture(t,width);await start(p);const initial=await saved(p);assert.equal(initial.questions.some(q=>'correct_answer'in q),false);assert.match(await p.locator('#exam-answered').textContent(),/0 из 20/);
 await p.locator('#exam-options .option').first().click();const first=(await saved(p)).answers[0];assert.match(await p.locator('#exam-answered').textContent(),/1 из 20/);
 await openMap(p);await p.locator('#exam-map button').nth(4).click();assert.match(await p.locator('#exam-progress').textContent(),/5 из 20/);assert.equal(await p.evaluate(()=>document.activeElement.id),'exam-question');
 await p.locator('#exam-next').click();await openMap(p);assert.equal(await p.locator('#exam-map button').nth(4).getAttribute('data-state'),'skipped');assert.equal(await p.locator('#exam-map button').nth(1).getAttribute('data-state'),'unvisited');assert.equal(await p.locator('#exam-map button').first().getAttribute('data-state'),'answered');assert.equal(await p.locator('#exam-map [aria-current=step]').count(),1);
 await p.locator('#exam-map button').first().click();assert.equal((await saved(p)).answers[0],first);assert.equal(await p.locator('#exam-options input:checked').count(),first.length);assert.equal((await saved(p)).deadline,initial.deadline);
 await p.reload();await p.locator('#exam-view').waitFor({state:'visible'});await openMap(p);assert.equal(await p.locator('#exam-map button').nth(4).getAttribute('data-state'),'skipped');assert.equal((await saved(p)).answers[0],first);assert.equal((await saved(p)).deadline,initial.deadline);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);
});
test('Emptying a multi-answer marks it unanswered and keyboard navigation opens a question',async t=>{
 const p=await fixture(t);await p.route('**/api/exam?*',async r=>{const response=await r.fetch();const questions=await response.json();questions[0].correct_count=2;await r.fulfill({response,json:questions})});await start(p);const snapshot=await saved(p),index=0;await openMap(p);await p.locator('#exam-map button').nth(index).focus();await p.keyboard.press('Enter');await p.locator('#exam-options .option').first().click();assert.match(await p.locator('#exam-answered').textContent(),/1 из 20/);await p.locator('#exam-options .option').first().click();assert.match(await p.locator('#exam-answered').textContent(),/0 из 20/);
 await openMap(p);await p.locator('#exam-map button').nth(index===0?1:0).click();assert.equal(await p.locator('#exam-map button').nth(index).getAttribute('data-state'),'skipped');
});
test('Overview cannot change the exam while finishing, and expiry keeps answers locked',async t=>{
 const p=await fixture(t);await p.clock.install();await p.clock.pauseAt(new Date(Date.now()+1000));await start(p);await p.locator('#exam-options .option').first().click();const original=await saved(p);let release,reached;const gate=new Promise(r=>{release=r}),arrived=new Promise(r=>{reached=r});t.after(release);let calls=0;
 await p.route('**/api/exam/check',async r=>{calls++;reached();await gate;await r.fulfill({status:503,json:{error:'Временный отказ'}})});p.once('dialog',d=>d.accept());await p.locator('#exam-finish').click();await arrived;assert.equal(await p.locator('#exam-map button:enabled').count(),0);assert.equal(await p.locator('#exam-options input:enabled').count(),0);release();await p.locator('#error').waitFor({state:'visible'});
 const automatic=p.waitForResponse(r=>r.url().endsWith('/api/exam/check'));await p.clock.fastForward('00:30:01');await automatic;await p.locator('#exam-timer').filter({hasText:'00:00'}).waitFor();assert.equal(await p.locator('#exam-options input:enabled').count(),0);const current=await saved(p);assert.deepEqual(current.answers,original.answers);assert.equal(calls,2);
});
test('Starting cannot be duplicated and a late response cannot override another section',async t=>{
 const p=await fixture(t);let release,reached;const gate=new Promise(r=>{release=r}),arrived=new Promise(r=>{reached=r});t.after(release);let calls=0;await p.route('**/api/exam?*',async r=>{calls++;reached();await gate;await r.continue()});await p.locator('#exam-start').click();await arrived;assert.equal(await p.locator('#exam-start').isDisabled(),true);assert.equal(await p.locator('#exam-count input:enabled').count(),0);await p.locator('#nav-results').click();release();await p.waitForTimeout(150);assert.equal(await p.locator('#results-view').isVisible(),true);assert.equal(calls,1);
});

test('Summary reports the actual available count when the selected topics contain fewer questions',async t=>{
 const p=await fixture(t,390,async page=>{await page.route('**/api/categories',r=>r.fulfill({json:[{id:1,name:'Небольшая тема',question_count:3,in_exam:true}]}))});
 assert.match(await p.locator('#exam-time-note').textContent(),/Вопросов: 3.*4,5 мин/);
 await p.locator('#exam-count .chip').filter({hasText:'50'}).click();
 assert.match(await p.locator('#exam-time-note').textContent(),/Вопросов: 3.*4,5 мин/);
});
test('Fifty questions fit a narrow screen and the map closes after a jump',async t=>{
 const p=await fixture(t,320);await p.locator('#exam-count .chip').filter({hasText:'50'}).click();await p.locator('#exam-start').click();await p.locator('#exam-view').waitFor({state:'visible'});await openMap(p);assert.equal(await p.locator('#exam-map button').count(),50);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),320);assert.equal(await p.locator('#exam-map button').evaluateAll(ns=>ns.every(n=>n.getBoundingClientRect().width>=44&&n.getBoundingClientRect().height>=44)),true);
 await p.locator('#exam-map button').last().click();assert.match(await p.locator('#exam-progress').textContent(),/50 из 50/);assert.equal(await p.locator('#exam-overview').evaluate(n=>n.open),false);assert.equal(await p.locator('#exam-next').isDisabled(),true);assert.ok(await p.locator('.exam-bar').evaluate(n=>n.getBoundingClientRect().top>=0&&n.getBoundingClientRect().bottom<innerHeight));
});
test('An existing saved exam without visited metadata restores safely',async t=>{
 const p=await fixture(t);await start(p);await p.locator('#exam-options .option').first().click();await p.locator('#exam-next').click();const initial=await saved(p);
 await p.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('pg16-exam:'));const data=JSON.parse(localStorage.getItem(key));delete data.visited;localStorage.setItem(key,JSON.stringify(data))});
 await p.reload();await p.locator('#exam-view').waitFor({state:'visible'});assert.deepEqual((await saved(p)).answers,initial.answers);assert.equal((await saved(p)).deadline,initial.deadline);assert.equal(await p.locator('#exam-map button').first().getAttribute('data-state'),'answered');assert.equal(await p.locator('#exam-map button').nth(1).getAttribute('aria-current'),'step');
});
