// Стек и куча на практике. Запуск из корня проекта: node --expose-gc examples/stack-heap.js

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' МБ';
const heapUsed = () => process.memoryUsage().heapUsed;

// ── 1. СТЕК: каждый вызов функции кладёт «тарелку» (кадр) ───────────────────
// Рекурсия: функция вызывает саму себя, тарелки копятся, пока стек не кончится.
let depth = 0;
function small() {
    depth += 1;
    return small();                                  // кадр маленький: в нём почти ничего нет
}
function big() {
    depth += 1;
    const a = depth, b = a + 1, c = b + 1, d = c + 1, e = d + 1,
          f = e + 1, g = f + 1, h = g + 1, i = h + 1, j = i + 1;
    return big() + a + b + c + d + e + f + g + h + i + j;  // десять переменных нужны и после вызова
}
function measure(fn) {
    depth = 0;
    try { fn(); } catch (err) { return { depth, error: err.constructor.name + ': ' + err.message }; }
}

console.log('1. СТЕК');
const s = measure(small);
const b = measure(big);
console.log('   маленькие кадры: глубина', s.depth, '→', s.error);
console.log('   крупные кадры:   глубина', b.depth, '— кадр больше, тарелок помещается меньше');

// ── 2. СТЕК живёт, пока работает функция; КУЧА — пока на данные есть ссылка ──
function makeUser() {
    const counter = 42;                      // простое значение в кадре функции: исчезнет при выходе
    const user = { name: 'student', marks: [5, 4, 5] };   // объект создаётся в куче
    return user;                             // кадр снят, а объект живёт: на него есть ссылка
}
console.log('\n2. ВРЕМЯ ЖИЗНИ');
const u = makeUser();
console.log('   функция закончилась, а объект из кучи доступен:', JSON.stringify(u));

// ── 3. КУЧА растёт по требованию и освобождается, когда ссылок не осталось ───
console.log('\n3. КУЧА');
global.gc();
const before = heapUsed();
let rows = [];
for (let n = 0; n < 1_000_000; n += 1) rows.push({ id: n, title: 'вопрос ' + n });
const filled = heapUsed();
console.log('   до:', mb(before), '| миллион объектов создан:', mb(filled), '(+' + mb(filled - before) + ')');
rows = null;                                 // ссылок больше нет — объекты стали мусором
global.gc();                                 // сборщик мусора возвращает место (в C это делал бы free)
console.log('   ссылку убрали, сборщик мусора прошёл:', mb(heapUsed()));

// ── 4. УТЕЧКА: память занята, хотя данные уже не нужны ───────────────────────
console.log('\n4. УТЕЧКА');
const cache = [];                            // глобальный массив живёт до конца программы
function handleRequest(id) {
    const tmp = new Array(10_000).fill(id);  // временные данные запроса...
    cache.push(tmp);                         // ...но по ошибке остаются в глобальном массиве
}
global.gc();
const start = heapUsed();
for (let r = 0; r < 200; r += 1) handleRequest(r);
global.gc();
console.log('   после 200 «запросов» сборщик мусора прошёл, а занято ещё +' + mb(heapUsed() - start),
    '— на данные есть ссылка, освободить их нельзя');
