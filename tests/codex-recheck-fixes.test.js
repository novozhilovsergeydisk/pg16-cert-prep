const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { fixes } = require('../scripts/questions/064_codex_recheck_fixes');
const { later } = require('./later-fixes');
after(() => pool.end());

// Ключи этих вопросов до исправлений 064: правки меняют только тексты, ключи и число вариантов остаются прежними.
const keys = {
    "Какое сочетание условий обычно делает Nested Loop выгодным при соединении по равенству?": "A",
    "Сортировка 100 000 строк по val в памяти (одинаковые данные и work_mem, в обоих планах Sort Method: quicksort) заняла 264 мс с COLLATE \"C\" и 2049 мс с COLLATE \"ru_RU.utf8\". Почему такая разница?": "C",
    "Строки таблицы вставлены по порядку id, значения val имеют вид «строка 1», «строка 2» и так далее. Сортировка по val с COLLATE \"ru_RU.utf8\" через диск (external merge) оказалась в два раза быстрее, чем в памяти, а на перемешанной копии таблицы — медленнее. Какой механизм может объяснить такой результат?": "C",
    "После загрузки большой таблицы ANALYZE вручную не выполняли. При каком объёме изменений таблица станет кандидатом на автоматический ANALYZE при настройках по умолчанию?": "D",
    "Таблица t (id int PRIMARY KEY, v int) без других ограничений и триггеров. Сеанс 1 выполнил BEGIN; UPDATE t SET v = 0 WHERE id = 1; и не завершил транзакцию. Каждая команда выполняется отдельно. Какие команды сеанса 2 не будут ждать блокировок сеанса 1?": "CD",
    "Что означает значение n_distinct = -1 для столбца в pg_stats?": "D",
    "Для столбца id в pg_stats correlation = 1. Что это значит?": "C",
    "Что верно для соединения Hash Join?": "ADE",
    "Как работает Bitmap Heap Scan?": "B",
    "Чем Index Scan отличается от Bitmap Heap Scan?": "AB",
    "Почему по одному индексу нельзя понять, видна ли строка текущей транзакции?": "C",
    "У сортировки с COLLATE \"C\" и с COLLATE \"ru_RU.utf8\" одинаковая оценка cost, хотя вторая выполняется почти в восемь раз дольше. Почему?": "C",
    "Процесс не использует HugeTLB. У него VmSize равен 439 МБ, VmRSS — 15 МБ, VmSwap — 1 МБ. Что из этого верно?": "A",
    "Что верно для приватных страниц памяти дочернего процесса, созданного вызовом fork() в Linux, если общая память явно не подключалась?": "CE",
    "У службы systemd (cgroup v2) заданы MemoryHigh=1700M и MemoryMax=2G, включён дисковый своп, для службы он не ограничен. Процессу службы нужно 3,6 ГБ активно используемой памяти. Что произойдёт?": "BC",
    "Процесс читает свою страницу, которая выгружена в своп на диске: копии страницы нет ни в оперативной памяти, ни в кеше свопа (сжатый кеш zswap не используется). Что произойдёт?": "D",
    "Сеанс ждёт блокировку. Что верно о поиске причины ожидания и об ограничении времени ожидания?": "BDE",
    "В таблице t 100 000 строк, первичный ключ по id (индекс t_pkey), индекса по val нет. В каком из этих запросов в EXPLAIN ANALYZE обычно появится Sort Method: top-N heapsort?": "A",
    "Параметр work_mem = 64MB. В непараллельном плане запроса две сортировки и одно хеш-соединение, hash_mem_multiplier по умолчанию. Чему равна сумма бюджетов памяти этих операций?": "A",
};
// Имя вопроса после 064 и всех поздних правок (066 переименовала ещё один вопрос).
const finalName = (name) => later.reduce((n, f) => (f.kind === 'question' && f.q === n ? f.new : n), name);
const keyNames = Object.fromEntries(Object.entries(keys).map(([name, key]) => [finalName(name), key]));

test('Исправления 064: новые тексты в базе, прежних нет, ключи не тронуты', async () => {
    assert.equal(fixes.length, 32);
    assert.equal(Object.keys(keys).length, 19);
    for (const f of fixes) {
        const name = finalName(f.q);
        assert.ok(name in keyNames, 'нет ключа в проверке: ' + name.slice(0, 50));
        const { rows } = await pool.query(
            'SELECT options, correct_answer, explanation, option_notes FROM questions WHERE question_text = $1', [name]);
        assert.equal(rows.length, 1, 'Нужна миграция 064: ' + name.slice(0, 50));
        const q = rows[0];
        assert.equal(q.correct_answer, keyNames[name], 'Ключ изменился: ' + name.slice(0, 50));
        assert.deepEqual(Object.keys(q.option_notes).sort(), Object.keys(q.options).sort());
        if (f.kind === 'explanation') {
            assert.equal(q.explanation, f.new);
            assert.notEqual(q.explanation, f.old);
        } else if (f.kind === 'option') {
            // Правки после 064 (066) могли ещё раз переписать вариант или пояснение: идём по цепочке от этой правки.
            let text = f.newOpt || f.opt;
            let note = f.newNote;
            let n = f.q;
            for (const g of later.slice(later.indexOf(f) + 1)) {
                if (g.kind === 'question' && g.q === n) n = g.new;
                else if (g.kind === 'option' && g.q === n && g.opt === text) {
                    text = g.newOpt || text;
                    note = g.newNote || note;
                }
            }
            const key = Object.keys(q.options).find((k) => q.options[k] === text);
            assert.ok(key, 'нет варианта: ' + text.slice(0, 50));
            if (f.newOpt) assert.notEqual(f.newOpt, f.opt);
            if (note) {
                assert.equal(q.option_notes[key], note);
                assert.notEqual(q.option_notes[key], f.oldNote);
            }
        }
    }
});
