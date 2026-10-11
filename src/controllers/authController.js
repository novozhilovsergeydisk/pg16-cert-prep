const crypto = require('crypto');
const pool = require('../config/db');
const { sendMail } = require('../services/mailer');
const { COOKIE_NAME, newToken, hashToken, isToken, appUrl, readCookie } = require('../middleware/auth');
const { TOO_OFTEN } = require('../middleware/rateLimit');

const TOKEN_TTL_MINUTES = 15;
const SESSION_DAYS = 30;
const EMAIL_PER_MINUTE = 1;
const EMAIL_PER_HOUR = 5;
const CODE_ATTEMPTS = 5;
const HOUR_MS = 3600 * 1000;
const BAD_LINK = 'Ссылка недействительна или устарела';
const BAD_CODE = 'Неверный или устаревший код';

// Секрет для HMAC кода из письма. В продакшене задаётся в .env (AUTH_SECRET); без него сервер не запускается.
// При разработке и в тестах, если секрет не задан, берётся случайный на время работы процесса.
const devSecret = crypto.randomBytes(32);

function codeHash(email, requestId, code) {
    const secret = process.env.AUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET не задан');
    return crypto.createHmac('sha256', secret || devSecret).update(`${email}\n${requestId}\n${code}`).digest();
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
    const token = newToken();
    const requestId = newToken();
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const client = await pool.connect();
    try {
        // Проверка лимита и создание запроса — под блокировкой по адресу, чтобы параллельные запросы
        // не обошли лимит писем. Блокировка снимается в конце транзакции.
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
        const recent = await client.query(
            `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS minute, count(*)::int AS hour
             FROM login_tokens
             WHERE email = $1 AND created_at > now() - interval '1 hour'`,
            [email]
        );
        const { minute, hour } = recent.rows[0];
        if (minute >= EMAIL_PER_MINUTE || hour >= EMAIL_PER_HOUR) {
            await client.query('ROLLBACK');
            return res.status(429).json({ error: TOO_OFTEN });
        }
        await client.query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'");
        await client.query(
            `INSERT INTO login_tokens (token_hash, email, expires_at, code_hash, request_hash)
             VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5)`,
            [hashToken(token), email, TOKEN_TTL_MINUTES, codeHash(email, requestId, code), hashToken(requestId)]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release();
    }
    try {
        // Токен в части после #: браузер не отправляет её на сервер, она не попадает в журналы nginx.
        const site = appUrl();
        await sendMail({
            to: email,
            subject: `Вход на ${new URL(site).host}`,
            text: `Ссылка для входа действует ${TOKEN_TTL_MINUTES} минут: ${site}/#login=${token}\n\n`
                + `Или введите код на странице входа: ${code}`,
        });
        // Номер запроса знает только эта страница: без него код проверить нельзя.
        res.json({ ok: true, request_id: requestId });
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
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
             RETURNING email`,
            [hashToken(token)]
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

// Вход по коду из письма: код проверяется у запроса с переданным номером.
// Неверный код увеличивает счётчик попыток; после CODE_ATTEMPTS код перестаёт действовать,
// а ссылка из того же письма продолжает работать.
async function verifyCode(req, res) {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const code = body.code;
    const requestId = body.request_id;
    if (email === null || !isToken(requestId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: BAD_CODE });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const last = await client.query(
            `SELECT token_hash, code_hash
             FROM login_tokens
             WHERE email = $1 AND request_hash = $2 AND used_at IS NULL AND expires_at > now()
               AND attempts < $3 AND code_hash IS NOT NULL
             FOR UPDATE`,
            [email, hashToken(requestId), CODE_ATTEMPTS]
        );
        if (last.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: BAD_CODE });
        }
        const row = last.rows[0];
        const expected = codeHash(email, requestId, code);
        if (row.code_hash.length !== expected.length || !crypto.timingSafeEqual(row.code_hash, expected)) {
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
