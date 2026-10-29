// Номер релиза: дата и короткий номер последнего коммита git-копии, на которой работает сервер.
// Определяется один раз при запуске; если git недоступен или не ответил за 2 с, релиз неизвестен (null).
const path = require('path');
const { execFileSync } = require('child_process');
const { logError } = require('../middleware/requestLog');

const ROOT = path.join(__dirname, '..', '..');

function readRelease() {
    try {
        // safe.directory только для этого вызова: на сервере каталог принадлежит root, а служба работает от pgcert.
        const out = execFileSync('git', ['-c', 'safe.directory=' + ROOT, '-C', ROOT, 'log', '-1', '--format=%h %cs'], {
            timeout: 2000,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8',
        }).trim();
        const match = /^([0-9a-f]{7,40}) (\d{4})-(\d{2})-(\d{2})$/.exec(out);
        return match ? { commit: match[1], date: `${match[4]}.${match[3]}.${match[2]}` } : null;
    } catch (err) {
        logError('release', err);
        return null;
    }
}

module.exports = { release: readRelease() };
