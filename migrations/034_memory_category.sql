-- Раздел «18. Память процесса»: устройство памяти процесса (стек, куча, виртуальная память), Linux и память PostgreSQL.
-- Вне экзамена, как раздел 17: по умолчанию не отмечен в настройках экзамена. Повторный запуск безопасен.

BEGIN;

INSERT INTO categories (name, in_exam)
SELECT '18. Память процесса', false
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE left(name, 3) = '18.');

COMMIT;
