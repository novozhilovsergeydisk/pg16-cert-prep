-- Второй круг Codex по темам 05–16: 9 вопросов (11 исправлений), в том числе исправление 885 и 1106, ключи не меняются.
-- Источник: scripts/questions/121_second_round_topics05_16.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('question', 'В таблице одна строка. Транзакция A на уровне Read Committed прочитала её. Транзакция B удалила строку и зафиксировала изменение. Каков результат повторного запроса A?', NULL, NULL, NULL, 'В t одна зафиксированная строка. A на Read Committed выполняет SELECT * FROM t. Затем B удаляет строку и делает COMMIT; других изменений нет. Что вернёт повторный SELECT * FROM t в A?'),
        ('question', 'Какие последствия возможны при регулярных изменениях данных, если отключить обычную автоочистку и не выполнять VACUUM и ANALYZE вручную?', NULL, NULL, NULL, 'К чему могут привести регулярные изменения данных, если отключить обычную автоочистку и не выполнять VACUUM и ANALYZE вручную?'),
        ('question', 'Сервер собран с поддержкой lz4. Допишите имя параметра, чтобы задать lz4 методом сжатия TOAST по умолчанию в сеансе:
```
SET default_toast_compression = ___;
```', NULL, NULL, NULL, 'Сервер собран с поддержкой lz4. Допишите имя параметра, чтобы задать lz4 методом сжатия TOAST по умолчанию в сеансе:
```
SET ___ = ''lz4'';
```'),
        ('question', 'Допишите одну и ту же подстановку в оба пропуска, чтобы копировать сегмент под его именем, отказываясь перезаписывать существующий файл:
```
archive_command = ''test ! -f /mnt/archive/___ && cp %p /mnt/archive/___''
```
```
archive_command = ''cp %p /mnt/archive/___''
```', NULL, NULL, NULL, 'Допишите одну и ту же подстановку в оба пропуска, чтобы копировать сегмент под его именем, отказываясь перезаписывать существующий файл:
```
archive_command = ''test ! -f /mnt/archive/___ && cp %p /mnt/archive/___''
```'),
        ('option', 'Что разрешает привилегия USAGE на схему?', 'Находить объекты схемы по имени', 'Разрешать имена объектов схемы в SQL', 'USAGE разрешает поиск объектов в схеме; права на операции с ними выдаются отдельно.', 'USAGE разрешает поиск объекта в схеме при SQL-обращении к нему; права на операции выдаются отдельно. Читать имена объектов в системном каталоге можно и без USAGE на их схему.'),
        ('option', 'Что верно для блокировок в PostgreSQL?', 'Обычный SELECT не мешает другим читать и изменять строки', 'ACCESS SHARE от SELECT совместима с ROW EXCLUSIVE', 'Обычный SELECT без FOR UPDATE и FOR SHARE получает блокировку ACCESS SHARE: она совместима с обычными изменениями строк, но конфликтует с ACCESS EXCLUSIVE, например у DROP TABLE.', 'Сами режимы совместимы: обычный SELECT получает ACCESS SHARE, а она совместима с обычными изменениями строк. Но ACCESS SHARE может задержать чужой ACCESS EXCLUSIVE, например у DROP TABLE, а новые запросы могут ждать за ним в очереди.'),
        ('option', 'Что верно для блокировок в PostgreSQL?', 'COMMIT и полный ROLLBACK освобождают обычные блокировки', NULL, 'Обычные блокировки строк и таблиц держатся до конца транзакции или до отката к более ранней точке сохранения; рекомендательные блокировки сеанса — до конца сеанса.', 'Обычные блокировки строк и таблиц освобождаются при завершении транзакции или откате к соответствующей точке сохранения. Сеансовые advisory-блокировки освобождают явно либо при завершении сеанса.'),
        ('explanation', 'Как PostgreSQL хранит файлы обычных таблиц и их индексов в одном табличном пространстве?', NULL, NULL, 'У обычной таблицы и каждого её индекса отдельные файлы слоёв и сегментов по 1 ГБ; представления и родительские секционированные таблицы собственного хранилища не имеют.', 'У обычной таблицы и каждого её индекса собственные файлы слоёв и сегментов. Предельный размер сегмента в стандартной сборке — 1 ГБ; он задаётся при сборке через --with-segsize. Представления и родительские секционированные таблицы собственного хранилища не имеют.'),
        ('option', 'Какое ограничение есть у анализатора журналов pgBadger?', 'Для анализа подходит журнал на любом языке', 'Для анализа требуется журнал в формате csvlog', 'Разбор опирается на текст сообщений, поэтому произвольная локаль не поддерживается.', 'Поддерживаются и текстовые журналы stderr, и другие форматы; csvlog не обязателен.'),
        ('option', 'Какое ограничение есть у анализатора журналов pgBadger?', 'Для разбора нужен журнал на английском', 'Для разбора нужны сообщения на английском', 'Нужны английские сообщения журнала; формат и состав журнала также настраивают для pgBadger.', 'Английскими должны быть сообщения PostgreSQL; имена объектов и строковые значения запросов могут содержать другие языки.'),
        ('option', 'При двунаправленной логической репликации оба узла вставляют строки с ключами из локальных последовательностей. Как уменьшить риск конфликтов первичного ключа?', 'Задать одинаковый START у обеих последовательностей', NULL, 'Одинаковый START даёт обеим последовательностям одни и те же значения: потоки генерации не разделяются, и совпадения неизбежны.', 'Одинаковый START сам по себе не разделяет генераторы. ALTER SEQUENCE START меняет начальное значение для будущего RESTART, а не текущий счётчик; неизбежность коллизий из одного START не следует.')
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
