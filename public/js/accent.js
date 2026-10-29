// Цвет кнопок и ссылок и светлая или тёмная тема до первой отрисовки: последний выбор на этом устройстве.
// Главные значения хранятся в профиле (users.accent, users.theme); app.js применяет их после /api/me и обновляет этот кэш.
(function () {
    try {
        const accent = localStorage.getItem('pg16-accent');
        if (accent === 'beige' || accent === 'green' || accent === 'graphite') {
            document.documentElement.dataset.accent = accent;
        }
        const theme = localStorage.getItem('pg16-theme');
        if (theme === 'light' || theme === 'dark') {
            document.documentElement.dataset.theme = theme;
        }
    } catch (err) {
        // хранилище недоступно: синий цвет и тема как в системе
    }
}());
