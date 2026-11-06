(function () {
    window.createAiAssistant = function ({ api }) {
        let revision = 0;
        let accountRevision = 0;
        let availability = Promise.resolve(false);
        const containers = new Set();
        const post = (url, body) => api(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        function reset({ preserveGeneral = false } = {}) {
            revision += 1;
            containers.forEach((node) => {
                if (preserveGeneral && node === generalContainer) return;
                node.textContent = ''; node.hidden = true;
            });
            containers.clear();
        }
        let generalContainer = null;
        let generalMounted = false;
        function setUser(user) {
            reset();
            if (generalContainer) { generalContainer.textContent = ''; generalContainer.hidden = true; }
            generalContainer = null;
            generalMounted = false;
            const version = ++accountRevision;
            availability = user ? api('/api/ai/status').then((data) => version === accountRevision && data.enabled)
                .catch(() => false) : Promise.resolve(false);
        }
        function element(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text) node.textContent = text;
            return node;
        }

        // Модель иногда возвращает Markdown вопреки инструкции. Создаём только безопасные DOM-узлы,
        // не используем innerHTML; содержимое SQL-блоков и произвольный HTML остаются текстом.
        function inline(container, text) {
            text.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g).forEach((part) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    const strong = element('strong');
                    inline(strong, part.slice(2, -2));
                    container.appendChild(strong);
                } else if (part.startsWith('`') && part.endsWith('`')) {
                    container.appendChild(element('code', '', part.slice(1, -1)));
                } else container.appendChild(document.createTextNode(part));
            });
        }
        function renderText(container, text) {
            const parts = text.split('```');
            parts.forEach((part, index) => {
                if (parts.length % 2 === 1 && index % 2 === 1) {
                    const pre = element('pre');
                    pre.appendChild(element('code', '', part.replace(/^(?:sql|text)?\n/, '').trim()));
                    container.appendChild(pre);
                } else inline(container, part);
            });
        }

        async function offer(container, context) {
            const standalone = context.mode === 'general';
            if (standalone && generalMounted && generalContainer === container) return;
            const account = accountRevision;
            const version = revision;
            containers.add(container);
            container.hidden = true;
            container.textContent = '';
            if ((!standalone && !context.batch_id) || !await availability || version !== revision) return;
            if (standalone) { generalContainer = container; generalMounted = true; }
            container.className = 'ai-assistant';
            let scope = standalone ? 'general' : 'question';
            let dialogRevision = 0;
            const modes = element('fieldset', 'ai-modes');
            modes.appendChild(element('legend', '', 'Тема диалога'));
            const group = 'ai-scope-' + crypto.randomUUID();
            for (const [value, text] of [['question', 'По текущему вопросу'], ['general', 'Любая тема']]) {
                const option = element('label');
                const radio = element('input');
                radio.type = 'radio';
                radio.name = group;
                radio.value = value;
                radio.checked = value === scope;
                radio.addEventListener('change', () => {
                    if (radio.checked) { scope = value; newDialogue(); }
                });
                option.append(radio, document.createTextNode(text));
                modes.appendChild(option);
            }
            const start = element('button', 'btn-secondary', 'Объяснить подробнее');
            start.type = 'button';
            const status = element('p', 'hint');
            status.setAttribute('role', 'status');
            const history = element('div', 'ai-history');
            history.setAttribute('aria-label', 'Диалог с ИИ');
            const sources = element('div', 'ai-sources');
            const form = element('form', 'ai-form');
            const label = element('label');
            const labelText = element('span', '', 'Уточнение по этому вопросу');
            label.appendChild(labelText);
            const input = element('textarea');
            input.maxLength = 1000;
            input.rows = 3;
            input.required = true;
            label.appendChild(input);
            const send = element('button', 'btn-secondary', 'Спросить');
            send.type = 'submit';
            form.append(label, send);
            form.hidden = true;
            container.append(modes, start, status, history, sources, form);
            if (standalone) {
                modes.remove();
                if (!container.closest('#ai-view')) container.prepend(element('h2', '', 'Спросить ИИ'));
            }
            container.hidden = false;
            let conversation = null;
            let pending = null;
            let busy = false;
            let exhausted = false;
            function newDialogue() {
                dialogRevision += 1;
                conversation = pending = null;
                busy = exhausted = false;
                history.textContent = sources.textContent = status.textContent = input.value = '';
                start.textContent = scope === 'general' ? 'Новый диалог' : 'Объяснить подробнее';
                labelText.textContent = scope === 'general' ? 'Ваш вопрос' : 'Уточнение по этому вопросу';
                start.hidden = scope === 'general';
                form.hidden = scope !== 'general';
                start.disabled = input.disabled = send.disabled = false;
            }
            function appendMessage(title, text) {
                const message = element('div', 'ai-message');
                const content = element('div', 'ai-text');
                renderText(content, text);
                message.append(element('strong', '', title), content);
                history.appendChild(message);
            }
            async function submit(first) {
                const sameScreen = () => standalone ? account === accountRevision : version === revision;
                if (busy || !sameScreen()) return;
                const dialogVersion = dialogRevision;
                const current = () => sameScreen() && dialogVersion === dialogRevision;
                const message = input.value.trim();
                if (!pending && (!first || scope === 'general') && !message) return;
                if (!pending) pending = { first, message, request_id: crypto.randomUUID() };
                busy = true;
                start.disabled = true;
                send.disabled = true;
                input.disabled = true;
                status.textContent = scope === 'general' ? 'Готовлю ответ…' : 'Готовлю пояснение…';
                try {
                    if (!pending.job_id) {
                        const data = pending.first
                            ? await post('/api/ai/conversations', { ...context, scope,
                                ...(scope === 'general' ? { message: pending.message } : {}), request_id: pending.request_id })
                            : await post('/api/ai/conversations/' + conversation + '/messages', {
                                request_id: pending.request_id, message: pending.message,
                            });
                        if (!current()) return;
                        pending.job_id = data.job_id;
                        pending.conversation_id = data.conversation_id;
                    }
                    const deadline = Date.now() + 70000;
                    let result;
                    while (current() && Date.now() < deadline) {
                        result = await api('/api/ai/jobs/' + pending.job_id);
                        if (!current()) return;
                        if (result.state !== 'pending') break;
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    if (!current()) return;
                    if (!result || result.state === 'pending') throw new Error('Ожидание затянулось. Повторите запрос, чтобы получить результат.');
                    if (result.state !== 'done') {
                        const error = new Error(result.error || 'Не удалось получить пояснение. Попробуйте позже.');
                        error.kind = 'ai';
                        throw error;
                    }
                    if (pending.first) {
                        history.textContent = '';
                        sources.textContent = '';
                        (result.sources || []).forEach((source) => {
                            if (!source.url.startsWith('https://www.postgresql.org/docs/16/')) return;
                            const link = element('a', '', source.title);
                            link.href = source.url;
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            sources.appendChild(link);
                        });
                    }
                    if (!pending.first || scope === 'general') appendMessage('Ваш вопрос', pending.message);
                    appendMessage(scope === 'general' ? 'Ответ ИИ' : 'Пояснение ИИ', result.answer);
                    conversation = pending.conversation_id;
                    exhausted = result.turns >= result.max_turns;
                    pending = null;
                    input.value = '';
                    form.hidden = exhausted;
                    start.hidden = false;
                    status.textContent = exhausted ? (scope === 'general'
                        ? 'Для продолжения нажмите «Новый диалог».'
                        : 'Для продолжения нажмите «Объяснить подробнее» и начните новый диалог.') : '';
                } catch (error) {
                    if (!current()) return;
                    status.textContent = error.message || 'Связь прервалась. Повторите запрос позже.';
                    // При неопределённом исходе повтор использует тот же request_id/job_id и не запускает вторую генерацию.
                    if (['api', 'ai', 'server'].includes(error.kind)) pending = null;
                } finally {
                    if (current()) {
                        busy = false;
                        start.disabled = Boolean(pending && !pending.first);
                        input.disabled = Boolean(pending);
                        send.disabled = exhausted || Boolean(pending && pending.first && scope !== 'general');
                    }
                }
            }
            start.addEventListener('click', () => scope === 'general' ? newDialogue() : submit(true));
            form.addEventListener('submit', (event) => {
                event.preventDefault(); submit(scope === 'general' && !conversation);
            });
            if (standalone) newDialogue();
        }
        return { reset, setUser, offer, isAvailable: () => availability };
    };
})();
