-- Светлая или тёмная тема, выбранная пользователем: как в системе (по умолчанию), светлая или тёмная.
-- Значения согласованы со стилями public/css/style.css ([data-theme]) и проверкой в src/controllers/authController.js.
-- Повторный запуск безопасен: столбец и ограничение добавляются, только если их ещё нет.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'auto';

DO $theme$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_theme_check' AND conrelid = 'users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT users_theme_check CHECK (theme IN ('auto', 'light', 'dark'));
    END IF;
END
$theme$;

COMMIT;
