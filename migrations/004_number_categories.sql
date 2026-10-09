-- Номер темы курса DBA1 в названии категории: сортировка по имени даёт порядок курса.
-- Повторный запуск безопасен: уже пронумерованные категории не трогаются.

BEGIN;

UPDATE categories
SET name = CASE id
        WHEN 1 THEN '03'
        WHEN 2 THEN '01'
        WHEN 3 THEN '02'
        ELSE lpad(id::text, 2, '0')
    END || '. ' || name
WHERE id BETWEEN 1 AND 16
  AND name !~ '^[0-9]{2}\. ';

COMMIT;
