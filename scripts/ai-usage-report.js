// Run with the project's existing credential loader. No dialogues are printed.
const fs = require('node:fs');
const path = require('node:path');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { logError } = require('../src/middleware/requestLog');

(async () => {
    try {
        const results = await pool.query(fs.readFileSync(path.join(__dirname, 'ai-usage-report.sql'), 'utf8'));
        const names = ['hourly', 'users', 'errors', 'peak_minutes', 'concurrency', 'storage', 'rejections_daily'];
        console.log(JSON.stringify(Object.fromEntries(results.map((result, i) => [names[i], result.rows])), null, 2));
    } catch (err) {
        logError('ai_usage_report', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
