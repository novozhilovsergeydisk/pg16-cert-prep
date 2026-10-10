const crypto = require('crypto');
const pool = require('../config/db');

const COOKIE_NAME = 'sid';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// 32 случайных байта в base64url — 43 символа. В базе хранится только SHA-256.
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest();
const isToken = (value) => typeof value === 'string' && TOKEN_PATTERN.test(value);

// Адрес сайта для ссылок в письмах и проверки Origin. В продакшене задаётся в .env.
function appUrl() {
    return process.env.APP_URL || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`;
}

function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

// POST с чужого сайта отклоняется: Origin должен совпадать с адресом сайта (APP_URL)
// или с адресом, по которому открыта страница. Запросы без Origin (не из браузера) пропускаются.
function checkOrigin(req, res, next) {
    if (req.method === 'POST') {
        const origin = req.get('origin');
        if (origin && origin !== new URL(appUrl()).origin && origin !== `${req.protocol}://${req.get('host')}`) {
            return res.status(403).json({ error: 'Запрос отклонён' });
        }
    }
    next();
}

async function requireAuth(req, res, next) {
    const sid = readCookie(req, COOKIE_NAME);
    if (!isToken(sid)) {
        return res.status(401).json({ error: 'Требуется вход' });
    }
    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.role
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.expires_at > now()`,
            [hashToken(sid)]
        );
        if (result.rowCount === 0) {
            return res.status(401).json({ error: 'Требуется вход' });
        }
        req.user = result.rows[0];
        next();
    } catch (err) {
        res.status(500).json({ error: 'Ошибка запроса к БД' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
}

module.exports = { COOKIE_NAME, newToken, hashToken, isToken, appUrl, readCookie, checkOrigin, requireAuth, requireAdmin };
