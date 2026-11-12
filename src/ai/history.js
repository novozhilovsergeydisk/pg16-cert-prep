const { randomUUID } = require('node:crypto');
const { logError } = require('../middleware/requestLog');

const LOCK_NAMESPACE = 21416;
const TTL_MS = 15 * 60 * 1000;
const date = (ms) => new Date(ms);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

// Only these metadata fields may cross the gateway boundary into the ledger.
function metrics(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'provider_request_bytes',
        'provider_response_bytes', 'gateway_response_bytes']) {
        if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 2147483647) result[key] = value[key];
    }
    for (const key of ['gateway_ms', 'provider_ms']) {
        if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
    }
    if (value.cost === 0) result.cost = 0;
    if (typeof value.provider_call_started === 'boolean') result.provider_call_started = value.provider_call_started;
    if (typeof value.model === 'string' && /^[A-Za-z0-9_./:-]{1,160}$/.test(value.model)) result.model = value.model;
    if (typeof value.provider_request_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.provider_request_id)) {
        result.provider_request_id = value.provider_request_id;
    }
    if (typeof value.prompt_version === 'string' && /^[a-f0-9]{64}$/.test(value.prompt_version)) result.prompt_version = value.prompt_version;
    return result;
}

function createAiHistory(pool) {
    async function unlock(client, userId) {
        let broken = false;
        try { await client.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, userId]); }
        catch (err) { broken = true; logError('ai_history_unlock', err); }
        client.release(broken);
    }

    async function previous(userId, requestId, client = pool) {
        return (await client.query("SELECT * FROM ai_requests WHERE user_id=$1 AND client_request_id=$2 AND state<>'rejected'", [userId, requestId])).rows[0];
    }

    // Caller holds the session lock. A live generator holds that same lock until finalization.
    async function recover(client, userId, now) {
        await client.query(`UPDATE ai_requests SET state='failed',error_code='AI_INTERRUPTED',finished_at=$2
            WHERE user_id=$1 AND state='pending'`, [userId, date(now)]);
    }

    async function messages(conversationId, userId, client = pool) {
        return (await client.query(`SELECT m.id,m.role,m.content FROM ai_messages m
            JOIN ai_requests r ON r.id=m.request_id
            WHERE r.conversation_id=$1 AND r.user_id=$2 AND r.state='done'
            ORDER BY r.sequence_id, CASE m.role WHEN 'user' THEN 0 ELSE 1 END`, [conversationId, userId])).rows;
    }

    async function conversation(id, userId, now, client = pool) {
        const row = (await client.query('SELECT * FROM ai_conversations WHERE id=$1 AND user_id=$2 AND expires_at>$3',
            [id, userId, date(now)])).rows[0];
        if (!row) return null;
        row.messages = await messages(id, userId, client);
        row.turns = row.messages.filter((m) => m.role === 'assistant').length;
        return row;
    }

    async function insert(client, input, state, status, code, conv, payload) {
        const jobId = randomUUID();
        if (state === 'rejected') {
            const counter = (await client.query(`INSERT INTO ai_rejection_daily(user_id,day_utc,total)
                VALUES($1,($2::timestamptz AT TIME ZONE 'UTC')::date,1)
                ON CONFLICT(user_id,day_utc) DO UPDATE SET total=ai_rejection_daily.total+1
                RETURNING total`, [input.userId, date(input.now)])).rows[0];
            if (Number(counter.total) > 100) {
                return { row: { id: jobId, fingerprint: input.fingerprint, state, admission_status: status,
                    error_code: code }, repeated: false };
            }
        }
        const history = conv?.messages || [];
        const row = (await client.query(`INSERT INTO ai_requests
            (id,user_id,client_request_id,fingerprint,conversation_id,scope,mode,state,admission_status,error_code,
             received_at,finished_at,expires_at,duration_ms,context_bytes,history_bytes,request_bytes,history_message_ids,queue_ms)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
            ON CONFLICT (user_id,client_request_id) WHERE state<>'rejected' DO NOTHING RETURNING *`,
        [jobId, input.userId, input.requestId, input.fingerprint, conv?.id || null, input.scope, input.mode,
            state, status, code, date(input.now), state === 'pending' ? null : date(input.wallNow ? input.wallNow() : input.now), date(input.now + TTL_MS),
            state === 'pending' ? null : input.elapsed(), conv ? bytes(conv.context) : null,
            payload ? bytes(payload.messages.slice(0, -1)) : null, payload ? bytes(payload) : null,
            history.map((m) => m.id), state === 'pending' ? 0 : null])).rows[0];
        if (!row) return { row: await previous(input.userId, input.requestId, client), repeated: true };
        if (state !== 'rejected') {
            await client.query(`INSERT INTO ai_messages(request_id,role,content,created_at) VALUES($1,'user',$2,$3)`,
                [row.id, input.message, date(input.now)]);
        }
        return { row, repeated: false };
    }

    async function accept(input) {
        const client = await pool.connect();
        let locked = false, transaction = false, retained = false;
        try {
            locked = (await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE, input.userId])).rows[0].locked;
            await client.query('BEGIN'); transaction = true;
            const found = await previous(input.userId, input.requestId, client);
            if (found) { await client.query('COMMIT'); transaction = false; return { row: found, repeated: true }; }
            if (locked) await recover(client, input.userId, input.now);
            let conv = input.conversationId ? await conversation(input.conversationId, input.userId, input.now, client) : null;
            let code = !locked ? 'AI_BUSY' : input.rejectCode || null;
            let status = !locked ? 409 : input.rejectStatus || 409;
            if (!code && input.conversationId && !conv) { code = 'AI_EXPIRED'; status = 404; }
            const history = (conv?.messages || []).map(({ role, content }) => ({ role, content }));
            if (!code && conv && (conv.turns >= 6 || bytes(history) > 48000)) code = 'AI_DIALOG_LIMIT';
            if (!code) {
                const limits = (await client.query(`SELECT count(*) AS daily,
                    count(*) FILTER (WHERE received_at>$2) AS recent FROM ai_requests
                    WHERE received_at>$1 AND state<>'rejected'`, [date(input.now - 86400000), date(input.now - 600000)])).rows[0];
                if (Number(limits.daily) >= 30 || Number(limits.recent) >= 10) { code = 'AI_LOCAL_RATE_LIMIT'; status = 429; }
            }
            if (!code) {
                const size = (await client.query(`SELECT
                    (SELECT count(*) FROM ai_conversations c WHERE expires_at>$1 AND EXISTS
                        (SELECT 1 FROM ai_requests r WHERE r.conversation_id=c.id AND r.state<>'rejected')) AS conversations,
                    (SELECT count(*) FROM ai_requests WHERE expires_at>$1 AND state<>'rejected') AS jobs`, [date(input.now)])).rows[0];
                if (Number(size.conversations) >= 20 || Number(size.jobs) >= 120) { code = 'AI_CAPACITY'; status = 429; }
            }
            if (!code && !conv) {
                conv = { id: randomUUID(), context: input.context, messages: [], turns: 0 };
                await client.query(`INSERT INTO ai_conversations(id,user_id,scope,mode,batch_id,question_id,context,created_at,expires_at)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [conv.id, input.userId, input.scope, input.mode,
                    input.batchId, input.questionId, conv.context, date(input.now), date(input.now + TTL_MS)]);
            }
            const payload = !code ? { context: conv.context, messages: [...history, { role: 'user', content: input.message }] } : null;
            const result = await insert(client, input, code ? 'rejected' : 'pending', code ? status : 202, code, conv, payload);
            if (!code && !result.repeated) await client.query('UPDATE ai_conversations SET expires_at=$2 WHERE id=$1', [conv.id, date(input.now + TTL_MS)]);
            await client.query('COMMIT'); transaction = false;
            if (code || result.repeated) return result;
            retained = true;
            const connectionError = (err) => logError('ai_history_connection', err);
            client.on('error', connectionError);
            let released = false;
            return { ...result, payload, lease: { client, release: async () => {
                if (released) return; released = true;
                await unlock(client, input.userId);
                client.removeListener('error', connectionError);
            } } };
        } catch (err) {
            if (transaction) try { await client.query('ROLLBACK'); } catch (rollbackError) { logError('ai_history_rollback', rollbackError); }
            throw err;
        } finally {
            if (!retained) { if (locked) await unlock(client, input.userId); else client.release(); }
        }
    }

    async function start(row, lease, now, preparationMs) {
        await lease.client.query(`UPDATE ai_requests SET started_at=$3,preparation_ms=$4
            WHERE id=$1 AND user_id=$2 AND state='pending'`, [row.id, row.user_id, date(now), preparationMs]);
    }

    async function finish(completion, lease) {
        const client = lease ? lease.client : await pool.connect();
        let transaction = false;
        try {
            await client.query('BEGIN'); transaction = true;
            const row = (await client.query('SELECT state FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE',
                [completion.row.id, completion.row.user_id])).rows[0];
            if (!row || row.state === 'done') { await client.query('COMMIT'); transaction = false; return; }
            if (completion.answer !== undefined) await client.query(`INSERT INTO ai_messages(request_id,role,content,created_at)
                VALUES($1,'assistant',$2,$3) ON CONFLICT (request_id,role) DO NOTHING`,
            [completion.row.id, completion.answer, date(completion.finishedAt)]);
            const m = metrics(completion.metrics);
            const fields = Object.keys(m);
            // Identifiers come exclusively from the fixed allowlist in metrics(). Values stay parameterized.
            const assignments = fields.map((key, i) => `${key}=$${i + 8}`).join(',');
            await client.query(`UPDATE ai_requests SET state=$2,error_code=$3,finished_at=$4,duration_ms=$5,transport_ms=$6,preparation_ms=$7
                ${assignments ? ',' + assignments : ''} WHERE id=$1`, [completion.row.id,
                completion.answer === undefined ? 'failed' : 'done', completion.code || null,
                date(completion.finishedAt), completion.durationMs, completion.transportMs, completion.preparationMs ?? null,
                ...fields.map((key) => m[key])]);
            await client.query('COMMIT'); transaction = false;
        } catch (err) {
            if (transaction) try { await client.query('ROLLBACK'); } catch (rollbackError) { logError('ai_history_rollback', rollbackError); }
            throw err;
        } finally { if (!lease) client.release(); }
    }

    async function job(id, userId, now) {
        const client = await pool.connect();
        let locked = false;
        try {
            let row = (await client.query('SELECT * FROM ai_requests WHERE id=$1 AND user_id=$2 AND expires_at>$3', [id, userId, date(now)])).rows[0];
            if (!row) return null;
            if (row.state === 'pending') {
                locked = (await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE, userId])).rows[0].locked;
                if (locked) {
                    await recover(client, userId, now);
                    row = (await client.query('SELECT * FROM ai_requests WHERE id=$1 AND user_id=$2', [id, userId])).rows[0];
                }
            }
            await client.query('UPDATE ai_requests SET poll_count=poll_count+1,last_polled_at=$2 WHERE id=$1', [id, date(now)]);
            const answer = (await client.query("SELECT content FROM ai_messages WHERE request_id=$1 AND role='assistant'", [id])).rows[0]?.content;
            const conv = row.conversation_id ? await conversation(row.conversation_id, userId, now, client) : null;
            return { ...row, answer, turns: conv?.turns || 0, sources: conv?.context.references || [] };
        } finally { if (locked) await unlock(client, userId); else client.release(); }
    }

    return { accept, previous, conversation, start, finish, job };
}

module.exports = { createAiHistory, metrics, LOCK_NAMESPACE };
