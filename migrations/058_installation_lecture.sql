-- Восемь вопросов раздела «01. Установка и управление сервером» по сверке с лекцией: config.log, --enable-debug, ключи --with-… и ICU по умолчанию, имя суперпользователя после initdb, режимы pg_ctl, pg_createcluster с контрольными суммами, проверка контрольных сумм, репозиторий apt.postgresql.org; пояснения к каждому варианту.
-- Источник: scripts/questions/058_installation_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.gnu.org/software/autoconf/manual/autoconf.html#Making-configure-Scripts
-- https://www.postgresql.org/docs/16/install-make.html
-- https://www.postgresql.org/docs/16/install-requirements.html
-- https://www.postgresql.org/docs/16/app-initdb.html
-- https://www.postgresql.org/docs/16/app-pg-ctl.html
-- https://manpages.debian.org/bookworm/postgresql-common/pg_createcluster.1.en.html
-- https://www.postgresql.org/docs/16/app-pgchecksums.html
-- https://www.postgresql.org/docs/16/runtime-config-preset.html
-- https://www.postgresql.org/docs/16/app-pgcontroldata.html
-- https://www.postgresql.org/download/linux/ubuntu/

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Скрипт ./configure при сборке из исходных кодов завершился ошибкой. Где подробно записано, какая проверка не прошла и почему?', '{"A":"В журнале сообщений сервера","B":"В файле `config.log` в каталоге, где запускали configure","C":"В файле `Makefile`","D":"В каталоге `/var/log/postgresql`"}'::jsonb, 'B', 'configure проверяет систему, компилируя небольшие тестовые программы: есть ли компилятор, заголовочные файлы и библиотеки. На экран выводится краткий итог, а подробности каждой проверки, включая ошибки компилятора, попадают в config.log. Частая причина ошибки — не установлена нужная библиотека или её пакет для разработки.', '{"A":"Сервера ещё нет: configure только готовит сборку.","B":"Туда configure пишет свои проверки и вывод компилятора.","C":"Это инструкции для make, отчёта о проверках в нём нет.","D":"Это журналы пакетной установки Ubuntu, к сборке они не относятся."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Допишите ключ configure, чтобы программы и библиотеки собирались с отладочными символами:
```
./configure --prefix=/home/student/pgsql16 ___
```', '{"A":"`--enable-cassert`","B":"`--enable-debug`","C":"`--enable-profiling`","D":"`--with-debug`"}'::jsonb, 'B', 'Ключ заметно увеличивает размер программ. По документации с компилятором GCC его можно использовать и в рабочей установке: при сбое отладчик покажет имена функций и строки кода.', '{"A":"Включает в сервере проверки утверждений для разработчиков и замедляет его, отладочных символов не даёт.","B":"С отладочными символами программы можно разбирать под отладчиком.","C":"Собирает с профилированием, а не с отладочными символами.","D":"Такого ключа нет: configure только предупредит о незнакомом ключе."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Что при сборке PostgreSQL 16 из исходных кодов включается только явным ключом configure вида --with-…?', '{"A":"Серверный язык PL/Python","B":"Библиотека readline для psql","C":"Поддержка ICU","D":"Аутентификация Kerberos (GSSAPI)"}'::jsonb, 'AD', 'Ключи --with-… включают то, что по умолчанию не собирается: PL/Perl, PL/Python, PL/Tcl, GSSAPI, LDAP, lz4, zstd, SSL. Ключи --without-… отключают собираемое по умолчанию: ICU, readline, zlib. Для --with-… нужная библиотека должна быть установлена, иначе configure завершится ошибкой.', '{"A":"Ключ --with-python.","B":"Используется по умолчанию, отключается ключом --without-readline.","C":"С версии 16 используется по умолчанию, отключается ключом --without-icu.","D":"Ключ --with-gssapi, нужна установленная MIT Kerberos."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Пользователь ОС student выполнил initdb -k -D /home/student/pgsql16/data без ключа -U. Как называется роль-суперпользователь в созданном кластере?', '{"A":"`student`","B":"`postgres`","C":"Суперпользователь не создаётся, пока не выполнить CREATE ROLE","D":"`root`"}'::jsonb, 'A', 'Ключ -U задаёт имя начальной роли-суперпользователя, а не владельца файлов. Владельцем каталога данных становится тот, кто запустил initdb. Поэтому в демонстрации курса указано -U postgres: файлы принадлежат student, а суперпользователь называется postgres.', '{"A":"Без -U initdb берёт имя пользователя ОС, который его запустил.","B":"Так будет, если initdb запускает пользователь ОС postgres, как при установке из пакета, или указано -U postgres.","C":"initdb всегда создаёт начальную роль-суперпользователя, иначе к кластеру нельзя было бы подключиться.","D":"Такой роли не будет; кроме того, ни initdb, ни сервер нельзя запускать от root."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Что умеет утилита pg_ctl?', '{"A":"Вывести список всех кластеров на машине","B":"Перевести реплику в режим чтения и записи (`promote`)","C":"Создать новый кластер (`init`)","D":"Попросить сервер перечитать конфигурацию (`reload`)","E":"Создать базу данных в кластере"}'::jsonb, 'BCD', 'Режимы pg_ctl: init, start, stop, restart, reload, status, promote, logrotate и kill, а в Windows ещё register и unregister. Переключение на реплику разбирается в теме о репликации.', '{"A":"Это делает pg_lsclusters из пакета Debian и Ubuntu, а pg_ctl работает с одним каталогом данных.","B":"Завершает режим резервного сервера.","C":"pg_ctl init вызывает initdb.","D":"Посылает процессу postgres сигнал SIGHUP.","E":"Базу создают командой CREATE DATABASE или утилитой createdb."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Допишите команду, чтобы в Ubuntu создать кластер second с контрольными суммами страниц:
```
sudo pg_createcluster 16 second ___
```', '{"A":"`-o data_checksums=on`","B":"`--data-checksums`","C":"`-k`","D":"`-- -k`"}'::jsonb, 'D', 'pg_createcluster — надстройка Debian и Ubuntu над initdb. Сам он контрольные суммы не включает, как и initdb без -k. Ключи initdb для всех новых кластеров можно задать параметром initdb_options в /etc/postgresql-common/createcluster.conf.', '{"A":"Ключ -o записывает параметр в postgresql.conf, а включить контрольные суммы параметром конфигурации нельзя: data_checksums только показывает их состояние.","B":"Это длинное имя того же ключа initdb, и его тоже нужно писать после двух дефисов.","C":"У pg_createcluster нет такого ключа, он завершится ошибкой: ключи initdb пишут после двух дефисов.","D":"Всё после двух дефисов pg_createcluster передаёт initdb, а -k включает контрольные суммы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'Как узнать, включены ли контрольные суммы страниц в кластере?', '{"A":"Выполнить `pg_ctl status`","B":"Выполнить `SHOW data_checksums` на работающем сервере","C":"Посмотреть строку «Data page checksum version» в выводе `pg_controldata`","D":"Остановить сервер и выполнить `pg_checksums --check`"}'::jsonb, 'BCD', 'Так устроена практика к этой теме. В кластере main из пакета Ubuntu контрольные суммы выключены: их проверяют, включают командой pg_checksums --enable на остановленном сервере и проверяют снова. pg_checksums --check ещё и сверяет суммы всех страниц, поэтому на большом кластере работает долго.', '{"A":"Показывает только, запущен ли сервер, его PID и параметры запуска.","B":"Параметр только для чтения: on или off.","C":"0 — выключены, иное значение — включены.","D":"Проверка — режим по умолчанию, работает только на корректно остановленном сервере."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '01.'), 'В репозитории вашей версии Ubuntu есть PostgreSQL 14, а нужен 16. Как установить его по рекомендации postgresql.org?', '{"A":"Выполнить `apt upgrade`","B":"Собрать PostgreSQL 16 из исходных кодов","C":"Скачать пакет postgresql-16 от другой версии Ubuntu","D":"Подключить репозиторий `apt.postgresql.org` и установить пакет `postgresql-16`"}'::jsonb, 'D', 'Каждый выпуск Ubuntu фиксирует одну версию PostgreSQL на весь срок поддержки. Репозиторий apt.postgresql.org встраивается в обычное управление пакетами, и несколько основных версий можно ставить рядом, каждую в свой каталог /usr/lib/postgresql/версия.', '{"A":"Обновит только ту версию, что есть в репозитории Ubuntu, новой основной версии не даст.","B":"Можно, но тогда установка и обновления на вас; в обычном случае сборка не нужна.","C":"Пакеты собраны под свой выпуск, зависимости могут не совпасть.","D":"Репозиторий даёт все поддерживаемые версии и обновления через обычный apt."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 8 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
