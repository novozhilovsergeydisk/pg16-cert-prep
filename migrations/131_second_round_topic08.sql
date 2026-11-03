-- Второй круг Codex по теме 08: 8 вопросов (11 исправлений), ключи не меняются.
-- Источник: scripts/questions/131_second_round_topic08.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('option', 'Для чего нужен шаблон template0?', 'Для подключения клиентов по умолчанию', NULL, 'К template0 подключаться нельзя: у неё datallowconn = false. Для подключений по умолчанию предназначена база postgres.', 'При datallowconn = false к template0 подключиться нельзя, в том числе суперпользователю. Для подключения нужно выбрать другую базу, например postgres.'),
        ('option', 'Какая функция показывает реальный путь поиска вместе с неявными схемами?', 'current_schema()', NULL, 'Возвращает одну схему: первую существующую в пути, в ней создаются новые объекты.', 'Возвращает одну схему: первую существующую и доступную по USAGE из search_path, без неявно добавленных схем. Если такой схемы нет, возвращает NULL.'),
        ('option', 'Запрос к pg_database показывает у template0 datallowconn = false. Что это значит для администратора?', 'Подключиться к ней можно, но создать из неё базу нельзя', NULL, 'Использование базы как шаблона определяет datistemplate, у template0 он true.', 'datallowconn запрещает подключения, а не клонирование. datistemplate = true разрешает использовать базу как шаблон любому пользователю с CREATEDB; при false это доступно суперпользователю и владельцу с CREATEDB.'),
        ('question', 'Вы суперпользователь и подключены к базе postgres. В базе appdb открыт один сеанс приложения, подготовленных транзакций и слотов репликации нет. Что верно?', NULL, NULL, NULL, 'Вы суперпользователь и подключены к postgres. В appdb открыт один сеанс приложения, который сам не отключается; подготовленных транзакций, слотов репликации и подписок нет. Каждую команду рассматривайте отдельно, вне блока транзакции. Что верно?'),
        ('option', 'Вы суперпользователь и подключены к postgres. В appdb открыт один сеанс приложения, который сам не отключается; подготовленных транзакций, слотов репликации и подписок нет. Каждую команду рассматривайте отдельно, вне блока транзакции. Что верно?', 'DROP DATABASE appdb дождётся конца сеанса', 'DROP DATABASE appdb поставит удаление в очередь', 'Команда не ждёт, а сразу завершается ошибкой.', 'Отложенного удаления нет. Сервер проверяет другие сеансы с ожиданием до пяти секунд; если сеанс приложения остаётся подключённым, команда завершается ошибкой.'),
        ('explanation', 'Вы суперпользователь и подключены к postgres. В appdb открыт один сеанс приложения, который сам не отключается; подготовленных транзакций, слотов репликации и подписок нет. Каждую команду рассматривайте отдельно, вне блока транзакции. Что верно?', NULL, NULL, 'Обычный DROP DATABASE отказывает, пока в базе есть сеансы. WITH (FORCE) завершает их, но и он не сработает при подготовленных транзакциях или активных слотах логической репликации.', 'Обычный DROP DATABASE отказывает, пока в базе есть сеансы. WITH (FORCE) завершает их, но и он не сработает при подготовленных транзакциях, активных слотах логической репликации или подписках.'),
        ('question', 'Таблица public.orders занимает 50 ГБ, у неё первичный ключ и столбец identity. Что сделает ALTER TABLE orders SET SCHEMA app?', NULL, NULL, NULL, 'Таблица public.orders занимает 50 ГБ, у неё первичный ключ и столбец identity. Что сделает ALTER TABLE public.orders SET SCHEMA app?'),
        ('question', 'В сеансе есть временная таблица t. Выполнили CREATE VIEW v AS SELECT * FROM t без слова TEMP. Что получится?', NULL, NULL, NULL, 'В сеансе есть временная таблица t. Выполнили CREATE VIEW v AS SELECT * FROM pg_temp.t без слова TEMP. Что получится?'),
        ('question', 'В сеансе выполнили SET search_path = app, public и переподключились к той же базе. В postgresql.conf, на уровне базы и роли search_path не задан. Какой путь будет в новом сеансе?', NULL, NULL, NULL, 'В сеансе выполнили SET search_path = app, public и переподключились к той же базе. Других переопределений search_path на сервере, для базы и роли или со стороны клиента нет. Какой путь будет в новом сеансе?'),
        ('option', 'Администратор выполнил ALTER DATABASE appdb SET search_path = app, public. Что верно?', 'Новые сеансы в appdb получат этот путь', 'Задаст значение по умолчанию базы для новых сеансов', 'Значение уровня базы применяется при подключении.', 'Это значение по умолчанию для базы. Настройки ALTER ROLE SET и ALTER ROLE ... IN DATABASE SET имеют больший приоритет; клиент также может задать search_path при подключении.'),
        ('option', 'Администратор выполнил ALTER DATABASE appdb SET search_path = app, public. Что верно?', 'Открытые сеансы в appdb сразу получат этот путь', NULL, 'Открытые сеансы сохраняют своё значение до переподключения.', 'Команда не меняет search_path уже открытых сеансов. В них путь можно изменить своей командой SET без переподключения.')
    ) AS fixes(kind, question_text, opt_text, new_opt_text, old_text, new_text)
    LOOP
        -- Сначала ровно один вопрос по тексту (прежнему или новому), дальше всё только по его id.
        SELECT count(*), min(id) INTO matches, qid FROM questions
        WHERE question_text IN (fix.question_text, CASE WHEN fix.kind = 'question' THEN fix.new_text ELSE fix.question_text END);
        IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вопрос для исправления'; END IF;
        IF fix.kind = 'question' THEN
            UPDATE questions SET question_text = fix.new_text WHERE id = qid;
        ELSIF fix.kind = 'explanation' THEN
            PERFORM 1 FROM questions WHERE id = qid AND explanation IN (fix.old_text, fix.new_text);
            IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение вопроса'; END IF;
            UPDATE questions SET explanation = fix.new_text WHERE id = qid;
        ELSE
            SELECT count(*), min(o.key) INTO matches, k
            FROM questions q, jsonb_each_text(q.options) o
            WHERE q.id = qid AND o.value IN (fix.opt_text, coalesce(fix.new_opt_text, fix.opt_text));
            IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вариант ответа для исправления'; END IF;
            IF fix.new_text IS NOT NULL THEN
                PERFORM 1 FROM questions WHERE id = qid AND option_notes ->> k IN (fix.old_text, fix.new_text);
                IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение варианта'; END IF;
                UPDATE questions SET option_notes = jsonb_set(option_notes, ARRAY[k], to_jsonb(fix.new_text)) WHERE id = qid;
            END IF;
            IF fix.new_opt_text IS NOT NULL THEN
                UPDATE questions SET options = jsonb_set(options, ARRAY[k], to_jsonb(fix.new_opt_text)) WHERE id = qid;
            END IF;
        END IF;
    END LOOP;
END
$fix$;

COMMIT;
