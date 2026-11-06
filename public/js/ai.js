(function () {
    window.createAiAssistant = function ({ api }) {
        let revision = 0;
        let accountRevision = 0;
        let availability = Promise.resolve(false);
        const containers = new Set();
        const post = (url, body) => api(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        function reset() {
            revision += 1;
            containers.forEach((node) => { node.textContent = ''; node.hidden = true; });
            containers.clear();
        }
        function setUser(user) {
            reset();
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
            const version = revision;
            containers.add(container);
            container.hidden = true;
            container.textContent = '';
            if (!context.batch_id || !await availability || version !== revision) return;
            container.className = 'ai-assistant';
            const start = element('button', 'btn-secondary', 'Объяснить подробнее');
            start.type = 'button';
            const status = element('p', 'hint');
            status.setAttribute('role', 'status');
            const history = element('div', 'ai-history');
            history.setAttribute('aria-label', 'Диалог с ИИ');
            const sources = element('div', 'ai-sources');
            const form = element('form', 'ai-form');
            const label = element('label', '', 'Уточнение по этому вопросу');
            const input = element('textarea');
            input.maxLength = 1000;
            input.rows = 3;
            input.required = true;
            label.appendChild(input);
            const send = element('button', 'btn-secondary', 'Спросить');
            send.type = 'submit';
            form.append(label, send);
            form.hidden = true;
            container.append(start, status, history, sources, form);
            container.hidden = false;
            let conversation = null;
            let pending = null;
            let busy = false;
            let exhausted = false;
            function appendMessage(title, text) {
                const message = element('div', 'ai-message');
                const content = element('div', 'ai-text');
                renderText(content, text);
                message.append(element('strong', '', title), content);
                history.appendChild(message);
            }
            async function submit(first) {
                if (busy || version !== revision) return;
                const message = input.value.trim();
                if (!pending && !first && !message) return;
                if (!pending) pending = { first, message, request_id: crypto.randomUUID() };
                busy = true;
                start.disabled = true;
                send.disabled = true;
                input.disabled = true;
                status.textContent = 'Готовлю пояснение…';
                try {
                    if (!pending.job_id) {
                        const data = pending.first
                            ? await post('/api/ai/conversations', { ...context, request_id: pending.request_id })
                            : await post('/api/ai/conversations/' + conversation + '/messages', {
                                request_id: pending.request_id, message: pending.message,
                            });
                        if (version !== revision) return;
                        pending.job_id = data.job_id;
                        pending.conversation_id = data.conversation_id;
                    }
                    const deadline = Date.now() + 70000;
                    let result;
                    while (version === revision && Date.now() < deadline) {
                        result = await api('/api/ai/jobs/' + pending.job_id);
                        if (version !== revision) return;
                        if (result.state !== 'pending') break;
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    if (version !== revision) return;
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
                    } else appendMessage('Ваш вопрос', pending.message);
                    appendMessage('Пояснение ИИ', result.answer);
                    conversation = pending.conversation_id;
                    exhausted = result.turns >= result.max_turns;
                    pending = null;
                    input.value = '';
                    form.hidden = exhausted;
                    status.textContent = exhausted ? 'Для продолжения нажмите «Объяснить подробнее» и начните новый диалог.' : '';
                } catch (error) {
                    if (version !== revision) return;
                    status.textContent = error.message || 'Связь прервалась. Повторите запрос позже.';
                    // При неопределённом исходе повтор использует тот же request_id/job_id и не запускает вторую генерацию.
                    if (['api', 'ai', 'server'].includes(error.kind)) pending = null;
                } finally {
                    if (version === revision) {
                        busy = false;
                        start.disabled = Boolean(pending && !pending.first);
                        input.disabled = Boolean(pending);
                        send.disabled = exhausted || Boolean(pending && pending.first);
                    }
                }
            }
            start.addEventListener('click', () => submit(true));
            form.addEventListener('submit', (event) => { event.preventDefault(); submit(false); });
        }
        return { reset, setUser, offer };
    };
})();
