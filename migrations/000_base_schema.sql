-- Базовая схема: категории и вопросы, пробная категория и первый вопрос.
-- Нужна для установки с нуля: дальнейшие миграции (002 и далее) рассчитаны на эти таблицы
-- и на пробную категорию с id 1. На уже работающей базе ничего не меняет.

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
    id   serial PRIMARY KEY,
    name varchar(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS questions (
    id             serial PRIMARY KEY,
    category_id    integer REFERENCES categories(id) ON DELETE CASCADE,
    question_text  text  NOT NULL,
    options        jsonb NOT NULL,
    correct_answer char(1) NOT NULL,
    explanation    text
);

-- Пробные данные добавляются только в пустую базу.
INSERT INTO categories (name)
SELECT 'Основы конфигурации'
WHERE NOT EXISTS (SELECT 1 FROM categories);

INSERT INTO questions (category_id, question_text, options, correct_answer, explanation)
SELECT 1,
       'Какой файл конфигурации считывается сервером PostgreSQL последним?',
       '{"A": "postgresql.conf", "B": "pg_hba.conf", "C": "postgresql.auto.conf", "D": "pg_ident.conf"}'::jsonb,
       'C',
       'Последним считывается postgresql.auto.conf, переопределяя все остальные настройки.'
WHERE NOT EXISTS (SELECT 1 FROM questions);

COMMIT;
