-- Раздел «20. Планировщик и EXPLAIN»: путь запроса, чтение плана, статистика, способы доступа, соединения, сортировка.
-- Вне экзамена, как разделы 17–19: по умолчанию не отмечен в настройках экзамена. Повторный запуск безопасен.

BEGIN;

INSERT INTO categories (name, in_exam)
SELECT '20. Планировщик и EXPLAIN', false
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE left(name, 3) = '20.');

COMMIT;
