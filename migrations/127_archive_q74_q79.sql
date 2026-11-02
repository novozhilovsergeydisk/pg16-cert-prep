-- Архив прежних версий: 2 вопроса темы 08 перед миграцией 128 (уточнены пояснения к вариантам по сверке с лекцией).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопросы ищутся по тексту:
-- номера на сервере и локально различаются. Тексты вопросов миграция 128 не меняет, проверка в конце убедится, что в архиве обе копии.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Тема 08: пояснения к вариантам по сверке с лекцией (миграция 128)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) = '08.'
WHERE q.question_text IN (
    'Для чего нужен шаблон template0?',
    'Какая функция показывает реальный путь поиска вместе с неявными схемами?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Тема 08: пояснения к вариантам по сверке с лекцией (миграция 128)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Тема 08: пояснения к вариантам по сверке с лекцией (миграция 128)';
    IF n <> 2 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 2: вопросы не найдены', n;
    END IF;
END
$check$;

COMMIT;
