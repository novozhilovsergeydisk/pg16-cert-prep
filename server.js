const express = require('express');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const pool = require('./src/config/db');

app.use(express.static('public'));
app.use(express.json());
app.use('/api', require('./src/routes/quiz'));

app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query("SELECT current_setting('server_version') AS version");
        res.json({ success: true, version: result.rows[0].version });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Ошибка запроса к БД' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Сервер запущен: http://localhost:${port}`);
    });
}

module.exports = app;
