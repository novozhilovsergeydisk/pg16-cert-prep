const express = require('express');
const { sessionUserId } = require('../middleware/auth');

const router = express.Router();

// Отчёты страницы о сбоях запросов и ошибках JavaScript пишутся в журнал службы.
// Свободного текста нет: путь, экран и файл принимаются только из списков ниже, числа — в пределах.
// Частота и размер тела ограничены в server.js до разбора тела. Ответ всегда одинаковый.
const KINDS = new Set(['timeout', 'network', 'gateway', 'server', 'js']);
const PATHS = new Set([
    '/api/me', '/api/me/accent', '/api/me/theme', '/api/auth/request', '/api/auth/peek', '/api/auth/verify', '/api/auth/verify-code', '/api/auth/logout',
    '/api/categories', '/api/questions', '/api/training/batches', '/api/training/batches/:id', '/api/answers', '/api/option-checks', '/api/option-checks/batches',
    '/api/exam', '/api/exam/check', '/api/exam/history', '/api/mistakes', '/api/stats', '/api/materials/interview', '/api/materials/memory', '/api/materials/syscalls', '/api/materials/planner', '/api/materials/xact', '/api/materials/acid', '/api/materials/changelog', '/api/practice/05', '/api/practice/06', '/api/practice/07', '/api/practice/08', '/api/practice/09', '/api/practice/10', '/api/practice/11', '/api/practice/12', '/api/practice/13', '/api/practice/17',
    '/api/admin/users', '/api/admin/users/:id', '/api/admin/hard-questions',
]);
const SCREENS = new Set(['login', 'login-sent', 'login-confirm', 'privacy', 'categories', 'question', 'finish',
    'exam-setup', 'exam', 'exam-result', 'history', 'training-history', 'training-batch', 'stats', 'admin',
    'admin-user', 'material', 'option-check']);
const SOURCES = new Set(['app.js']);

const pick = (value, allowed) => (typeof value === 'string' && allowed.has(value) ? value : '-');
const int = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : 0);
// Номера в пути заменяются на :id, чтобы путь совпал со списком маршрутов.
const apiPath = (value) => pick(typeof value === 'string' ? value.replace(/\/\d+(?=\/|$)/g, '/:id') : null, PATHS);

router.post('/client-errors', async (req, res) => {
    res.status(204).end();
    const report = req.body && typeof req.body === 'object' ? req.body : {};
    if (!KINDS.has(report.kind)) return;
    const user = await sessionUserId(req);
    console.warn([
        'client', report.kind,
        'path=' + apiPath(report.path),
        'status=' + int(report.status, 599),
        'ms=' + int(report.ms, 600000),
        'screen=' + pick(report.screen, SCREENS),
        'user=' + user,
        'source=' + pick(report.source, SOURCES) + ':' + int(report.line, 1000000),
    ].join(' '));
});

module.exports = router;
