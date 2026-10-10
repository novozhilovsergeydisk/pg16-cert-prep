-- Код из письма: вместе со ссылкой для входа приходит 6-значный код.
-- Код и ссылка подтверждают один и тот же запрос: войти можно одним из способов, один раз.
-- Хранится только SHA-256 кода; после 5 неверных попыток запрос перестаёт действовать.
-- Повторный запуск безопасен.

BEGIN;

ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS code_hash bytea;
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMIT;
