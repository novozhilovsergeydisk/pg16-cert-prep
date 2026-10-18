-- Шесть вопросов о каталоге /proc в разделе «18. Память процесса» с пояснениями к каждому варианту.
-- Источник: scripts/questions/042_proc_basics.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://man7.org/linux/man-pages/man5/proc.5.html
-- https://man7.org/linux/man-pages/man1/bash.1.html
-- https://man7.org/linux/man-pages/man5/proc_pid_limits.5.html
-- https://man7.org/linux/man-pages/man5/proc_meminfo.5.html
-- https://man7.org/linux/man-pages/man1/free.1.html
-- https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html
-- https://man7.org/linux/man-pages/man5/proc_pid_cmdline.5.html
-- https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что такое каталог /proc в Linux?', '{"A":"Каталог на диске, куда ядро сохраняет журналы процессов","B":"Псевдофайловая система ядра: через неё ядро показывает состояние процессов и системы в виде файлов, которые создаются при обращении","C":"Временный каталог для файлов процессов, который очищается при перезагрузке","D":"Каталог с исполняемыми файлами системных программ"}'::jsonb, 'B', 'Поэтому у многих файлов /proc команда ls показывает размер 0, хотя при чтении данные есть: размер и дата из ls не говорят ни об объёме, ни о свежести этих данных. Команда: ls -la /proc/$$ | head.', '{"A":"Журналы хранятся в /var/log и в журнале systemd; /proc на диске не лежит.","B":"На диске /proc ничего не хранит: содержимое формирует ядро в момент чтения.","C":"Это /tmp или /run; /proc вообще не хранит данные на диске.","D":"Это /usr/bin и /usr/sbin."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'В оболочке bash набрали /proc/self и /proc/$$. Что верно для этих имён?', '{"A":"/proc/self указывает на процесс init с номером 1","B":"Оба имени всегда указывают на один и тот же процесс","C":"/proc/self указывает на процесс, который сейчас обращается к /proc, например на сам ls","D":"$$ — номер процесса текущей оболочки, поэтому /proc/$$ — её каталог"}'::jsonb, 'CD', 'Удобно для опытов: /proc/$$ — постоянный каталог вашей оболочки, /proc/self — каталог той команды, которую вы запускаете. Команды: readlink /proc/self и echo $$.', '{"A":"/proc/1 — каталог init; self указывает на читающий процесс.","B":"Команда, например ls, — отдельный процесс, а оболочка — другой: номера различаются.","C":"При каждом запуске команды номер свой.","D":"Переменную $$ подставляет оболочка до запуска команды."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Какой файл каталога /proc/PID показывает лимиты процесса, например размер стека и число открытых файлов?', '{"A":"`maps`","B":"`status`","C":"`limits`","D":"`stat`"}'::jsonb, 'C', 'Лимиты для оболочки задаёт ulimit, для служб systemd — параметры вроде LimitSTACK и LimitNOFILE. Команда: grep -E "stack|open files" /proc/PID/limits.', '{"A":"Это карта виртуальной памяти процесса.","B":"Здесь состояние и отдельные счётчики процесса; лимиты размера стека и числа открытых файлов смотрят в limits.","C":"Для каждого лимита два значения: мягкий (действующее ограничение) и жёсткий (потолок, до которого процесс может поднять мягкий без особых прав).","D":"Это компактная статистика процесса для программ."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Какое поле /proc/meminfo показывает, сколько памяти можно выделить новым программам без вытеснения в своп?', '{"A":"`SwapFree`","B":"`MemFree`","C":"`MemTotal`","D":"`MemAvailable`"}'::jsonb, 'D', 'Тот же показатель выводит столбец available команды free -m. Команда: grep -E "MemTotal|MemAvailable|SwapFree" /proc/meminfo.', '{"A":"Это свободное место в свопе на диске, а не оперативная память.","B":"Это совсем незанятая память; часть кеша тоже можно освободить, поэтому доступно больше.","C":"Это вся оперативная память системы.","D":"Оценка ядра с учётом кеша, который можно освободить."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что верно для файлов environ и cmdline в каталоге /proc/PID?', '{"A":"В обоих файлах могут оказаться пароли и токены, поэтому их содержимое не стоит показывать посторонним","B":"environ всегда показывает текущее окружение, включая изменения через setenv","C":"environ обычно показывает исходную область окружения процесса, а доступ к нему ограничен: как правило, читать его может только владелец процесса и root","D":"В cmdline аргументы разделены пробелами"}'::jsonb, 'AC', 'Поэтому пароль для подключения лучше хранить в файле ~/.pgpass с правами 0600, а не в переменной PGPASSWORD. Посмотреть права файлов: ls -l /proc/$$/environ /proc/$$/cmdline.', '{"A":"Пароль может быть в переменной окружения или в аргументе командной строки.","B":"Он показывает исходную область окружения; изменения через setenv попадают в другую память и там не видны. Программа может и перезаписать исходную область, как это делает PostgreSQL для заголовка процесса.","C":"Права этого файла закрыты от других пользователей, а ядро дополнительно проверяет право доступа к процессу.","D":"Аргументы разделены нулевыми байтами, а не пробелами."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что находится в каталоге /proc/PID/fd?', '{"A":"Список файлов, которые процесс может открыть по своим правам","B":"Копии всех файлов, которые процесс открыл","C":"Все файлы, которые процесс создал за время работы","D":"Символьные ссылки с номерами открытых процессом файловых дескрипторов: каждая указывает на файл, сокет или канал"}'::jsonb, 'D', 'Число записей помогает оценить, сколько дескрипторов занято. Мягкий лимит Max open files в /proc/PID/limits ограничивает номер нового дескриптора: он должен быть меньше лимита. Если свободного номера нет, открыть файл или создать подключение не удаётся (ошибка Too many open files). Команды: ls -l /proc/$$/fd — куда ведут ссылки, ls /proc/$$/fd | wc -l — сколько их.', '{"A":"Каталог показывает только уже открытые файлы.","B":"Копий там нет: только ссылки, которые формирует ядро.","C":"Закрытые файлы в fd не видны, даже если процесс их создал.","D":"Номера 0, 1 и 2 — стандартный ввод, вывод и вывод ошибок."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 6 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
