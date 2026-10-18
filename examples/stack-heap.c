/*
 * Стек, куча и окружение процесса на практике.
 *
 * Сборка и запуск из корня проекта (Linux или macOS):
 *     cc -O0 -Wall -o /tmp/stack-heap examples/stack-heap.c && /tmp/stack-heap
 *
 * -O0 отключает оптимизацию: иначе компилятор может убрать рекурсию и переменные,
 * и опыт со стеком ничего не покажет.
 * Адреса при каждом запуске разные (система нарочно перемешивает их ради защиты),
 * но порядок областей обычно тот же.
 *
 * Это лабораторный опыт, а не просмотр: программа расходует около 100 МБ памяти
 * и намеренно вызывает переполнение стека в дочернем процессе. Запускайте её
 * обычным пользователем в учебной среде, а не на рабочем сервере.
 */
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>

int global_counter = 42;            /* глобальная переменная: область данных */

/* Максимальный RSS с начала работы, МБ: сколько оперативной памяти процесс занимал в самый загруженный момент.
   Это максимум, а не текущее значение: после free он не уменьшается. */
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
    printf("   Исходное окружение — в верхней части начального стека, выше кадров функций.\n"
           "   Добавленная переменная — рядом с кучей:\n"
           "   библиотека C выделила под неё место через malloc.\n");
    free(on_heap);

    /* ── 2. Стек растёт вниз ──────────────────────────────────────────────── */
    printf("\n2. КАДРЫ СТЕКА: у каждого вызова свой кадр, адреса уменьшаются\n");
    show_frames(1);

    /* ── 3. Куча: память сначала только резервируется ─────────────────────── */
    printf("\n3. КУЧА\n");
    size_t size = 100 * 1024 * 1024;
    printf("   (ниже — максимальный RSS с начала работы)\n");
    printf("   в начале:                          максимальный RSS %.0f МБ\n", max_rss_mb());
    char *big = malloc(size);
    if (big == NULL) {
        perror("malloc");
        return 1;
    }
    printf("   malloc(100 МБ), память не трогали: максимальный RSS %.0f МБ — выданы только адреса\n", max_rss_mb());
    memset(big, 1, size);
    printf("   записали во все 100 МБ:            максимальный RSS %.0f МБ — страницы появились при обращении\n", max_rss_mb());
    free(big);
    printf("   free(big): память возвращена. Забыть free — это и есть утечка.\n"
           "   Максимальный RSS после free не уменьшится: это максимум за всё время работы.\n");

    /* ── 4. Время жизни ───────────────────────────────────────────────────── */
    printf("\n4. ВРЕМЯ ЖИЗНИ\n"
           "   Локальная переменная исчезает вместе с кадром функции: возвращать её адрес нельзя.\n"
           "   Память из кучи живёт до free, поэтому её адрес можно вернуть из функции.\n");

    /* ── 5. Переполнение стека — в отдельном процессе, чтобы пример не упал ─── */
    printf("\n5. ПЕРЕПОЛНЕНИЕ СТЕКА\n");
    struct rlimit stack_limit;
    if (getrlimit(RLIMIT_STACK, &stack_limit) != 0) {
        perror("getrlimit");
        return 1;
    }
    if (stack_limit.rlim_cur == RLIM_INFINITY) {
        printf("   лимит стека не ограничен (ulimit -s unlimited): опыт пропущен,\n"
               "   иначе рекурсия израсходовала бы всю доступную память\n");
        return 0;
    }
    printf("   лимит стека: %ld КБ\n", (long) (stack_limit.rlim_cur / 1024));
    fflush(stdout);
    pid_t child = fork();                        /* копия процесса: о fork — в следующей теме */
    if (child < 0) {
        perror("fork");
        return 1;
    }
    if (child == 0) {
        endless();
        _exit(0);
    }
    int status;
    pid_t done;
    do
        done = waitpid(child, &status, 0);
    while (done < 0 && errno == EINTR);          /* ожидание прервал сигнал — ждём снова */
    if (done < 0) {
        perror("waitpid");
        return 1;
    }
    if (WIFSIGNALED(status))
        printf("\n   дочерний процесс завершён сигналом %d (%s)%s\n", WTERMSIG(status), strsignal(WTERMSIG(status)),
               WTERMSIG(status) == SIGSEGV ? ": ожидаемое переполнение стека" : ": неожиданный для этого опыта сигнал, причину нужно выяснять отдельно");
    else
        printf("\n   дочерний процесс завершился сам с кодом %d\n", WEXITSTATUS(status));
    printf("   PostgreSQL в проверяемых местах не доводит до этого: параметр max_stack_depth\n"
           "   обычно прерывает запрос раньше с ошибкой «stack depth limit exceeded».\n");
    return 0;
}
