-- Архив первых версий: 6 вопросов набора 129 (тема 08) перед миграцией 131 (второй круг Codex).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопросы ищутся по прежнему тексту:
-- номера на сервере и локально различаются. После миграции 131 четырёх прежних текстов уже нет, проверка в конце убедится, что в архиве все 6 копий.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Тема 08: второй круг Codex по набору 129 (миграция 131)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) = '08.'
WHERE q.question_text IN (
    'Запрос к pg_database показывает у template0 datallowconn = false. Что это значит для администратора?',
    'Вы суперпользователь и подключены к базе postgres. В базе appdb открыт один сеанс приложения, подготовленных транзакций и слотов репликации нет. Что верно?',
    'Таблица public.orders занимает 50 ГБ, у неё первичный ключ и столбец identity. Что сделает ALTER TABLE orders SET SCHEMA app?',
    'В сеансе есть временная таблица t. Выполнили CREATE VIEW v AS SELECT * FROM t без слова TEMP. Что получится?',
    'В сеансе выполнили SET search_path = app, public и переподключились к той же базе. В postgresql.conf, на уровне базы и роли search_path не задан. Какой путь будет в новом сеансе?',
    'Администратор выполнил ALTER DATABASE appdb SET search_path = app, public. Что верно?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Тема 08: второй круг Codex по набору 129 (миграция 131)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Тема 08: второй круг Codex по набору 129 (миграция 131)';
    IF n <> 6 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 6: прежние тексты вопросов не найдены', n;
    END IF;
END
$check$;

COMMIT;
