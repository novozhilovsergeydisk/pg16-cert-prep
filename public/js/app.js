(function () {
    const $ = (id) => document.getElementById(id);

    const VIEWS = ['login', 'login-sent', 'login-confirm', 'privacy', 'categories', 'question', 'finish',
        'exam-setup', 'exam', 'exam-result', 'history', 'training-history', 'training-batch', 'stats', 'admin', 'admin-user', 'material',
        'option-check', 'ai', 'results'];
    const EXAM_COUNTS = [20, 30, 50];
    const EXAM_DEFAULT_COUNT = 30;
    let examStarting = false;
    let overviewQuestions = null;
    const SECONDS_PER_QUESTION = 90;
    const PORTION_SIZE = 16;
    const FINISH_PORTION = 'Порция пройдена';
    const FINISH_MISTAKES = 'Вопросы из списка ошибок закончились';
    const NEXT_PORTION_HINT = 'Откройте тему снова, чтобы получить следующую: сначала новые вопросы и те, где были ошибки.';
    let finishText = FINISH_PORTION;
    let finishHint = NEXT_PORTION_HINT;
    // Практикумы по темам (docs/practice); ссылка на итоге порции, если верных меньше PRACTICE_BELOW.
    const PRACTICE_TOPICS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    const PRACTICE_BELOW = 0.7;
    let finishPractice = null;
    // Число верных ответов в текущей порции или в работе над ошибками.
    let portionScore = 0;
    let progressLabel = 'Порция: вопрос';
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    let categories = [];
    // В работе над ошибками вопросы из разных разделов: над вопросом показывается название раздела.
    let showSection = false;
    let questions = [];
    let trainingBatchId = null;
    // Режим «Подходит или нет»: порция карточек, номер текущей, счёт и ответы без подтверждения сервера.
    let checkMode = false;
    let checkBatch = null;
    let checkIndex = 0;
    let checkScore = 0;
    const savedTraining = new Map();
    const savedChecks = new Map();
    let practiceLoading = false;
    const unconfirmedChecks = new Map();
    let trainingHistoryBefore = null;
    let index = 0;
    let exam = null;
    let user = null;
    let loginToken = null;
    let loginEmail = '';
    let loginRequest = '';
    let privacyReturn = 'login';
    let viewRevision = 0;
    const ai = typeof window.createAiAssistant === 'function' ? window.createAiAssistant({ api })
        : { reset() {}, setUser() {}, offer() {}, isAvailable: () => Promise.resolve(false) };
    if (typeof window.createAiAssistant !== 'function') {
        queueMicrotask(() => reportClientError({ kind: 'js', source: 'ai.js' }));
    }

    let activeView = null;
    const lastViews = { training: 'categories', exam: 'exam-setup', ai: 'ai', results: 'results' };
    const sectionScroll = new Map();
    const sectionNames = { training: 'Тренировка', exam: 'Экзамен', ai: 'ИИ-помощник', results: 'Результаты' };
    function sectionOf(name) {
        if (['categories', 'question', 'option-check', 'finish', 'material'].includes(name)) return 'training';
        if (['exam', 'exam-setup'].includes(name)) return 'exam';
        if (name === 'ai') return 'ai';
        if (['results', 'stats', 'history', 'training-history', 'training-batch', 'exam-result', 'admin', 'admin-user'].includes(name)) return 'results';
        return null;
    }

    function show(name, { route = true } = {}) {
        const previousSection = sectionOf(activeView);
        const section = sectionOf(name);
        if (previousSection && previousSection !== section) sectionScroll.set(previousSection, window.scrollY);
        ai.reset({ preserveGeneral: Boolean(user) });
        viewRevision += 1;
        activeView = name;
        VIEWS.forEach((key) => {
            $(key + '-view').hidden = key !== name;
        });
        $('main-nav').hidden = !user;
        $('user-bar').open = false;
        if (user && section) {
            lastViews[section] = name;
            document.title = sectionNames[section] + ' · PostgreSQL 16';
            document.querySelectorAll('#main-nav a').forEach((link) => {
                if (link.hash === '#/' + section) link.setAttribute('aria-current', 'page');
                else link.removeAttribute('aria-current');
            });
            if (route && location.hash !== '#/' + section) {
                const method = location.hash.startsWith('#/') ? 'pushState' : 'replaceState';
                history[method]({ section }, '', '#/' + section);
            }
            if (previousSection !== section) {
                window.scrollTo(0, sectionScroll.get(section) || 0);
                const heading = $(name + '-view').querySelector('h2');
                if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
            }
        }
        if (name === 'ai') ai.offer($('ai-home'), { mode: 'general' });
    }

    async function navigateSection(section, fromHistory = false) {
        if (!user || !Object.hasOwn(sectionNames, section)) return;
        const actor = user;
        if (section === 'exam' && activeView === 'exam') return;
        if (section === 'ai' && !await ai.isAvailable()) section = 'training';
        if (user !== actor) return;
        if (exam && activeView === 'exam' && section !== 'exam') {
            if (exam.finishing || !window.confirm('Экзамен будет сохранён. Время продолжит идти. Перейти в другой раздел?')) {
                if (fromHistory) history.pushState({ section: 'exam' }, '', '#/exam');
                return;
            }
            saveExam(); stopTimer(); exam = null;
        }
        showError('');
        if (fromHistory && location.hash !== '#/' + section) history.replaceState({ section }, '', '#/' + section);
        if (section === 'exam') {
            if (readSavedExam()) resumeExam();
            else await openExamSetup();
        } else if (section === 'training') {
            const view = lastViews.training;
            if (view === 'categories' || !categories.length || (!fromHistory && sectionOf(activeView) === 'training')) await loadCategories();
            else if (view === 'question') showQuestion();
            else if (view === 'option-check') showCheckCard();
            else show(view);
        } else show(section === 'results' && !fromHistory ? 'results' : lastViews[section]);
        if (location.hash !== '#/' + section && user && sectionOf(activeView) === section) {
            history.replaceState({ section }, '', '#/' + section);
        }
    }

    function showError(message) {
        const box = $('error');
        box.textContent = message;
        box.hidden = !message;
        if (message) box.scrollIntoView({ block: 'nearest' });
    }

    // Сколько страница ждёт ответа сервера. На сервере ограничения меньше: БД 5 с, nginx 60 с.
    const API_TIMEOUT_MS = 15000;
    const ANSWER_NOT_SAVED = 'Не удалось подтвердить сохранение. Повторите отправку — ответ не продублируется.';
    // Сбои без подтверждения от нашего сервера: время вышло, сеть недоступна, ответ не в JSON.
    const NO_RESPONSE = ['timeout', 'network', 'gateway'];

    function currentView() {
        return VIEWS.find((key) => !$(key + '-view').hidden) || '-';
    }

    // Любой запрос страницы — с ограничением времени. Тело читается целиком внутри ограничения.
    // response === null: ответа нет (время вышло — timedOut, иначе сеть недоступна или тело оборвалось).
    async function timedFetch(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
        try {
            const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
            const body = await response.text();
            return { response, body, timedOut: false };
        } catch (err) {
            return { response: null, body: null, timedOut: controller.signal.aborted };
        } finally {
            clearTimeout(timer);
        }
    }

    // Отчёт о сбое в журнал сервера: только вид сбоя, путь, код, длительность, экран и место ошибки.
    // Свободного текста нет. Не больше 10 отчётов за загрузку страницы; сбой отправки отчёта не порождает новый.
    let reportsLeft = 10;
    function reportClientError(report) {
        if (reportsLeft <= 0) return;
        reportsLeft -= 1;
        const body = Object.assign({ screen: currentView() }, report);
        if (body.path) body.path = String(body.path).split('?')[0];
        timedFetch('/api/client-errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
        });
    }

    window.addEventListener('error', (event) => {
        reportClientError({ kind: 'js', source: String(event.filename || '').split('/').pop(), line: event.lineno || 0 });
    });
    window.addEventListener('unhandledrejection', (event) => {
        // Пустое сообщение — намеренный отказ после перехода ко входу (см. api), это не сбой.
        if (event.reason instanceof Error && event.reason.message === '') return;
        reportClientError({ kind: 'js' });
    });

    function requestFailed(kind, message) {
        const err = new Error(message || 'Ошибка запроса');
        err.kind = kind;
        return err;
    }

    async function api(url, options) {
        const started = Date.now();
        const { response, body, timedOut } = await timedFetch(url, options);
        const ms = Date.now() - started;
        if (!response) {
            const kind = timedOut ? 'timeout' : 'network';
            reportClientError({ kind, path: url, status: 0, ms });
            throw requestFailed(kind);
        }
        if (response.status === 401) {
            // Сеанс истёк или его нет: показать вход без сообщения об ошибке.
            showLogin();
            throw new Error('');
        }
        let data = null;
        try {
            data = JSON.parse(body);
        } catch (err) {
            // не JSON: обрабатывается ниже
        }
        if (!data || typeof data !== 'object') {
            // Не JSON — ответ шлюза (например, nginx при 502–504) или испорченное тело, даже при коде 200.
            // Подтверждения от нашего сервера нет.
            reportClientError({ kind: 'gateway', path: url, status: response.status, ms });
            throw requestFailed('gateway');
        }
        if (!response.ok) {
            const kind = response.status >= 500 ? 'server' : 'api';
            if (kind === 'server') reportClientError({ kind, path: url, status: response.status, ms });
            throw requestFailed(kind, data.error);
        }
        return data;
    }

    // Текущий пользователь или null; сбой этой проверки не мешает показать экран входа.
    async function currentUser() {
        const { response, body } = await timedFetch('/api/me');
        if (!response || !response.ok) return null;
        try {
            return JSON.parse(body);
        } catch (err) {
            return null;
        }
    }

    function postJson(url, payload) {
        return api(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    function formatDate(value) {
        return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    }

    // Вход по ссылке из письма

    function showLogin() {
        user = null;
        ai.setUser(null);
        savedTraining.clear(); savedChecks.clear();
        unconfirmedAnswers.clear(); unconfirmedChecks.clear();
        stopTimer();
        exam = null;
        // Данные незавершённого входа не должны пережить выход или истечение сеанса.
        loginToken = null;
        loginEmail = '';
        loginRequest = '';
        $('login-code').value = '';
        $('user-bar').hidden = true;
        $('main-nav').hidden = true;
        $('nav-ai').hidden = true;
        document.title = 'Тренажёр сертификации PostgreSQL 16';
        Object.assign(lastViews, { training: 'categories', exam: 'exam-setup', ai: 'ai', results: 'results' });
        sectionScroll.clear();
        $('login-submit').disabled = false;
        show('login');
    }

    async function requestLink(event) {
        event.preventDefault();
        showError('');
        const email = $('login-email').value.trim();
        if (!email) {
            showError('Введите email');
            return;
        }
        $('login-submit').disabled = true;
        try {
            const sent = await postJson('/api/auth/request', { email });
            loginEmail = email;
            loginRequest = sent.request_id;
            $('sent-email').textContent = email;
            $('login-code').value = '';
            show('login-sent');
            $('login-code').focus();
        } catch (err) {
            showError(err.message);
        } finally {
            $('login-submit').disabled = false;
        }
    }

    async function confirmLogin() {
        showError('');
        $('login-confirm').disabled = true;
        try {
            const me = await postJson('/api/auth/verify', { token: loginToken });
            loginToken = null;
            startApp(me);
        } catch (err) {
            loginToken = null;
            showLogin();
            showError(err.message);
        } finally {
            $('login-confirm').disabled = false;
        }
    }

    async function submitCode(event) {
        event.preventDefault();
        showError('');
        const code = $('login-code').value.trim();
        if (!/^[0-9]{6}$/.test(code)) {
            showError('Введите 6 цифр из письма');
            return;
        }
        $('code-submit').disabled = true;
        try {
            startApp(await postJson('/api/auth/verify-code', { email: loginEmail, request_id: loginRequest, code }));
        } catch (err) {
            showError(err.message);
        } finally {
            $('code-submit').disabled = false;
        }
    }

    // Экран входа показывается только после того, как сервер подтвердил выход:
    // иначе на общем компьютере сеанс остался бы рабочим, а человек думал бы, что вышел.
    async function logout() {
        showError('');
        try {
            await postJson('/api/auth/logout', {});
        } catch (err) {
            if (err.message) showError('Не удалось выйти, попробуйте ещё раз');
            return;
        }
        clearSavedExam();
        // Перезагрузка стирает из памяти и страницы всё, что было загружено в сеансе:
        // токен открытой ссылки, личные и административные данные, ответы незавершённых запросов.
        window.location.replace(window.location.pathname);
    }

    function openPrivacy() {
        privacyReturn = user ? 'categories' : 'login';
        showError('');
        show('privacy');
    }

    // Цвет кнопок и ссылок и тема: значения из профиля, копии в браузере нужны public/js/accent.js до первой отрисовки.
    const ACCENTS = ['blue', 'beige', 'green', 'graphite'];

    function applyAccent(accent) {
        const value = ACCENTS.includes(accent) ? accent : 'blue';
        if (value === 'blue') delete document.documentElement.dataset.accent;
        else document.documentElement.dataset.accent = value;
        $('accent-select').value = value;
        try {
            localStorage.setItem('pg16-accent', value);
        } catch (err) {
            // хранилище недоступно: цвет из профиля применится после загрузки
        }
    }

    const THEMES = ['auto', 'light', 'dark'];

    function applyTheme(theme) {
        const value = THEMES.includes(theme) ? theme : 'auto';
        if (value === 'auto') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = value;
        $('theme-select').value = value;
        try {
            localStorage.setItem('pg16-theme', value);
        } catch (err) {
            // хранилище недоступно: тема из профиля применится после загрузки
        }
    }

    async function changeTheme() {
        const chosen = $('theme-select').value;
        const previous = user && THEMES.includes(user.theme) ? user.theme : 'auto';
        showError('');
        applyTheme(chosen);
        try {
            await postJson('/api/me/theme', { theme: chosen });
            if (user) user.theme = chosen;
        } catch (err) {
            applyTheme(previous);
            if (err.message) showError('Не удалось сохранить тему, попробуйте ещё раз');
        }
    }

    async function changeAccent() {
        const chosen = $('accent-select').value;
        const previous = user && ACCENTS.includes(user.accent) ? user.accent : 'blue';
        showError('');
        applyAccent(chosen);
        try {
            await postJson('/api/me/accent', { accent: chosen });
            if (user) user.accent = chosen;
        } catch (err) {
            applyAccent(previous);
            if (err.message) showError('Не удалось сохранить цвет, попробуйте ещё раз');
        }
    }

    async function startApp(me) {
        const initialSection = location.hash.slice(2);
        user = me;
        ai.setUser(me);
        applyAccent(me.accent);
        applyTheme(me.theme);
        const trainingPointer = readPractice('training'), checkPointer = readPractice('check');
        setMode(Boolean(checkPointer && (!trainingPointer || checkPointer.updatedAt > trainingPointer.updatedAt)));
        $('release-name').textContent = me.release ? `${me.release.date} · ${me.release.commit}` : 'неизвестен';
        $('release').hidden = false;
        $('user-email').textContent = me.email;
        $('user-bar').hidden = false;
        $('open-admin').hidden = me.role !== 'admin';
        ai.isAvailable().then((available) => {
            if (user === me) $('nav-ai').hidden = !available;
        });
        await loadCategories({ route: false });
        if (user === me && activeView !== 'categories') {
            history.replaceState({ section: sectionOf(activeView) }, '', '#/' + sectionOf(activeView));
            return;
        }
        if (user === me && Object.hasOwn(sectionNames, initialSection) && initialSection !== 'training') {
            await navigateSection(initialSection, true);
        } else if (user === me) {
            history.replaceState({ section: 'training' }, '', '#/training');
        }
    }

    // Ссылка из письма: токен в части после #, она не уходит на сервер при загрузке страницы.
    function takeLoginLink() {
        const match = /^#login=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
        if (!match) return false;
        loginToken = match[1];
        history.replaceState(null, '', window.location.pathname);
        stopTimer();
        exam = null;
        showError('');
        $('login-confirm-text').textContent = '';
        $('login-confirm-warning').hidden = true;
        $('login-confirm').disabled = true;
        show('login-confirm');
        describeLoginLink();
        return true;
    }

    // На экране подтверждения: в какой аккаунт ведёт ссылка и не открыт ли сейчас другой.
    async function describeLoginLink() {
        try {
            const target = await postJson('/api/auth/peek', { token: loginToken });
            $('login-confirm-text').textContent = 'Вход как ' + target.email;
            const current = await currentUser();
            if (current && current.email !== target.email) {
                $('login-confirm-warning').textContent = 'Сейчас вы вошли как ' + current.email + '. Войти в другой аккаунт?';
                $('login-confirm-warning').hidden = false;
            }
            $('login-confirm').disabled = false;
        } catch (err) {
            loginToken = null;
            const message = err.message || 'Ссылка недействительна или устарела';
            const current = await currentUser();
            if (current) startApp(current);
            else showLogin();
            showError(message);
        }
    }

    async function init() {
        if (takeLoginLink()) return;
        try {
            startApp(await api('/api/me'));
        } catch (err) {
            if (err.message) showError(err.message);
        }
    }

    function plural(n, one, few, many) {
        const mod100 = n % 100;
        const mod10 = n % 10;
        if (mod100 >= 11 && mod100 <= 14) return many;
        if (mod10 === 1) return one;
        if (mod10 >= 2 && mod10 <= 4) return few;
        return many;
    }

    function questionsLabel(n) {
        return n + ' ' + plural(n, 'вопрос', 'вопроса', 'вопросов');
    }

    function shuffle(items) {
        const result = items.slice();
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // Перемешивает порядок вариантов один раз для вопроса: буквы на экране идут по позиции,
    // а на сервер уходит исходный ключ варианта.
    function prepareQuestions(list) {
        return list.map((question) => Object.assign({}, question, {
            order: shuffle(Object.keys(question.options)),
        }));
    }

    function displayLetter(question, key) {
        return LETTERS[question.order.indexOf(key)];
    }

    // Буквы ответа (например 'AC') в порядке, как они показаны на экране: ['A', 'B'].
    function answerKeys(question, answer) {
        return answer.split('').sort((a, b) => question.order.indexOf(a) - question.order.indexOf(b));
    }

    function isMulti(question) {
        return question.correct_count > 1;
    }

    // Ответ для сервера: исходные ключи выбранных вариантов по алфавиту, либо null.
    function collectAnswer(container) {
        const keys = Array.from(container.querySelectorAll('input:checked')).map((el) => el.value);
        return keys.length === 0 ? null : keys.sort().join('');
    }

    function hintText(question) {
        return isMulti(question) ? 'Правильных вариантов может быть несколько: выберите один или более' : '';
    }

    // Фрагменты кода в одиночных ` ` внутри обычного текста.
    function appendInline(container, source) {
        source.split(/(`[^`\n]+`)/).forEach((chunk) => {
            if (chunk === '') return;
            if (chunk.length > 2 && chunk.startsWith('`') && chunk.endsWith('`')) {
                const code = document.createElement('code');
                code.textContent = chunk.slice(1, -1);
                container.appendChild(code);
            } else {
                container.appendChild(document.createTextNode(chunk));
            }
        });
    }

    // Безопасный вывод текста с кодом: блок между ``` и ``` и фрагменты в одиночных ` `. Без innerHTML.
    // Если тройных кавычек нечётное число, блоков нет, весь текст выводится как обычный.
    function renderRich(container, text) {
        container.textContent = '';
        const parts = String(text).split('```');
        const hasBlocks = parts.length % 2 === 1;
        parts.forEach((part, i) => {
            if (hasBlocks && i % 2 === 1) {
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = part.replace(/^\n+|\n+$/g, '');
                pre.appendChild(code);
                container.appendChild(pre);
            } else {
                appendInline(container, hasBlocks || i === 0 ? part : '```' + part);
            }
        });
    }

    // Список вариантов ответа (буква + текст) для разбора: 'A. текст'.
    function appendAnswerLines(container, question, answer, notes, correctAnswer) {
        answerKeys(question, answer).forEach((key) => {
            const line = document.createElement('div');
            line.className = 'answer-line';
            const letter = document.createElement('strong');
            letter.textContent = displayLetter(question, key) + '.';
            const body = document.createElement('span');
            renderRich(body, question.options[key]);
            line.appendChild(letter);
            line.appendChild(document.createTextNode(' '));
            line.appendChild(body);
            if (notes && correctAnswer && !correctAnswer.includes(key)) appendNote(body, notes[key]);
            container.appendChild(line);
        });
    }

    // Пояснение к варианту (что он делает или почему не подходит) — показывается после ответа.
    function appendNote(container, text) {
        if (!text) return;
        const note = document.createElement('span');
        note.className = 'option-note';
        renderRich(note, text);
        container.appendChild(note);
    }

    function makeOption(key, letter, text, name, inputType) {
        const label = document.createElement('label');
        label.className = inputType === 'checkbox' ? 'option multi' : 'option';
        const input = document.createElement('input');
        input.type = inputType || 'radio';
        input.name = name;
        input.value = key;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = letter;
        const body = document.createElement('span');
        body.className = 'text';
        renderRich(body, text);
        label.appendChild(input);
        label.appendChild(badge);
        label.appendChild(body);
        return label;
    }

    // Категории и тренировка

    function practiceKey(kind) { return user ? 'pg16-practice:' + user.email + ':' + kind : null; }
    function readPractice(kind) {
        try {
            const p = JSON.parse(localStorage.getItem(practiceKey(kind)) || 'null');
            return p && Number.isInteger(p.id) && p.id > 0 && Number.isInteger(p.index) && p.index >= 0
                && typeof p.name === 'string' && Number.isInteger(p.total) && p.total > p.index ? p : null;
        } catch { return null; }
    }
    function savePractice(kind) {
        if (!user) return;
        const training = kind === 'training';
        const id = training ? trainingBatchId : checkBatch?.id;
        const at = training ? index : checkIndex;
        const total = training ? questions.length : checkBatch?.cards.length;
        if (!id || at >= total) return;
        const questionId = training ? questions[at].id : checkBatch.cards[at].question_id;
        const key = id + ':' + questionId;
        const pending = training ? unconfirmedAnswers.has(key) : unconfirmedChecks.has(key);
        const draft = training ? collectAnswer($('options')) : (pending ? unconfirmedChecks.get(key) : null);
        try {
            localStorage.setItem(practiceKey(kind), JSON.stringify({ id, index: at, total, questionId,
                name: training ? $('category-name').textContent : checkBatch.category_name,
                draft, pending, updatedAt: Date.now() }));
        } catch { /* Без хранилища работа в текущей вкладке продолжается. */ }
    }
    function clearPracticePointer(kind, id) {
        if (readPractice(kind)?.id !== id) return;
        try { localStorage.removeItem(practiceKey(kind)); } catch {}
    }
    function updatePracticeOffer() {
        const pointer = readPractice(checkMode ? 'check' : 'training');
        $('practice-resume').hidden = !pointer;
        if (pointer) $('practice-resume-text').textContent = pointer.name + ' · '
            + (checkMode ? 'Подходит или нет · карточка ' : 'Тренировка · вопрос ')
            + (pointer.index + 1) + ' из ' + pointer.total;
    }
    function focusQuestion(id) {
        const node = $(id); node.tabIndex = -1;
        node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'start' });
    }
    function loadingPractice(on) {
        practiceLoading = on;
        $('practice-loading').hidden = !on;
        $('practice-resume-button').disabled = on;
    }
    async function resumePractice() {
        if (practiceLoading) return;
        const kind = checkMode ? 'check' : 'training';
        const pointer = readPractice(kind);
        if (!pointer) return;
        const revision = viewRevision;
        loadingPractice(true); showError('');
        try {
            const batch = await api('/api/' + (kind === 'training' ? 'training' : 'option-checks') + '/batches/' + pointer.id + '/resume');
            if (revision !== viewRevision) return;
            if (kind === 'training') {
                trainingBatchId = batch.id; questions = batch.questions;
                showSection = batch.mode === 'mistakes';
                $('category-name').textContent = batch.category_name;
                finishText = showSection ? FINISH_MISTAKES : FINISH_PORTION;
                finishHint = showSection ? '' : NEXT_PORTION_HINT;
                finishPractice = batch.category_id ? practiceTopicOf({ name: batch.category_name }) : null;
                progressLabel = showSection ? 'Вопрос' : 'Порция: вопрос';
                for (const q of questions) {
                    const key = batch.id + ':' + q.id;
                    savedTraining.delete(key); unconfirmedAnswers.delete(key);
                    if (q.answer) savedTraining.set(key, { ...q.result, selected_answer: q.answer.selected_answer });
                }
                index = Math.min(pointer.index, questions.length - 1);
                portionScore = questions.filter(q => q.answer?.correct).length;
                if (pointer.pending && questions[index].id === pointer.questionId && !questions[index].answer && typeof pointer.draft === 'string'
                    && /^[A-Z]+$/.test(pointer.draft) && [...pointer.draft].every(k => Object.hasOwn(questions[index].options, k))) {
                    unconfirmedAnswers.set(batch.id + ':' + pointer.questionId, pointer.draft);
                }
                showQuestion();
            } else {
                checkBatch = batch; $('check-category-name').textContent = batch.category_name;
                for (const card of batch.cards) {
                    const key = batch.id + ':' + card.question_id;
                    savedChecks.delete(key); unconfirmedChecks.delete(key);
                    if (card.answer) savedChecks.set(key, { ...card.result, fits: card.answer.fits });
                }
                checkIndex = Math.min(pointer.index, batch.cards.length - 1);
                checkScore = batch.cards.filter(c => c.result?.right).length;
                if (pointer.pending && batch.cards[checkIndex].question_id === pointer.questionId && !batch.cards[checkIndex].answer && typeof pointer.draft === 'boolean') {
                    unconfirmedChecks.set(batch.id + ':' + pointer.questionId, pointer.draft);
                }
                showCheckCard();
            }
        } catch (err) {
            if (revision === viewRevision) showError(err.message || 'Не удалось продолжить тренировку. Попробуйте ещё раз.');
        } finally { loadingPractice(false); }
    }

    async function refreshMistakes() {
        const button = $('open-mistakes');
        try {
            const list = await api('/api/mistakes');
            button.textContent = 'Работа над ошибками (' + list.length + ')';
            button.disabled = list.length === 0;
        } catch (err) {
            button.textContent = 'Работа над ошибками';
            button.disabled = false;
        }
    }

    async function startMistakes() {
        showError('');
        if (practiceLoading) return;
        loadingPractice(true);
        const revision = viewRevision;
        try {
            const batch = await postJson('/api/training/batches', { mode: 'mistakes' });
            if (revision !== viewRevision) return;
            trainingBatchId = batch.id;
            questions = batch.questions;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        } finally { loadingPractice(false); }
        if (questions.length === 0) {
            showError('Список ошибок пуст');
            refreshMistakes();
            return;
        }
        $('category-name').textContent = 'Работа над ошибками';
        showSection = true;
        finishText = FINISH_MISTAKES;
        finishHint = '';
        finishPractice = null;
        progressLabel = 'Вопрос';
        index = 0;
        portionScore = 0;
        showQuestion();
    }

    async function loadCategories({ route = true } = {}) {
        showError('');
        stopTimer();
        exam = null;
        show('categories', { route });
        const revision = viewRevision;
        updatePracticeOffer();
        $('categories-loading').hidden = false;
        const list = $('categories');
        list.textContent = '';
        refreshMistakes();
        try {
            categories = await api('/api/categories');
            if (revision !== viewRevision) return;
            // Личный прогресс на карточках; если статистика недоступна, остаётся число вопросов в теме.
            const answered = new Map();
            try {
                (await api('/api/stats')).topics.forEach((topic) => answered.set(topic.id, topic.answered));
            } catch (err) {
                // карточки покажут только число вопросов
            }
            if (revision !== viewRevision) return;
            categories.forEach((category) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'card';
                const name = document.createElement('span');
                name.className = 'card-name';
                name.textContent = category.name;
                const count = document.createElement('span');
                count.className = 'card-count';
                count.textContent = answered.has(category.id)
                    ? 'решено ' + answered.get(category.id) + ' из ' + category.question_count
                    : questionsLabel(category.question_count);
                button.appendChild(name);
                button.appendChild(count);
                button.addEventListener('click', () => (checkMode ? startOptionCheck(category) : startCategory(category)));
                item.appendChild(button);
                // Материал к разделу; глава 7 материала о системных вызовах относится и к разделу 07.
                const materialName = { '04.': 'acid', '05.': 'xact', '07.': 'syscalls', '17.': 'interview', '18.': 'memory', '19.': 'syscalls', '20.': 'planner' }[category.name.slice(0, 3)] || null;
                if (materialName) {
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'link card-link';
                    link.textContent = 'Материал для изучения';
                    link.addEventListener('click', () => openMaterial(materialName));
                    item.appendChild(link);
                }
                const practice = practiceTopicOf(category);
                if (practice) {
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'link card-link';
                    link.textContent = 'Практикум';
                    link.addEventListener('click', () => openPractice(practice));
                    item.appendChild(link);
                }
                list.appendChild(item);
            });
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
        }
        if (revision === viewRevision) $('categories-loading').hidden = true;
        checkSavedExam();
    }

    async function startCategory(category) {
        showError('');
        if (practiceLoading) return;
        loadingPractice(true);
        const revision = viewRevision;
        try {
            const batch = await postJson('/api/training/batches', { category_id: category.id, limit: PORTION_SIZE });
            if (revision !== viewRevision) return;
            trainingBatchId = batch.id;
            questions = batch.questions;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        } finally { loadingPractice(false); }
        $('category-name').textContent = category.name;
        showSection = false;
        finishText = FINISH_PORTION;
        finishHint = NEXT_PORTION_HINT;
        finishPractice = practiceTopicOf(category);
        progressLabel = 'Порция: вопрос';
        index = 0;
        portionScore = 0;
        showQuestion();
    }

    // Ответы без подтверждения сервера: ключ «порция:вопрос» → отправленный ответ. Сервер мог его сохранить,
    // поэтому выбор остаётся заблокированным до успешного ответа — при повторах и при возврате к вопросу.
    const unconfirmedAnswers = new Map();
    const answerKeyOf = (question) => (trainingBatchId || '-') + ':' + question.id;

    function practiceTopicOf(category) {
        const topic = category.name.slice(0, 2);
        return PRACTICE_TOPICS.includes(topic) && category.name[2] === '.' ? topic : null;
    }

    // Итог порции: «верно X из N (P %)», под ним необязательная подсказка и, при слабом результате, практикум темы.
    function showFinish(text, score, total, hint, practice) {
        $('finish-text').textContent = text + ': верно ' + score + ' из ' + total
            + ' (' + Math.round((score * 100) / total) + ' %).';
        $('finish-hint').textContent = hint;
        $('finish-hint').hidden = !hint;
        const offer = practice && score < total * PRACTICE_BELOW ? practice : null;
        $('finish-practice').hidden = !offer;
        $('finish-practice-link').onclick = offer ? () => openPractice(offer) : null;
        show('finish');
    }

    function showQuestion() {
        portionScore = questions.filter(q => savedTraining.get(trainingBatchId + ':' + q.id)?.correct).length;
        if (index >= questions.length) {
            clearPracticePointer('training', trainingBatchId);
            showFinish(finishText, portionScore, questions.length, finishHint, finishPractice);
            return;
        }
        const question = questions[index];
        show('question');
        $('progress').textContent = progressLabel + ' ' + (index + 1) + ' из ' + questions.length;
        const section = showSection ? categories.find((c) => c.id === question.category_id) : null;
        $('question-section').textContent = section ? section.name : '';
        $('question-section').hidden = !section;
        renderRich($('question-text'), question.question_text);
        $('question-hint').textContent = hintText(question);
        $('question-hint').hidden = !isMulti(question);
        $('result').hidden = true;
        $('submit').disabled = false;

        const options = $('options');
        options.textContent = '';
        question.order.forEach((key, position) => {
            options.appendChild(makeOption(
                key, LETTERS[position], question.options[key], 'answer', isMulti(question) ? 'checkbox' : 'radio'
            ));
        });
        const pending = unconfirmedAnswers.get(answerKeyOf(question));
        if (pending) {
            options.querySelectorAll('input').forEach((input) => {
                input.checked = pending.includes(input.value);
                input.disabled = true;
            });
        }
        const stored = savedTraining.get(answerKeyOf(question));
        const pointer = readPractice('training');
        const draft = stored?.selected_answer || (pointer?.id === trainingBatchId && pointer.questionId === question.id ? pointer.draft : null);
        if (typeof draft === 'string') options.querySelectorAll('input').forEach(input => { input.checked = draft.includes(input.value); });
        if (stored) renderTrainingAnswer(question, stored);
        savePractice('training');
        focusQuestion('question-text');
    }

    function renderTrainingAnswer(question, result) {
        const rightKeys = result.correct_answer.split('');
        document.querySelectorAll('#options .option').forEach((label) => {
            const input = label.querySelector('input');
            input.disabled = true;
            label.classList.add('locked');
            if (rightKeys.includes(input.value)) {
                label.classList.add('correct');
            } else if (input.checked) {
                label.classList.add('wrong');
            }
            if (result.option_notes) appendNote(label.querySelector('.text'), result.option_notes[input.value]);
        });
        const status = $('result-status');
        status.textContent = result.correct ? 'Верно' : 'Неверно';
        status.className = 'status ' + (result.correct ? 'ok' : 'bad');
        const rightLetters = answerKeys(question, result.correct_answer)
            .map((key) => displayLetter(question, key)).join(', ');
        $('result-correct').textContent = (rightKeys.length > 1 ? 'Правильные ответы: ' : 'Правильный ответ: ') + rightLetters;
        $('result-explanation').textContent = result.explanation || '';
        $('result').hidden = false;
        ai.offer($('ai-question'), { mode: 'training', batch_id: trainingBatchId, question_id: question.id });
        $('submit').disabled = true;
    }

    async function submitAnswer(event) {
        event.preventDefault();
        if ($('question-view').hidden || $('submit').disabled) return;
        showError('');
        const question = questions[index];
        const revision = viewRevision;
        const answer = collectAnswer($('options'));
        if (answer === null) {
            showError(isMulti(question) ? 'Выберите варианты ответа' : 'Выберите вариант ответа');
            return;
        }
        $('submit').disabled = true;
        document.querySelectorAll('#options input').forEach((input) => { input.disabled = true; });
        const answerKey = answerKeyOf(question);
        const actor = user;
        const wasUnconfirmed = unconfirmedAnswers.has(answerKey);
        unconfirmedAnswers.set(answerKey, answer);
        savePractice('training');
        try {
            const result = await api('/api/answers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: question.id, answer, training_batch_id: trainingBatchId }),
            });
            if (user !== actor) return;
            unconfirmedAnswers.delete(answerKey);
            savedTraining.set(answerKey, { ...result, selected_answer: answer });
            // Даже повторное открытие того же вопроса — уже другой экран.
            if (revision !== viewRevision) return;
            portionScore = questions.filter(q => savedTraining.get(trainingBatchId + ':' + q.id)?.correct).length;
            renderTrainingAnswer(question, result);
            savePractice('training');
        } catch (err) {
            // Состояние ответа фиксируется независимо от текущего экрана; проверка экрана — только для DOM.
            const unconfirmed = NO_RESPONSE.includes(err.kind);
            if (user !== actor) return;
            if (!unconfirmed && !wasUnconfirmed) unconfirmedAnswers.delete(answerKey);
            if (unconfirmed) unconfirmedAnswers.set(answerKey, answer);
            if (trainingBatchId + ':' + questions[index]?.id === answerKey) savePractice('training');
            if (revision !== viewRevision) return;
            $('submit').disabled = false;
            // Ответ не подтверждён: сервер мог его уже сохранить. Выбор не меняется, и «Ответить»
            // повторяет тот же ответ — сервер вернёт сохранённый результат. Выбор можно изменить,
            // только если ни одна попытка не осталась без подтверждения.
            if (!unconfirmedAnswers.has(answerKey)) {
                document.querySelectorAll('#options input').forEach((input) => { input.disabled = false; });
            }
            showError(unconfirmed ? ANSWER_NOT_SAVED : err.message);
        }
    }

    // Экзамен: настройка

    function selectedExamCount() {
        const checked = document.querySelector('#exam-count input:checked');
        return checked ? Number(checked.value) : EXAM_DEFAULT_COUNT;
    }

    function updateTimeNote() {
        const count = selectedExamCount();
        const chosen = new Set(Array.from(document.querySelectorAll('#exam-categories input:checked')).map(n => Number(n.value)));
        const available = categories.filter(c => chosen.has(c.id)).reduce((sum, c) => sum + (Number(c.question_count) || 0), 0);
        const actual = Math.min(count, available);
        $('exam-time-note').textContent = 'Вопросов: ' + actual + ' · Время: ' + (actual * SECONDS_PER_QUESTION / 60).toLocaleString('ru-RU') + ' мин';
        $('exam-topics-note').textContent = chosen.size ? 'Выбрано тем: ' + chosen.size + ' из ' + categories.length : 'Выберите хотя бы одну тему';
        $('exam-start').disabled = examStarting || actual === 0;
        document.querySelectorAll('#exam-setup-view input').forEach(n => { n.disabled = examStarting; });
    }

    async function openExamSetup() {
        showError('');
        const revision = viewRevision;
        try {
            categories = await api('/api/categories');
            if (revision !== viewRevision) return;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        const counts = $('exam-count');
        counts.textContent = '';
        EXAM_COUNTS.forEach((count) => {
            const label = document.createElement('label');
            label.className = 'chip';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'exam-count';
            input.value = String(count);
            input.checked = count === EXAM_DEFAULT_COUNT;
            input.addEventListener('change', updateTimeNote);
            label.appendChild(input);
            label.appendChild(document.createTextNode(String(count)));
            counts.appendChild(label);
        });

        const list = $('exam-categories');
        list.textContent = '';
        categories.forEach((category) => {
            const label = document.createElement('label');
            label.className = 'option check';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = String(category.id);
            input.checked = category.in_exam !== false;
            input.addEventListener('change', updateTimeNote);
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = '✓';
            const text = document.createElement('span');
            text.className = 'text';
            text.textContent = category.name;
            label.appendChild(input);
            label.appendChild(badge);
            label.appendChild(text);
            list.appendChild(label);
        });
        updateTimeNote();
        $('exam-topics-settings').open = false;
        show('exam-setup');
    }

    // Экзамен: незавершённый экзамен хранится в браузере, отдельно для каждого пользователя.
    // Правильных ответов в нём нет: браузер их не получает до завершения экзамена.

    function savedExamKey() {
        return user ? 'pg16-exam:' + user.email : null;
    }

    function saveExam() {
        const key = savedExamKey();
        if (!key || !exam || exam.finishing) return;
        try {
            localStorage.setItem(key, JSON.stringify({
                questions: exam.questions,
                answers: exam.answers,
                index: exam.index,
                startedAt: exam.startedAt,
                deadline: exam.deadline,
                visited: exam.visited,
            }));
        } catch (err) {
            // хранилище недоступно или переполнено — экзамен просто не переживёт закрытие вкладки
        }
    }

    function readSavedExam() {
        const key = savedExamKey();
        if (!key) return null;
        try {
            const data = JSON.parse(localStorage.getItem(key) || 'null');
            const valid = data && Array.isArray(data.questions) && data.questions.length > 0
                && Array.isArray(data.answers) && data.answers.length === data.questions.length
                && Number.isFinite(data.deadline) && Number.isFinite(data.startedAt)
                && Number.isInteger(data.index) && data.index >= 0 && data.index < data.questions.length;
            if (!valid && data) localStorage.removeItem(key);
            return valid ? data : null;
        } catch (err) {
            return null;
        }
    }

    function clearSavedExam() {
        const key = savedExamKey();
        if (!key) return;
        try {
            localStorage.removeItem(key);
        } catch (err) {
            // нечего удалять
        }
    }

    function restoreExam(data) {
        exam = {
            questions: data.questions,
            answers: data.answers,
            index: data.index,
            startedAt: data.startedAt,
            deadline: data.deadline,
            timerId: null,
            finishing: false,
            visited: Array.isArray(data.visited) && data.visited.length === data.questions.length && data.visited.every(v => typeof v === 'boolean')
                ? data.visited : data.questions.map((_, i) => i <= data.index || Boolean(data.answers[i])),
        };
    }

    // На экране категорий: плашка о незавершённом экзамене; если время вышло — экзамен завершается сам.
    function checkSavedExam() {
        const box = $('exam-resume');
        const data = readSavedExam();
        box.hidden = !data || exam !== null;
        if (!data || exam !== null) return;
        const remaining = Math.ceil((data.deadline - Date.now()) / 1000);
        if (remaining <= 0) {
            box.hidden = true;
            restoreExam(data);
            finishExam(true);
            return;
        }
        $('exam-resume-text').textContent = 'Есть незавершённый экзамен: вопрос ' + (data.index + 1)
            + ' из ' + data.questions.length + ', осталось ' + formatTime(remaining);
    }

    function resumeExam() {
        const data = readSavedExam();
        $('exam-resume').hidden = true;
        if (!data) return;
        showError('');
        restoreExam(data);
        show('exam');
        renderExamQuestion();
        startTimer();
        focusExamQuestion();
    }

    function finishSavedExam() {
        const data = readSavedExam();
        if (!data) return;
        restoreExam(data);
        const restored = exam;
        finishExam(false).then((completed) => {
            // если завершение отменили в диалоге, экзамен остаётся сохранённым
            if (completed === false && exam === restored) exam = null;
        });
    }

    // Экзамен: прохождение

    function stopTimer() {
        if (exam && exam.timerId) {
            clearInterval(exam.timerId);
            exam.timerId = null;
        }
    }

    function formatTime(totalSeconds) {
        const seconds = Math.max(0, totalSeconds);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function updateExamControls() {
        const locked = exam.finishing || Date.now() >= exam.deadline;
        document.querySelectorAll('#exam-options input').forEach((input) => {
            input.disabled = locked;
            input.closest('.option').classList.toggle('locked', locked);
        });
        $('exam-prev').disabled = exam.finishing || exam.index === 0;
        $('exam-next').disabled = exam.finishing || exam.index === exam.questions.length - 1;
        $('exam-finish').disabled = exam.finishing;
        document.querySelectorAll('#exam-map button').forEach(button => { button.disabled = exam.finishing; });
    }

    function startTimer(autoFinish = true) {
        stopTimer();
        tick(autoFinish);
        if (exam && !exam.finishing && Date.now() < exam.deadline) {
            exam.timerId = setInterval(tick, 1000);
        }
    }

    function tick(autoFinish = true) {
        if (!exam) return;
        const remaining = Math.ceil((exam.deadline - Date.now()) / 1000);
        $('exam-timer').textContent = formatTime(remaining);
        updateExamControls();
        if (remaining <= 0) {
            stopTimer();
            if (autoFinish) finishExam(true);
        }
    }

    async function startExam() {
        if (examStarting) return;
        showError('');
        const chosen = Array.from(document.querySelectorAll('#exam-categories input:checked')).map((el) => el.value);
        if (chosen.length === 0) {
            showError('Выберите хотя бы одну тему');
            return;
        }
        const count = selectedExamCount();
        const revision = viewRevision;
        examStarting = true;
        updateTimeNote();
        let loaded;
        try {
            loaded = await api('/api/exam?count=' + count + '&categories=' + chosen.join(','));
            if (revision !== viewRevision) return;
        } catch (err) {
            if (revision === viewRevision) showError(err.message);
            return;
        } finally { examStarting = false; updateTimeNote(); }
        if (loaded.length === 0) {
            showError('В выбранных темах нет вопросов');
            return;
        }
        exam = {
            questions: prepareQuestions(loaded),
            answers: loaded.map(() => null),
            index: 0,
            startedAt: Date.now(),
            deadline: Date.now() + loaded.length * SECONDS_PER_QUESTION * 1000,
            timerId: null,
            finishing: false,
            visited: loaded.map(() => false),
        };
        saveExam();
        $('exam-overview').open = false;
        show('exam');
        renderExamQuestion();
        startTimer();
        focusExamQuestion();
    }

    function renderExamQuestion() {
        const question = exam.questions[exam.index];
        exam.visited[exam.index] = true;
        $('exam-progress').textContent = 'Вопрос ' + (exam.index + 1) + ' из ' + exam.questions.length;
        renderRich($('exam-question'), question.question_text);
        $('exam-hint').textContent = hintText(question);
        $('exam-hint').hidden = !isMulti(question);
        const options = $('exam-options');
        options.textContent = '';
        const saved = exam.answers[exam.index] || '';
        question.order.forEach((key, position) => {
            const label = makeOption(
                key, LETTERS[position], question.options[key], 'exam-answer', isMulti(question) ? 'checkbox' : 'radio'
            );
            const input = label.querySelector('input');
            input.checked = saved.includes(key);
            input.addEventListener('change', () => {
                // Событие может прийти между истечением срока и следующим тиком таймера.
                if (exam.finishing || Date.now() >= exam.deadline) {
                    renderExamQuestion();
                    return;
                }
                exam.answers[exam.index] = collectAnswer(options);
                saveExam();
                renderExamOverview();
            });
            options.appendChild(label);
        });
        renderExamOverview();
        updateExamControls();
        saveExam();
    }

    function renderExamOverview() {
        const map = $('exam-map');
        if (overviewQuestions !== exam.questions) {
            overviewQuestions = exam.questions;
            map.textContent = '';
            exam.questions.forEach((_, i) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'exam-number';
                button.append(document.createTextNode(String(i + 1)));
                const status = document.createElement('span');
                status.className = 'exam-number-status';
                status.setAttribute('aria-hidden', 'true');
                button.appendChild(status);
                button.addEventListener('click', () => {
                    if (window.matchMedia('(max-width: 600px)').matches) $('exam-overview').open = false;
                    jumpExamQuestion(i);
                });
                map.appendChild(button);
            });
        }
        const answered = exam.answers.filter(Boolean).length;
        $('exam-answered').textContent = 'Отвечено ' + answered + ' из ' + exam.questions.length;
        Array.from(map.children).forEach((button, i) => {
            const state = exam.answers[i] ? 'answered' : exam.visited[i] ? 'skipped' : 'unvisited';
            const current = i === exam.index;
            button.dataset.state = state;
            button.classList.toggle('current', current);
            if (current) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
            button.setAttribute('aria-label', 'Вопрос ' + (i + 1) + ': '
                + (state === 'answered' ? 'отвечен' : state === 'skipped' && !current ? 'пропущен' : 'без ответа')
                + (current ? ', текущий' : state === 'unvisited' ? ', ещё не открыт' : ''));
            button.querySelector('span').textContent = state === 'answered' ? '●' : state === 'skipped' && !current ? '—' : '○';
        });
    }

    function focusExamQuestion() {
        $('exam-question').tabIndex = -1;
        $('exam-question').focus({ preventScroll: true });
        document.querySelector('.exam-bar').scrollIntoView({ block: 'start' });
    }

    function jumpExamQuestion(index) {
        if (!exam || exam.finishing || !Number.isInteger(index) || index < 0 || index >= exam.questions.length) return;
        exam.index = index;
        if (window.matchMedia('(max-width: 600px)').matches) $('exam-overview').open = false;
        renderExamQuestion();
        focusExamQuestion();
    }

    async function finishExam(auto) {
        if (!exam || exam.finishing) return;
        if (!auto) {
            const unanswered = exam.answers.filter((a) => a === null).length;
            if (unanswered > 0) {
                const message = 'Без ответа: ' + unanswered + '. Завершить экзамен?';
                if (!window.confirm(message)) return false;
            }
        }
        exam.finishing = true;
        const submitted = exam;
        stopTimer();
        showError('');
        show('exam');
        renderExamQuestion();
        tick(false);
        try {
            const result = await api('/api/exam/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answers: exam.questions.map((q, i) => ({ question_id: q.id, answer: exam.answers[i] })),
                    duration_seconds: Math.max(0, Math.min(86400, Math.round((Math.min(Date.now(), exam.deadline) - exam.startedAt) / 1000))),
                }),
            });
            if (exam !== submitted) return;
            clearSavedExam();
            renderResult(result);
            return true;
        } catch (err) {
            if (exam !== submitted) return;
            exam.finishing = false;
            // До срока продолжаем отсчёт. После срока ждём ручного повтора,
            // чтобы недоступный API не вызывался бесконечно каждую секунду.
            startTimer(false);
            showError(err.message);
        }
    }

    // История выданных тренировок: снимок вопросов и фактический порядок показа.

    function openTrainingHistory() {
        showError('');
        show('training-history');
        trainingHistoryBefore = null;
        $('training-history-list').textContent = '';
        $('training-history-empty').hidden = true;
        $('training-history-more').hidden = true;
        $('training-history-more').disabled = false;
        loadTrainingHistoryPage();
    }

    async function loadTrainingHistoryPage() {
        const more = $('training-history-more');
        if (more.disabled) return;
        more.disabled = true;
        showError('');
        const revision = viewRevision;
        try {
            const data = await api('/api/training/batches' + (trainingHistoryBefore ? '?before=' + trainingHistoryBefore : ''));
            if (revision !== viewRevision) return;
            data.batches.forEach((batch) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-secondary training-history-item';
                const title = document.createElement('strong');
                title.textContent = batch.category_name;
                const meta = document.createElement('span');
                meta.textContent = formatDate(batch.created_at) + ' · Порция №' + batch.id
                    + ' · Ответов ' + batch.answered + ' из ' + batch.question_count;
                button.appendChild(title);
                button.appendChild(meta);
                button.addEventListener('click', () => openTrainingBatch(batch.id));
                item.appendChild(button);
                $('training-history-list').appendChild(item);
            });
            trainingHistoryBefore = data.next_before;
            more.hidden = data.next_before === null;
            $('training-history-empty').hidden = $('training-history-list').children.length > 0;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            more.hidden = false;
        } finally {
            if (revision === viewRevision) more.disabled = false;
        }
    }

    async function openTrainingBatch(id) {
        showError('');
        show('training-batch');
        $('training-batch-title').textContent = '';
        $('training-batch-meta').textContent = '';
        $('training-batch-questions').textContent = '';
        const revision = viewRevision;
        try {
            const batch = await api('/api/training/batches/' + id);
            if (revision !== viewRevision) return;
            $('training-batch-title').textContent = batch.category_name;
            $('training-batch-meta').textContent = 'Порция №' + batch.id + ' · ' + formatDate(batch.created_at);
            batch.questions.forEach((question) => {
                const card = document.createElement('article');
                card.className = 'result training-question';
                const position = document.createElement('h3');
                position.textContent = 'Вопрос ' + question.position;
                const text = document.createElement('div');
                text.className = 'question';
                renderRich(text, question.question_text);
                const status = document.createElement('p');
                const answer = question.answer;
                status.className = answer ? 'status ' + (answer.correct ? 'ok' : 'bad') : 'progress';
                status.textContent = answer ? (answer.correct ? 'Верно' : 'Неверно') + ' · ' + formatDate(answer.answered_at) : 'Без ответа';
                const options = document.createElement('div');
                options.className = 'options';
                question.order.forEach((key, i) => {
                    const label = makeOption(key, LETTERS[i], question.options[key], 'history-' + question.position,
                        isMulti(question) ? 'checkbox' : 'radio');
                    const input = label.querySelector('input');
                    input.disabled = true;
                    input.checked = Boolean(answer && answer.selected_answer.includes(key));
                    label.classList.add('locked');
                    options.appendChild(label);
                });
                card.append(position, text, status, options);
                $('training-batch-questions').appendChild(card);
            });
        } catch (err) {
            if (revision === viewRevision) showError(err.message);
        }
    }

    // История экзаменов

    function renderExamRows(list, items) {
        list.textContent = '';
        items.forEach((item) => {
            const row = document.createElement('li');
            row.className = 'history-row';
            const when = document.createElement('span');
            when.className = 'history-date';
            when.textContent = formatDate(item.finished_at);
            const score = document.createElement('span');
            score.className = 'history-score';
            score.textContent = item.correct + ' из ' + item.total + ', ' + item.percent + '%';
            const status = document.createElement('span');
            status.className = 'status ' + (item.passed ? 'ok' : 'bad');
            status.textContent = item.passed ? 'Сдан' : 'Не сдан';
            const time = document.createElement('span');
            time.className = 'history-time';
            time.textContent = item.duration_seconds === null ? '' : formatTime(item.duration_seconds);
            row.appendChild(when);
            row.appendChild(score);
            row.appendChild(status);
            row.appendChild(time);
            list.appendChild(row);
        });
    }

    async function openHistory() {
        showError('');
        const revision = viewRevision;
        let items;
        try {
            items = await api('/api/exam/history');
            if (revision !== viewRevision) return;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        renderExamRows($('history-list'), items);
        $('history-empty').hidden = items.length > 0;
        show('history');
    }

    // Материал для изучения: Markdown с заголовками, абзацами, списками и блоками кода. Без innerHTML.

    function renderMaterial(container, text) {
        container.textContent = '';
        const lines = text.split('\n');
        let paragraph = [];
        let list = null;
        let code = null;
        const flushParagraph = () => {
            if (paragraph.length === 0) return;
            const p = document.createElement('p');
            appendInline(p, paragraph.join(' '));
            container.appendChild(p);
            paragraph = [];
        };
        lines.forEach((line) => {
            if (code !== null) {
                if (line.startsWith('```')) {
                    const pre = document.createElement('pre');
                    const codeEl = document.createElement('code');
                    codeEl.textContent = code.join('\n');
                    pre.appendChild(codeEl);
                    container.appendChild(pre);
                    code = null;
                } else {
                    code.push(line);
                }
                return;
            }
            if (line.startsWith('```')) {
                flushParagraph();
                list = null;
                code = [];
                return;
            }
            const heading = /^(#{1,3}) (.+)$/.exec(line);
            if (heading) {
                flushParagraph();
                list = null;
                const h = document.createElement('h' + (heading[1].length + 1));
                h.textContent = heading[2];
                container.appendChild(h);
                return;
            }
            if (line.startsWith('- ')) {
                flushParagraph();
                if (!list) {
                    list = document.createElement('ul');
                    container.appendChild(list);
                }
                const li = document.createElement('li');
                appendInline(li, line.slice(2));
                list.appendChild(li);
                return;
            }
            if (line.trim() === '') {
                flushParagraph();
                list = null;
                return;
            }
            paragraph.push(line.trim());
        });
        flushParagraph();
    }

    function openMaterial(name) {
        return openDocument('/api/materials/' + name, 'Материал недоступен');
    }

    function openPractice(topic) {
        return openDocument('/api/practice/' + topic, 'Практикум недоступен');
    }

    async function openDocument(url, failText) {
        showError('');
        const revision = viewRevision;
        let text;
        try {
            const started = Date.now();
            const { response, body, timedOut } = await timedFetch(url);
            if (response && response.status === 401) {
                showLogin();
                return;
            }
            if (!response || response.status >= 500) {
                reportClientError({ kind: !response ? (timedOut ? 'timeout' : 'network') : 'server',
                    path: url, status: response ? response.status : 0, ms: Date.now() - started });
            }
            if (!response || !response.ok) throw new Error(failText);
            text = body;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        if (revision !== viewRevision) return;
        renderMaterial($('material-body'), text);
        show('material');
        window.scrollTo(0, 0);
    }

    // Статистика

    function cell(row, text, numeric) {
        const td = document.createElement('td');
        td.textContent = text;
        if (numeric) td.className = 'num';
        row.appendChild(td);
        return td;
    }

    function percentText(value) {
        return value === null || value === undefined ? '—' : value + '%';
    }

    function renderTopicRows(tbody, topics) {
        tbody.textContent = '';
        topics.forEach((topic) => {
            const row = document.createElement('tr');
            cell(row, topic.name);
            cell(row, topic.answered + ' из ' + topic.question_count, true);
            cell(row, percentText(topic.correct_percent), true);
            cell(row, String(topic.mistakes), true);
            tbody.appendChild(row);
        });
    }

    async function openStats() {
        showError('');
        const revision = viewRevision;
        let data;
        try {
            data = await api('/api/stats');
            if (revision !== viewRevision) return;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        renderTopicRows($('stats-topics'), data.topics);
        show('stats');
    }

    async function openAdmin() {
        showError('');
        const revision = viewRevision;
        let users;
        let hard;
        try {
            [users, hard] = await Promise.all([api('/api/admin/users'), api('/api/admin/hard-questions')]);
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        if (revision !== viewRevision) return;
        const tbody = $('admin-users');
        tbody.textContent = '';
        users.forEach((item) => {
            const row = document.createElement('tr');
            row.className = 'clickable';
            row.tabIndex = 0;
            cell(row, item.email + (item.role === 'admin' ? ' (админ)' : ''));
            cell(row, formatDate(item.created_at));
            cell(row, formatDate(item.last_login_at));
            cell(row, String(item.answers), true);
            cell(row, percentText(item.correct_percent), true);
            cell(row, String(item.exams), true);
            cell(row, item.last_exam_percent === null ? '—'
                : item.last_exam_percent + '%, ' + (item.last_exam_passed ? 'сдан' : 'не сдан'), true);
            row.addEventListener('click', () => openAdminUser(item.id));
            row.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') openAdminUser(item.id);
            });
            tbody.appendChild(row);
        });

        const list = $('hard-list');
        list.textContent = '';
        $('hard-empty').hidden = hard.length > 0;
        hard.forEach((item) => {
            const li = document.createElement('li');
            const meta = document.createElement('div');
            meta.className = 'hard-meta';
            meta.textContent = item.category_name + ' · ответов: ' + item.answers + ' · ошибок: ' + item.error_percent + '%';
            const text = document.createElement('div');
            renderRich(text, item.question_text);
            li.appendChild(meta);
            li.appendChild(text);
            list.appendChild(li);
        });
        show('admin');
    }

    async function openAdminUser(id) {
        showError('');
        const revision = viewRevision;
        let data;
        try {
            data = await api('/api/admin/users/' + encodeURIComponent(id));
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        }
        if (revision !== viewRevision) return;
        $('admin-user-email').textContent = data.user.email;
        renderTopicRows($('admin-user-topics'), data.topics);
        renderExamRows($('admin-user-exams'), data.exams);
        $('admin-user-exams-empty').hidden = data.exams.length > 0;
        show('admin-user');
    }

    function renderResult(result) {
        showError('');
        $('score-percent').textContent = result.percent + '%';
        const status = $('score-status');
        status.textContent = result.passed ? 'Сдан' : 'Не сдан';
        status.className = 'status ' + (result.passed ? 'ok' : 'bad');
        $('score-detail').textContent = 'Верных ответов: ' + result.correct + ' из ' + result.total
            + '. Порог сдачи: ' + result.pass_percent + '%.';

        const names = new Map(categories.map((c) => [c.id, c.name]));
        const stats = new Map();
        result.results.forEach((r) => {
            const stat = stats.get(r.category_id) || { total: 0, correct: 0 };
            stat.total += 1;
            if (r.correct) stat.correct += 1;
            stats.set(r.category_id, stat);
        });
        const list = $('score-categories');
        list.textContent = '';
        Array.from(stats.entries())
            .sort((a, b) => String(names.get(a[0])).localeCompare(String(names.get(b[0]))))
            .forEach(([id, stat]) => {
                const item = document.createElement('li');
                item.textContent = (names.get(id) || 'Тема ' + id) + ': ' + stat.correct + ' из ' + stat.total;
                list.appendChild(item);
            });

        const errorsBox = $('score-errors');
        errorsBox.textContent = '';
        const wrong = result.results
            .map((r, i) => ({ r, question: exam.questions[i] }))
            .filter(({ r }) => !r.correct);
        $('errors-title').hidden = wrong.length === 0;
        wrong.forEach(({ r, question }) => {
            const card = document.createElement('div');
            card.className = 'result error-card';
            const title = document.createElement('div');
            title.className = 'question';
            renderRich(title, question.question_text);
            const mine = document.createElement('div');
            mine.className = 'answer-block';
            const mineTitle = document.createElement('p');
            mineTitle.textContent = r.answer === null
                ? 'Ваш ответ: нет ответа'
                : (r.answer.length > 1 ? 'Ваши ответы:' : 'Ваш ответ:');
            mine.appendChild(mineTitle);
            if (r.answer !== null) appendAnswerLines(mine, question, r.answer, r.option_notes, r.correct_answer);
            const right = document.createElement('div');
            right.className = 'answer-block';
            const rightTitle = document.createElement('p');
            rightTitle.textContent = r.correct_answer.length > 1 ? 'Правильные ответы:' : 'Правильный ответ:';
            right.appendChild(rightTitle);
            appendAnswerLines(right, question, r.correct_answer);
            const note = document.createElement('p');
            note.className = 'explanation';
            note.textContent = r.explanation || '';
            card.appendChild(title);
            card.appendChild(mine);
            card.appendChild(right);
            card.appendChild(note);
            errorsBox.appendChild(card);
        });
        show('exam-result');
    }

    // ── Режим «Подходит или нет» ───────────────────────────────────────────
    function setMode(check) {
        checkMode = check;
        $('mode-train').classList.toggle('active', !check);
        $('mode-check').classList.toggle('active', check);
        $('mode-train').setAttribute('aria-pressed', String(!check));
        $('mode-check').setAttribute('aria-pressed', String(check));
        updatePracticeOffer();
    }

    async function startOptionCheck(category) {
        showError('');
        if (practiceLoading) return;
        loadingPractice(true);
        const revision = viewRevision;
        try {
            const batch = await postJson('/api/option-checks/batches', { category_id: category.id });
            if (revision !== viewRevision) return;
            checkBatch = batch;
        } catch (err) {
            if (revision !== viewRevision) return;
            showError(err.message);
            return;
        } finally { loadingPractice(false); }
        if (!checkBatch.cards.length) {
            showError('В этом разделе нет вопросов');
            return;
        }
        $('check-category-name').textContent = checkBatch.category_name;
        checkIndex = 0;
        checkScore = 0;
        showCheckCard();
    }

    function showCheckCard() {
        checkScore = checkBatch.cards.filter(c => savedChecks.get(checkBatch.id + ':' + c.question_id)?.right).length;
        if (checkIndex >= checkBatch.cards.length) {
            clearPracticePointer('check', checkBatch.id);
            showFinish(FINISH_PORTION, checkScore, checkBatch.cards.length, '');
            return;
        }
        const card = checkBatch.cards[checkIndex];
        show('option-check');
        $('check-progress').textContent = 'Карточка ' + (checkIndex + 1) + ' из ' + checkBatch.cards.length;
        renderRich($('check-question-text'), card.question_text);
        $('check-hint').hidden = !card.multi;
        const option = $('check-option');
        option.className = 'check-option';
        renderRich(option, card.option_text);
        $('check-result').hidden = true;
        // Ответ без подтверждения: сервер мог его сохранить, поэтому доступна только отправленная кнопка.
        const pending = unconfirmedChecks.get(checkBatch.id + ':' + card.question_id);
        $('check-yes').disabled = pending === false;
        $('check-no').disabled = pending === true;
        const stored = savedChecks.get(checkBatch.id + ':' + card.question_id);
        if (stored) renderCheckAnswer(card, stored);
        savePractice('check');
        focusQuestion('check-question-text');
    }

    function renderCheckAnswer(card, result) {
        $('check-yes').disabled = $('check-no').disabled = true;
        const status = $('check-status');
        status.textContent = result.right ? 'Верно' : 'Неверно';
        status.className = 'status ' + (result.right ? 'ok' : 'bad');
        $('check-fits').textContent = result.option_fits ? 'Этот вариант подходит как ответ.' : 'Этот вариант не подходит как ответ.';
        $('check-note').textContent = result.option_note || '';
        $('check-explanation').textContent = result.explanation || '';
        $('check-option').className = 'check-option ' + (result.right ? 'right' : 'wrong');
        $('check-result').hidden = false;
        ai.offer($('ai-check'), { mode: 'option-check', batch_id: checkBatch.id, question_id: card.question_id });
    }

    async function submitOptionCheck(fits) {
        if ($('check-yes').disabled && $('check-no').disabled) return;
        showError('');
        const revision = viewRevision;
        const card = checkBatch.cards[checkIndex];
        const key = checkBatch.id + ':' + card.question_id;
        $('check-yes').disabled = true;
        $('check-no').disabled = true;
        const actor = user;
        const wasUnconfirmed = unconfirmedChecks.has(key);
        unconfirmedChecks.set(key, fits);
        savePractice('check');
        try {
            const result = await postJson('/api/option-checks', { batch_id: checkBatch.id, question_id: card.question_id, fits });
            if (user !== actor) return;
            unconfirmedChecks.delete(key);
            savedChecks.set(key, { ...result, fits });
            if (revision !== viewRevision) return;
            checkScore = checkBatch.cards.filter(c => savedChecks.get(checkBatch.id + ':' + c.question_id)?.right).length;
            renderCheckAnswer(card, result);
            savePractice('check');
        } catch (err) {
            const unconfirmed = NO_RESPONSE.includes(err.kind);
            if (user !== actor) return;
            if (!unconfirmed && !wasUnconfirmed) unconfirmedChecks.delete(key);
            if (unconfirmed) unconfirmedChecks.set(key, fits);
            if (checkBatch.id + ':' + checkBatch.cards[checkIndex]?.question_id === key) savePractice('check');
            if (revision !== viewRevision) return;
            const pending = unconfirmedChecks.get(key);
            $('check-yes').disabled = pending === false;
            $('check-no').disabled = pending === true;
            showError(unconfirmed ? ANSWER_NOT_SAVED : err.message);
        }
    }

    $('mode-train').addEventListener('click', () => setMode(false));
    $('mode-check').addEventListener('click', () => setMode(true));
    $('check-yes').addEventListener('click', () => submitOptionCheck(true));
    $('check-no').addEventListener('click', () => submitOptionCheck(false));
    $('check-next').addEventListener('click', () => {
        checkIndex += 1;
        showCheckCard();
    });
    $('check-back').addEventListener('click', loadCategories);

    $('practice-resume-button').addEventListener('click', resumePractice);
    $('options').addEventListener('change', () => savePractice('training'));
    $('answer-form').addEventListener('submit', submitAnswer);
    $('next').addEventListener('click', () => {
        index += 1;
        showQuestion();
    });
    $('back').addEventListener('click', loadCategories);
    $('finish-back').addEventListener('click', loadCategories);

    document.querySelectorAll('#main-nav a').forEach((link) => {
        link.addEventListener('click', (event) => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigateSection(link.hash.slice(2));
        });
    });
    $('open-mistakes').addEventListener('click', startMistakes);
    $('open-history').addEventListener('click', openHistory);
    $('open-training-history').addEventListener('click', openTrainingHistory);
    $('training-history-back').addEventListener('click', () => show('results'));
    $('training-history-more').addEventListener('click', loadTrainingHistoryPage);
    $('training-batch-back').addEventListener('click', openTrainingHistory);
    $('history-back').addEventListener('click', () => show('results'));
    $('exam-setup-back').addEventListener('click', loadCategories);
    $('exam-start').addEventListener('click', startExam);
    $('exam-prev').addEventListener('click', () => {
        if (exam && !exam.finishing && exam.index > 0) {
            jumpExamQuestion(exam.index - 1);
        }
    });
    $('exam-next').addEventListener('click', () => {
        if (exam && !exam.finishing && exam.index < exam.questions.length - 1) {
            jumpExamQuestion(exam.index + 1);
        }
    });
    $('exam-finish').addEventListener('click', () => finishExam(false));
    $('exam-resume-continue').addEventListener('click', resumeExam);
    $('exam-resume-finish').addEventListener('click', finishSavedExam);
    $('result-new').addEventListener('click', openExamSetup);
    $('result-back').addEventListener('click', loadCategories);

    $('login-form').addEventListener('submit', requestLink);
    $('login-again').addEventListener('click', () => {
        showError('');
        show('login');
    });
    $('login-confirm').addEventListener('click', confirmLogin);
    $('code-form').addEventListener('submit', submitCode);
    $('logout').addEventListener('click', logout);
    $('accent-select').addEventListener('change', changeAccent);
    $('theme-select').addEventListener('change', changeTheme);
    $('open-changelog').addEventListener('click', () => openMaterial('changelog'));
    $('open-privacy').addEventListener('click', openPrivacy);
    $('privacy-back').addEventListener('click', () => {
        if (privacyReturn === 'categories') loadCategories();
        else show('login');
    });
    $('material-back').addEventListener('click', loadCategories);
    $('open-stats').addEventListener('click', openStats);
    $('stats-back').addEventListener('click', () => show('results'));
    $('open-admin').addEventListener('click', openAdmin);
    $('admin-back').addEventListener('click', loadCategories);
    $('admin-user-back').addEventListener('click', openAdmin);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') $('user-bar').open = false;
    });
    document.addEventListener('click', (event) => {
        if (!$('user-bar').contains(event.target)) $('user-bar').open = false;
    });

    // Ссылку могут открыть во вкладке, где сайт уже открыт: тогда меняется только часть после #.
    window.addEventListener('hashchange', () => {
        if (!takeLoginLink() && location.hash.startsWith('#/')) navigateSection(location.hash.slice(2), true);
    });

    init();
})();
