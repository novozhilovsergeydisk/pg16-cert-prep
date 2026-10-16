const net = require('net');
const nodemailer = require('nodemailer');

// В тестах письма не отправляются, а складываются сюда.
const outbox = [];

// Общий срок отправки письма. Отдельные ограничения Nodemailer (соединение, приветствие, простой)
// не ограничивают сумму этапов, поэтому по общему сроку соединение закрывается и отправка прекращается.
const MAIL_MAX_MS = 10000;

function createTransport(sockets) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        // Соединение открывает приложение, чтобы закрыть его по общему сроку; TLS поверх него поднимает Nodemailer.
        getSocket(options, callback) {
            const socket = net.connect({ host: options.host, port: options.port });
            sockets.push(socket);
            let done = false;
            const finish = (err, result) => {
                if (done) return;
                done = true;
                callback(err, result);
            };
            const onError = (err) => finish(err);
            socket.once('error', onError);
            socket.once('connect', () => {
                socket.removeListener('error', onError);
                finish(null, { connection: socket });
            });
        },
    });
}

// deadlineAt — момент, к которому запрос должен быть обслужен целиком (с учётом работы с БД до отправки).
async function sendMail({ to, subject, text, deadlineAt }) {
    if (process.env.NODE_ENV === 'test') {
        outbox.push({ to, subject, text });
        return;
    }
    const left = Math.min(MAIL_MAX_MS, (deadlineAt || Infinity) - Date.now());
    const expired = () => Object.assign(new Error('Срок отправки письма истёк'), { code: 'EMAILDEADLINE' });
    if (left < 1000) throw expired();
    const sockets = [];
    const sending = createTransport(sockets).sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    let timer;
    const deadline = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            // Свой объект ошибки для сокета: Nodemailer меняет у полученной ошибки код на ESOCKET.
            reject(expired());
            sockets.forEach((socket) => socket.destroy(expired()));
        }, left);
    });
    try {
        await Promise.race([sending, deadline]);
    } finally {
        clearTimeout(timer);
        // После истечения срока отправка завершится ошибкой закрытого соединения — она уже учтена.
        sending.catch(() => {});
    }
}

module.exports = { sendMail, outbox, MAIL_MAX_MS };
