const crypto = require('crypto');
const pool = require('../config/db');
const { sendMail } = require('../services/mailer');
const { COOKIE_NAME, newToken, hashToken, isToken, appUrl, readCookie } = require('../middleware/auth');

const TOKEN_TTL_MINUTES = 15;
const SESSION_DAYS = 30;
const EMAIL_PER_MINUTE = 1;
const EMAIL_PER_HOUR = 5;
const IP_PER_HOUR = 20;
const CODE_ATTEMPTS = 5;
const HOUR_MS = 3600 * 1000;
const TOO_OFTEN = 'Слишком много запросов, попробуйте позже';
const BAD_LINK = 'Ссылка недействительна или устарела';
const BAD_CODE = 'Неверный или устаревший код';

// Запросы ссылок с одного IP за последний час (в памяти процесса).
const ipLog = new Map();

function ipAllowed(ip) {
    const now = Date.now();
    if (ipLog.size > 10000) {
        for (const [key, times] of ipLog) {
            if (times[times.length - 1] < now - HOUR_MS) ipLog.delete(key);
        }
    }
    const times = (ipLog.get(ip) || []).filter((t) => t > now - HOUR_MS);
    if (times.length >= IP_PER_HOUR) {
        ipLog.set(ip, times);
        return false;
    }
    times.push(now);
    ipLog.set(ip, times);
    return true;
}

function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(email)) return null;
    return email;
}

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    };
}

async function requestLink(req, res) {
    const email = normalizeEmail((req.body || {}).email);
    if (email === null) {
        return res.status(400).json({ error: 'Некорректный email' });
    }
    if (!ipAllowed(req.ip)) {
        return res.status(429).json({ error: TOO_OFTEN });
    }
    try {
        const recent = await pool.query(
            `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS minute, count(*)::int AS hour
             FROM login_tokens
             WHERE email = $1 AND created_at > now() - interval '1 hour'`,
            [email]
        );
        const { minute, hour } = recent.rows[0];
        if (minute >= EMAIL_PER_MINUTE || hour >= EMAIL_PER_HOUR) {
            return res.status(429).json({ error: TOO_OFTEN });
        }
        await pool.query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'");
        const token = newToken();
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await pool.query(
            'INSERT INTO login_tokens (token_hash, email, expires_at, code_hash) VALUES ($1, $2, now() + make_interval(mins => $3), $4)',
            [hashToken(token), email, TOKEN_TTL_MINUTES, hashToken(code)]
        );
        // Токен в части после #: браузер не отправляет её на сервер, она не попадает в журналы nginx.
        const site = appUrl();
        await sendMail({
            to: email,
            subject: `Вход на ${new URL(site).host}`,
            text: `Ссылка для входа действует ${TOKEN_TTL_MINUTES} минут: ${site}/#login=${token}\n\n`
                + `Или введите код на странице входа: ${code}`,
        });
        res.json({ ok: true });
    } catch (err) {
        // Текст ошибки почтового сервера может содержать адреса и логины — выводится только код.
        console.error('Не удалось отправить ссылку для входа:', err && err.code ? err.code : 'ошибка');
        res.status(500).json({ error: 'Не удалось отправить письмо, попробуйте позже' });
    }
}

// Создаёт пользователя при первом входе и новый сеанс; вызывается внутри транзакции.
async function openSession(client, res, email) {
    const user = await client.query(
        `INSERT INTO users (email, last_login_at) VALUES ($1, now())
         ON CONFLICT (email) DO UPDATE SET last_login_at = now()
         RETURNING id, email, role`,
        [email]
    );
    await client.query('DELETE FROM sessions WHERE expires_at < now()');
    const sid = newToken();
    await client.query(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))',
        [hashToken(sid), user.rows[0].id, SESSION_DAYS]
    );
    await client.query('COMMIT');
    res.cookie(COOKIE_NAME, sid, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * HOUR_MS });
    res.json({ email: user.rows[0].email, role: user.rows[0].role });
}

async function verifyLink(req, res) {
    const token = (req.body || {}).token;
    if (!isToken(token)) {
        return res.status(400).json({ error: BAD_LINK });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const used = await client.query(
            `UPDATE login_tokens SET used_at = now()
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
             RETURNING email`,
            [hashToken(token), CODE_ATTEMPTS]
        );
        if (used.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: BAD_LINK });
        }
        await openSession(client, res, used.rows[0].email);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release();
    }
}

// Вход по коду из письма: проверяется только последний запрос для этого адреса.
// Неверный код увеличивает счётчик попыток; после CODE_ATTEMPTS запрос перестаёт действовать.
async function verifyCode(req, res) {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const code = body.code;
    if (email === null || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: BAD_CODE });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const last = await client.query(
            `SELECT token_hash, code_hash
             FROM login_tokens
             WHERE email = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2 AND code_hash IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE`,
            [email, CODE_ATTEMPTS]
        );
        if (last.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: BAD_CODE });
        }
        const row = last.rows[0];
        if (!crypto.timingSafeEqual(row.code_hash, hashToken(code))) {
            await client.query('UPDATE login_tokens SET attempts = attempts + 1 WHERE token_hash = $1', [row.token_hash]);
            await client.query('COMMIT');
            return res.status(400).json({ error: BAD_CODE });
        }
        await client.query('UPDATE login_tokens SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
        await openSession(client, res, email);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release();
    }
}

async function logout(req, res) {
    const sid = readCookie(req, COOKIE_NAME);
    try {
        if (isToken(sid)) {
            await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(sid)]);
        }
        res.clearCookie(COOKIE_NAME, cookieOptions());
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

function getMe(req, res) {
    res.json({ email: req.user.email, role: req.user.role });
}

module.exports = { requestLink, verifyLink, verifyCode, logout, getMe, normalizeEmail };
