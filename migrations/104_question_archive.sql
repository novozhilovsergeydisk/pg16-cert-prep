-- Архив прежних версий вопросов: перед переписыванием вопрос копируется сюда целиком, сайт эту таблицу не читает.
-- Первое заполнение: 11 вопросов темы 05 перед миграцией 105 (инженерный стиль, materials/drafts/topic05-style-rewrite.md).
-- Повторный запуск безопасен: таблица создаётся, если её нет; вопрос копируется, только если его копии с этой причиной ещё нет.
-- Вопросы ищутся по прежнему тексту: номера на сервере и локально различаются. После миграции 105 прежних текстов уже нет,
-- поэтому повторный запуск ничего не добавит, а проверка в конце убедится, что в архиве все 11 копий.

BEGIN;
SET LOCAL standard_conforming_strings = on;

CREATE TABLE IF NOT EXISTS question_archive (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id    integer NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    question_text  text NOT NULL,
    options        jsonb NOT NULL,
    correct_answer character varying(8) NOT NULL,
    explanation    text,
    option_notes   jsonb,
    archived_at    timestamptz NOT NULL DEFAULT now(),
    reason         text NOT NULL
);

LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Тема 05: переписано в инженерном стиле (миграция 105)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) = '05.'
WHERE q.question_text IN (
    'Когда строится снимок данных на уровне Repeatable Read?',
    'Что такое горизонт очистки?',
    'На каких уровнях изоляции транзакция может завершиться ошибкой сериализации при обычных изменениях строк (без перемещения строк между секциями)?',
    'Транзакция на уровне Repeatable Read уже построила снимок. Затем другая транзакция удалила строку и зафиксировала изменение. Увидит ли первая транзакция эту строку при повторном запросе?',
    'На каком уровне определяется горизонт очистки для обычных таблиц?',
    'Обычная блокировка строки или таблицы была получена после установки точки сохранения. Когда она будет снята при откате к этой точке?',
    'Две транзакции без точек сохранения захватили разные строки, а затем каждая запросила блокировку строки, удерживаемой другой. Как PostgreSQL разрешает такую взаимоблокировку?',
    'Строка уже зафиксирована. Транзакция A изменила её командой UPDATE и ещё не завершилась. Второй сеанс работает на уровне Read Committed и обращается к этой строке обычным SELECT (без FOR UPDATE и FOR SHARE) или командой UPDATE. Что произойдёт?',
    'В транзакции после SAVEPOINT s вставлена строка. Какой номер транзакции окажется в xmin этой строки?',
    'Снимок данных построен, когда все упомянутые транзакции уже завершились. Номер в xmax оставлен удалением или изменением строки, а не её блокировкой. Какие версии строки в него попадут?',
    'Сеанс ждёт блокировку. Что верно о поиске причины ожидания и об ограничении времени ожидания?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Тема 05: переписано в инженерном стиле (миграция 105)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Тема 05: переписано в инженерном стиле (миграция 105)';
    IF n <> 11 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 11: прежние тексты вопросов не найдены', n;
    END IF;
END
$check$;

COMMIT;
