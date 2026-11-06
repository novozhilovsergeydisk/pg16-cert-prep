const { spawn } = require('node:child_process');

const MAX_OUTPUT_BYTES = 32000;
const DEADLINE_MS = 55000;
const ERROR_CODES = new Set(['AI_RATE_LIMIT', 'AI_TIMEOUT', 'AI_CREDENTIAL', 'AI_PRICING',
    'AI_UNAVAILABLE', 'AI_INVALID', 'AI_TRUNCATED', 'AI_BUSY']);

function failure(code) {
    const err = new Error('AI request failed');
    err.code = code;
    return err;
}

// Единственный транспорт приложения — SSH. HTTP-клиента и прямого fallback к ИИ здесь нет.
function runGateway(payload, { configPath = process.env.AI_SSH_CONFIG || '/etc/pg16-ai/ssh_config',
    spawnProcess = spawn, deadlineMs = DEADLINE_MS } = {}) {
    return new Promise((resolve, reject) => {
        if (!configPath.startsWith('/') || Buffer.byteLength(JSON.stringify(payload)) > 96000) {
            reject(failure('AI_INVALID'));
            return;
        }
        let child;
        try {
            child = spawnProcess('/usr/bin/ssh', ['-F', configPath, '-T', '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
                '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1',
                '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
                'pg16-ai-gateway'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        } catch (_) {
            reject(failure('AI_UNAVAILABLE'));
            return;
        }
        let complete = false;
        let bytes = 0;
        const output = [];
        const finish = (err, result) => {
            if (complete) return;
            complete = true;
            clearTimeout(timer);
            if (err) {
                child.kill('SIGKILL');
                reject(err);
            } else resolve(result);
        };
        const timer = setTimeout(() => finish(failure('AI_TIMEOUT')), deadlineMs);
        child.on('error', () => finish(failure('AI_UNAVAILABLE')));
        child.stdin.on('error', () => finish(failure('AI_UNAVAILABLE')));
        // SSH stderr может содержать инфраструктурные подробности: не отдаём и не журналируем его.
        child.stderr.on('data', () => {});
        child.stdout.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_OUTPUT_BYTES) return finish(failure('AI_INVALID'));
            output.push(chunk);
        });
        child.on('close', (code) => {
            if (complete) return;
            try {
                const result = JSON.parse(Buffer.concat(output).toString('utf8'));
                if (!result.ok) return finish(failure(ERROR_CODES.has(result.code) ? result.code : 'AI_UNAVAILABLE'));
                if (code !== 0 || typeof result.answer !== 'string' || !result.answer.trim()
                    || result.answer.length > 12000 || result.cost !== 0) return finish(failure('AI_INVALID'));
                finish(null, { answer: result.answer.trim() });
            } catch (_) {
                finish(failure('AI_UNAVAILABLE'));
            }
        });
        child.stdin.end(JSON.stringify(payload));
    });
}

module.exports = { runGateway, failure };
