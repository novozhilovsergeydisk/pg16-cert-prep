-- Архив прежней версии вопроса 2241 темы 05 перед миграцией 123 (уточнение формулировки).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопрос ищется по прежнему тексту:
-- номера на сервере и локально различаются. После миграции 123 прежнего текста уже нет, проверка в конце убедится, что копия в архиве есть.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Тема 05: уточнена формулировка вопроса 2241 (миграция 123)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) = '05.'
WHERE q.question_text = 'В исходно пустую таблицу t вставляли строки с четырьмя разными id. Каждый вариант описывает историю одной такой строки. Все указанные транзакции завершились до начала SELECT * FROM t на Read Committed. Какие из этих строк вернёт запрос?'
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Тема 05: уточнена формулировка вопроса 2241 (миграция 123)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Тема 05: уточнена формулировка вопроса 2241 (миграция 123)';
    IF n <> 1 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 1: прежний текст вопроса не найден', n;
    END IF;
END
$check$;

COMMIT;
