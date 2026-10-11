(function () {
    const $ = (id) => document.getElementById(id);

    const VIEWS = ['login', 'login-sent', 'login-confirm', 'privacy', 'categories', 'question', 'finish',
        'exam-setup', 'exam', 'exam-result', 'history', 'stats', 'admin', 'admin-user', 'material'];
    const EXAM_COUNTS = [20, 30, 50];
    const EXAM_DEFAULT_COUNT = 30;
    const SECONDS_PER_QUESTION = 90;
    const PORTION_SIZE = 16;
    const FINISH_PORTION = 'Порция вопросов пройдена. Откройте тему снова, чтобы получить следующую: сначала новые вопросы и те, где были ошибки.';
    const FINISH_MISTAKES = 'Вопросы из списка ошибок закончились.';
    let finishText = FINISH_PORTION;
    let progressLabel = 'Порция: вопрос';
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    let categories = [];
    let questions = [];
    let index = 0;
    let exam = null;
    let user = null;
    let loginToken = null;
    let loginEmail = '';
    let loginRequest = '';
    let privacyReturn = 'login';

    function show(name) {
        VIEWS.forEach((key) => {
            $(key + '-view').hidden = key !== name;
        });
    }

    function showError(message) {
        const box = $('error');
        box.textContent = message;
        box.hidden = !message;
    }

    async function api(url, options) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => null);
        if (response.status === 401) {
            // Сеанс истёк или его нет: показать вход без сообщения об ошибке.
            showLogin();
            throw new Error('');
        }
        if (!response.ok) {
            throw new Error((data && data.error) || 'Ошибка запроса');
        }
        return data;
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
        stopTimer();
        exam = null;
        $('user-bar').hidden = true;
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
        showLogin();
    }

    function openPrivacy() {
        privacyReturn = user ? 'categories' : 'login';
        showError('');
        show('privacy');
    }

    function startApp(me) {
        user = me;
        $('user-email').textContent = me.email;
        $('user-bar').hidden = false;
        $('open-admin').hidden = me.role !== 'admin';
        loadCategories();
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
            const current = await fetch('/api/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
            if (current && current.email !== target.email) {
                $('login-confirm-warning').textContent = 'Сейчас вы вошли как ' + current.email + '. Войти в другой аккаунт?';
                $('login-confirm-warning').hidden = false;
            }
            $('login-confirm').disabled = false;
        } catch (err) {
            loginToken = null;
            const message = err.message || 'Ссылка недействительна или устарела';
            const current = await fetch('/api/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
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
        try {
            questions = prepareQuestions(shuffle(await api('/api/mistakes')));
        } catch (err) {
            showError(err.message);
            return;
        }
        if (questions.length === 0) {
            showError('Список ошибок пуст');
            refreshMistakes();
            return;
        }
        $('category-name').textContent = 'Работа над ошибками';
        finishText = FINISH_MISTAKES;
        progressLabel = 'Вопрос';
        index = 0;
        showQuestion();
    }

    async function loadCategories() {
        showError('');
        stopTimer();
        exam = null;
        show('categories');
        const list = $('categories');
        list.textContent = '';
        refreshMistakes();
        try {
            categories = await api('/api/categories');
            // Личный прогресс на карточках; если статистика недоступна, остаётся число вопросов в теме.
            const answered = new Map();
            try {
                (await api('/api/stats')).topics.forEach((topic) => answered.set(topic.id, topic.answered));
            } catch (err) {
                // карточки покажут только число вопросов
            }
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
                button.addEventListener('click', () => startCategory(category));
                item.appendChild(button);
                if (category.name.startsWith('17.')) {
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'link card-link';
                    link.textContent = 'Материал для изучения';
                    link.addEventListener('click', openMaterial);
                    item.appendChild(link);
                }
                list.appendChild(item);
            });
        } catch (err) {
            showError(err.message);
        }
        checkSavedExam();
    }

    async function startCategory(category) {
        showError('');
        try {
            questions = prepareQuestions(shuffle(await api('/api/questions?category_id=' + encodeURIComponent(category.id) + '&limit=' + PORTION_SIZE)));
        } catch (err) {
            showError(err.message);
            return;
        }
        $('category-name').textContent = category.name;
        finishText = FINISH_PORTION;
        progressLabel = 'Порция: вопрос';
        index = 0;
        showQuestion();
    }

    function showQuestion() {
        if (index >= questions.length) {
            $('finish-text').textContent = finishText;
            show('finish');
            return;
        }
        const question = questions[index];
        show('question');
        $('progress').textContent = progressLabel + ' ' + (index + 1) + ' из ' + questions.length;
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
    }

    async function submitAnswer(event) {
        event.preventDefault();
        showError('');
        const answer = collectAnswer($('options'));
        if (answer === null) {
            showError(isMulti(questions[index]) ? 'Выберите варианты ответа' : 'Выберите вариант ответа');
            return;
        }
        try {
            const result = await api('/api/answers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: questions[index].id, answer }),
            });
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
            const rightLetters = answerKeys(questions[index], result.correct_answer)
                .map((key) => displayLetter(questions[index], key)).join(', ');
            $('result-correct').textContent = (rightKeys.length > 1 ? 'Правильные ответы: ' : 'Правильный ответ: ') + rightLetters;
            $('result-explanation').textContent = result.explanation || '';
            $('result').hidden = false;
            $('submit').disabled = true;
        } catch (err) {
            showError(err.message);
        }
    }

    // Экзамен: настройка

    function selectedExamCount() {
        const checked = document.querySelector('#exam-count input:checked');
        return checked ? Number(checked.value) : EXAM_DEFAULT_COUNT;
    }

    function updateTimeNote() {
        const count = selectedExamCount();
        const minutes = Math.ceil((count * SECONDS_PER_QUESTION) / 60);
        $('exam-time-note').textContent = 'Время на экзамен: ' + minutes + ' мин';
    }

    async function openExamSetup() {
        showError('');
        try {
            categories = await api('/api/categories');
        } catch (err) {
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
        tick();
        if (exam && !exam.finishing) exam.timerId = setInterval(tick, 1000);
    }

    function finishSavedExam() {
        const data = readSavedExam();
        if (!data) return;
        restoreExam(data);
        finishExam(false).then(() => {
            // если завершение отменили в диалоге, экзамен остаётся сохранённым
            if (exam && !exam.finishing) exam = null;
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

    function tick() {
        const remaining = Math.ceil((exam.deadline - Date.now()) / 1000);
        $('exam-timer').textContent = formatTime(remaining);
        if (remaining <= 0) {
            finishExam(true);
        }
    }

    async function startExam() {
        showError('');
        const chosen = Array.from(document.querySelectorAll('#exam-categories input:checked')).map((el) => el.value);
        if (chosen.length === 0) {
            showError('Выберите хотя бы одну тему');
            return;
        }
        const count = selectedExamCount();
        let loaded;
        try {
            loaded = await api('/api/exam?count=' + count + '&categories=' + chosen.join(','));
        } catch (err) {
            showError(err.message);
            return;
        }
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
        };
        saveExam();
        show('exam');
        renderExamQuestion();
        tick();
        exam.timerId = setInterval(tick, 1000);
    }

    function renderExamQuestion() {
        const question = exam.questions[exam.index];
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
                exam.answers[exam.index] = collectAnswer(options);
                saveExam();
            });
            options.appendChild(label);
        });
        $('exam-prev').disabled = exam.index === 0;
        $('exam-next').disabled = exam.index === exam.questions.length - 1;
    }

    async function finishExam(auto) {
        if (!exam || exam.finishing) return;
        if (!auto) {
            const unanswered = exam.answers.filter((a) => a === null).length;
            if (unanswered > 0) {
                const message = 'Без ответа: ' + unanswered + '. Завершить экзамен?';
                if (!window.confirm(message)) return;
            }
        }
        exam.finishing = true;
        stopTimer();
        try {
            const result = await api('/api/exam/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answers: exam.questions.map((q, i) => ({ question_id: q.id, answer: exam.answers[i] })),
                    duration_seconds: Math.max(0, Math.min(86400, Math.round((Math.min(Date.now(), exam.deadline) - exam.startedAt) / 1000))),
                }),
            });
            clearSavedExam();
            renderResult(result);
        } catch (err) {
            exam.finishing = false;
            showError(err.message);
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
        let items;
        try {
            items = await api('/api/exam/history');
        } catch (err) {
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

    async function openMaterial() {
        showError('');
        let text;
        try {
            const response = await fetch('/api/materials/interview');
            if (response.status === 401) {
                showLogin();
                return;
            }
            if (!response.ok) throw new Error('Материал недоступен');
            text = await response.text();
        } catch (err) {
            showError(err.message);
            return;
        }
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
        let data;
        try {
            data = await api('/api/stats');
        } catch (err) {
            showError(err.message);
            return;
        }
        renderTopicRows($('stats-topics'), data.topics);
        show('stats');
    }

    async function openAdmin() {
        showError('');
        let users;
        let hard;
        try {
            [users, hard] = await Promise.all([api('/api/admin/users'), api('/api/admin/hard-questions')]);
        } catch (err) {
            showError(err.message);
            return;
        }
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
        let data;
        try {
            data = await api('/api/admin/users/' + encodeURIComponent(id));
        } catch (err) {
            showError(err.message);
            return;
        }
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

    $('answer-form').addEventListener('submit', submitAnswer);
    $('next').addEventListener('click', () => {
        index += 1;
        showQuestion();
    });
    $('back').addEventListener('click', loadCategories);
    $('finish-back').addEventListener('click', loadCategories);

    $('open-exam').addEventListener('click', openExamSetup);
    $('open-mistakes').addEventListener('click', startMistakes);
    $('open-history').addEventListener('click', openHistory);
    $('history-back').addEventListener('click', loadCategories);
    $('exam-setup-back').addEventListener('click', loadCategories);
    $('exam-start').addEventListener('click', startExam);
    $('exam-prev').addEventListener('click', () => {
        if (exam.index > 0) {
            exam.index -= 1;
            saveExam();
            renderExamQuestion();
        }
    });
    $('exam-next').addEventListener('click', () => {
        if (exam.index < exam.questions.length - 1) {
            exam.index += 1;
            saveExam();
            renderExamQuestion();
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
    $('open-privacy').addEventListener('click', openPrivacy);
    $('privacy-back').addEventListener('click', () => {
        if (privacyReturn === 'categories') loadCategories();
        else show('login');
    });
    $('material-back').addEventListener('click', loadCategories);
    $('open-stats').addEventListener('click', openStats);
    $('stats-back').addEventListener('click', loadCategories);
    $('open-admin').addEventListener('click', openAdmin);
    $('admin-back').addEventListener('click', loadCategories);
    $('admin-user-back').addEventListener('click', openAdmin);

    // Ссылку могут открыть во вкладке, где сайт уже открыт: тогда меняется только часть после #.
    window.addEventListener('hashchange', takeLoginLink);

    init();
})();
