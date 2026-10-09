(function () {
    const $ = (id) => document.getElementById(id);

    const VIEWS = ['categories', 'question', 'finish', 'exam-setup', 'exam', 'exam-result'];
    const EXAM_COUNTS = [20, 30, 50];
    const EXAM_DEFAULT_COUNT = 30;
    const SECONDS_PER_QUESTION = 90;
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    let categories = [];
    let questions = [];
    let index = 0;
    let exam = null;

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
        if (!response.ok) {
            throw new Error((data && data.error) || 'Ошибка запроса');
        }
        return data;
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

    function optionLine(question, key) {
        return displayLetter(question, key) + '. ' + question.options[key];
    }

    function makeOption(key, letter, text, name, inputType) {
        const label = document.createElement('label');
        label.className = 'option';
        const input = document.createElement('input');
        input.type = inputType || 'radio';
        input.name = name;
        input.value = key;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = letter;
        const body = document.createElement('span');
        body.className = 'text';
        body.textContent = text;
        label.appendChild(input);
        label.appendChild(badge);
        label.appendChild(body);
        return label;
    }

    // Категории и тренировка

    async function loadCategories() {
        showError('');
        stopTimer();
        exam = null;
        show('categories');
        const list = $('categories');
        list.textContent = '';
        try {
            categories = await api('/api/categories');
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
                count.textContent = questionsLabel(category.question_count);
                button.appendChild(name);
                button.appendChild(count);
                button.addEventListener('click', () => startCategory(category));
                item.appendChild(button);
                list.appendChild(item);
            });
        } catch (err) {
            showError(err.message);
        }
    }

    async function startCategory(category) {
        showError('');
        try {
            questions = prepareQuestions(shuffle(await api('/api/questions?category_id=' + encodeURIComponent(category.id))));
        } catch (err) {
            showError(err.message);
            return;
        }
        $('category-name').textContent = category.name;
        index = 0;
        showQuestion();
    }

    function showQuestion() {
        if (index >= questions.length) {
            show('finish');
            return;
        }
        const question = questions[index];
        show('question');
        $('progress').textContent = 'Вопрос ' + (index + 1) + ' из ' + questions.length;
        $('question-text').textContent = question.question_text;
        $('result').hidden = true;
        $('submit').disabled = false;

        const options = $('options');
        options.textContent = '';
        question.order.forEach((key, position) => {
            options.appendChild(makeOption(key, LETTERS[position], question.options[key], 'answer'));
        });
    }

    async function submitAnswer(event) {
        event.preventDefault();
        showError('');
        const selected = document.querySelector('#options input[name="answer"]:checked');
        if (!selected) {
            showError('Выберите вариант ответа');
            return;
        }
        try {
            const result = await api('/api/answers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: questions[index].id, answer: selected.value }),
            });
            document.querySelectorAll('#options .option').forEach((label) => {
                const input = label.querySelector('input');
                input.disabled = true;
                label.classList.add('locked');
                if (input.value === result.correct_answer) {
                    label.classList.add('correct');
                } else if (input.checked) {
                    label.classList.add('wrong');
                }
            });
            const status = $('result-status');
            status.textContent = result.correct ? 'Верно' : 'Неверно';
            status.className = 'status ' + (result.correct ? 'ok' : 'bad');
            $('result-correct').textContent = 'Правильный ответ: ' + displayLetter(questions[index], result.correct_answer);
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
            input.checked = true;
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
            deadline: Date.now() + loaded.length * SECONDS_PER_QUESTION * 1000,
            timerId: null,
            finishing: false,
        };
        show('exam');
        renderExamQuestion();
        tick();
        exam.timerId = setInterval(tick, 1000);
    }

    function renderExamQuestion() {
        const question = exam.questions[exam.index];
        $('exam-progress').textContent = 'Вопрос ' + (exam.index + 1) + ' из ' + exam.questions.length;
        $('exam-question').textContent = question.question_text;
        const options = $('exam-options');
        options.textContent = '';
        question.order.forEach((key, position) => {
            const label = makeOption(key, LETTERS[position], question.options[key], 'exam-answer');
            const input = label.querySelector('input');
            input.checked = exam.answers[exam.index] === key;
            input.addEventListener('change', () => {
                exam.answers[exam.index] = key;
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
                }),
            });
            renderResult(result);
        } catch (err) {
            exam.finishing = false;
            showError(err.message);
        }
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
            const title = document.createElement('p');
            title.className = 'question';
            title.textContent = question.question_text;
            const mine = document.createElement('p');
            mine.textContent = r.answer === null
                ? 'Ваш ответ: нет ответа'
                : 'Ваш ответ: ' + optionLine(question, r.answer);
            const right = document.createElement('p');
            right.textContent = 'Правильный ответ: ' + optionLine(question, r.correct_answer);
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
    $('exam-setup-back').addEventListener('click', loadCategories);
    $('exam-start').addEventListener('click', startExam);
    $('exam-prev').addEventListener('click', () => {
        if (exam.index > 0) {
            exam.index -= 1;
            renderExamQuestion();
        }
    });
    $('exam-next').addEventListener('click', () => {
        if (exam.index < exam.questions.length - 1) {
            exam.index += 1;
            renderExamQuestion();
        }
    });
    $('exam-finish').addEventListener('click', () => finishExam(false));
    $('result-new').addEventListener('click', openExamSetup);
    $('result-back').addEventListener('click', loadCategories);

    loadCategories();
})();
