-- Несколько правильных ответов: correct_answer хранит буквы вариантов без повторов по алфавиту ('C', 'AC').
-- Существующие вопросы с одной буквой не меняются. Повторный запуск безопасен.

BEGIN;

ALTER TABLE questions
    ALTER COLUMN correct_answer TYPE varchar(8) USING trim(correct_answer);

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_correct_answer_check;

-- Формат: непустой набор букв A–H по алфавиту без повторов; каждая буква есть среди ключей options.
ALTER TABLE questions ADD CONSTRAINT questions_correct_answer_check CHECK (
    correct_answer <> ''
    AND correct_answer ~ '^A?B?C?D?E?F?G?H?$'
    AND options ?& regexp_split_to_array(correct_answer, '')
);

COMMIT;
