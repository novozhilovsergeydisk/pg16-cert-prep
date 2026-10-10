-- Раздел «17. Собеседование DBA»: вопросы с собеседований на должность DBA, в том числе за пределами курса DBA1.
-- Признак in_exam: темы с false по умолчанию не отмечены в настройках экзамена и не попадают
-- в экзамен без явного выбора тем. Повторный запуск безопасен.

BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS in_exam boolean NOT NULL DEFAULT true;

INSERT INTO categories (name, in_exam)
SELECT '17. Собеседование DBA', false
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE left(name, 3) = '17.');

COMMIT;
