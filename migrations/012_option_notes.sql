-- Пояснения к вариантам ответа: что делает вариант или почему он не подходит.
-- Ключи совпадают с ключами options (A, B, C, D). Пустое значение — пояснений пока нет.
-- Повторный запуск безопасен.

BEGIN;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS option_notes jsonb;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_option_notes_check;
ALTER TABLE questions ADD CONSTRAINT questions_option_notes_check
    CHECK (option_notes IS NULL OR jsonb_typeof(option_notes) = 'object');

COMMIT;
