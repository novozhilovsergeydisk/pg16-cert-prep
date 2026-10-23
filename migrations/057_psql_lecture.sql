-- Тринадцать вопросов раздела «02. Утилита psql» по сверке с лекцией: роль по умолчанию, сокет и TCP, \c, справка, приглашение, \g, \if, обратные апострофы, системный psqlrc, -f и стандартный ввод, \set, \gset, format с %I; пояснения к каждому варианту.
-- Источник: scripts/questions/057_psql_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/libpq-envars.html
-- https://www.postgresql.org/docs/16/libpq-connect.html#LIBPQ-CONNECT-HOST
-- https://www.postgresql.org/docs/16/auth-pg-hba-conf.html
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-META-COMMAND-CONNECT
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-PROMPTING
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-META-COMMAND-G
-- https://www.postgresql.org/docs/16/app-psql.html#PSQL-METACOMMAND-IF
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-INTERPOLATION
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-FILES-PSQLRC
-- https://www.postgresql.org/docs/16/app-pgconfig.html
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-META-COMMAND-SET
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-META-COMMAND-GSET
-- https://www.postgresql.org/docs/16/functions-string.html#FUNCTIONS-STRING-FORMAT

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'psql запущен без ключа -U, переменная окружения PGUSER не задана. От имени какой роли он подключится?', '{"A":"Роли postgres","B":"Роли с именем базы данных, указанной ключом -d","C":"Роли с тем же именем, что у пользователя операционной системы, запустившего psql","D":"Роли public"}'::jsonb, 'C', 'Без -U и PGUSER psql берёт имя роли из операционной системы, а без -d и PGDATABASE — имя базы из имени роли. Поэтому у пользователя ОС student команда psql без ключей подключается к базе student от имени роли student.', '{"A":"postgres — обычное имя суперпользователя, но psql подставит его, только если так зовут пользователя ОС.","B":"Наоборот: если не указана база, её имя берётся из имени роли.","C":"Если такой роли в кластере нет, подключение завершится ошибкой «роль не существует».","D":"public — псевдороль, означающая всех; подключиться от её имени нельзя."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Переменная PGHOST не задана. Чем подключение psql -h localhost отличается от подключения без ключа -h на том же компьютере с Linux?', '{"A":"С -h localhost номер порта не используется","B":"Без -h psql подключается по TCP к адресу 127.0.0.1","C":"С -h localhost подключение идёт по TCP через петлевой интерфейс, без -h — через Unix-сокет","D":"Ничем: localhost — это и есть Unix-сокет"}'::jsonb, 'C', 'От способа подключения зависит, какая строка pg_hba.conf сработает: для сокета — строки local, для TCP — строки host. Если значение -h начинается с косой черты, это каталог сокета, а не имя компьютера. Если PGHOST задана, psql без -h берёт компьютер или каталог сокета из неё.', '{"A":"По TCP порт нужен всегда; у сокета номер порта входит в имя файла, например .s.PGSQL.5432.","B":"Без -h и PGHOST psql в Linux выбирает Unix-сокет в каталоге по умолчанию.","C":"Это видно в выводе \\conninfo: «через сокет в …» или «компьютер localhost, адрес …».","D":"localhost — сетевое имя петлевого интерфейса, подключение к нему идёт по TCP."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Допишите метакоманду, чтобы переподключиться к той же базе данных, но от имени роли postgres:
```
\c ___ postgres
```', '{"A":"`current`","B":"`.`","C":"`*`","D":"`-`"}'::jsonb, 'D', '\c без аргументов открывает новый сеанс с теми же параметрами: той же базой и ролью. Минус можно ставить и на месте других аргументов: \c - - localhost подключит к той же базе той же ролью, но по TCP.', '{"A":"Это было бы имя базы current.","B":"Точку psql не понимает как текущую базу: это было бы имя базы из одного символа.","C":"Звёздочка не обозначает текущую базу.","D":"Минус означает «оставить прежнее значение» — здесь имя текущей базы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что верно о справке в psql?', '{"A":"psql --help — ключи запуска psql из командной строки","B":"\\? variables — специальные переменные psql","C":"\\? — синтаксис команд SQL","D":"\\h — справка по метакомандам psql","E":"\\? — список метакоманд psql"}'::jsonb, 'ABE', 'Подробное описание — man psql и документация. Запоминать все команды не нужно: достаточно знать, где искать справку.', '{"A":"Ту же справку внутри psql выводит \\? options.","B":"Например, AUTOCOMMIT, ON_ERROR_ROLLBACK, PROMPT1.","C":"Синтаксис команд SQL показывает \\h.","D":"\\h показывает синтаксис команд SQL, например \\h SELECT.","E":"Метакоманды начинаются с обратной косой черты и выполняются самим psql, а не сервером."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что можно понять по стандартному приглашению psql?', '{"A":"Знак > в конце означает, что транзакция прервана ошибкой","B":"Звёздочка после знака равенства означает подключение по сети","C":"Звёздочка после знака равенства, например student=*>, — открыт блок транзакции","D":"# в конце приглашения — подключение под суперпользователем, > — под обычной ролью","E":"Минус вместо знака равенства, например student->, — запрос не закончен и продолжается на следующей строке"}'::jsonb, 'CDE', 'Внутри незакрытой строки в апострофах вместо знака равенства будет апостроф: student''>. Вид приглашения настраивается переменными PROMPT1 и PROMPT2.', '{"A":"Прерванную транзакцию обозначает восклицательный знак: student=!>.","B":"Способ подключения в стандартном приглашении не виден; его показывает \\conninfo.","C":"После COMMIT или ROLLBACK звёздочка пропадает.","D":"Например, postgres=# и student=>.","E":"Приглашение для второй и следующих строк задаёт переменная PROMPT2."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что верно о метакоманде \g в psql?', '{"A":"SELECT ... \\g | cat -n передаёт вывод запроса команде ОС через конвейер","B":"\\g выполняет каждое значение результата как команду SQL","C":"\\g (format=unaligned) меняет формат вывода для всех следующих запросов","D":"SELECT ... \\g (format=unaligned tuples_only=on) файл задаёт формат вывода только для этого запроса","E":"SELECT ... \\g файл записывает вывод этого запроса в файл"}'::jsonb, 'ADE', 'Такие приёмы удобны в скриптах: результат можно сразу передать программе ОС или сохранить в файл без заголовков и выравнивания.', '{"A":"Команда ОС получает вывод на стандартный ввод.","B":"Это делает \\gexec.","C":"Параметры в скобках действуют только для одного запроса; на весь сеанс формат меняет \\pset.","D":"Следующие запросы выводятся в прежнем формате.","E":"В отличие от \\o, перенаправление действует только для этого запроса."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Допишите метакоманду, которая завершает блок условного выполнения в скрипте psql:
```
\if :{?wd}
\echo ''переменная wd задана''
\else
\echo ''переменная wd не задана''
___
```', '{"A":"`\\endif`","B":"`\\end`","C":"`END IF;`","D":"`\\fi`"}'::jsonb, 'A', 'Условие вычисляет сам psql, а не сервер: значение должно быть логическим — true, false, on, off, 1, 0 и подобные. Так в скриптах проверяют, например, задана ли переменная: :{?имя} даёт TRUE или FALSE.', '{"A":"Блок \\if может содержать \\elif и \\else и обязательно закрывается \\endif.","B":"Такой метакоманды в psql нет.","C":"Это конструкция языка PL/pgSQL, а не метакоманда psql.","D":"Так завершается условие в оболочке bash; в psql такой метакоманды нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что сделает эта команда psql?
```
\set wd `pwd`
```', '{"A":"Задаст переменную окружения ОС wd","B":"Запишет в переменную psql wd вывод команды ОС pwd — путь к текущему каталогу","C":"Выполнит на сервере функцию pwd","D":"Запишет в переменную wd строку pwd"}'::jsonb, 'B', 'Вывод команды подставляется без завершающего перевода строки. Так в скриптах получают, например, текущий каталог или дату из ОС.', '{"A":"Переменную окружения задаёт \\setenv; \\set создаёт переменную psql.","B":"Текст в обратных апострофах psql выполняет как команду оболочки и подставляет её вывод.","C":"Команду в обратных апострофах выполняет оболочка на компьютере, где запущен psql, а не сервер.","D":"Строку без подстановки дали бы обычные апострофы: \\set wd ''pwd''."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Как узнать штатный каталог, в котором psql ищет общесистемный файл настройки psqlrc?', '{"A":"Выполнить SHOW data_directory;","B":"Выполнить \\conninfo","C":"Выполнить pg_config --sysconfdir","D":"Выполнить SHOW config_file;"}'::jsonb, 'C', 'При запуске psql выполняет сначала общесистемный psqlrc, затем личный ~/.psqlrc. Каталог общесистемного файла можно переопределить переменной окружения PGSYSCONFDIR. Ключ -X отключает оба файла. В них обычно задают приглашение, \timing и переменные-сокращения для частых запросов.', '{"A":"psqlrc не хранится в каталоге данных сервера.","B":"Метакоманда показывает параметры подключения, а не каталоги psql.","C":"Нужен pg_config от той же установки PostgreSQL, что и psql. Например, в Debian и Ubuntu это /etc/postgresql-common.","D":"Это путь к postgresql.conf сервера, а psqlrc — файл клиента psql."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Чем запуск скрипта командой psql -f script.sql отличается от psql < script.sql?', '{"A":"С -f в сообщениях об ошибках psql указывает имя файла и номер строки","B":"Через стандартный ввод нельзя выполнять метакоманды psql","C":"Через стандартный ввод psql не останавливается на ошибках, а с -f останавливается","D":"С -f все команды скрипта выполняются в одной транзакции"}'::jsonb, 'A', 'Документация советует -f: результат тот же, но ошибки в скрипте легче найти.', '{"A":"Например: psql:script.sql:2: ОШИБКА: …","B":"Метакоманды из стандартного ввода тоже выполняются.","C":"Поведение при ошибках одинаково и задаётся переменной ON_ERROR_STOP.","D":"Одной транзакцией скрипт выполняется с ключом -1 (--single-transaction)."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Допишите метакоманду, чтобы вывести все переменные psql и их значения:
```
\___
```', '{"A":"`pset`","B":"`dconfig`","C":"`echo`","D":"`set`"}'::jsonb, 'D', 'Значение одной переменной выводит \echo :имя.', '{"A":"\\pset без аргументов показывает параметры форматирования вывода.","B":"\\dconfig показывает параметры сервера, а не переменные psql.","C":"\\echo выводит переданный текст, а не список переменных.","D":"\\set без аргументов выводит все переменные, включая служебные, например AUTOCOMMIT и PROMPT1."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'В psql переменная v содержит строку «старое». Затем выполнен запрос SELECT g AS v FROM generate_series(1, 3) g \gset. Что произойдёт?', '{"A":"Будут созданы переменные v1, v2 и v3","B":"psql сообщит, что запрос вернул больше одной строки, и v сохранит прежнее значение","C":"В v запишется значение из последней строки","D":"В v запишется значение из первой строки"}'::jsonb, 'B', 'Если запрос не вернул ни одной строки, \gset тоже сообщит об ошибке и переменные не изменит. Если в строке результата NULL, соответствующая переменная удаляется.', '{"A":"\\gset не нумерует строки: имена переменных берутся из имён столбцов.","B":"\\gset требует ровно одну строку результата.","C":"При нескольких строках psql ничего не записывает и сообщает об ошибке.","D":"При нескольких строках psql ничего не записывает и сообщает об ошибке."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что подставляет спецификатор %I в функции format?', '{"A":"Номер позиции аргумента","B":"Значение как имя объекта: при необходимости заключает его в двойные кавычки","C":"Значение как есть, без кавычек","D":"Значение как строковую константу в апострофах"}'::jsonb, 'B', 'Подстановка через %I и %L защищает от внедрения SQL-кода. Вместе с \gexec функция format удобна, чтобы сгенерировать и сразу выполнить команды для многих таблиц.', '{"A":"Номер аргумента задают иначе, например %1$I.","B":"format(''SELECT count(*) FROM %I'', ''my table'') даст SELECT count(*) FROM \"my table\".","C":"Так подставляет %s.","D":"Это делает %L."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 13 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
