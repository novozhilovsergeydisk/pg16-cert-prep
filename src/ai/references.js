// Короткие проверенные сведения PG16. Это не поиск по всей документации.
const references = [
    {
        topic: /очист|vacuum/i,
        title: 'PostgreSQL 16: очистка',
        url: 'https://www.postgresql.org/docs/16/routine-vacuuming.html',
        text: 'Обычный VACUUM может вернуть ОС пустые страницы в конце файла таблицы, если возможно усечение. '
            + 'Для защиты от wraparound сервер запускает autovacuum даже при autovacuum=off. '
            + 'Отключение обычного autovacuum не отключает эту защиту.',
    },
    {
        topic: /мониторинг|статистик/i,
        title: 'PostgreSQL 16: статистика',
        url: 'https://www.postgresql.org/docs/16/monitoring-stats.html',
        text: 'В pg_stat_activity state=active совместимо с ожиданием блокировки: состояние и wait_event независимы. '
            + 'pg_stat_io агрегирует I/O по backend_type, object и context, без relid и queryid. '
            + 'Столбец heap_blks_read для пользовательских таблиц находится в pg_statio_user_tables, '
            + 'а не в pg_stat_user_tables. Эти счётчики не позволяют отделить чтение из кеша ОС от чтения с накопителя.',
    },
    {
        topic: /изоляци|транзакци/i,
        title: 'PostgreSQL 16: изоляция транзакций',
        url: 'https://www.postgresql.org/docs/16/transaction-iso.html',
        text: 'В READ COMMITTED обычный SELECT использует снимок на начало своего выполнения. '
            + 'В REPEATABLE READ снимок определяется первым оператором, который не является командой управления '
            + 'транзакцией. Сам BEGIN снимок не устанавливает. Изменения другой транзакции, зафиксированные '
            + 'до первого SELECT, попадут в этот снимок, даже если COMMIT произошёл после BEGIN.',
    },
    {
        topic: /табличные пространства/i,
        title: 'PostgreSQL 16: табличные пространства',
        url: 'https://www.postgresql.org/docs/16/manage-ag-tablespaces.html',
        text: 'Каталог LOCATION для CREATE TABLESPACE должен заранее существовать, быть пустым и принадлежать '
            + 'пользователю ОС, запускающему PostgreSQL. Табличное пространство является частью кластера. '
            + 'Таблицы одной схемы могут находиться в разных пространствах, индекс — отдельно от таблицы.',
    },
];

function forTopic(topic) {
    return references.filter((ref) => ref.topic.test(topic || '')).map(({ title, url, text }) => ({ title, url, text }));
}

module.exports = { forTopic };
