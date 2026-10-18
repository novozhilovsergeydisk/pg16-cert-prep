-- Четыре вопроса о карте памяти /proc/PID/maps в разделе «18. Память процесса» с пояснениями к каждому варианту.
-- Источник: scripts/questions/040_proc_maps.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html
-- https://man7.org/linux/man-pages/man5/proc_pid_status.5.html
-- https://man7.org/linux/man-pages/man2/mmap.2.html

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что означают права r-xp в строке файла /proc/PID/maps?', '{"A":"Чтение и запись разрешены, выполнение запрещено; область общая","B":"Чтение и выполнение разрешены, запись запрещена; область приватная","C":"Разрешено только выполнение; читать эту область процесс не может","D":"Область принадлежит пользователю root и недоступна остальным"}'::jsonb, 'B', 'Четыре символа: r (чтение), w (запись), x (выполнение) и p (приватная область с копированием при записи) либо s (общая). Код обычно r-xp, данные и куча — rw-p.', '{"A":"Это были бы права rw-s: запись разрешена, а последняя буква s означает общую область.","B":"Так обычно выглядит область машинного кода программы или библиотеки.","C":"Первая буква r означает, что чтение разрешено.","D":"Права в maps относятся к самой области памяти процесса, а не к владельцу процесса."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что верно для строки «7f58aa3a8000-7f58aa3cd000 rw-p 00000000 00:00 0» в /proc/PID/maps?', '{"A":"Процесс может читать и записывать эту область","B":"Адреса в первой колонке — физические адреса оперативной памяти","C":"Область анонимная: за ней нет файла на диске","D":"Область отображена из файла libc.so.6","E":"Из этой области разрешено выполнять инструкции"}'::jsonb, 'AC', 'В приведённой строке показана безымянная анонимная область: файла за ней нет. Анонимную память создаёт, например, malloc для больших блоков, а у других анонимных областей могут быть служебные подписи — [heap], [stack] или [anon:имя]; это не имена файлов.', '{"A":"Права rw: чтение и запись разрешены.","B":"Это виртуальные адреса процесса; физические адреса программе не показываются.","C":"Устройство 00:00, inode 0 и нет имени файла в последней колонке.","D":"У областей из файла указаны его inode и имя.","E":"Права x нет, то есть выполнение запрещено; хранить байты машинного кода это не запрещает."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'В /proc/PID/maps файл locale-archive занимает около 232 МБ адресов, а процесс занимает в оперативной памяти всего несколько мегабайт. Как это возможно?', '{"A":"Файл сжат на диске, поэтому в памяти занимает меньше места","B":"Колонка адресов показывает объём оперативной памяти, которую занимает область","C":"Часть области постоянно находится в свопе","D":"Отображение всего файла не требует загрузки всех его страниц в оперативную память: резидентной у процесса может быть лишь небольшая часть"}'::jsonb, 'D', 'VmSize учитывает весь виртуальный диапазон, а страницы подключаются по мере необходимости и могут уже находиться в кеше страниц системы; размер отображения не равен VmRSS. Поэтому VmSize процесса может быть в десятки раз больше VmRSS.', '{"A":"Отображение файла само по себе не сжимает данные; размер виртуального диапазона учитывает округление до границы страницы.","B":"Она показывает диапазон виртуальных адресов. Занятую оперативную память показывают VmRSS в /proc/PID/status и поля в /proc/PID/smaps.","C":"Страницы только читаемого файла в своп не вытесняются: их можно просто прочитать с диска заново.","D":"Размер области в maps — это объём зарезервированных виртуальных адресов, а не занятой оперативной памяти."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Какие утверждения о библиотеке libc.so.6 в картах памяти разных процессов верны?', '{"A":"Запись в область r-xp изменяет код библиотеки для всех процессов","B":"Области libc.so.6 входят в [heap] процесса","C":"Каждый процесс получает собственную копию кода библиотеки в оперативной памяти","D":"У разных процессов одна и та же библиотека может лежать по разным виртуальным адресам","E":"Процессы, отображающие одни и те же неизменённые страницы файла libc, могут использовать общие физические страницы кеша страниц"}'::jsonb, 'DE', 'Так экономится память: процессы разделяют неизменённые физические страницы файла libc. Для приватных областей rw-p изменения изолированы копированием при записи: отдельная физическая копия страницы появляется только при записи в неё.', '{"A":"Права на запись (w) в этой области нет.","B":"Библиотеки отображаются отдельно от кучи, у них своё имя файла в последней колонке.","C":"Код только читается и выполняется, поэтому физические страницы можно разделять.","D":"При включённом ASLR адреса загрузки библиотек рандомизируются, поэтому при разных запусках они могут различаться.","E":"Неизменённые страницы одного и того же файла хранятся в кеше страниц системы и разделяются между процессами."}'::jsonb;

DO $check$
DECLARE candidate record; matches integer;
BEGIN
    FOR candidate IN SELECT * FROM question_seed LOOP
        SELECT count(*) INTO matches FROM questions q
        WHERE regexp_replace(trim(q.question_text), '[[:space:]]+', ' ', 'g') =
              regexp_replace(trim(candidate.question_text), '[[:space:]]+', ' ', 'g');
        IF matches > 1 OR (matches = 1 AND NOT EXISTS (
            SELECT 1 FROM questions q WHERE q.question_text = candidate.question_text
              AND q.category_id = candidate.category_id AND q.options = candidate.options
              AND q.correct_answer = candidate.correct_answer AND q.explanation = candidate.explanation
              AND q.option_notes = candidate.option_notes
        )) THEN
            RAISE EXCEPTION 'Конфликт содержимого или повтор нового вопроса';
        END IF;
    END LOOP;
END
$check$;

INSERT INTO questions(category_id, question_text, options, correct_answer, explanation, option_notes)
SELECT n.* FROM question_seed n
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);

DO $check$
BEGIN
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 4 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
