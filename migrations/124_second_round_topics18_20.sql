-- Второй круг Codex по темам 18–20: 6 вопросов (7 исправлений), ключи и варианты не меняются.
-- Источник: scripts/questions/124_second_round_topics18_20.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('option', 'Что такое виртуальная память процесса?', 'Общая для всех процессов память, где каждый видит данные остальных процессов', NULL, 'У каждого процесса своё адресное пространство; общие участки подключаются только явно.', 'У процессов отдельные виртуальные адресные пространства. Одни физические страницы могут использоваться совместно, например для кода библиотек или после fork; это не открывает доступ к чужой приватной памяти.'),
        ('explanation', 'Что не так в этой функции?
```
int *make(void)
{
    int x = 42;
    return &x;
}
```', NULL, NULL, 'Чтобы вернуть данные из функции, их размещают в куче (malloc, а освобождает вызывающий), в статической переменной или в буфере, который передал вызывающий.', 'Значение x можно вернуть непосредственно, объявив функцию как int make(void) и написав return x. Если нужен указатель, объект должен существовать после возврата: подойдут блок malloc, статическая переменная или буфер вызывающего. Блок malloc освобождает вызывающий.'),
        ('question', 'Программа получила через mmap новую анонимную область с правом записи, без MAP_POPULATE, и впервые записывает в одну из её страниц. Что верно?', NULL, NULL, NULL, 'Программа получила через mmap новую приватную анонимную область с правом записи. Физические страницы заранее не выделялись, обращений к области ещё не было; памяти достаточно. Что верно при самой первой записи в эту область?'),
        ('explanation', 'Программа получила через mmap новую приватную анонимную область с правом записи. Физические страницы заранее не выделялись, обращений к области ещё не было; памяти достаточно. Что верно при самой первой записи в эту область?', NULL, NULL, 'Первая запись в неподготовленное анонимное отображение вызывает minor fault: ядро выделяет страницу. THP могут увеличить размер выделяемой страницы, но сами по себе не означают предварительного заполнения mmap; malloc же может вернуть уже использованную память, а glibc сама пишет служебные данные в начало блока. Мелкие страничные ошибки обходятся без диска, крупные требуют чтения из файла или свопа. Счётчики процесса: ps -o pid,min_flt,maj_flt,cmd -p PID. Опыт 4 в examples/syscalls.c считает их при записи в 64 МБ.', 'Возникает мелкая страничная ошибка: ядро выделяет физическую страницу и возобновляет выполнение инструкции. Читать исходные данные из файла или свопа не нужно. Счётчики процесса: ps -o pid,min_flt,maj_flt,cmd -p PID. Опыт 4 в examples/syscalls.c считает их при записи в 64 МБ.'),
        ('explanation', 'Чем команда ANALYZE t отличается от EXPLAIN ANALYZE SELECT * FROM t?', NULL, NULL, 'ANALYZE строит выборку около 300 × default_statistics_target строк (по умолчанию около 30 000), просматривая для этого и больше. Подробности сбора: ANALYZE VERBOSE t. Когда статистика собиралась: SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = ''t'';', 'ANALYZE собирает статистику по выборке строк; её размер зависит от настроек статистики, в том числе для отдельных столбцов. При стандартных настройках для большой обычной таблицы это около 30 000 строк; маленькая таблица может читаться целиком. EXPLAIN ANALYZE выполняет запрос и собирает показатели его выполнения. Подробности сбора: ANALYZE VERBOSE t. Когда статистика собиралась: SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = ''t'';'),
        ('question', 'Таблица уже проходила ANALYZE; оценка числа строк в pg_class.reltuples актуальна и положительна. При каком объёме изменений с последнего анализа она станет кандидатом на автоматический ANALYZE при настройках по умолчанию?', NULL, NULL, NULL, 'Обычная постоянная таблица уже проходила ANALYZE; оценка числа строк в pg_class.reltuples актуальна и положительна. При каком объёме изменений с последнего анализа она станет кандидатом на автоматический ANALYZE при настройках по умолчанию?'),
        ('option', 'Что верно для соединения Hash Join?', 'Может разбивать данные на порции и использовать временные файлы', NULL, 'Бюджет — work_mem × hash_mem_multiplier. Обычно используются порции и временные файлы; при неудачном разбиении рост числа порций может остановиться, а расход превысить бюджет.', 'Если хеш-таблица помещается в выделенную память, временные файлы не нужны. При нехватке памяти Hash Join может разбить данные на порции с записью во временные файлы. Базовый бюджет — work_mem × hash_mem_multiplier; при неудачном разбиении рост числа порций может остановиться, а расход превысить бюджет.')
    ) AS fixes(kind, question_text, opt_text, new_opt_text, old_text, new_text)
    LOOP
        -- Сначала ровно один вопрос по тексту (прежнему или новому), дальше всё только по его id.
        SELECT count(*), min(id) INTO matches, qid FROM questions
        WHERE question_text IN (fix.question_text, CASE WHEN fix.kind = 'question' THEN fix.new_text ELSE fix.question_text END);
        IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вопрос для исправления'; END IF;
        IF fix.kind = 'question' THEN
            UPDATE questions SET question_text = fix.new_text WHERE id = qid;
        ELSIF fix.kind = 'explanation' THEN
            PERFORM 1 FROM questions WHERE id = qid AND explanation IN (fix.old_text, fix.new_text);
            IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение вопроса'; END IF;
            UPDATE questions SET explanation = fix.new_text WHERE id = qid;
        ELSE
            SELECT count(*), min(o.key) INTO matches, k
            FROM questions q, jsonb_each_text(q.options) o
            WHERE q.id = qid AND o.value IN (fix.opt_text, coalesce(fix.new_opt_text, fix.opt_text));
            IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вариант ответа для исправления'; END IF;
            IF fix.new_text IS NOT NULL THEN
                PERFORM 1 FROM questions WHERE id = qid AND option_notes ->> k IN (fix.old_text, fix.new_text);
                IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение варианта'; END IF;
                UPDATE questions SET option_notes = jsonb_set(option_notes, ARRAY[k], to_jsonb(fix.new_text)) WHERE id = qid;
            END IF;
            IF fix.new_opt_text IS NOT NULL THEN
                UPDATE questions SET options = jsonb_set(options, ARRAY[k], to_jsonb(fix.new_opt_text)) WHERE id = qid;
            END IF;
        END IF;
    END LOOP;
END
$fix$;

COMMIT;
