-- Вопросы 264 и 557 (раздел 01): уточнены формулировки, пояснения к вариантам стали ответами «Да» и «Нет» с причиной.
-- Источник: scripts/questions/043_question_264_wording.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('question', 'Какие утилиты относятся к пакету PostgreSQL для Ubuntu, а не к стандартной поставке?', NULL, NULL, NULL, 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?'),
        ('explanation', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', NULL, NULL, 'pg_ctlcluster, pg_createcluster, pg_dropcluster и pg_lsclusters — обёртки, специфичные для Ubuntu и Debian.', 'Верные ответы: pg_ctlcluster и pg_createcluster. Их добавили Debian и Ubuntu в отдельном пакете postgresql-common, чтобы удобно управлять несколькими кластерами на одном сервере. Так же устроены pg_dropcluster и pg_lsclusters. А pg_ctl и initdb — стандартные утилиты самого PostgreSQL, они лежат в пакете postgresql-16 и есть везде. Проверить, какому пакету принадлежит утилита: dpkg -S /usr/bin/pg_ctlcluster и dpkg -S /usr/lib/postgresql/16/bin/pg_ctl.'),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', '`pg_ctlcluster`', NULL, 'Обёртка Ubuntu и Debian над pg_ctl.', 'Да. Это обёртка Ubuntu и Debian над pg_ctl: запускает, останавливает и перезапускает кластер по номеру версии и имени. В стандартном PostgreSQL её нет, её добавил пакет postgresql-common.'),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', '`pg_createcluster`', NULL, 'Обёртка Ubuntu и Debian над initdb.', 'Да. Это обёртка Ubuntu и Debian над initdb: создаёт новый кластер и сразу кладёт настройки в /etc/postgresql. В стандартном PostgreSQL её нет, её добавил пакет postgresql-common.'),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', '`pg_ctl`', NULL, 'Входит в стандартную поставку PostgreSQL.', 'Нет. pg_ctl входит в стандартную поставку PostgreSQL (пакет postgresql-16), Ubuntu и Debian её не добавляли. Поверх неё они сделали pg_ctlcluster.'),
        ('option', 'Какие утилиты добавлены пакетами Debian и Ubuntu и не входят в стандартную поставку PostgreSQL?', '`initdb`', NULL, 'Входит в стандартную поставку PostgreSQL.', 'Нет. initdb входит в стандартную поставку PostgreSQL (пакет postgresql-16), Ubuntu и Debian её не добавляли. Поверх неё они сделали pg_createcluster.'),
        ('question', 'Что верно для PostgreSQL как сервиса у облачного провайдера (DBaaS)?', NULL, NULL, NULL, 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?'),
        ('explanation', 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?', NULL, NULL, 'В DBaaS провайдер обслуживает инфраструктуру и часть задач СУБД, а пользователь управляет базой через предоставленные интерфейсы и ограничения.', 'Верные ответы: управление ограничено инструментами провайдера и основное администрирование берёт на себя провайдер. DBaaS (Database as a Service, «база данных как услуга») — это общее название управляемой базы у облачного провайдера, например Amazon RDS или Yandex Managed PostgreSQL. Конкретные названия знать не нужно, важна модель: провайдер отвечает за серверы, обновления, резервные копии и мониторинг, а вы работаете с базой через панель, API и обычное подключение, но без доступа к самому серверу. Если PostgreSQL стоит на вашей собственной виртуальной машине, всё это администрируете вы.'),
        ('option', 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?', 'Администратор получает полный доступ к экземпляру', NULL, 'Полный доступ есть, когда PostgreSQL установлен в собственной виртуальной машине.', 'Нет. Полный доступ к серверу есть, только когда PostgreSQL стоит на вашей собственной виртуальной машине. В управляемом сервисе провайдер доступ ограничивает.'),
        ('option', 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?', 'Резервное копирование в таком режиме невозможно', NULL, 'Оно выполняется предоставленными провайдером инструментами.', 'Нет. Резервное копирование возможно, обычно его делает сам провайдер: автоматические копии и восстановление на момент времени.'),
        ('option', 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?', 'Управление ограничено инструментами, которые даёт провайдер', NULL, 'Например, для мониторинга, резервного копирования и восстановления.', 'Да. Настройки и действия доступны через панель и API провайдера, а на сам сервер зайти нельзя.'),
        ('option', 'Что верно для PostgreSQL как управляемого сервиса у облачного провайдера (DBaaS, «база данных как услуга»)?', 'Основное администрирование берёт на себя провайдер', NULL, 'В этом смысл managed database.', 'Да. Провайдер занимается серверами, обновлениями, копиями и мониторингом: в этом смысл управляемой базы (managed database).')
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
