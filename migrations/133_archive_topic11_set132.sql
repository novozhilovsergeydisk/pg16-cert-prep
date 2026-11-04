-- Архив первых версий: 2 вопроса набора 132 (тема 11) перед миграцией 134 (проверка Codex).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопросы ищутся по прежнему тексту:
-- номера на сервере и локально различаются. После миграции 134 прежний текст вопроса про EXTERNAL уже не найдётся, проверка в конце убедится, что обе копии в архиве.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Тема 11: проверка Codex по набору 132 (миграция 134)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) = '11.'
WHERE q.question_text IN (
    'Для временной таблицы pg_relation_filepath вернула base/16384/t2_16400. Что означает префикс t2_?',
    'Для столбца s типа text выполнили SET STORAGE EXTERNAL, затем вставили строку длиной 100 символов и строку длиной 10 000 символов. Что верно?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Тема 11: проверка Codex по набору 132 (миграция 134)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Тема 11: проверка Codex по набору 132 (миграция 134)';
    IF n <> 2 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 2: прежние тексты вопросов не найдены', n;
    END IF;
END
$check$;

COMMIT;
