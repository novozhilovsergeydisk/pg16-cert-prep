-- Архив прежних версий: 9 вопросов тем 06, 07, 12, 16 перед миграцией 126 (вопросы с одним ответом становятся вопросами с несколькими ответами).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопросы ищутся по прежнему тексту:
-- номера на сервере и локально различаются. После миграции 126 прежних текстов уже нет, проверка в конце убедится, что в архиве все 9 копий.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Темы 06, 07, 12, 16: вопросы с несколькими ответами (миграция 126)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) IN ('06.', '07.', '12.', '16.')
WHERE q.question_text IN (
    'Что произойдёт, если не выполнять заморозку своевременно?',
    'Возвращает ли обычный VACUUM, как правило, освободившееся место операционной системе?',
    'Почему изменённая страница записывается на диск не сразу?',
    'Что делает сервер при остановке в режиме fast?',
    'Сервер был остановлен в режиме immediate. Что произойдёт при следующем запуске?',
    'Какой из параметров выключен по умолчанию в Linux?',
    'Какой параметр задаёт порог длительности для записи завершённых команд в журнал?',
    'Что происходит при конфликте (нарушении ограничения) на подписчике?',
    'Чем опасен неактивный слот логической репликации?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Темы 06, 07, 12, 16: вопросы с несколькими ответами (миграция 126)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Темы 06, 07, 12, 16: вопросы с несколькими ответами (миграция 126)';
    IF n <> 9 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 9: прежние тексты вопросов не найдены', n;
    END IF;
END
$check$;

COMMIT;
