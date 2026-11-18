const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../config/db');
const {requireAuth} = require('../middleware/auth');
const {noteError,logError} = require('../middleware/requestLog');
const core = require('../../public/js/offline-core');
const router = express.Router();
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const bad = (message='Некорректные данные синхронизации',status=400) => Object.assign(new Error(message),{status});
const collections = new Set(['users','training_batches','answer_log','option_check_batches','option_check_answers','exam_history','sync_attempts']);

router.use(['/sync','/offline'], requireAuth, (req,res,next)=>{res.set('Cache-Control','no-store');next();});

async function catalog() {
    const c=await pool.connect();
    try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const categories=(await c.query('SELECT id,name,in_exam,exam_allowed FROM categories ORDER BY name')).rows;
        const questions=(await c.query('SELECT id,category_id,question_text,options,correct_answer,explanation,option_notes FROM questions ORDER BY id')).rows;
        const documents={};
        const names={interview:'INTERVIEW',memory:'MEMORY',syscalls:'SYSCALLS',planner:'PLANNER',networks:'NETWORKS',xact:'XACT',acid:'ACID',changelog:'CHANGELOG'};
        for(const [name,file] of Object.entries(names)) documents['/api/materials/'+name]=await fs.readFile(path.join(__dirname,'../../docs',file+'.md'),'utf8');
        for(let i=1;i<=20;i++) {const n=String(i).padStart(2,'0');documents['/api/practice/'+n]=await fs.readFile(path.join(__dirname,'../../docs/practice',n+'.md'),'utf8');}
        const payload={categories,questions,documents};
        const version=digest(core.canonical(payload));
        await c.query('INSERT INTO offline_catalogs(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[version,JSON.stringify(payload)]);
        await c.query('COMMIT');
        return {version,payload};
    } catch(e) {await c.query('ROLLBACK').catch(x=>logError('catalog_rollback',x));throw e;} finally {c.release();}
}
function parts(payload) {const text=core.canonical(payload),out=[];for(let i=0;i<text.length;i+=400000)out.push(text.slice(i,i+400000));return out;}
router.get('/offline/catalog',async(req,res)=>{
    try {const data=await catalog();res.json({protocol_version:1,version:data.version,parts:parts(data.payload).map((text,i)=>({part:i,hash:digest(text),bytes:Buffer.byteLength(text)}))});}
    catch(e){noteError(res,e);res.status(503).json({error:'Не удалось подготовить учебные материалы. Повторите загрузку.'});}
});
router.get('/offline/catalog/:version/:part',async(req,res)=>{
    if(!/^[0-9a-f]{64}$/.test(req.params.version)||!/^\d{1,5}$/.test(req.params.part))return res.status(400).json({error:'Некорректная версия материалов'});
    try {const r=await pool.query('SELECT payload FROM offline_catalogs WHERE version=$1',[req.params.version]);
        const text=r.rowCount?parts(r.rows[0].payload)[Number(req.params.part)]:undefined;
        if(text===undefined)return res.status(404).json({error:'Материалы не найдены'});
        res.json({text,hash:digest(text)});
    }catch(e){noteError(res,e);res.status(503).json({error:'Не удалось загрузить материалы. Повторите попытку.'});}
});

async function changes(req,res) {
    const cursor=req.query.cursor ?? '0',until=req.query.until;
    if(!/^\d{1,18}$/.test(cursor)||(until!==undefined&&!/^\d{1,18}$/.test(until)))return res.status(400).json({error:'Некорректный курсор'});
    try {
        const head=(await pool.query('SELECT revision::text FROM sync_heads WHERE user_id=$1',[req.user.id])).rows[0]?.revision || '0';
        if(BigInt(cursor)>BigInt(head))return res.status(409).json({error:'Нужна повторная загрузка истории',reset:true});
        const end=until && BigInt(until)<BigInt(head)?until:head;
        const rows=(await pool.query(`SELECT revision::text,collection,entity_id,data FROM sync_changes
            WHERE user_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT 100`,[req.user.id,cursor,end])).rows;
        const selected=[];let bytes=0;
        for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row));if(selected.length&&bytes+size>512*1024)break;selected.push(row);bytes+=size;}
        const next=selected.at(-1)?.revision || cursor;
        res.json({protocol_version:1,user_id:req.user.id,server_time:new Date().toISOString(),changes:selected,cursor:next,until:end,more:BigInt(next)<BigInt(end)});
    } catch(e){noteError(res,e);res.status(503).json({error:'Не удалось получить изменения. Данные на устройстве сохранены.'});}
}
router.get('/sync/bootstrap',changes);
router.get('/sync/changes',changes);

async function loadAttempt(c,uid,id) {
    if(typeof id!=='string'||id.length>80)throw bad();
    const saved=await c.query('SELECT state FROM sync_attempts WHERE user_id=$1 AND id=$2',[uid,id]);
    if(saved.rowCount){
        const s=saved.rows[0].state;
        if(s.legacy_id&&s.kind!=='exam'){
            const training=s.kind==='training';
            const rows=(await c.query(`SELECT * FROM ${training?'answer_log':'option_check_answers'} WHERE user_id=$1 AND ${training?'training_batch_id':'batch_id'}=$2`,[uid,s.legacy_id])).rows;
            for(const a of rows)s.answers[a.question_id]={value:training?a.selected_answer:a.fits,occurred_at:a.answered_at};
        }
        return s;
    }
    const match=/^(training|check):(\d{1,10})$/.exec(id);
    if(!match)throw bad('Занятие ещё не синхронизировано',409);
    const training=match[1]==='training';
    const row=(await c.query(`SELECT * FROM ${training?'training_batches':'option_check_batches'} WHERE user_id=$1 AND id=$2`,[uid,match[2]])).rows[0];
    if(!row)throw bad('Занятие не найдено',404);
    const answers=(await c.query(`SELECT * FROM ${training?'answer_log':'option_check_answers'} WHERE user_id=$1 AND ${training?'training_batch_id':'batch_id'}=$2`,[uid,row.id])).rows;
    const questions=training?[]:(await c.query('SELECT * FROM questions WHERE category_id=$1',[row.category_id])).rows;
    return core.legacy(match[1],row,answers,questions);
}

async function mirror(c,uid,s,event) {
    const categoryExists=s.category_id && (await c.query('SELECT 1 FROM categories WHERE id=$1',[s.category_id])).rowCount;
    const categoryId=categoryExists?s.category_id:null;
    if(!s.legacy_id && s.kind==='training') {
        s.legacy_id=(await c.query(`INSERT INTO training_batches(user_id,category_id,category_name,mode,questions,created_at)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[uid,categoryId,s.category_name,s.mode,JSON.stringify(s.questions),s.created_at])).rows[0].id;
    }
    if(!s.legacy_id && s.kind==='check') {
        const cards=s.questions.map(q=>({question_id:q.id,key:q.key,is_correct:q.correct_answer.includes(q.key),snapshot:{question_text:q.question_text,
            option_text:q.options[q.key],multi:q.correct_answer.length>1,explanation:q.explanation,option_note:q.option_notes?.[q.key]||'',question:q}}));
        s.legacy_id=(await c.query(`INSERT INTO option_check_batches(user_id,category_id,category_name,cards,created_at)
            VALUES($1,$2,$3,$4,$5) RETURNING id`,[uid,categoryId,s.category_name,JSON.stringify(cards),s.created_at])).rows[0].id;
    }
    if(['answer','resolve'].includes(event.kind) && s.kind!=='exam') {
        for(const q of s.questions) {
            const a=s.answers[q.id];if(!a)continue;
            if(s.kind==='training')await c.query(`INSERT INTO answer_log(user_id,question_id,correct,training_batch_id,selected_answer,answered_at)
                VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(training_batch_id,question_id) WHERE training_batch_id IS NOT NULL
                DO UPDATE SET selected_answer=EXCLUDED.selected_answer,correct=EXCLUDED.correct,answered_at=EXCLUDED.answered_at
                WHERE answer_log.selected_answer IS DISTINCT FROM EXCLUDED.selected_answer`,[uid,q.id,a.value===q.correct_answer,s.legacy_id,a.value,a.occurred_at]);
            else await c.query(`INSERT INTO option_check_answers(user_id,batch_id,question_id,option_key,fits,option_is_correct,is_right,answered_at)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(batch_id,question_id) DO UPDATE
                SET fits=EXCLUDED.fits,is_right=EXCLUDED.is_right,answered_at=EXCLUDED.answered_at
                WHERE option_check_answers.fits IS DISTINCT FROM EXCLUDED.fits`,[uid,s.legacy_id,q.id,q.key,a.value,q.correct_answer.includes(q.key),a.value===q.correct_answer.includes(q.key),a.occurred_at]);
        }
    }
    if(s.kind==='exam'&&s.finished&&(!s.legacy_id||event.kind==='resolve')) {
        const snapshot=core.examResult(s);
        if(!s.legacy_id) {
            s.legacy_id=(await c.query(`INSERT INTO exam_history(user_id,total,correct,percent,passed,duration_seconds,snapshot,submission_id,finished_at)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[uid,snapshot.total,snapshot.correct,snapshot.percent,snapshot.passed,snapshot.duration_seconds,JSON.stringify(snapshot),s.id,s.finished_at])).rows[0].id;
            s.exam_log_ids=[];
            for(const r of snapshot.results){
                if(r.answer===null){s.exam_log_ids.push(null);continue;}
                s.exam_log_ids.push((await c.query('INSERT INTO answer_log(user_id,question_id,correct,answered_at) VALUES($1,$2,$3,$4) RETURNING id',[uid,r.question_id,r.correct,s.finished_at])).rows[0].id);
            }
        } else {
            await c.query(`UPDATE exam_history SET total=$3,correct=$4,percent=$5,passed=$6,duration_seconds=$7,snapshot=$8,finished_at=$9
                WHERE user_id=$1 AND id=$2`,[uid,s.legacy_id,snapshot.total,snapshot.correct,snapshot.percent,snapshot.passed,snapshot.duration_seconds,JSON.stringify(snapshot),s.finished_at]);
            // Preserve each original log identity when replacing the selected conflicting result.
            for(let i=0;i<snapshot.results.length;i++){
                const r=snapshot.results[i],id=s.exam_log_ids?.[i];
                if(id && r.answer!==null) await c.query('UPDATE answer_log SET correct=$3,answered_at=$4 WHERE user_id=$1 AND id=$2',[uid,id,r.correct,s.finished_at]);
                else if(!id && r.answer!==null) s.exam_log_ids[i]=(await c.query('INSERT INTO answer_log(user_id,question_id,correct,answered_at) VALUES($1,$2,$3,$4) RETURNING id',[uid,r.question_id,r.correct,s.finished_at])).rows[0].id;
                else if(id && r.answer===null){await c.query('DELETE FROM answer_log WHERE user_id=$1 AND id=$2',[uid,id]);s.exam_log_ids[i]=null;}
            }
        }
    }
}

router.post('/sync/events',async(req,res)=>{
    const body=req.body;
    if(!body||body.protocol_version!==1||!core.uuid(body.device_id)||!Array.isArray(body.events)||!body.events.length||body.events.length>50
        ||Buffer.byteLength(JSON.stringify(body))>96*1024)return res.status(400).json({error:'Некорректный пакет синхронизации'});
    const receipts=[];
    for(const e of body.events) {
        if(!e||!core.uuid(e.event_id)||!Number.isSafeInteger(e.device_sequence)||e.device_sequence<1
            ||!Number.isInteger(e.base_revision)||e.base_revision<0||!Number.isFinite(Date.parse(e.occurred_at))
            ||!['create','answer','finish','draft','resolve','profile'].includes(e.kind))return res.status(400).json({error:'Некорректное событие синхронизации',receipts});
        let c;
        try {
            c=await pool.connect();await c.query('BEGIN');
            await c.query('INSERT INTO sync_heads(user_id) VALUES($1) ON CONFLICT DO NOTHING',[req.user.id]);
            await c.query('SELECT revision FROM sync_heads WHERE user_id=$1 FOR UPDATE',[req.user.id]);
            const fingerprint=digest(core.canonical(e));
            const prior=(await c.query('SELECT fingerprint,result FROM sync_receipts WHERE user_id=$1 AND event_id=$2',[req.user.id,e.event_id])).rows[0];
            if(prior){if(prior.fingerprint!==fingerprint)throw bad('Идентификатор события уже использован с другими данными',409);
                receipts.push(prior.result);await c.query('COMMIT');continue;}
            await c.query('INSERT INTO sync_devices(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,body.device_id]);
            const device=(await c.query('SELECT sequence,last_occurred_at FROM sync_devices WHERE user_id=$1 AND id=$2',[req.user.id,body.device_id])).rows[0];
            if(BigInt(e.device_sequence)<=BigInt(device.sequence))throw bad('Нарушен порядок событий устройства',409);
            if(Date.parse(e.occurred_at)>Date.now()+300000 || Date.parse(e.occurred_at)<Date.parse('2020-01-01')
                || (device.last_occurred_at && Date.parse(e.occurred_at)<device.last_occurred_at.getTime()))throw bad('Проверьте часы устройства. Результаты сохранены локально.',409);
            let state=null;
            if(e.kind==='profile') {
                const p=e.payload;
                if(!p||!['theme','accent'].includes(p.field)||!(p.field==='theme'?['auto','light','dark']:['blue','beige','green','graphite']).includes(p.value))throw bad();
                await c.query(`UPDATE users SET ${p.field}=$2 WHERE id=$1`,[req.user.id,p.value]);
            } else if(e.kind==='create') {
                const existing=await c.query('SELECT 1 FROM sync_attempts WHERE user_id=$1 AND id=$2',[req.user.id,e.attempt_id]);
                if(existing.rowCount)throw bad('Занятие уже существует',409);
                const cat=(await c.query('SELECT payload FROM offline_catalogs WHERE version=$1',[e.catalog_version])).rows[0];
                if(!cat)throw bad('Нужна сохранённая версия учебных материалов',409);
                state=core.create(e,cat.payload);
                await mirror(c,req.user.id,state,e);
            } else {
                state=core.apply(await loadAttempt(c,req.user.id,e.attempt_id),e);
                await mirror(c,req.user.id,state,e);
            }
            if(state)await c.query(`INSERT INTO sync_attempts(user_id,id,state) VALUES($1,$2,$3)
                ON CONFLICT(user_id,id) DO UPDATE SET state=EXCLUDED.state`,[req.user.id,state.id,JSON.stringify(state)]);
            await c.query('UPDATE sync_devices SET sequence=$3,last_occurred_at=$4 WHERE user_id=$1 AND id=$2',[req.user.id,body.device_id,e.device_sequence,e.occurred_at]);
            const receipt={event_id:e.event_id,attempt_id:state?.id || null,legacy_id:state?.legacy_id || null,revision:state?.revision || 0,conflict:Boolean(state?.conflicts.length)};
            await c.query('INSERT INTO sync_receipts(user_id,event_id,fingerprint,result) VALUES($1,$2,$3,$4)',[req.user.id,e.event_id,fingerprint,JSON.stringify(receipt)]);
            await c.query('COMMIT');receipts.push(receipt);
        } catch(e) {
            if(c)await c.query('ROLLBACK').catch(x=>logError('sync_rollback',x));
            const quota=e.constraint==='snapshot_storage_quota';
            const status=quota?429:(e.status || (e.name==='Error'&&!e.code?400:503));
            if(status>=500)noteError(res,e);
            return res.status(status).json({error:quota?'Достигнут лимит сохранённых тренировок. Результаты остались на устройстве.':
                status<500?'Синхронизация приостановлена. Проверьте конфликт, время устройства или обновите приложение.':'Сервер временно недоступен. Результаты сохранены на устройстве.',receipts});
        } finally {if(c)c.release();}
    }
    res.json({protocol_version:1,user_id:req.user.id,receipts,server_time:new Date().toISOString()});
});
module.exports={router,catalog,collections};
