const path = require('path');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { noteError } = require('../middleware/requestLog');

const router = express.Router();

// Материалы для изучения: Markdown-файлы из репозитория, только для вошедших. Имена берутся из белого списка.
const MATERIALS = { interview: 'INTERVIEW.md', memory: 'MEMORY.md', syscalls: 'SYSCALLS.md', planner: 'PLANNER.md' };

router.get('/materials/:name', requireAuth, (req, res) => {
    const file = Object.hasOwn(MATERIALS, req.params.name) ? MATERIALS[req.params.name] : null;
    if (!file) return res.status(404).json({ error: 'Материал не найден' });
    res.type('text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, '..', '..', 'docs', file), (err) => {
        if (!err) return;
        noteError(res, err);
        if (res.headersSent) res.destroy();
        else res.status(500).json({ error: 'Материал недоступен' });
    });
});

module.exports = router;
