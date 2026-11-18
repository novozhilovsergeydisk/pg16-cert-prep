(function (root) {
    'use strict';
    const C=root.OfflineCore;
    const hasDOM=typeof document!=='undefined';
    const encoder=new TextEncoder();
    let dbPromise,account=null,catalog=null,device=null,busy=false,timer=null,installPrompt=null,rerun=false,retryTimer=null,running=null;
    const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('pg16-offline'):null;
    let message='Подготовка для работы без интернета…',connected=false,syncMode='auto';
    let networkTail=Promise.resolve();
    const owner=crypto.randomUUID();
    const storageError=()=>new Error('Не удалось сохранить данные на устройстве. Освободите место и повторите действие.');
    function database(){
        if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
            const r=indexedDB.open('pg16-offline',1);
            r.onupgradeneeded=()=>r.result.createObjectStore('records');
            r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();dbPromise=null;};resolve(r.result);};
            r.onerror=()=>reject(storageError());r.onblocked=()=>reject(new Error('Закройте другие вкладки тренажёра для обновления хранилища.'));
        });return dbPromise;
    }
    async function read(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('records');const r=tx.objectStore('records').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(storageError());});}
    async function modify(key,fn){
        const db=await database();return new Promise((resolve,reject)=>{
            const tx=db.transaction('records','readwrite'),s=tx.objectStore('records');let value,error;
            const r=s.get(key);r.onsuccess=()=>{try{value=fn(r.result);if(value===undefined)s.delete(key);else s.put(value,key);}catch(e){error=e;tx.abort();}};
            tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(error || storageError());
        });
    }
    async function write(key,value){return modify(key,()=>value);}
    function empty(me){return {me,base:{},queue:[],cursor:'0',sequence:0,lastTime:0,offset:0,ready:false,historyReady:false,version:null};}
    async function update(fn){if(!account)throw new Error('Сначала войдите в приложение');const uid=account.me.id;
        const next=await modify('account:'+uid,s=>{if(!s)throw storageError();fn(s);return s;});if(account?.me.id===uid)account=next;
        channel?.postMessage({user_id:uid});paint();return next;}
    if(channel)channel.onmessage=async e=>{if(account?.me.id===e.data.user_id){const fresh=await read('account:'+e.data.user_id);if(fresh&&account?.me.id===e.data.user_id){account=fresh;status();}}};
    async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
    async function fetchJson(url,options){
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
        try {
            const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal});
            let data;try{data=await response.json();}catch{throw Object.assign(new Error('Сервер временно недоступен'),{network:true});}
            if(!response.ok)throw Object.assign(new Error(data.error || 'Не удалось синхронизировать данные'),{status:response.status,data,retryAfter:response.headers.get('Retry-After')});
            return data;
        } catch(e){if(!e.status)e.network=true;throw e;}finally{clearTimeout(timeout);}
    }
    function net(url,options={}){const r=networkTail.then(()=>fetchJson(url,options));networkTail=r.catch(()=>{});return r;}
    const post=(url,payload)=>net(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    function paint(){
        if(!hasDOM)return;
        const node=document.getElementById('sync-status');if(!node)return;
        node.textContent=message;node.parentElement.hidden=!account;
        const modeSelect=document.getElementById('sync-mode-select');if(modeSelect)modeSelect.value=syncMode;
        const retry=document.getElementById('sync-retry');retry.textContent=syncMode==='manual'?'Синхронизировать сейчас':'Синхронизировать';
        const conflicts=attempts().flatMap(s=>(s.conflicts||[]).map(c=>({s,c})));
        const box=document.getElementById('sync-conflicts');box.replaceChildren();
        for(const {s,c} of conflicts){const row=document.createElement('div'),label=document.createElement('p');
            label.textContent='Нужно выбрать вариант '+(c.kind==='finish'?'экзамена':c.kind==='draft'?'незавершённого занятия':'ответа')+': '+s.category_name;
            row.append(label);
            for(const [choice,text] of [['local','Оставить ответ с этого устройства'],['server','Оставить ответ с сервера']]){
                const button=document.createElement('button');button.type='button';button.className='btn-secondary';button.textContent=text;
                button.onclick=async()=>{button.disabled=true;try{await emit('resolve',s.id,{event_id:c.event_id,choice});await sync({manual:true});}catch(e){message=e.message;paint();}};row.append(button);
            }box.append(row);
        }
        box.hidden=!conflicts.length;
        retry.disabled=busy;
    }
    function status(){
        if(!account)return;
        const n=account.queue.filter(e=>!e.acked).length;
        if(syncMode==='manual')message=!account.ready?'Синхронизация вручную · материалы не загружены':
            'Синхронизация вручную · '+(n?'ожидают отправки: '+n:'изменений нет');
        else message=!account.ready?'Подготовка для работы без интернета…':!connected?'Нет связи с сервером · ожидают отправки: '+n:
            n?'Сохранено на устройстве · ожидают отправки: '+n:'Доступно без интернета · Синхронизировано: '+(account.syncedAt?new Date(account.syncedAt).toLocaleTimeString():'—');
        if(account.ready&&!account.historyReady)message+=' · История загружена не полностью';
        paint();
    }
    async function boot(){
        const meta=await read('meta');syncMode=meta?.syncMode || 'auto';
        if(meta?.logoutPending){try{await post('/api/auth/logout',{});await write('meta',{...meta,logoutPending:false});}catch{}throw Object.assign(new Error(''),{login:true});}
        if(meta?.locked)throw Object.assign(new Error(''),{login:true});
        try{return await net('/api/me');}catch(e){
            if((e.network || e.status===401) && meta?.active){const s=await read('account:'+meta.active);if(s?.ready){account=s;catalog=await read('catalog:'+s.version);message=e.status===401?'Для синхронизации войдите снова':'Нет связи с сервером';return {...s.me,offline:true};}}
            throw e;
        }
    }
    async function use(me){
        const meta=await modify('meta',m=>({...m,device:m?.device || crypto.randomUUID(),active:me.id,locked:false,syncMode:m?.syncMode || 'auto'}));
        device=meta.device;syncMode=meta.syncMode;
        account=await modify('account:'+me.id,s=>({...s || empty(me),me:{...me,offline:undefined}}));
        catalog=account.version?await read('catalog:'+account.version):null;
        status();
        if(hasDOM && 'serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{message='Не удалось подготовить запуск без интернета. Повторите загрузку.';paint();});
        if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
        if(!timer&&hasDOM)timer=setInterval(()=>{if(document.visibilityState==='visible')sync();},30000);
        await sync();
    }
    async function ensureActor(uid){const m=await read('meta');if(m?.locked||m?.active!==uid||account?.me.id!==uid)throw new Error('Аккаунт изменился. Синхронизация остановлена.');}
    async function prepare(uid){
        const manifest=await net('/api/offline/catalog');await ensureActor(uid);
        if(manifest.protocol_version!==1)throw new Error('Обновите приложение для синхронизации');
        if(account.version===manifest.version&&catalog)return;
        const key='download:'+manifest.version;
        let download=await read(key)||{parts:{}};
        for(const part of manifest.parts){
            if(download.parts[part.part]!==undefined)continue;
            const piece=await net('/api/offline/catalog/'+manifest.version+'/'+part.part);await ensureActor(uid);
            if(await hash(piece.text)!==part.hash)throw new Error('Не удалось проверить материалы. Повторите загрузку.');
            download.parts[part.part]=piece.text;await write(key,download);
        }
        const text=manifest.parts.map(p=>download.parts[p.part]).join('');
        if(await hash(text)!==manifest.version)throw new Error('Учебные материалы загружены не полностью');
        const data=JSON.parse(text);await write('catalog:'+manifest.version,data);await ensureActor(uid);
        await update(s=>{s.version=manifest.version;s.ready=true;});catalog=data;await write(key,undefined);
    }
    function mergeStaged(current,incoming){
        const byRevision=new Map();
        for(const change of [...(current?.changes || []),...(incoming?.changes || [])])byRevision.set(String(change.revision),change);
        const changes=[...byRevision.values()].sort((a,b)=>{const x=BigInt(a.revision),y=BigInt(b.revision);return x<y?-1:x>y?1:0;});
        const maxText=(a,b)=>a===undefined||a===null?b:b===undefined||b===null?a:BigInt(a)>=BigInt(b)?a:b;
        return {cursor:maxText(current?.cursor,incoming?.cursor) || '0',until:maxText(current?.until,incoming?.until) || null,changes};
    }
    async function pull(uid){
        let staged=mergeStaged(null,account.staged || {cursor:account.cursor,until:null,changes:[]});
        do{
            const data=await net('/api/sync/'+(account.historyReady?'changes':'bootstrap')+'?cursor='+staged.cursor+(staged.until?'&until='+staged.until:''));
            await ensureActor(uid);if(data.user_id!==uid)throw new Error('Аккаунт изменился');
            staged=mergeStaged(staged,{cursor:data.cursor,until:data.until,changes:data.changes});
            if(data.more)staged=(await update(s=>{s.staged=mergeStaged(s.staged,staged);})).staged;
            else {
                await update(s=>{
                    const finalStaged=mergeStaged(s.staged,staged);
                    for(const change of finalStaged.changes){const group=s.base[change.collection] ||= {};
                        if(change.data===null)delete group[change.entity_id];
                        else if(change.collection==='sync_attempts'&&change.data.partial){
                            const previous=group[change.entity_id];
                            if(!previous?.state?.questions)throw new Error('Нужна повторная загрузка занятия');
                            group[change.entity_id]={...change.data,state:{...change.data.state,questions:previous.state.questions}};
                        }else group[change.entity_id]=change.data;}
                    s.cursor=data.cursor;s.staged=null;s.historyReady=true;s.offset=Date.parse(data.server_time)-Date.now();
                    s.queue=s.queue.filter(e=>!e.acked);s.syncedAt=Date.now();
                });break;
            }
        }while(true);
    }
    async function sync(options={}){
        if(syncMode==='manual'&&!options.manual){status();return;}
        if(running){rerun=true;return running;}
        running=performSync(options);
        try{return await running;}finally{running=null;}
    }
    async function setSyncMode(mode){
        if(!['auto','manual'].includes(mode))throw new Error('Некорректный режим синхронизации');
        const meta=await modify('meta',m=>({...m,syncMode:mode}));syncMode=meta.syncMode || 'auto';
        if(syncMode==='manual')clearTimeout(retryTimer);
        status();paint();
        if(syncMode==='auto')setTimeout(()=>sync(),0);
        return syncMode;
    }
    async function performSync(options={}){
        if(!account)return;
        if(busy){rerun=true;return;}
        if(navigator.onLine===false){connected=false;status();return;}
        const uid=account.me.id;
        const lease=await modify('lease',x=>x&&x.until>Date.now()&&x.owner!==owner?x:{owner,until:Date.now()+15000}).catch(()=>null);
        if(!lease||lease.owner!==owner){clearTimeout(retryTimer);retryTimer=setTimeout(()=>sync(options),2000);return;}
        rerun=false;
        busy=true;message='Синхронизация…';paint();
        const renewal=setInterval(()=>modify('lease',x=>x?.owner===owner?{owner,until:Date.now()+15000}:x).catch(()=>{}),5000);
        try {
            await ensureActor(uid);
            const me=await net('/api/me');await ensureActor(uid);
            if(me.id!==uid)throw Object.assign(new Error('Для синхронизации войдите в прежний аккаунт'),{status:401});
            connected=true;
            account=await read('account:'+uid);
            // Finish a previously interrupted download before acknowledging newer events.
            if(account.staged)await pull(uid);
            while(true){
                const fresh=await read('account:'+uid),events=[];let bytes=150;
                for(const row of fresh.queue.filter(e=>!e.acked)){
                    const {acked,...e}=row;const size=encoder.encode(JSON.stringify(e)).length;
                    if(events.length&&(events.length>=50||bytes+size>96000))break;
                    if(size>95000)throw new Error('Слишком большой результат. Он сохранён на устройстве.');
                    events.push(e);bytes+=size;
                }
                if(!events.length)break;
                let data,error;
                try{data=await post('/api/sync/events',{protocol_version:1,device_id:device,events});}catch(e){error=e;data=e.data;}
                await ensureActor(uid);
                if(data?.receipts?.length){const ids=new Set(data.receipts.map(r=>r.event_id));await update(s=>{for(const e of s.queue)if(ids.has(e.event_id))e.acked=true;});}
                if(error)throw error;
            }
            await pull(uid);await prepare(uid);await ensureActor(uid);
            await restorePointers();status();
            if(hasDOM)root.dispatchEvent(new CustomEvent('pg16-synced'));
        }catch(e){
            connected=!e.network;
            message=e.status===401?'Для синхронизации войдите снова':e.network?'Нет связи с сервером · ожидают отправки: '+(account?.queue.filter(x=>!x.acked).length || 0):e.message;
            if(e.status===409&&e.data?.reset)await update(s=>{s.cursor='0';s.base={};s.staged=null;s.historyReady=false;});
            // Apply receipts and conflicts even when a later event could not be accepted.
            if(e.status && e.status!==401 && account?.queue.some(x=>x.acked))try{await pull(uid);}catch{}
            paint();
        }finally{busy=false;clearInterval(renewal);await modify('lease',x=>x?.owner===owner?undefined:x).catch(()=>{});paint();
            if(rerun&&navigator.onLine!==false){clearTimeout(retryTimer);retryTimer=setTimeout(()=>sync(options),500);}}
    }
    function attempts(s=account){
        if(!s)return [];
        const out=new Map(),base=s.base;
        for(const [kind,table,answers,field] of [['training','training_batches','answer_log','training_batch_id'],['check','option_check_batches','option_check_answers','batch_id']]){
            for(const row of Object.values(base[table]||{})){
                try{const a=C.legacy(kind,row,Object.values(base[answers]||{}).filter(x=>x[field]===row.id),catalog?.questions || []);out.set(a.id,a);}catch{}
            }
        }
        for(const row of Object.values(base.sync_attempts||{})){
            const a=C.clone(row.state),legacy=out.get(a.kind+':'+a.legacy_id);
            if(legacy)a.answers={...a.answers,...legacy.answers};
            out.delete(a.kind+':'+a.legacy_id);out.set(a.id,a);
        }
        for(const event of s.queue){
            if(event.kind==='profile')continue;
            try{
                if(event.kind==='create'){if(!out.has(event.attempt_id))out.set(event.attempt_id,event.localState || C.create(event,catalog));}
                else if(out.has(event.attempt_id))out.set(event.attempt_id,C.apply(out.get(event.attempt_id),event));
            }catch{}
        }
        return [...out.values()];
    }
    function find(id){return attempts().find(s=>s.id===String(id)||String(s.legacy_id)===String(id));}
    async function emit(kind,id,payload,extra={}){
        if(!account?.ready)throw new Error('Дождитесь загрузки материалов для автономной работы');
        const uid=account.me.id;
        await ensureActor(uid);
        await update(s=>{
            const state=id?attempts(s).find(x=>x.id===id):null;
            const now=Math.max(Date.now()+s.offset,s.lastTime || 0);
            const event={event_id:crypto.randomUUID(),device_sequence:++s.sequence,attempt_id:id,base_revision:state?.revision || 0,
                occurred_at:new Date(now).toISOString(),catalog_version:s.version,kind,payload,...extra};
            if(kind==='create')C.create(event,catalog);else if(kind!=='profile')C.apply(state,event);
            s.lastTime=now;s.queue.push(event);
        });
        status();
        if(hasDOM&&navigator.serviceWorker?.ready)navigator.serviceWorker.ready.then(r=>r.sync?.register('pg16-sync')).catch(()=>{});
        // Yield until the caller has rendered its saved result; networking is independent.
        setTimeout(()=>sync(),0);
    }
    const shuffle=items=>{const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
    function logs(){
        const rows=Object.values(account.base.answer_log||{}).map(C.clone),checks=Object.values(account.base.option_check_answers||{}).map(C.clone);
        const all=attempts();
        for(const s of all){
            if(s.kind==='exam'){
                if(!s.finished)continue;
                if(s.exam_log_ids)for(let i=rows.length-1;i>=0;i--)if(s.exam_log_ids.includes(rows[i].id))rows.splice(i,1);
                s.questions.forEach((q,i)=>{const value=s.final.answers[i];if(value!==null)rows.push({id:s.id+':'+i,question_id:q.id,correct:value===q.correct_answer,answered_at:s.finished_at});});
            }else{
                const dest=s.kind==='check'?checks:rows,field=s.kind==='check'?'batch_id':'training_batch_id';
                if(s.legacy_id)for(let i=dest.length-1;i>=0;i--)if(dest[i][field]===s.legacy_id)dest.splice(i,1);
                for(const q of s.questions){const a=s.answers[q.id];if(a)dest.push({id:s.id+':'+q.id,question_id:q.id,correct:a.value===q.correct_answer,
                    is_right:a.value===q.correct_answer.includes(q.key),option_key:q.key,answered_at:a.occurred_at});}
            }
        }
        const sort=(a,b)=>Date.parse(a.answered_at)-Date.parse(b.answered_at)||String(a.id).localeCompare(String(b.id));rows.sort(sort);checks.sort(sort);
        return {rows,checks};
    }
    function stats(){
        const {rows,checks}=logs();
        const build=(entries,check)=>catalog.categories.map(c=>{
            const qs=catalog.questions.filter(q=>q.category_id===c.id),ids=new Set(qs.map(q=>q.id)),a=entries.filter(x=>ids.has(x.question_id)),latest=new Map();
            a.forEach(x=>latest.set(x.question_id+(check?':'+x.option_key:''),x));
            return {...c,question_count:qs.length,answered:new Set(a.map(x=>x.question_id)).size,
                correct_percent:a.length?Math.round(a.filter(x=>check?x.is_right:x.correct).length*100/a.length):null,
                mistakes:[...latest.values()].filter(x=>!(check?x.is_right:x.correct)).length};
        });return {topics:build(rows,false),option_topics:build(checks,true)};
    }
    function latestAnswers(){const latest=new Map();logs().rows.forEach(a=>latest.set(a.question_id,a));return latest;}
    function profile(){
        if(!account)return null;
        const p={...account.me,...account.base.users?.[account.me.id]};
        for(const e of account.queue)if(e.kind==='profile')p[e.payload.field]=e.payload.value;
        return p;
    }
    function trainingView(s){return {id:s.id,created_at:s.created_at,category_id:s.category_id,category_name:s.category_name,mode:s.mode,
        questions:s.questions.map((q,i)=>{const a=s.answers[q.id];return {...C.publicQuestion(q),position:i+1,
            answer:a?{selected_answer:a.value,correct:a.value===q.correct_answer,answered_at:a.occurred_at}:null,result:a?C.result(q,a.value):null};})};}
    function checkView(s){return {id:s.id,created_at:s.created_at,category_id:s.category_id,category_name:s.category_name,
        cards:s.questions.map(q=>{const a=s.answers[q.id];return {question_id:q.id,question_text:q.question_text,option_text:q.options[q.key],multi:q.correct_answer.length>1,
            answer:a?{fits:a.value}:null,result:a?checkResult(q,a.value):null};})};}
    function checkResult(q,value){return {right:value===q.correct_answer.includes(q.key),option_fits:q.correct_answer.includes(q.key),option_note:q.option_notes?.[q.key]||'',explanation:q.explanation};}
    async function request(url,options={}){
        if(!account?.ready||!catalog)return {handled:false};
        account=await read('account:'+account.me.id);
        const u=new URL(url,root.location.origin),p=u.pathname,body=options.body?JSON.parse(options.body):{},method=options.method||'GET';
        const done=value=>({handled:true,value});
        if(p==='/api/categories')return done(catalog.categories.map(c=>({...c,question_count:catalog.questions.filter(q=>q.category_id===c.id).length})));
        if(p==='/api/stats')return done(stats());
        if(p==='/api/mistakes'){const latest=latestAnswers();return done(catalog.questions.filter(q=>latest.get(q.id)?.correct===false).map(C.publicQuestion));}
        if((p==='/api/training/batches'||p==='/api/option-checks/batches')&&method==='POST'){
            const kind=p.includes('option-checks')?'check':'training',latest=latestAnswers();
            let qs=shuffle(catalog.questions.filter(q=>body.mode==='mistakes'?latest.get(q.id)?.correct===false:q.category_id===body.category_id));
            if(kind==='training')qs.sort((a,b)=>{
                const x=latest.get(a.id),y=latest.get(b.id),rank=x=>!x?0:!x.correct?1:2;
                return rank(x)-rank(y)||(x?.correct&&y?.correct?Date.parse(x.answered_at)-Date.parse(y.answered_at):0);
            });
            else {const seen=new Map();logs().checks.forEach(a=>seen.set(a.question_id,Date.parse(a.answered_at)));qs.sort((a,b)=>(seen.get(a.id)||0)-(seen.get(b.id)||0));}
            if(body.mode!=='mistakes')qs=qs.slice(0,kind==='check'?16:body.limit||16);
            if(!qs.length)return done(kind==='check'?{id:null,cards:[]}:{id:null,questions:[]});
            qs=shuffle(qs);const trueCount=Math.floor(qs.length/2)+(qs.length%2&&Math.random()<0.5?1:0);
            const wanted=shuffle(qs.map((q,i)=>i<trueCount));
            const id=crypto.randomUUID();
            await emit('create',id,{kind,mode:body.mode || 'category',category_id:body.category_id || null,
                questions:qs.map((q,i)=>{let keys=Object.keys(q.options).filter(k=>q.correct_answer.includes(k)===wanted[i]);if(!keys.length)keys=Object.keys(q.options);
                    return {id:q.id,order:shuffle(Object.keys(q.options)),...(kind==='check'?{key:shuffle(keys)[0]}:{})};})});
            return done(kind==='check'?checkView(find(id)):trainingView(find(id)));
        }
        if(p==='/api/answers'&&method==='POST'){
            const s=find(body.training_batch_id);if(!s)throw new Error('Тренировка не загружена');
            await emit('answer',s.id,{question_id:body.question_id,value:body.answer});return done(C.result(s.questions.find(q=>q.id===body.question_id),body.answer));
        }
        if(p==='/api/option-checks'&&method==='POST'){
            const s=find(body.batch_id);if(!s)throw new Error('Карточки не загружены');
            await emit('answer',s.id,{question_id:body.question_id,value:body.fits});return done(checkResult(s.questions.find(q=>q.id===body.question_id),body.fits));
        }
        const batch=/^\/api\/(training|option-checks)\/batches\/([^/]+)(?:\/resume)?$/.exec(p);
        if(batch){const s=find(batch[2]);if(!s)throw new Error('Занятие не загружено на устройство');return done(s.kind==='check'?checkView(s):trainingView(s));}
        if(p==='/api/training/batches'&&method==='GET'){
            const all=attempts().filter(s=>s.kind==='training').sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id.localeCompare(a.id));
            const before=u.searchParams.get('before'),offset=before?Math.max(0,all.findIndex(x=>x.id===before)+1):0;
            const rows=all.slice(offset,offset+50).map(s=>({id:s.id,category_name:s.category_name,created_at:s.created_at,mode:s.mode,question_count:s.questions.length,answered:Object.keys(s.answers).length}));
            return done({batches:rows,next_before:offset+50<all.length?rows.at(-1).id:null});
        }
        if(p==='/api/exam'){
            const ids=new Set((u.searchParams.get('categories')||'').split(',').map(Number));
            const allowed=new Set(catalog.categories.filter(c=>c.exam_allowed&&ids.has(c.id)).map(c=>c.id));
            return done(shuffle(catalog.questions.filter(q=>allowed.has(q.category_id))).slice(0,Math.min(200,Number(u.searchParams.get('count'))||30)).map(C.publicQuestion));
        }
        if(p==='/api/exam/check'){
            let s=find(body.submission_id);
            if(!s){await emit('create',body.submission_id,{kind:'exam',questions:body.answers.map(a=>({id:a.question_id,order:a.order || Object.keys(catalog.questions.find(q=>q.id===a.question_id).options)}))});s=find(body.submission_id);}
            await emit('finish',s.id,{answers:body.answers.map(a=>a.answer),duration_seconds:body.duration_seconds});return done(C.examResult(find(s.id)));
        }
        if(p==='/api/exam/history'){
            const rows=Object.values(account.base.exam_history||{}).map(r=>({...r,has_review:!!r.snapshot}));
            for(const s of attempts().filter(s=>s.kind==='exam'&&s.finished)){const i=rows.findIndex(r=>r.id===s.legacy_id);if(i>=0)rows.splice(i,1);rows.push({...C.examResult(s),id:s.id,finished_at:s.finished_at,has_review:true});}
            return done(rows.sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at)));
        }
        if(p.startsWith('/api/exam/history/')){const id=p.split('/').at(-1),s=find(id);if(s?.finished)return done(C.examResult(s));
            const row=account.base.exam_history?.[id];if(row?.snapshot)return done(row.snapshot);throw new Error('Разбор ещё не загружен');}
        if(p==='/api/me/theme'||p==='/api/me/accent'){const field=p.split('/').at(-1);await emit('profile',null,{field,value:body[field]});return done(body);}
        return {handled:false};
    }
    async function saveDraft(kind,data){
        if(!account?.ready)return false;
        let s=find(data.submissionId || data.id);
        if(!s&&kind==='exam'){
            await emit('create',data.submissionId,{kind:'exam',questions:data.questions.map(q=>({id:q.id,order:q.order}))});s=find(data.submissionId);
        }
        if(!s)return false;
        const payload=kind==='exam'?{index:data.index,answers:data.answers,startedAt:data.startedAt,deadline:data.deadline,visited:data.visited}:
            {index:data.index,draft:data.draft,pending:data.pending,total:data.total,name:data.name,questionId:data.questionId};
        if(C.canonical(s.draft)===C.canonical(payload))return true;
        await emit('draft',s.id,payload);return true;
    }
    async function restorePointers(){
        if(!hasDOM||!account)return;
        const all=attempts().filter(s=>!s.finished&&s.draft).sort((a,b)=>Date.parse(a.updated_at || a.created_at)-Date.parse(b.updated_at || b.created_at));
        for(const s of all){const d=s.draft;
            if(s.kind==='exam'){
                const key='pg16-exam:'+account.me.email;
                if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({...d,submissionId:s.id,questions:s.questions.map(C.publicQuestion)}));
            }else{
                const kind=s.kind==='check'?'check':'training',key='pg16-practice:'+account.me.email+':'+kind;
                if(Object.keys(s.answers).length<s.questions.length&&!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({...d,id:s.id,total:s.questions.length,name:s.category_name,updatedAt:Date.parse(s.created_at)}));
            }
        }
    }
    async function logout(){
        if(!account)return false;
        await sync();
        const pending=account.queue.some(e=>!e.acked);
        if(pending&&hasDOM&&!confirm('Есть результаты, ещё не отправленные на сервер. Выйти и сохранить их на устройстве до повторного входа?'))return false;
        const meta=await read('meta');
        await write('meta',{...meta,locked:true,logoutPending:true});
        try{await post('/api/auth/logout',{});await write('meta',{...meta,locked:true,logoutPending:false});}catch{}
        account=null;catalog=null;return true;
    }
    async function afterLogin(me){const m=await read('meta');syncMode=m?.syncMode || 'auto';await write('meta',{...m,locked:false,logoutPending:false,active:me.id,syncMode});}
    async function background(){const m=await read('meta');if(!m?.active||m.locked||m.logoutPending)return;
        device=m.device;syncMode=m.syncMode || 'auto';account=await read('account:'+m.active);catalog=account?.version?await read('catalog:'+account.version):null;await sync();}
    function aiContext(context){const s=find(context.batch_id);return s?.legacy_id?{...context,batch_id:s.legacy_id}:null;}
    if(hasDOM){
        root.addEventListener('online',()=>sync());
        document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync();});
        root.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;document.getElementById('pwa-install').hidden=false;});
        root.addEventListener('DOMContentLoaded',()=>{
            document.getElementById('sync-retry').onclick=()=>sync({manual:true});
            document.getElementById('pwa-install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;document.getElementById('pwa-install').hidden=true;}};
        });
    }
    root.PGOffline={boot,use,request,sync,setSyncMode,saveDraft,logout,afterLogin,background,aiContext,profile,
        document:url=>catalog?.documents[url],ready:()=>!!account?.ready,connected:()=>connected,syncMode:()=>syncMode,
        report:e=>{message=e.message;paint();},inspect:()=>({pending:account?.queue.filter(x=>!x.acked).length||0,ready:account?.ready,historyReady:account?.historyReady,busy,syncedAt:account?.syncedAt||0,syncMode})};
})(typeof self!=='undefined'?self:globalThis);
