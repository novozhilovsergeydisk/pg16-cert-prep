-- Три вопроса о куче и её отличии от стека в разделе «18. Память процесса» с пояснениями к каждому варианту.
-- Источник: scripts/questions/038_stack_heap_basics.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://man7.org/linux/man-pages/man3/malloc.3.html
-- https://man7.org/linux/man-pages/man2/getrlimit.2.html

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что такое куча (heap) в процессе?', '{"A":"Область памяти, где хранятся кадры вызванных функций","B":"Область памяти, из которой программа по мере надобности запрашивает блоки (в C — через malloc) и сама возвращает их (free)","C":"Область диска, куда ядро выгружает страницы процесса","D":"Общая память, которую одновременно используют все процессы системы"}'::jsonb, 'B', 'Куча нужна для данных, размер или время жизни которых заранее неизвестны. Не путать с общей памятью PostgreSQL (shared_buffers): она общая для процессов сервера, а у каждого обслуживающего процесса есть ещё и своя куча.', '{"A":"Это стек: кадры создаются и снимаются автоматически при вызове функций и выходе из них.","B":"Размер блоков и время их жизни определяет сама программа.","C":"Это своп: он хранит страницы, которые не поместились в оперативную память.","D":"У каждого процесса куча своя; общая память подключается к процессам отдельно."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'В чём главное отличие стека от кучи?', '{"A":"Стек находится в оперативной памяти, а куча — на диске","B":"Память стека освобождается автоматически при выходе из функции, а блок из кучи — только когда программа сама его вернёт","C":"Размер стека можно увеличить вызовом malloc, а размер кучи — нельзя","D":"Стек общий для всех процессов, а куча у каждого процесса своя"}'::jsonb, 'B', 'Стек быстрый и управляется автоматически, но невелик (обычно 8 МБ) и хранит данные только на время вызова функции. Куча больше и гибче, но за освобождение памяти отвечает программа: забытый free приводит к утечке.', '{"A":"Обе области — виртуальная память процесса, и страницы любой из них могут оказаться в свопе.","B":"Стек живёт вместе с вызовом функции, куча — пока программа не вызовет free.","C":"Наоборот: malloc берёт память из кучи, а размер стека ограничен лимитом ulimit -s.","D":"У каждого процесса и стек, и куча свои; у каждого потока, кроме того, свой стек."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Код собран для Linux x86-64 без оптимизации (-O0), вызов malloc успешен. Где лежат данные в этом коде на C? Какие утверждения верны?
```
#include <stdlib.h>

int counter = 0;

void work(void)
{
    int n = 5;
    char *buf = malloc(100);
    /* ... работа с buf, free не вызывается ... */
}
```', '{"A":"Блок в 100 байт, выданный malloc, лежит в куче","B":"Глобальная переменная counter лежит в стеке","C":"Сама переменная buf (указатель) лежит в стеке","D":"Блок из malloc освободится при выходе из work","E":"Переменная n лежит в стеке и исчезает при выходе из work"}'::jsonb, 'ACE', 'Данные и ссылка на них могут лежать в разных областях: указатель — в стеке, блок — в куче. Поэтому исчезновение указателя вместе с кадром не освобождает память. Так выглядит обычная сборка без оптимизации; с оптимизацией компилятор может держать n и buf в регистрах или вовсе убрать неиспользуемый код, то есть физическое размещение зависит от сборки.', '{"A":"Память от malloc берётся из кучи.","B":"Глобальные переменные находятся в области данных программы и живут всё время её работы.","C":"Указатель — локальная переменная, а блок, на который он указывает, находится в куче.","D":"Нет: при выходе исчезнет указатель buf, а блок останется в куче, потому что free не вызывается. Получится утечка памяти.","E":"Это обычная локальная переменная: она находится в кадре функции."}'::jsonb;

DO $check$
DECLARE candidate record; matches integer;
BEGIN
    FOR candidate IN SELECT * FROM question_seed LOOP
        SELECT count(*) INTO matches FROM questions q
        WHERE regexp_replace(trim(q.question_text), '[[:space:]]+', ' ', 'g') =
              regexp_replace(trim(candidate.question_text), '[[:space:]]+', ' ', 'g');
        IF matches > 1 OR (matches = 1 AND NOT EXISTS (
            SELECT 1 FROM questions q WHERE q.question_text = candidate.question_text
              AND q.category_id = candidate.category_id AND q.options = candidate.options
              AND q.correct_answer = candidate.correct_answer AND q.explanation = candidate.explanation
              AND q.option_notes = candidate.option_notes
        )) THEN
            RAISE EXCEPTION 'Конфликт содержимого или повтор нового вопроса';
        END IF;
    END LOOP;
END
$check$;

INSERT INTO questions(category_id, question_text, options, correct_answer, explanation, option_notes)
SELECT n.* FROM question_seed n
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);

DO $check$
BEGIN
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 3 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
