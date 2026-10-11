-- Исправления отдельных пояснений тем 13–16 по замечаниям Codex.
-- Вопросы ищутся по полному тексту; заполняются только пустые option_notes, повторный запуск безопасен.

BEGIN;

UPDATE questions SET option_notes = option_notes || '{"D":"Работает только для локальных подключений; имя пользователя ОС можно сопоставить с ролью через pg_ident.conf."}'::jsonb WHERE question_text = 'Как работает метод аутентификации peer?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"D":"Дополнительный архив WAL не нужен; конфигурационные файлы вне каталога данных нужно восстановить отдельно."}'::jsonb WHERE question_text = 'Почему копия pg_basebackup с WAL называется автономной?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"A":"Сервер восстановится и станет обычным; при заданной цели восстановления действие после неё определяет recovery_target_action."}'::jsonb WHERE question_text = 'Какой сигнальный файл запускает восстановление из архива, после которого сервер работает как обычный, а не как реплика?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"A":"Так для логической репликации (при binary = true нужны ещё совместимые двоичные форматы типов)."}'::jsonb WHERE question_text = 'Какая совместимость серверов нужна для физической репликации?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"D":"Пока работает соединение, очистка на мастере не удаляет версии, нужные запросам реплики; old_snapshot_threshold это ограничение не отменяет."}'::jsonb WHERE question_text = 'Что даёт включение hot_standby_feedback?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"A":"Двоичная совместимость файлов не нужна, достаточно протокола; при binary = true нужны ещё совместимые двоичные форматы типов."}'::jsonb WHERE question_text = 'Какая совместимость серверов нужна для логической репликации?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"D":"У строк пользовательских таблиц нет автоматического oid."}'::jsonb WHERE question_text = 'Как по умолчанию идентифицируется строка при репликации UPDATE и DELETE?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"C":"Сервер копит журнал и удерживает версии строк системного каталога, нужные для декодирования."}'::jsonb WHERE question_text = 'Чем опасен неактивный слот логической репликации?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"C":"Совместимость файлов кластера не нужна; при binary = true нужны совместимые двоичные форматы типов."}'::jsonb WHERE question_text = 'Чем логическая репликация отличается от физической?' AND option_notes IS NOT NULL;
UPDATE questions SET option_notes = option_notes || '{"B":"Идентификация по первичному ключу, если он есть; без него старая строка не идентифицируется."}'::jsonb WHERE question_text = 'Допишите команду, чтобы строки таблицы идентифицировались по всем столбцам:
```
ALTER TABLE accounts REPLICA IDENTITY ___;
```' AND option_notes IS NOT NULL;

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM questions WHERE option_notes IS NULL AND category_id IN (SELECT id FROM categories WHERE left(name, 3) IN ('13.', '14.', '15.', '16.'));
    IF n > 0 THEN
        RAISE EXCEPTION 'В темах 13–16 остались вопросы без пояснений к вариантам: %', n;
    END IF;
END
$check$;

COMMIT;
