const crypto = require('crypto');
const pool = require('../config/db');
const { noteError, logError } = require('../middleware/requestLog');
const { release } = require('../services/release');
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

// Весь запрос, включая работу с БД и отправку письма, должен уложиться в 12 с: страница ждёт 15 с.
const REQUEST_LINK_BUDGET_MS = 12000;

async function requestLink(req, res) {
    const started = Date.now();
    const email = normalizeEmail((req.body || {}).email);
    if (email === null) {
        return res.status(400).json({ error: 'Некорректный email' });
    }
    const token = newToken();
    const requestId = newToken();
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const deadlineAt = started + REQUEST_LINK_BUDGET_MS;
    const left = () => deadlineAt - Date.now();
    const client = await pool.connect();
    // Каждый запрос транзакции ограничен временем, оставшимся до общего срока.
    const query = (text, values) => (left() < 1
        ? Promise.reject(Object.assign(new Error('Срок запроса истёк'), { code: 'EDEADLINE' }))
        : client.query({ text, values, query_timeout: left() }));
    // Откат не подтверждён — соединение может быть в незавершённой транзакции: не возвращать его в пул.
    let broken = false;
    try {
        // Проверка лимита и создание запроса — под блокировкой по адресу, чтобы параллельные запросы
        // не обошли лимит писем. Блокировка снимается в конце транзакции.
        await query('BEGIN');
        await query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
        const recent = await query(
            `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS minute, count(*)::int AS hour
             FROM login_tokens
             WHERE email = $1 AND created_at > now() - interval '1 hour'`,
            [email]
        );
        const { minute, hour } = recent.rows[0];
        if (minute >= EMAIL_PER_MINUTE || hour >= EMAIL_PER_HOUR) {
            await query('ROLLBACK');
            return res.status(429).json({ error: TOO_OFTEN });
        }
        await query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'");
        await query(
            `INSERT INTO login_tokens (token_hash, email, expires_at, code_hash, request_hash)
             VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5)`,
            [hashToken(token), email, TOKEN_TTL_MINUTES, codeHash(email, requestId, code), hashToken(requestId)]
        );
        await query('COMMIT');
    } catch (err) {
        noteError(res, err);
        // Срок истёк посреди запроса: соединение занято незавершённым запросом, откат на нём не выполнить.
        // Соединение уничтожается, и PostgreSQL сам откатывает транзакцию при разрыве.
        if (err.code === 'EDEADLINE' || err.message === 'Query read timeout') {
            broken = true;
        } else {
            await query('ROLLBACK').catch((rollbackErr) => {
                broken = true;
                logError('rollback', rollbackErr);
            });
        }
        return res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release(broken);
    }
    try {
        // Токен в части после #: браузер не отправляет её на сервер, она не попадает в журналы nginx.
        const site = appUrl();
        await sendMail({
            to: email,
            subject: `Вход на ${new URL(site).host}`,
            text: `Ссылка для входа действует ${TOKEN_TTL_MINUTES} минут: ${site}/#login=${token}\n\n`
                + `Или введите код на странице входа: ${code}`,
            deadlineAt,
        });
        // Номер запроса знает только эта страница: без него код проверить нельзя.
        res.json({ ok: true, request_id: requestId });
    } catch (err) {
        noteError(res, err);
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
         RETURNING id, email, role, accent, theme`,
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
    res.json({ id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role, accent: user.rows[0].accent, theme: user.rows[0].theme, release });
}

// Показывает, в какой аккаунт ведёт ссылка, не расходуя её: страница подтверждения пишет «Вход как …»,
// чтобы по подставленной чужой ссылке нельзя было незаметно войти в аккаунт злоумышленника.
async function peekLink(req, res) {
    const token = (req.body || {}).token;
    if (!isToken(token)) {
        return res.status(400).json({ error: BAD_LINK });
    }
    try {
        const found = await pool.query(
            'SELECT email FROM login_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
            [hashToken(token)]
        );
        if (found.rowCount === 0) {
            return res.status(400).json({ error: BAD_LINK });
        }
        res.json({ email: found.rows[0].email });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

async function verifyLink(req, res) {
    const token = (req.body || {}).token;
    if (!isToken(token)) {
        return res.status(400).json({ error: BAD_LINK });
    }
    const client = await pool.connect();
    // Откат не подтверждён — соединение может быть в незавершённой транзакции: не возвращать его в пул.
    let broken = false;
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
        noteError(res, err);
        await client.query('ROLLBACK').catch((rollbackErr) => {
            broken = true;
            logError('rollback', rollbackErr);
        });
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release(broken);
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
    // Откат не подтверждён — соединение может быть в незавершённой транзакции: не возвращать его в пул.
    let broken = false;
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
        noteError(res, err);
        await client.query('ROLLBACK').catch((rollbackErr) => {
            broken = true;
            logError('rollback', rollbackErr);
        });
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    } finally {
        client.release(broken);
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
        noteError(res, err);
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

function getMe(req, res) {
    res.json({ id: req.user.id, email: req.user.email, role: req.user.role, accent: req.user.accent, theme: req.user.theme, release });
}

// Цвет кнопок и ссылок; тот же список проверяет ограничение users_accent_check (миграция 106).
const ACCENTS = ['blue', 'beige', 'green', 'graphite'];

async function setAccent(req, res) {
    const accent = req.body && req.body.accent;
    if (!ACCENTS.includes(accent)) {
        return res.status(400).json({ error: 'Такого цвета нет, выберите из списка' });
    }
    try {
        await pool.query('UPDATE users SET accent = $1 WHERE id = $2', [accent, req.user.id]);
        res.json({ accent });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить цвет, попробуйте ещё раз' });
    }
}

// Светлая или тёмная тема; тот же список проверяет ограничение users_theme_check (миграция 107).
const THEMES = ['auto', 'light', 'dark'];

async function setTheme(req, res) {
    const theme = req.body && req.body.theme;
    if (!THEMES.includes(theme)) {
        return res.status(400).json({ error: 'Такой темы нет, выберите из списка' });
    }
    try {
        await pool.query('UPDATE users SET theme = $1 WHERE id = $2', [theme, req.user.id]);
        res.json({ theme });
    } catch (err) {
        noteError(res, err);
        res.status(500).json({ error: 'Не удалось сохранить тему, попробуйте ещё раз' });
    }
}

module.exports = { requestLink, peekLink, verifyLink, verifyCode, logout, getMe, setAccent, setTheme, normalizeEmail };
