// Журнал API в вывод службы (journalctl -u pg16-cert-prep): ошибки, медленные и оборванные запросы.
// Тексты ошибок, тела запросов, cookie и адреса почты в журнал не пишутся:
// текст ошибки БД может содержать адрес сервера и имя пользователя.
const SLOW_MS = 2000;

// Класс ошибки и её код (SQLSTATE PostgreSQL или код Node), без текста.
function errorKind(err) {
    if (!err) return '-';
    const name = String((err.constructor && err.constructor.name) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    const code = typeof err.code === 'string' && /^[A-Za-z0-9_]{1,30}$/.test(err.code) ? '/' + err.code : '';
    return (name || 'Error') + code;
}

// Запомнить ошибку обработчика: её класс попадёт в строку журнала этого запроса.
function noteError(res, err) {
    res.locals.errorKind = errorKind(err);
}

// Ошибка вне ответа на запрос: вторичная запись, сбой пула, необработанное исключение.
function logError(where, err) {
    console.error(`error ${where} err=${errorKind(err)}`);
}

function requestLog(req, res, next) {
    const start = Date.now();
    res.on('close', () => {
        const ms = Date.now() - start;
        // Ответ не дописан: клиент или nginx закрыл соединение раньше, чем пришёл ответ.
        const aborted = !res.writableFinished;
        const failed = res.statusCode >= 500 || Boolean(res.locals.errorKind);
        if (!aborted && !failed && ms < SLOW_MS) return;
        // Шаблон маршрута (/api/admin/users/:id), а не фактический путь: в пути может быть произвольный текст.
        // Маршруты роутеров смонтированы на /api и записаны без префикса; маршруты приложения уже с ним.
        const route = req.route && typeof req.route.path === 'string' ? req.route.path : null;
        const path = !route ? 'unknown' : route.startsWith('/api/') ? route : '/api' + route;
        const user = req.user ? req.user.id : '-';
        const status = aborted ? 'aborted' : res.statusCode;
        const line = `api ${req.method} ${path} ${status} ${ms}ms user=${user} err=${res.locals.errorKind || '-'}`;
        if (aborted || failed) console.error(line);
        else console.warn(line + ' slow');
    });
    next();
}

module.exports = { SLOW_MS, errorKind, noteError, logError, requestLog };
