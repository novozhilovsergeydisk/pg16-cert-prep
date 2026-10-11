const express = require('express');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const pool = require('./src/config/db');
const { checkOrigin } = require('./src/middleware/auth');

// Сервер работает за nginx на той же машине: настоящий IP клиента берётся из X-Forwarded-For.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Защитные заголовки. Страница не использует встроенных скриптов и стилей, поэтому CSP строгая.
// HSTS только в продакшене и без includeSubDomains: на соседних поддоменах работают другие сайты.
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
            + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
    });
    if (process.env.NODE_ENV === 'production') {
        res.set('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
});

app.use(express.static('public'));
app.use(express.json());
app.use('/api', checkOrigin);

// Проверка соединения с БД отдаёт версию сервера, поэтому в продакшене отключена.
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/test', async (req, res) => {
        try {
            const result = await pool.query("SELECT current_setting('server_version') AS version");
            res.json({ success: true, version: result.rows[0].version });
        } catch (err) {
            res.status(500).json({ success: false, error: 'Ошибка запроса к БД' });
        }
    });
}

app.use('/api', require('./src/routes/auth'));
app.use('/api', require('./src/routes/stats'));
app.use('/api', require('./src/routes/materials'));
app.use('/api', require('./src/routes/quiz'));

if (require.main === module) {
    if (process.env.NODE_ENV === 'production' && (!process.env.APP_URL || !process.env.AUTH_SECRET)) {
        console.error('Не заданы APP_URL или AUTH_SECRET: они нужны для входа по ссылке и коду');
        process.exit(1);
    }
    app.listen(port, host, () => {
        console.log(`Сервер запущен: http://${host}:${port}`);
    });
}

module.exports = app;
