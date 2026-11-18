(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OfflineCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
    'use strict';
    const clone = x => JSON.parse(JSON.stringify(x));
    const fail = (message = 'Некорректные данные синхронизации') => { throw new Error(message); };
    const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
    function canonical(x) {
        if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
        if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
        return JSON.stringify(x);
    }
    function answer(q, value, nullable = false) {
        if (nullable && value === null) return null;
        if (typeof value !== 'string' || !/^[A-Z]{1,8}$/.test(value)
            || new Set(value).size !== value.length || [...value].some(k => !Object.hasOwn(q.options, k))) fail();
        return [...value].sort().join('');
    }
    function result(q, value) {
        return { correct: value === q.correct_answer, correct_answer: q.correct_answer,
            explanation: q.explanation, option_notes: q.option_notes || {} };
    }
    function create(event, catalog) {
        const p = event.payload;
        if (!uuid(event.attempt_id) || !p || !['training','check','exam'].includes(p.kind)
            || !Array.isArray(p.questions) || !p.questions.length || p.questions.length > 200) fail();
        const byId = new Map(catalog.questions.map(q => [q.id,q]));
        const cats = new Map(catalog.categories.map(c => [c.id,c]));
        const ids = new Set();
        const questions = p.questions.map(item => {
            const q = byId.get(item.id), c = q && cats.get(q.category_id);
            if (!q || !c || ids.has(q.id) || (p.kind === 'exam' && !c.exam_allowed)) fail();
            if (p.kind !== 'exam' && p.mode !== 'mistakes' && q.category_id !== p.category_id) fail();
            ids.add(q.id);
            const order = item.order;
            if (!Array.isArray(order) || order.length !== Object.keys(q.options).length
                || new Set(order).size !== order.length || order.some(k => !Object.hasOwn(q.options,k))) fail();
            if (p.kind === 'check' && !Object.hasOwn(q.options,item.key)) fail();
            return { ...clone(q), category_name: c.name, order, ...(p.kind === 'check' ? { key:item.key } : {}) };
        });
        if (p.kind !== 'exam' && !['category','mistakes'].includes(p.mode)) fail();
        if (p.kind === 'check' && (p.mode !== 'category' || questions.length > 16)) fail();
        return { id:event.attempt_id,kind:p.kind,mode:p.mode || 'exam',category_id:p.category_id || null,
            category_name:p.mode === 'mistakes' ? 'Работа над ошибками' : (cats.get(p.category_id)?.name || 'Экзамен'),
            created_at:event.occurred_at,catalog_version:event.catalog_version,questions,answers:{},draft:null,
            revision:0,conflicts:[],finished:false,legacy_id:null };
    }
    function apply(state, event) {
        const s = clone(state), p = event.payload || {};
        if (event.kind === 'answer') {
            if (s.kind === 'exam') fail();
            const q = s.questions.find(q => q.id === p.question_id);
            if (!q) fail();
            const value = s.kind === 'check' ? p.value : answer(q,p.value);
            if (s.kind === 'check' && typeof value !== 'boolean') fail();
            const previous = s.answers[q.id];
            if (previous && previous.value !== value) {
                s.conflicts.push({event_id:event.event_id,kind:'answer',question_id:q.id,value,occurred_at:event.occurred_at});
            } else if (!previous) {
                s.answers[q.id] = {value,occurred_at:event.occurred_at,event_id:event.event_id};
            }
        } else if (event.kind === 'finish') {
            if (s.kind !== 'exam' || !Array.isArray(p.answers) || p.answers.length !== s.questions.length
                || !Number.isInteger(p.duration_seconds) || p.duration_seconds < 0 || p.duration_seconds > 86400) fail();
            const values = s.questions.map((q,i) => answer(q,p.answers[i],true));
            if (s.finished && canonical(s.final.answers) !== canonical(values)) {
                s.conflicts.push({event_id:event.event_id,kind:'finish',value:{answers:values,duration_seconds:p.duration_seconds},occurred_at:event.occurred_at});
            } else if (!s.finished) {
                s.final = {answers:values,duration_seconds:p.duration_seconds};
                s.finished = true; s.finished_at = event.occurred_at; s.draft = null;
            }
        } else if (event.kind === 'draft') {
            if (s.finished) return s;
            if (!p || !Number.isInteger(p.index) || p.index < 0 || p.index > s.questions.length) fail();
            if (s.kind === 'exam') {
                if (!Array.isArray(p.answers) || p.answers.length !== s.questions.length
                    || !Number.isFinite(p.startedAt) || !Number.isFinite(p.deadline) || p.deadline < p.startedAt
                    || p.deadline-p.startedAt > 86400000) fail();
                s.questions.forEach((q,i) => answer(q,p.answers[i],true));
            }
            if (s.draft && event.base_revision !== s.revision && canonical(s.draft) !== canonical(p)) {
                s.conflicts.push({event_id:event.event_id,kind:'draft',value:clone(p),occurred_at:event.occurred_at});
            } else s.draft = clone(p);
        } else if (event.kind === 'resolve') {
            if (event.base_revision !== s.revision) fail('Состояние изменилось. Повторите выбор после синхронизации.');
            const conflict = s.conflicts.find(c => c.event_id === p.event_id);
            if (!conflict || !['local','server'].includes(p.choice)) fail();
            if (p.choice === 'local') {
                if (conflict.kind === 'answer') s.answers[conflict.question_id] = {value:conflict.value,occurred_at:conflict.occurred_at,event_id:conflict.event_id};
                if (conflict.kind === 'finish') {s.final=conflict.value;s.finished_at=conflict.occurred_at;}
                if (conflict.kind === 'draft') s.draft=conflict.value;
            }
            s.conflicts = s.conflicts.filter(c => c.event_id !== p.event_id);
        } else fail();
        s.revision += 1;
        s.updated_at = event.occurred_at;
        return s;
    }
    function examResult(s) {
        const results = s.questions.map((q,i) => ({question_id:q.id,category_id:q.category_id,
            answer:s.final.answers[i],...result(q,s.final.answers[i])}));
        const correct=results.filter(r=>r.correct).length,percent=Math.round(correct*100/results.length);
        return {history_id:s.id,total:results.length,correct,percent,pass_percent:70,passed:percent>=70,
            duration_seconds:s.final.duration_seconds,questions:s.questions.map(publicQuestion),results};
    }
    function publicQuestion(q) {
        return {id:q.id,category_id:q.category_id,category_name:q.category_name,question_text:q.question_text,
            options:q.options,correct_count:q.correct_answer.length,order:q.order};
    }
    function legacy(kind,row,answers,questions) {
        const qs=kind==='training' ? row.questions : row.cards.map(c=>{
            const q=c.snapshot?.question || questions.find(q=>q.id===c.question_id);
            return {...q,id:c.question_id,category_id:row.category_id,key:c.key,order:Object.keys(q?.options || {})};
        });
        const s={id:kind+':'+row.id,legacy_id:row.id,kind,mode:row.mode || 'category',category_id:row.category_id,
            category_name:row.category_name,created_at:row.created_at,questions:qs,answers:{},draft:null,revision:0,conflicts:[],finished:false};
        for(const a of answers) s.answers[a.question_id]={value:kind==='training'?a.selected_answer:a.fits,occurred_at:a.answered_at};
        return s;
    }
    return {clone,canonical,uuid,answer,result,create,apply,examResult,publicQuestion,legacy};
});
