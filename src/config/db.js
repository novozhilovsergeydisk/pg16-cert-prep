const { Pool } = require('pg');
const { logError } = require('../middleware/requestLog');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT,
    // Ограничения по времени: соединение из пула — 3 с, запрос в PostgreSQL — 5 с.
    // query_timeout дублирует statement_timeout на стороне Node на случай, если подвис сам сервер БД.
    // Вместе они меньше ожидания страницы (15 с) и nginx (60 с), поэтому ошибку первым видит сервер.
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
});

// Сбой простаивающего соединения: без обработчика процесс завершился бы.
pool.on('error', (err) => logError('pool', err));

module.exports = pool;
