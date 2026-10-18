/*
 * Стек, куча и окружение процесса на практике.
 *
 * Сборка и запуск из корня проекта (Linux или macOS):
 *     cc -O0 -Wall -o /tmp/stack-heap examples/stack-heap.c && /tmp/stack-heap
 *
 * -O0 отключает оптимизацию: иначе компилятор может убрать рекурсию и переменные,
 * и опыт со стеком ничего не покажет.
 * Адреса при каждом запуске разные (система нарочно перемешивает их ради защиты),
 * но порядок областей сохраняется.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>

int global_counter = 42;            /* глобальная переменная: область данных */

/* Сколько оперативной памяти процесс занимал в самый загруженный момент, МБ. */
static double max_rss_mb(void)
{
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    return usage.ru_maxrss / 1024.0 / 1024.0;   /* в macOS — байты */
#else
    return usage.ru_maxrss / 1024.0;            /* в Linux — килобайты */
#endif
}

/* ── 2. Каждый вызов функции кладёт в стек новый кадр ───────────────────── */
static void show_frames(int level)
{
    int local = level;                          /* переменная в кадре этого вызова */
    printf("   вызов %d: адрес локальной переменной %p\n", level, (void *) &local);
    if (level < 3)
        show_frames(level + 1);
}

/* ── 5. Рекурсия без конца: кадры копятся, пока стек не кончится ──────────── */
static long depth = 0;
static void endless(void)
{
    volatile char frame[1024];                  /* 1 КБ в каждом кадре */
    frame[0] = (char) depth;
    depth += 1;
    if (depth % 1000 == 0) {
        printf("\r   глубина %ld, израсходовано стека около %ld КБ", depth, depth);
        fflush(stdout);
    }
    if (depth > 0)                              /* всегда истинно: рекурсия намеренно бесконечная */
        endless();
    frame[1] = frame[0];                        /* не даёт компилятору убрать кадр */
}

int main(void)
{
    /* ── 1. Где что лежит ─────────────────────────────────────────────────── */
    int on_stack = 1;                            /* локальная переменная main: стек */
    int *on_heap = malloc(sizeof(int));          /* память, выданная по запросу: куча */
    char *home = getenv("HOME");                 /* строка окружения, её положила система */
    setenv("PRACTICE_VAR", "добавлена во время работы", 1);
    char *added = getenv("PRACTICE_VAR");        /* добавленная переменная: копия в куче */

    printf("1. ГДЕ ЧТО ЛЕЖИТ (сверху — большие адреса)\n");
    printf("   окружение, HOME (положила система)    %p\n", (void *) home);
    printf("   стек, локальная переменная main        %p\n", (void *) &on_stack);
    printf("   куча, память от malloc                 %p\n", (void *) on_heap);
    printf("   окружение, добавлено через setenv      %p\n", (void *) added);
    printf("   данные, глобальная переменная          %p\n", (void *) &global_counter);
    printf("   код, функция main                      %p\n", (void *) main);
    printf("   Исходное окружение — над стеком. Добавленная переменная — рядом с кучей:\n"
           "   библиотека C выделила под неё место через malloc.\n");
    free(on_heap);

    /* ── 2. Стек растёт вниз ──────────────────────────────────────────────── */
    printf("\n2. КАДРЫ СТЕКА: у каждого вызова свой кадр, адреса уменьшаются\n");
    show_frames(1);

    /* ── 3. Куча: память сначала только резервируется ─────────────────────── */
    printf("\n3. КУЧА\n");
    size_t size = 100 * 1024 * 1024;
    printf("   в начале:                          занято в RAM %.0f МБ\n", max_rss_mb());
    char *big = malloc(size);
    if (big == NULL) {
        perror("malloc");
        return 1;
    }
    printf("   malloc(100 МБ), память не трогали: занято в RAM %.0f МБ — выданы только адреса\n", max_rss_mb());
    memset(big, 1, size);
    printf("   записали во все 100 МБ:            занято в RAM %.0f МБ — страницы появились при обращении\n", max_rss_mb());
    free(big);
    printf("   free(big): память возвращена. Забыть free — это и есть утечка.\n");

    /* ── 4. Время жизни ───────────────────────────────────────────────────── */
    printf("\n4. ВРЕМЯ ЖИЗНИ\n"
           "   Локальная переменная исчезает вместе с кадром функции: возвращать её адрес нельзя.\n"
           "   Память из кучи живёт до free, поэтому её адрес можно вернуть из функции.\n");

    /* ── 5. Переполнение стека — в отдельном процессе, чтобы пример не упал ─── */
    printf("\n5. ПЕРЕПОЛНЕНИЕ СТЕКА\n");
    struct rlimit stack_limit;
    getrlimit(RLIMIT_STACK, &stack_limit);
    printf("   лимит стека: %ld КБ\n", (long) (stack_limit.rlim_cur / 1024));
    fflush(stdout);
    pid_t child = fork();                        /* копия процесса: о fork — в следующей теме */
    if (child == 0) {
        endless();
        _exit(0);
    }
    int status;
    waitpid(child, &status, 0);
    if (WIFSIGNALED(status))
        printf("\n   дочерний процесс аварийно завершён сигналом %d (%s): стек кончился\n",
               WTERMSIG(status), strsignal(WTERMSIG(status)));
    printf("   PostgreSQL не доводит до этого: параметр max_stack_depth прерывает запрос раньше\n"
           "   с ошибкой «stack depth limit exceeded».\n");
    return 0;
}
