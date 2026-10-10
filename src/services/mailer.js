const nodemailer = require('nodemailer');

// В тестах письма не отправляются, а складываются сюда.
const outbox = [];
let transport = null;

function getTransport() {
    if (!transport) {
        const port = Number(process.env.SMTP_PORT) || 587;
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    }
    return transport;
}

async function sendMail({ to, subject, text }) {
    if (process.env.NODE_ENV === 'test') {
        outbox.push({ to, subject, text });
        return;
    }
    await getTransport().sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}

module.exports = { sendMail, outbox };
