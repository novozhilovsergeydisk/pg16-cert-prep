-- Тринадцать вопросов раздела «13. Разграничение доступа» по сверке с лекцией: метакоманда \password, CREATE на базу данных, USAGE на схему, чтение вывода \dp, привилегия на столбец и SELECT *, схема public в 16-й версии, \drg, атрибуты не наследуются, начальный суперпользователь, SECURITY DEFINER и search_path, ALTER DEFAULT PRIVILEGES IN SCHEMA, pg_hba_file_rules и ошибка в файле, одно отображение peer для двух ролей; пояснения к каждому варианту.
-- Источник: scripts/questions/139_access_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/sql-alterrole.html
-- https://www.postgresql.org/docs/16/ddl-priv.html
-- https://www.postgresql.org/docs/16/sql-grant.html
-- https://www.postgresql.org/docs/16/ddl-schemas.html
-- https://www.postgresql.org/docs/16/predefined-roles.html
-- https://www.postgresql.org/docs/16/role-membership.html
-- https://www.postgresql.org/docs/16/role-attributes.html
-- https://www.postgresql.org/docs/16/sql-droprole.html
-- https://www.postgresql.org/docs/16/database-roles.html
-- https://www.postgresql.org/docs/16/sql-createfunction.html
-- https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html
-- https://www.postgresql.org/docs/16/view-pg-hba-file-rules.html
-- https://www.postgresql.org/docs/16/auth-pg-hba-conf.html
-- https://www.postgresql.org/docs/16/auth-username-maps.html
-- https://www.postgresql.org/docs/16/auth-peer.html

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Нужно задать пароль роли alice из psql так, чтобы открытый текст пароля не попал ни в историю psql, ни в журнал сервера. Что выбрать?', '{"A":"SET password_encryption перед ALTER ROLE","B":"CREATE ROLE ... ENCRYPTED PASSWORD с паролем","C":"Метакоманду \\password alice: ввод без отображения","D":"ALTER ROLE alice PASSWORD с паролем в кавычках"}'::jsonb, 'C', 'В демонстрации курса пароль alice сначала задали в CREATE ROLE ... PASSWORD и отметили, что так делать нехорошо: пароль виден на экране и остаётся в истории psql. Хеш пароля хранится в pg_authid.', '{"A":"Параметр выбирает алгоритм хеша на сервере, а открытый пароль всё равно передаётся в команде.","B":"Слово ENCRYPTED не меняет главного: открытый пароль стоит в тексте команды.","C":"psql спрашивает пароль без отображения на экране, сам вычисляет хеш и отправляет на сервер ALTER ROLE уже с хешем.","D":"Текст команды с паролем останется в истории psql и может попасть в журнал сервера, например при log_statement = ddl."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'База acc принадлежит student. Роль alice подключилась к acc и выполнила CREATE SCHEMA alice, ответ — «нет доступа к базе данных acc». Чего не хватает alice?', '{"A":"Привилегии CONNECT на базу данных acc","B":"Атрибута CREATEDB у роли alice","C":"Привилегии CREATE на базу данных acc","D":"Привилегии CREATE на схему public"}'::jsonb, 'C', 'Для схемы CREATE разрешает создавать объекты в ней, для табличного пространства — размещать в нём объекты. Временные таблицы разрешает отдельная привилегия базы данных TEMPORARY.', '{"A":"Подключение уже прошло: CONNECT по умолчанию есть у public, иначе alice не попала бы в базу.","B":"CREATEDB разрешает создавать базы данных, а не схемы внутри базы.","C":"Для базы данных CREATE разрешает создавать в ней схемы: в опыте после GRANT CREATE ON DATABASE acc TO alice команда прошла.","D":"Она разрешает создавать объекты в схеме public, а новая схема создаётся на уровне базы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Схему alice создала alice. bob — обычная роль, не член других ролей. alice выдала bob SELECT на таблицу alice.t1 и больше ничего не выдавала. bob выполняет SELECT * FROM alice.t1. Что он получит?', '{"A":"Ошибку «нет доступа к таблице t1»","B":"Ошибку «нет доступа к схеме alice»","C":"Пустой результат без ошибки","D":"Все строки t1: SELECT на таблицу достаточно"}'::jsonb, 'B', 'Чтобы читать таблицу чужой схемы, нужны обе привилегии: USAGE на схему и SELECT на таблицу. В демонстрации курса сообщение об ошибке менялось по мере того, как alice выдавала их bob.', '{"A":"Такое сообщение было бы при USAGE на схему, но без SELECT на таблицу: в опыте оно появилось именно так.","B":"Без USAGE на схему bob не может обратиться к её объектам: проверка доходит до схемы раньше, чем до таблицы.","C":"Сервер не скрывает строки молча, а отказывает с ошибкой.","D":"Нужна ещё USAGE на схему alice, а её никому не выдавали."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'В PostgreSQL 16 команда \dp alice.t1 показывает в правах доступа строку bob=rD/alice. Что означает эта запись?', '{"A":"alice выдала bob привилегию SELECT на t1","B":"bob выдал эти привилегии роли alice","C":"alice выдала bob привилегию DELETE на t1","D":"alice выдала bob привилегию TRUNCATE на t1"}'::jsonb, 'AD', 'Обозначения привилегий: a — INSERT, r — SELECT, w — UPDATE, d — DELETE, D — TRUNCATE, x — REFERENCES, t — TRIGGER. Пустое имя перед знаком равенства означает public.', '{"A":"Буква r — read, привилегия SELECT.","B":"Наоборот: перед знаком равенства — кому выданы привилегии, после косой черты — кто их выдал.","C":"DELETE обозначается строчной d, в этой записи её нет. Получить DELETE bob мог бы по другой записи, например для public или групповой роли.","D":"Заглавная D — привилегия TRUNCATE."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Таблица alice.t2 (n numeric, who text). alice выдала bob USAGE на схему и GRANT SELECT (n) ON alice.t2 TO bob. bob — обычная роль, других прав на t2 у него нет. Что получит bob на SELECT * FROM alice.t2?', '{"A":"Ошибку «нет доступа к таблице t2»","B":"Столбец n, а who будет пропущен","C":"Все столбцы: право на столбец даёт и таблицу","D":"Все столбцы, но who будет заполнен NULL"}'::jsonb, 'A', 'Привилегии SELECT, INSERT, UPDATE и REFERENCES можно выдавать на отдельные столбцы. Сообщение об ошибке не называет столбец, к которому нет доступа.', '{"A":"Звёздочка разворачивается во все столбцы, а на who права нет. В опыте SELECT n FROM alice.t2 при этом работал.","B":"Сервер не урезает список столбцов молча, а отказывает во всём запросе.","C":"Право на столбец действует на этот столбец, а не на всю таблицу.","D":"Значения столбцов не подменяются: без права на who запрос не выполнится."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Кластер PostgreSQL 16 создан initdb, базу appdb создали из template1, права на схему public нигде не меняли. Обычная роль bob (не владелец базы, не член других ролей), search_path по умолчанию, схемы bob нет, выполняет CREATE TABLE t (x int). Что произойдёт?', '{"A":"Таблица создастся в схеме public","B":"Таблица создастся в новой схеме bob","C":"Таблица создастся во временной схеме pg_temp","D":"Ошибка «нет доступа к схеме public»"}'::jsonb, 'D', 'В \dn+ у схемы public владелец pg_database_owner — это владелец текущей базы, права pg_database_owner=UC и =U. В демонстрации курса bob смог создать таблицу в public после GRANT CREATE ON SCHEMA public TO bob.', '{"A":"Так было до 15-й версии. Так будет и в 16-й, если кластер обновлён с 14-й: права на public в шаблоне сохраняются.","B":"Схему с именем роли сервер сам не создаёт: $user в search_path лишь ищет такую схему.","C":"Во временной схеме создаются временные таблицы, CREATE TEMP TABLE, а не обычные.","D":"Начиная с 15-й версии у public на схему public есть USAGE, а USAGE и CREATE — у pg_database_owner. В эту роль неявно входит владелец текущей базы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Допишите метакоманду psql 16, чтобы увидеть, в какие роли входит bob и с какими параметрами членства (INHERIT, SET):
```
\___ bob
```', '{"A":"`du`","B":"`drg`","C":"`ddp`","D":"`dp`"}'::jsonb, 'B', 'В опыте \drg bob показал: bob входит в admins с параметрами INHERIT, SET, праводатель postgres. INHERIT — наследовать привилегии групповой роли, SET — право переключиться на неё командой SET ROLE.', '{"A":"В psql 16 \\du показывает имя роли и атрибуты, столбца с членством в ролях в нём больше нет.","B":"Метакоманда появилась в psql 16: роль, групповая роль, параметры членства и кто его выдал.","C":"Показывает привилегии по умолчанию для будущих объектов.","D":"Показывает привилегии на таблицы и другие отношения, а не членство в ролях."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Групповая роль admins создана с NOLOGIN и CREATEDB. Роль bob создана командой CREATE ROLE bob LOGIN. Выполнили GRANT admins TO bob, параметры членства по умолчанию. bob подключился и выполнил CREATE DATABASE bobdb. Что получится?', '{"A":"Ошибка: у групповой роли нет атрибута LOGIN","B":"Ошибка: атрибут CREATEDB не наследуется","C":"База создастся, её владельцем станет admins","D":"База создастся, её владельцем станет bob"}'::jsonb, 'B', 'Членство в роли даёт её привилегии (при INHERIT), но не атрибуты: CREATEDB, CREATEROLE, SUPERUSER и другие. Чтобы воспользоваться атрибутом групповой роли, на неё переключаются командой SET ROLE.', '{"A":"LOGIN нужен для подключения, а bob уже подключился своей ролью.","B":"В опыте bob получил «нет прав для создания базы данных», а после SET ROLE admins база создалась.","C":"Так выйдет после SET ROLE admins: в опыте владельцем тогда стала admins.","D":"Атрибуты роли, в отличие от привилегий, через членство не наследуются."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'Суперпользователь admin выполняет DROP ROLE postgres — роли, которую создал initdb при создании кластера. Что получится?', '{"A":"Роль удалится после ALTER ROLE NOSUPERUSER","B":"Роль удалится, если к ней нет подключений","C":"Ошибка: эта роль нужна системе баз данных","D":"Роль удалится, если у неё нет своих объектов"}'::jsonb, 'C', 'Имя начальной роли задаёт initdb, обычно это postgres; снять с неё SUPERUSER в 16-й версии тоже нельзя. Другие роли, в том числе суперпользователей, можно удалить, если ни в одной базе кластера у них нет объектов и выданных им привилегий; их снимают REASSIGN OWNED и DROP OWNED.', '{"A":"Снять SUPERUSER с начальной роли тоже нельзя: в опыте команда завершилась ошибкой.","B":"Подключения не главное: начальную роль удалить нельзя ни при каких условиях.","C":"Начальную роль, созданную initdb, удалить нельзя: в опыте «удалить объект роль postgres нельзя, так как он нужен системе баз данных».","D":"Объекты тут ни при чём: эту роль сервер не даёт удалить в принципе."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'alice создала функцию alice.fu() RETURNS SETOF alice.t2 LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM t2 $$, search_path для неё не задан. bob (у него есть USAGE на схему alice) создал public.t2 той же структуры, выдал SELECT всем и вызвал fu() при search_path = public, alice. Чьи строки вернёт функция?', '{"A":"Ошибку: у alice нет прав на таблицу bob","B":"Ошибку: SECURITY DEFINER требует указать схему","C":"Из alice.t2: функция работает от имени alice","D":"Из public.t2 bob, хотя права — alice"}'::jsonb, 'D', 'Тело в виде строки разбирается при выполнении, поэтому имя t2 ищется по search_path вызывающего; тело BEGIN ATOMIC связало бы имя с таблицей при создании функции. Для функций SECURITY DEFINER документация советует задавать search_path, например ALTER FUNCTION alice.fu() SET search_path = alice, pg_temp, или указывать схему в именах. В опыте после этого fu() снова вернула строки alice.t2. В демонстрации курса bob подменял таблицу ещё для функции SECURITY INVOKER.', '{"A":"bob выдал SELECT на свою таблицу всем, поэтому alice её прочитает. Без такого права была бы ошибка доступа.","B":"Такой проверки нет: функция выполняется и находит первую подходящую t2 в search_path.","C":"От имени alice проверяются права, а схема по-прежнему ищется по search_path bob.","D":"Имя t2 разрешается по search_path вызывающего сеанса, а не владельца функции: в опыте fu() вернула строку bob."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'alice ранее не меняла привилегии по умолчанию в этой базе. Она выполнила ALTER DEFAULT PRIVILEGES IN SCHEMA alice REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, затем создала функцию alice.f2(). Получит ли public право EXECUTE на f2?', '{"A":"Нет: команда отозвала EXECUTE у PUBLIC в схеме","B":"Нет: у новых функций у PUBLIC нет EXECUTE","C":"Да, до следующего подключения alice к базе","D":"Да: отзыв в схеме не отменяет общие права"}'::jsonb, 'D', 'Отозвать EXECUTE у PUBLIC для будущих функций можно общей настройкой без IN SCHEMA: ALTER DEFAULT PRIVILEGES FOR ROLE alice REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC. Так сделали в демонстрации курса, и \ddp показал alice=X/alice.', '{"A":"В опыте has_function_privilege для public и новой функции вернула true.","B":"Наоборот: по умолчанию PUBLIC получает EXECUTE на каждую новую функцию.","C":"Привилегии по умолчанию не зависят от сеанса и действуют сразу.","D":"Настройка IN SCHEMA дополняет общие привилегии по умолчанию, а EXECUTE для PUBLIC выдают общие. REVOKE IN SCHEMA отменяет лишь прежний GRANT IN SCHEMA. В опыте \\ddp после команды был пуст."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'PostgreSQL 16 на Linux. Суперпользователь добавил в pg_hba.conf строку с опечаткой в методе (peerr) и ещё не вызывал pg_reload_conf(). Что верно?', '{"A":"После pg_reload_conf() останутся прежние правила","B":"Сервер применит верные строки, а строку с ошибкой пропустит","C":"pg_reload_conf() вернёт false из-за ошибки в файле","D":"pg_hba_file_rules уже покажет ошибку в столбце error"}'::jsonb, 'AD', 'Поэтому после правки pg_hba.conf сначала смотрят pg_hba_file_rules: представление разбирает файл на диске в момент запроса, это не действующие правила. pg_reload_conf() сообщает об отправке сигнала, а не об успешном разборе файла. Где лежит файл, показывает SHOW hba_file; в Debian и Ubuntu для кластера main по умолчанию это /etc/postgresql/16/main/pg_hba.conf.', '{"A":"Файл с ошибкой сервер не применяет: в журнале «pg_hba.conf не был перезагружен», подключения шли по старым правилам.","B":"Файл применяется целиком или не применяется вовсе.","C":"Функция отправляет сигнал серверу и вернула true; об ошибке сообщает журнал сервера.","D":"Представление читает файл с диска при каждом запросе: в опыте у этой строки было «invalid authentication method \"peerr\"»."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '13.'), 'В pg_hba.conf первая строка: local all alice,bob peer map=stmap. В pg_ident.conf две строки: stmap student alice и stmap student bob. Пользователь ОС student подключается через сокет. Под какими ролями он пройдёт проверку по этой строке?', '{"A":"Под ролью postgres","B":"Под ролью alice","C":"Под ролью bob","D":"Под ролью student"}'::jsonb, 'BC', 'Без параметра map peer требует совпадения имени пользователя ОС и роли. С map=stmap нужна подходящая строка именно в stmap: в опыте после удаления строки для bob подключение под bob завершилось ошибкой «не прошёл проверку подлинности (Peer)». Это задание практики+ курса.', '{"A":"Роли postgres нет ни в строке, ни в отображении stmap.","B":"Отображение stmap разрешает пользователю ОС student роль alice.","C":"Одно отображение можно использовать для нескольких ролей: в опыте подключились и alice, и bob.","D":"Строка подходит для ролей alice и bob, а роли student в ней нет."}'::jsonb;

DO $check$
DECLARE candidate record; matches integer;
BEGIN
    FOR candidate IN SELECT * FROM question_seed LOOP
        SELECT count(*) INTO matches FROM questions q
        WHERE regexp_replace(trim(q.question_text), '[[:space:]]+', ' ', 'g') =
              regexp_replace(trim(candidate.question_text), '[[:space:]]+', ' ', 'g');
        IF matches > 1 OR (matches = 1 AND NOT EXISTS (
            SELECT 1 FROM questions q WHERE q.question_text = candidate.question_text
              AND q.category_id = candidate.category_id AND q.options = candidate.options
              AND q.correct_answer = candidate.correct_answer AND q.explanation = candidate.explanation
              AND q.option_notes = candidate.option_notes
        )) THEN
            RAISE EXCEPTION 'Конфликт содержимого или повтор нового вопроса';
        END IF;
    END LOOP;
END
$check$;

INSERT INTO questions(category_id, question_text, options, correct_answer, explanation, option_notes)
SELECT n.* FROM question_seed n
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);

DO $check$
BEGIN
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 13 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
