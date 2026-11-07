const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const nodemailer = require('nodemailer');
const { sendMail } = require('../src/services/mailer');
let directory;
const certificates = {};

before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pg16-mail-tls-'));
    for (const hostname of ['localhost', 'wrong.example.test']) {
        const key = path.join(directory, hostname + '.key');
        const cert = path.join(directory, hostname + '.crt');
        try {
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=' + hostname, '-addext', 'subjectAltName=DNS:' + hostname,
                '-keyout', key, '-out', cert], { stdio: 'ignore', timeout: 10000 });
        } catch (_) { throw new Error('Не удалось создать временный сертификат: для TLS-тестов нужен OpenSSL'); }
        fs.chmodSync(key, 0o600);
        fs.chmodSync(cert, 0o600);
        certificates[hostname] = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    }
});
after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

async function smtpFixture(t, { mode = 'starttls', trusted = true, hostname = 'localhost' } = {}) {
    const credentials = certificates[hostname];
    const context = tls.createSecureContext(credentials);
    const sockets = new Set();
    const seen = { auth: false, message: false, cleartextAuth: false, cleartextMessage: false };
    function track(socket) {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.setTimeout(5000, () => socket.destroy());
    }
    function serve(socket, greeting = true) {
        track(socket);
        if (greeting) socket.write('220 localhost ESMTP\r\n');
        let input = '', dataMode = false;
        function onData(chunk) {
            input += chunk.toString();
            let end;
            while ((end = input.indexOf('\r\n')) !== -1) {
                const row = input.slice(0, end); input = input.slice(end + 2);
                if (dataMode) {
                    seen.message = true;
                    seen.cleartextMessage ||= !socket.encrypted;
                    if (row === '.') { dataMode = false; socket.write('250 accepted\r\n'); }
                } else if (/^(EHLO|HELO)/.test(row)) {
                    socket.write('250-localhost\r\n'
                        + (!socket.encrypted && mode === 'starttls' ? '250-STARTTLS\r\n' : '')
                        + '250 AUTH PLAIN\r\n');
                } else if (/^STARTTLS/.test(row)) {
                    if (mode === 'plaintext') { socket.write('502 TLS unavailable\r\n'); continue; }
                    socket.removeListener('data', onData);
                    socket.write('220 Begin TLS\r\n', () => {
                        serve(new tls.TLSSocket(socket, { isServer: true, secureContext: context }), false);
                    });
                    return;
                } else if (/^AUTH/.test(row)) {
                    seen.auth = true; seen.cleartextAuth ||= !socket.encrypted;
                    socket.write('235 authenticated\r\n');
                } else if (/^DATA/.test(row)) { dataMode = true; socket.write('354 send data\r\n'); }
                else if (/^QUIT/.test(row)) socket.end('221 goodbye\r\n');
                else socket.write('250 OK\r\n');
            }
        }
        socket.on('data', onData);
    }
    const server = mode === 'implicit' ? tls.createServer(credentials, serve) : net.createServer(serve);
    server.on('connection', track);
    server.on('tlsClientError', () => {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const saved = Object.fromEntries(['NODE_ENV', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']
        .map(key => [key, process.env[key]]));
    const original = nodemailer.createTransport;
    // Порт назначения и доверенный тестовый CA меняются только в тесте; проверка имени остаётся настоящей.
    nodemailer.createTransport = options => original({ ...options,
        tls: { ...options.tls, ...(trusted ? { ca: credentials.cert } : {}) },
        getSocket(socketOptions, callback) {
            options.getSocket({ ...socketOptions, host: '127.0.0.1', port: server.address().port }, callback);
        },
    });
    Object.assign(process.env, { NODE_ENV: 'production', SMTP_HOST: 'localhost',
        SMTP_PORT: mode === 'implicit' ? '465' : '587', SMTP_FROM: 'sender@example.test',
        SMTP_USER: crypto.randomBytes(16).toString('hex'), SMTP_PASS: crypto.randomBytes(32).toString('base64url') });
    t.after(async () => {
        nodemailer.createTransport = original;
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        sockets.forEach(socket => socket.destroy());
        await new Promise(resolve => server.close(resolve));
    });
    return { seen, send: () => sendMail({ to: 'receiver@example.test', subject: 'TLS test', text: 'Transport check',
        deadlineAt: Date.now() + 4000 }) };
}

test('SMTP: server without STARTTLS is rejected before credentials and message', async t => {
    const { seen, send } = await smtpFixture(t, { mode: 'plaintext' });
    await assert.rejects(send(), err => err.code === 'ETLS');
    assert.equal(seen.auth, false);
    assert.equal(seen.message, false);
});

for (const mode of ['starttls', 'implicit']) test('SMTP: ' + mode + ' delivers credentials and message only over TLS', async t => {
    const { seen, send } = await smtpFixture(t, { mode });
    await send();
    assert.deepEqual(seen, { auth: true, message: true, cleartextAuth: false, cleartextMessage: false });
});

for (const mode of ['starttls', 'implicit']) test('SMTP: ' + mode + ' rejects an untrusted certificate before credentials and message', async t => {
    const { seen, send } = await smtpFixture(t, { mode, trusted: false });
    await assert.rejects(send(), err => err.code === 'ESOCKET');
    assert.equal(seen.auth, false);
    assert.equal(seen.message, false);
});

for (const mode of ['starttls', 'implicit']) test('SMTP: ' + mode + ' rejects a trusted certificate for another hostname before credentials and message', async t => {
    const { seen, send } = await smtpFixture(t, { mode, hostname: 'wrong.example.test' });
    await assert.rejects(send(), err => err.code === 'ESOCKET');
    assert.equal(seen.auth, false);
    assert.equal(seen.message, false);
});
