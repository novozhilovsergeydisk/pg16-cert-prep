// Цвет кнопок и ссылок до первой отрисовки: последний выбранный на этом устройстве.
// Главное значение хранится в профиле (users.accent); app.js применяет его после /api/me и обновляет этот кэш.
(function () {
    try {
        const accent = localStorage.getItem('pg16-accent');
        if (accent === 'beige' || accent === 'green' || accent === 'graphite') {
            document.documentElement.dataset.accent = accent;
        }
    } catch (err) {
        // хранилище недоступно: остаётся синий
    }
}());
