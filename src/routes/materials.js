const path = require('path');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { noteError } = require('../middleware/requestLog');

const router = express.Router();

// Материалы для изучения: Markdown-файлы из репозитория, только для вошедших. Имена берутся из белого списка.
const MATERIALS = { interview: 'INTERVIEW.md', memory: 'MEMORY.md', syscalls: 'SYSCALLS.md', planner: 'PLANNER.md', xact: 'XACT.md', acid: 'ACID.md', changelog: 'CHANGELOG.md' };

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

// Практикумы по темам: примеры для psql, файлы docs/practice/<номер темы>.md. Номера берутся из белого списка.
const PRACTICE = { '05': '05.md', '06': '06.md', '07': '07.md', '08': '08.md', '09': '09.md', '10': '10.md', '11': '11.md', '12': '12.md', '13': '13.md', '17': '17.md' };

router.get('/practice/:topic', requireAuth, (req, res) => {
    const file = Object.hasOwn(PRACTICE, req.params.topic) ? PRACTICE[req.params.topic] : null;
    if (!file) return res.status(404).json({ error: 'Практикум не найден' });
    res.type('text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, '..', '..', 'docs', 'practice', file), (err) => {
        if (!err) return;
        noteError(res, err);
        if (res.headersSent) res.destroy();
        else res.status(500).json({ error: 'Практикум недоступен' });
    });
});

module.exports = router;
