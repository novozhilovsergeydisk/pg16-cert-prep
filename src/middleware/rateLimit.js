// Ограничение частоты запросов в памяти процесса: не больше limit запросов за windowMs на ключ.
// Ключ — IP клиента или номер пользователя. Приложение работает одним процессом, поэтому памяти достаточно.
const TOO_OFTEN = 'Слишком много запросов, попробуйте позже';

function rateLimit({ limit, windowMs, key }) {
    const log = new Map();
    return function limiter(req, res, next) {
        const now = Date.now();
        if (log.size > 10000) {
            for (const [k, times] of log) {
                if (times[times.length - 1] <= now - windowMs) log.delete(k);
            }
        }
        const id = key(req);
        const times = (log.get(id) || []).filter((t) => t > now - windowMs);
        if (times.length >= limit) {
            log.set(id, times);
            return res.status(429).json({ error: TOO_OFTEN });
        }
        times.push(now);
        log.set(id, times);
        next();
    };
}

const HOUR_MS = 3600 * 1000;
const byIp = (req) => req.ip;
const byUser = (req) => req.user.id;

// Token bucket: устойчивые 10/с, ёмкость для короткого всплеска — 20.
function apiLimit({ now = Date.now } = {}) {
    const buckets = new Map();
    return (req, res, next) => {
        const time = now();
        const previous = buckets.get(req.ip);
        if (!previous && buckets.size >= 10000) {
            for (const [ip, bucket] of buckets) if (time - bucket.at >= 2000) buckets.delete(ip);
            if (buckets.size >= 10000) return res.status(429).json({ error: TOO_OFTEN });
        }
        const tokens = previous ? Math.min(20, previous.tokens + Math.max(0, time - previous.at) / 100) : 20;
        buckets.set(req.ip, { at: time, tokens: tokens >= 1 ? tokens - 1 : tokens });
        if (tokens < 1) return res.status(429).json({ error: TOO_OFTEN });
        next();
    };
}

module.exports = {
    apiLimit,
    linkVerifyLimit: rateLimit({ limit: 10, windowMs: 60000, key: byIp }),
    TOO_OFTEN,
    // Запрос письма со ссылкой и кодом: с одного IP.
    linkRequestLimit: rateLimit({ limit: 20, windowMs: HOUR_MS, key: byIp }),
    // Проверка кода из письма: с одного IP, против перебора и выжигания попыток.
    codeCheckLimit: rateLimit({ limit: 30, windowMs: HOUR_MS, key: byIp }),
    // Просмотр владельца ссылки на экране подтверждения: с одного IP.
    linkPeekLimit: rateLimit({ limit: 30, windowMs: HOUR_MS, key: byIp }),
    // Ответы и проверка экзаменов: на пользователя, против раздувания журнала.
    answerLimit: rateLimit({ limit: 1000, windowMs: HOUR_MS, key: byUser }),
    examCheckLimit: rateLimit({ limit: 20, windowMs: HOUR_MS, key: byUser }),
    // Отчёты страницы о сбоях: принимаются и без входа, поэтому ограничены по IP.
    clientErrorLimit: rateLimit({ limit: 30, windowMs: HOUR_MS, key: byIp }),
};
