-- Обычная учебная тема с полным запретом экзамена, включая ручной выбор.
-- in_exam по-прежнему определяет выбор по умолчанию для остальных тем.
BEGIN;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS exam_allowed boolean NOT NULL DEFAULT true;

INSERT INTO categories(name, in_exam, exam_allowed)
SELECT '21. Основы сетей', false, false
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE left(name, 3) = '21.');

DO $check$
BEGIN
    IF (SELECT count(*) FROM categories WHERE left(name, 3) = '21.') <> 1
       OR NOT EXISTS (SELECT 1 FROM categories WHERE name = '21. Основы сетей' AND NOT in_exam AND NOT exam_allowed) THEN
        RAISE EXCEPTION 'Не найдена единственная ожидаемая учебная тема Основы сетей';
    END IF;
END
$check$;
COMMIT;
