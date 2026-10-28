-- Тема 01: правки по отчёту Codex (23 исправлений в 11 вопросах), ключи не меняются.
-- Источник: scripts/questions/101_codex_topic01_fixes.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('question', 'Где в пакете Ubuntu находится каталог данных кластера main версии 16?', NULL, NULL, NULL, 'Где по умолчанию в пакете Ubuntu находится каталог данных кластера main версии 16?'),
        ('question', 'Включены ли контрольные суммы страниц в кластере, созданном пакетом Ubuntu?', NULL, NULL, NULL, 'Включены ли контрольные суммы страниц в кластере, который пакет Ubuntu создал со стандартными настройками?'),
        ('option', 'Для чего нужна библиотека readline?', 'Для сжатия данных в таблицах и WAL', NULL, 'Для сжатия служат zlib, lz4 и zstd.', 'Readline к сжатию не относится: в TOAST сжимают pglz и lz4, а образы страниц в WAL — pglz, lz4 и zstd.'),
        ('option', 'Для чего нужна библиотека readline?', 'Для редактирования команд и истории в psql', 'Для редактирования команд и их истории', NULL, NULL),
        ('option', 'Сервер собран командами make и make install. Как собрать и установить расширения из contrib?', 'Выполнить initdb с ключом --contrib', 'Повторить make install в корне дерева', 'Такого ключа нет: initdb создаёт кластер и ничего не собирает.', 'Из корня устанавливается то, что собрал обычный make, а модулей contrib среди этого нет.'),
        ('option', 'Сервер собран командами make и make install. Как собрать и установить расширения из contrib?', 'Выполнить CREATE EXTENSION до сборки', 'Выполнить CREATE EXTENSION hstore', 'CREATE EXTENSION работает только с уже собранным и установленным расширением.', 'Команда подключает к базе уже установленное расширение, а файлы hstore ещё не собраны и не установлены.'),
        ('option', 'Где по умолчанию в пакете Ubuntu находится каталог данных кластера main версии 16?', '`/etc/postgresql/16/main/conf.d`', NULL, 'Здесь лежат файлы конфигурации кластера.', 'Это каталог дополнительных файлов .conf, подключаемых из postgresql.conf; основные файлы конфигурации лежат уровнем выше.'),
        ('explanation', 'Где по умолчанию в пакете Ubuntu находится каталог данных кластера main версии 16?', NULL, NULL, 'В пакете Ubuntu данные кластера лежат в /var/lib/postgresql/<версия>/<имя>, конфигурация — в /etc/postgresql/<версия>/<имя>, программы — в /usr/lib/postgresql/<версия>.', 'В пакете Ubuntu данные кластера лежат в /var/lib/postgresql/<версия>/<имя>, конфигурация — в /etc/postgresql/<версия>/<имя>, программы — в /usr/lib/postgresql/<версия>/bin.'),
        ('option', 'Чем make world отличается от make при сборке из исходных кодов?', 'Собирает также расширения и всю документацию', 'Собирает также contrib и документацию', 'Кроме сервера собираются дополнительные модули (contrib) и документация.', 'Кроме сервера собираются дополнительные модули (contrib) и документация в форматах HTML и man.'),
        ('option', 'Включены ли контрольные суммы страниц в кластере, который пакет Ubuntu создал со стандартными настройками?', 'Нет, они выключены по умолчанию', 'Нет, при создании они выключены', 'По умолчанию пакет создаёт кластер без контрольных сумм.', 'Со стандартными настройками пакет создаёт кластер без контрольных сумм.'),
        ('option', 'Включены ли контрольные суммы страниц в кластере, который пакет Ubuntu создал со стандартными настройками?', 'Да, включены при создании кластера', 'Да, при создании они включены', NULL, NULL),
        ('option', 'Скрипт ./configure при сборке из исходных кодов завершился ошибкой. Где подробно записано, какая проверка не прошла и почему?', 'В файле `config.log` рядом с configure', 'В файле `config.log` в каталоге сборки', 'Туда configure пишет свои проверки и вывод компилятора; файл лежит в каталоге, где запускали configure.', 'Туда configure пишет свои проверки и вывод компилятора; файл появляется в каталоге, где запускали configure.'),
        ('option', 'Скрипт ./configure при сборке из исходных кодов завершился ошибкой. Где подробно записано, какая проверка не прошла и почему?', 'В каталоге `/var/log/postgresql` пакета', NULL, 'Это журналы пакетной установки Ubuntu, к сборке они не относятся.', 'Сюда пишет журнал сервер из пакета Ubuntu, к сборке это не относится.'),
        ('option', 'Что такое кластер баз данных в PostgreSQL?', 'Набор баз данных одного экземпляра сервера', 'Базы данных одного экземпляра сервера', NULL, NULL),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', 'Утилита `pg_ctlcluster` для кластера', 'Утилита `pg_ctlcluster` для управления сервером', NULL, NULL),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', 'Утилита `pg_createcluster` для кластера', 'Утилита `pg_createcluster` для создания кластера', NULL, NULL),
        ('option', 'Что при сборке PostgreSQL 16 из исходных кодов включается только явным ключом configure вида --with-…?', 'Серверный язык PL/Python', 'Поддержка языка PL/Python', NULL, NULL),
        ('option', 'Что при сборке PostgreSQL 16 из исходных кодов включается только явным ключом configure вида --with-…?', 'Библиотека readline для работы psql', 'Поддержка библиотеки readline', NULL, NULL),
        ('option', 'Что при сборке PostgreSQL 16 из исходных кодов включается только явным ключом configure вида --with-…?', 'Поддержка ICU для правил сортировки', 'Поддержка библиотеки ICU', NULL, NULL),
        ('option', 'Что при сборке PostgreSQL 16 из исходных кодов включается только явным ключом configure вида --with-…?', 'Аутентификация Kerberos (GSSAPI)', 'Поддержка Kerberos (GSSAPI)', NULL, NULL),
        ('option', 'Как узнать, включены ли контрольные суммы страниц в кластере?', 'Строка «Data page checksum version» в `pg_controldata`', 'Найти версию контрольных сумм в выводе `pg_controldata`', '0 — выключены, иное значение — включены.', 'Строка «Data page checksum version»: 0 — выключены, иное значение — включены.'),
        ('option', 'В репозитории вашей версии Ubuntu есть PostgreSQL 14, а нужен 16. Как установить его по рекомендации postgresql.org?', 'Собрать PostgreSQL 16 из исходных кодов вручную', 'Собрать PostgreSQL 16 из исходных кодов', NULL, NULL),
        ('option', 'В репозитории вашей версии Ubuntu есть PostgreSQL 14, а нужен 16. Как установить его по рекомендации postgresql.org?', 'Скачать пакет postgresql-16 от другой версии Ubuntu вручную', 'Скачать пакет postgresql-16 от другой версии Ubuntu', NULL, NULL)
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
