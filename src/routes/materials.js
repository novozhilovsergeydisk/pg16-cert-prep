const path = require('path');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { noteError } = require('../middleware/requestLog');

const router = express.Router();

// Материал для подготовки к собеседованию: Markdown-файл из репозитория, только для вошедших.
router.get('/materials/interview', requireAuth, (req, res) => {
    res.type('text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, '..', '..', 'docs', 'INTERVIEW.md'), (err) => {
        if (!err) return;
        noteError(res, err);
        if (res.headersSent) res.destroy();
        else res.status(500).json({ error: 'Материал недоступен' });
    });
});

module.exports = router;
