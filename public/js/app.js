(function () {
    const $ = (id) => document.getElementById(id);

    const views = {
        categories: $('categories-view'),
        question: $('question-view'),
        finish: $('finish-view'),
    };

    let questions = [];
    let index = 0;

    function show(name) {
        Object.keys(views).forEach((key) => {
            views[key].hidden = key !== name;
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

    async function loadCategories() {
        showError('');
        show('categories');
        const list = $('categories');
        list.textContent = '';
        try {
            const categories = await api('/api/categories');
            categories.forEach((category) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'card';
                button.textContent = category.name;
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
            questions = await api('/api/questions?category_id=' + encodeURIComponent(category.id));
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
        $('question-text').textContent = question.question_text;
        $('result').hidden = true;
        $('submit').disabled = false;

        const options = $('options');
        options.textContent = '';
        Object.keys(question.options).sort().forEach((letter) => {
            const label = document.createElement('label');
            label.className = 'option';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'answer';
            input.value = letter;
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = letter;
            const text = document.createElement('span');
            text.className = 'text';
            text.textContent = question.options[letter];
            label.appendChild(input);
            label.appendChild(badge);
            label.appendChild(text);
            options.appendChild(label);
        });
    }

    async function submitAnswer(event) {
        event.preventDefault();
        showError('');
        const selected = document.querySelector('input[name="answer"]:checked');
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
            $('result-correct').textContent = 'Правильный ответ: ' + result.correct_answer;
            $('result-explanation').textContent = result.explanation || '';
            $('result').hidden = false;
            $('submit').disabled = true;
        } catch (err) {
            showError(err.message);
        }
    }

    $('answer-form').addEventListener('submit', submitAnswer);
    $('next').addEventListener('click', () => {
        index += 1;
        showQuestion();
    });
    $('back').addEventListener('click', loadCategories);
    $('finish-back').addEventListener('click', loadCategories);

    loadCategories();
})();
