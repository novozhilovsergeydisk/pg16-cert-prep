-- Цвет кнопок и ссылок, выбранный пользователем: синий (по умолчанию), бежевый, зелёный или графитовый.
-- Значения согласованы со стилями public/css/style.css ([data-accent]) и проверкой в src/controllers/authController.js.
-- Повторный запуск безопасен: столбец и ограничение добавляются, только если их ещё нет.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS accent text NOT NULL DEFAULT 'blue';

DO $accent$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_accent_check' AND conrelid = 'users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT users_accent_check CHECK (accent IN ('blue', 'beige', 'green', 'graphite'));
    END IF;
END
$accent$;

COMMIT;
