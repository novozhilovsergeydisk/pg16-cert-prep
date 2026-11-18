const express = require('express');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const pool = require('./src/config/db');
const { checkOrigin } = require('./src/middleware/auth');
const { requestLog, noteError, logError } = require('./src/middleware/requestLog');
const { clientErrorLimit, apiLimit } = require('./src/middleware/rateLimit');

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
// Журнал API: ошибки, медленные и оборванные запросы.
app.use('/api', requestLog);
app.use('/api', apiLimit());
// Отчёты страницы о сбоях: лимит частоты до разбора тела, чтобы его расходовали и отклонённые запросы;
// тело — не больше 2 КБ. Остальные запросы — с обычным ограничением express.json.
app.use('/api/client-errors', clientErrorLimit, express.json({ limit: '2kb', inflate: false }));
// Браузер отправляет обычный JSON: сжатые тела не распаковываем до проверки входа.
app.use(express.json({ inflate: false }));
app.use('/api', checkOrigin);

// Проверка соединения с БД отдаёт версию сервера, поэтому в продакшене отключена.
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/test', async (req, res) => {
        try {
            const result = await pool.query("SELECT current_setting('server_version') AS version");
            res.json({ success: true, version: result.rows[0].version });
        } catch (err) {
            noteError(res, err);
            res.status(500).json({ success: false, error: 'Ошибка запроса к БД' });
        }
    });
}

app.use('/api', require('./src/routes/auth'));
app.use('/api', require('./src/routes/sync').router);
// До маршрутов с обязательным входом: отчёты принимаются и без него.
app.use('/api', require('./src/routes/clientErrors'));
app.use('/api', require('./src/routes/stats'));
app.use('/api', require('./src/routes/materials'));
app.use('/api', require('./src/routes/ai').createAiRouter());
app.use('/api', require('./src/routes/quiz'));

// Необработанная ошибка маршрута или разбора тела запроса: фиксированный ответ в JSON,
// класс и код ошибки — в журнал. Текст ошибки не выводится ни клиенту, ни в журнал.
app.use((err, req, res, next) => {
    noteError(res, err);
    // Ответ уже начат: обрываем соединение, чтобы частичный ответ не выглядел успешным.
    if (res.headersSent) return res.destroy();
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: 'Ошибка запроса' });
});

if (require.main === module) {
    if (process.env.NODE_ENV === 'production' && (!process.env.APP_URL || !process.env.AUTH_SECRET)) {
        console.error('Не заданы APP_URL или AUTH_SECRET: они нужны для входа по ссылке и коду');
        process.exit(1);
    }
    process.on('unhandledRejection', (err) => logError('unhandledRejection', err));
    process.on('uncaughtException', (err) => {
        logError('uncaughtException', err);
        process.exit(1);
    });
    app.listen(port, host, () => {
        console.log(`Сервер запущен: http://${host}:${port}`);
    });
}

module.exports = app;
