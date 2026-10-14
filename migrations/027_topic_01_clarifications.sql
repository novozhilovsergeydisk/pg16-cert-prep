-- Уточнения темы 01 по аудиту 14.10.2026. Ключи ответов и ID сохраняются.
-- Повторный запуск безопасен; отсутствие или дублирование вопроса отменяет транзакцию.
-- Источники: https://www.postgresql.org/docs/16/install-requirements.html
-- https://www.postgresql.org/docs/16/checksums.html
-- https://manpages.debian.org/bookworm/postgresql-common/pg_dropcluster.1.en.html

BEGIN;

DO $fix$
DECLARE n integer;
BEGIN
    UPDATE questions
    SET explanation = 'Контрольная сумма записывается при сохранении страницы и проверяется при чтении страницы с диска. Это создаёт дополнительные затраты, но помогает обнаруживать повреждения данных.'
    WHERE question_text = 'Какой ключ initdb включает контрольные суммы страниц данных?';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Ожидался один вопрос о контрольных суммах, найдено: %', n; END IF;

    UPDATE questions
    SET question_text = 'Что обязательно нужно для обычной сборки PostgreSQL 16 из релизного архива на Unix/Linux с помощью configure и GNU make, без дополнительных процедурных языков и тестов?',
        explanation = 'Из перечисленного обязательны компилятор C и GNU make. Readline можно отключить с помощью --without-readline. Для такой сборки Perl не требуется; он нужен, например, для сборки из Git, PL/Perl и некоторых тестов.'
    WHERE question_text IN (
        'Что обязательно нужно для сборки PostgreSQL из исходных кодов традиционным способом?',
        'Что обязательно нужно для обычной сборки PostgreSQL 16 из релизного архива на Unix/Linux с помощью configure и GNU make, без дополнительных процедурных языков и тестов?'
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Ожидался один вопрос о сборке, найдено: %', n; END IF;

    UPDATE questions
    SET explanation = 'Утилиты pg_lsclusters, pg_createcluster, pg_dropcluster и pg_ctlcluster входят в пакет postgresql-common в Debian и Ubuntu.'
    WHERE question_text = 'Какая утилита пакета Ubuntu выводит список кластеров с версией, портом и состоянием?';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Ожидался один вопрос о списке кластеров, найдено: %', n; END IF;

    UPDATE questions AS q
    SET explanation = 'В Debian и Ubuntu pg_dropcluster входит в пакет postgresql-common. При установке из исходников без этих обёрток кластер создают с помощью initdb, а для удаления останавливают сервер и удаляют его файлы средствами ОС.',
        option_notes = q.option_notes || jsonb_build_object(
            (SELECT key FROM jsonb_each_text(q.options) WHERE value = '`pg_dropcluster`'),
            'Парная к pg_createcluster утилита пакета postgresql-common в Debian и Ubuntu.'
        )
    WHERE question_text = 'Какая утилита пакета Ubuntu удаляет кластер баз данных?';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Ожидался один вопрос об удалении кластера, найдено: %', n; END IF;
END
$fix$;

COMMIT;
