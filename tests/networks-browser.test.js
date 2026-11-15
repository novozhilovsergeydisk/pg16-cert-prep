const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
process.env.NODE_ENV='test';process.env.DOTENV_CONFIG_QUIET='true';
const app=require('../server'),pool=require('../src/config/db');
let server,browser,base,questions,category;
async function query(sql,args){try{return await pool.query(sql,args)}catch{throw new Error('Networks browser fixture failed')}}
before(async()=>{
    category=(await query("SELECT id FROM categories WHERE name='21. Основы сетей'")).rows[0].id;
    questions=(await query('SELECT * FROM questions WHERE category_id=$1',[category])).rows;
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));await pool.end()});
async function fixture(t,width){
    const user=(await query('INSERT INTO users(email,role) VALUES($1,$2) RETURNING id',['networks-browser-'+crypto.randomUUID()+'@example.test','user'])).rows[0].id;
    const sid=crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(sid).digest(),user]);
    const context=await browser.newContext({viewport:{width,height:900}}),errors=[];
    await context.addCookies([{name:'sid',value:sid,url:base,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',()=>errors.push(true));
    t.after(async()=>{await context.close();await query('DELETE FROM users WHERE id=$1',[user]);assert.equal(errors.length,0)});
    await page.goto(base);await page.locator('#categories .card').first().waitFor();return page;
}
for(const width of [320,390,1280]) test('Тема, материал, порция 16 и запрет экзамена: '+width+'px',async t=>{
    const p=await fixture(t,width);
    const card=p.locator('#categories li').filter({has:p.locator('button.card').filter({hasText:'21. Основы сетей'})});
    assert.match(await card.textContent(),/48/);
    await card.getByRole('button',{name:'Материал для изучения'}).click();
    await p.locator('#material-view').waitFor({state:'visible'});assert.match(await p.locator('#material-body').textContent(),/Основы сетей/);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);
    await p.screenshot({path:'/private/tmp/pg16-networks-250/material-'+width+'.png'});
    await p.locator('#material-back').click();
    const pending=p.waitForResponse(r=>r.url().endsWith('/api/training/batches')&&r.request().method()==='POST');
    await p.locator('#categories .card').filter({hasText:'21. Основы сетей'}).click();
    const batch=await (await pending).json();assert.equal(batch.questions.length,16);
    await p.locator('#question-view').waitFor({state:'visible'});assert.match(await p.locator('#progress').textContent(),/из 16/);
    const q=questions.find(q=>q.id===batch.questions[0].id);const wrong=Object.keys(q.options).find(k=>k!==q.correct_answer);
    await p.locator('#options .option').filter({has:p.locator('input[value="'+wrong+'"]')}).click();await p.locator('#submit').click();
    await p.locator('#result').waitFor({state:'visible'});assert.equal(await p.locator('#result-explanation').textContent(),q.explanation);
    await p.screenshot({path:'/private/tmp/pg16-networks-250/question-'+width+'.png'});
    // Повторяем именно ошибочный вопрос в обычной работе над ошибками.
    await p.locator('#back').click();await p.locator('#open-mistakes').click();
    await p.locator('#question-view').waitFor({state:'visible'});assert.equal(await p.locator('#question-text').textContent(),q.question_text);
    for(const key of q.correct_answer)await p.locator('#options .option').filter({has:p.locator('input[value="'+key+'"]')}).click();
    await p.locator('#submit').click();await p.locator('#result').waitFor({state:'visible'});
    const stats=await p.evaluate(async()=>await(await fetch('/api/stats')).json());
    const topic=stats.topics.find(c=>c.id===category);assert.equal(topic.mistakes,0);assert.equal(topic.answered,1);
    await p.locator('#open-exam').click();await p.locator('#exam-setup-view').waitFor({state:'visible'});
    assert.equal(await p.locator('#exam-categories input[value="'+category+'"]').count(),0);
    assert.ok(await p.locator('#exam-categories input').count()>0);
    assert.ok((await p.locator('#exam-topics-note').textContent()).endsWith('из '+await p.locator('#exam-categories input').count()));
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);
});
