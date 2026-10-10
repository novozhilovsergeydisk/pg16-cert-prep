const pool = require('../config/db');
const { sendMail } = require('../services/mailer');
const { COOKIE_NAME, newToken, hashToken, isToken, appUrl, readCookie } = require('../middleware/auth');

const TOKEN_TTL_MINUTES = 15;
const SESSION_DAYS = 30;
const EMAIL_PER_MINUTE = 1;
const EMAIL_PER_HOUR = 5;
const IP_PER_HOUR = 20;
const HOUR_MS = 3600 * 1000;
const TOO_OFTEN = 'Слишком много запросов, попробуйте позже';
const BAD_LINK = 'Ссылка недействительна или устарела';

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
        await pool.query(
            'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))',
            [hashToken(token), email, TOKEN_TTL_MINUTES]
        );
        // Токен в части после #: браузер не отправляет её на сервер, она не попадает в журналы nginx.
        const site = appUrl();
        await sendMail({
            to: email,
            subject: `Вход на ${new URL(site).host}`,
            text: `Ссылка для входа действует ${TOKEN_TTL_MINUTES} минут: ${site}/#login=${token}`,
        });
        res.json({ ok: true });
    } catch (err) {
        // Текст ошибки почтового сервера может содержать адреса и логины — выводится только код.
        console.error('Не удалось отправить ссылку для входа:', err && err.code ? err.code : 'ошибка');
        res.status(500).json({ error: 'Не удалось отправить письмо, попробуйте позже' });
    }
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
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
             RETURNING email`,
            [hashToken(token)]
        );
        if (used.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: BAD_LINK });
        }
        const user = await client.query(
            `INSERT INTO users (email, last_login_at) VALUES ($1, now())
             ON CONFLICT (email) DO UPDATE SET last_login_at = now()
             RETURNING id, email, role`,
            [used.rows[0].email]
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

module.exports = { requestLink, verifyLink, logout, getMe, normalizeEmail };
