/*
 * Системные вызовы и режимы процессора на практике: материал docs/SYSCALLS.md.
 *
 * Сборка и запуск из корня проекта (Linux x86-64; в других системах часть опытов пропускается):
 *     cc -O0 -Wall -o /tmp/syscalls examples/syscalls.c && /tmp/syscalls
 * Необязательный аргумент — каталог для временного файла опыта 3 (по умолчанию текущий):
 *     /tmp/syscalls /var/tmp
 *
 * Это лабораторный опыт, а не просмотр: программа нагружает диск сбросами, расходует
 * 64 МБ памяти и намеренно роняет дочерний процесс. Запускайте её обычным пользователем
 * в учебной среде, а не на рабочем сервере. Временный файл опыта 3 создаётся с уникальным
 * именем (mkstemp), чужих файлов не трогает и удаляется в конце опыта.
 * Код возврата: 0 — все опыты прошли как ожидалось, 1 — хотя бы один не удался.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#if defined(__linux__) && defined(__x86_64__)
#include <sys/syscall.h>
#endif

/* Сообщить о неудачной записи: -1 — ошибка с кодом errno, иначе записано меньше, чем просили. */
static void report_write(const char *what, ssize_t done, size_t wanted)
{
    if (done < 0)
        fprintf(stderr, "%s: %s\n", what, strerror(errno));
    else
        fprintf(stderr, "%s: записано %zd байт из %zu\n", what, done, wanted);
}

/* Текущее время в микросекундах по монотонным часам; при ошибке -1. */
static double now_us(void)
{
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        perror("clock_gettime");
        return -1;
    }
    return ts.tv_sec * 1e6 + ts.tv_nsec / 1e3;
}

/* Статистика ресурсов процесса; при ошибке 1. */
static int usage(struct rusage *ru)
{
    if (getrusage(RUSAGE_SELF, ru) != 0) {
        perror("getrusage");
        return 1;
    }
    return 0;
}

static double ms(struct timeval tv)
{
    return tv.tv_sec * 1e3 + tv.tv_usec / 1e3;
}

/* Надёжный сброс данных файла: в Linux fdatasync, в других системах fsync. */
static int sync_data(int fd)
{
#ifdef __linux__
    return fdatasync(fd);
#else
    return fsync(fd);
#endif
}

/* ── 1. Три пути к write и ошибка errno ─────────────────────────────────── */
static int three_ways(void)
{
    static const char by_wrapper[] = "   2) write: обёртка libc вызывает ядро\n";
    printf("1. ТРИ ПУТИ К WRITE И ОШИБКА\n");
    printf("   1) printf: библиотека копит текст в буфере и вызывает write позже\n");
    fflush(stdout);                                       /* сбросить буфер, чтобы строки шли по порядку */
    ssize_t n = write(1, by_wrapper, sizeof by_wrapper - 1);
    if (n != (ssize_t) (sizeof by_wrapper - 1)) {
        report_write("write", n, sizeof by_wrapper - 1);
        return 1;
    }
#if defined(__linux__) && defined(__x86_64__)
    static const char by_number[] = "   3) syscall(SYS_write): вызов ядра по номеру, минуя обёртку\n";
    long r = syscall(SYS_write, 1, by_number, sizeof by_number - 1);
    if (r != (long) (sizeof by_number - 1)) {
        report_write("syscall", (ssize_t) r, sizeof by_number - 1);
        return 1;
    }
#else
    printf("   3) вызов по номеру показывается только в Linux на x86-64: здесь пропущен\n");
#endif
    n = write(-1, "x", 1);                                /* отрицательного номера файла не бывает */
    int saved = errno;                                    /* сохранить сразу, до других вызовов */
    printf("   write(-1, ...) вернул %zd, errno = %d (%s)\n", n, saved, strerror(saved));
    if (n != -1 || saved != EBADF) {
        fprintf(stderr, "   ожидалась ошибка EBADF\n");
        return 1;
    }
    return 0;
}

/* ── 2. Цена мелких вызовов ─────────────────────────────────────────────── */
static int small_calls(void)
{
    enum { COUNT = 200000 };
    static char block[COUNT];
    printf("\n2. ЦЕНА МЕЛКИХ ВЫЗОВОВ: %d байт в /dev/null\n", COUNT);
    int fd = open("/dev/null", O_WRONLY);
    if (fd < 0) {
        perror("open /dev/null");
        return 1;
    }
    struct rusage r0, r1;
    int failed = usage(&r0);
    double t0 = now_us();
    for (int i = 0; i < COUNT && !failed; i++) {
        ssize_t n = write(fd, block + i, 1);              /* по одному байту: COUNT системных вызовов */
        if (n != 1) {
            report_write("write", n, 1);
            failed = 1;
        }
    }
    double t1 = now_us();
    failed |= usage(&r1);
    double t2 = now_us();                                 /* отдельный замер вокруг одного вызова */
    ssize_t n = write(fd, block, COUNT);
    double t3 = now_us();
    if (!failed && n != COUNT) {
        report_write("write", n, COUNT);
        failed = 1;
    }
    if (close(fd) != 0) {
        perror("close");
        failed = 1;
    }
    if (failed || t0 < 0 || t1 < 0 || t2 < 0 || t3 < 0)
        return 1;
    printf("   по 1 байту:  %8.1f мс по часам, в программе %.1f мс, в ядре %.1f мс\n", (t1 - t0) / 1e3,
           ms(r1.ru_utime) - ms(r0.ru_utime), ms(r1.ru_stime) - ms(r0.ru_stime));
    printf("   одним write: %8.3f мс по часам\n", (t3 - t2) / 1e3);
    printf("   В среднем одна итерация с write (вместе с циклом и обёрткой libc) — около %.0f нс.\n"
           "   Поэтому printf и PostgreSQL пишут крупными порциями.\n", (t1 - t0) * 1e3 / COUNT);
    return 0;
}

/* ── 3. Сброс на диск ───────────────────────────────────────────────────── */

/* Записать все страницы файла заново; with_sync — сбрасывать после каждой. Возвращает мкс на запись или -1. */
static double write_pages(int fd, char *page, int pages, int page_size, int with_sync)
{
    double t0 = now_us();
    for (int i = 0; i < pages; i++) {
        ssize_t n = pwrite(fd, page, (size_t) page_size, (off_t) i * page_size);
        if (n != page_size) {
            report_write("pwrite", n, (size_t) page_size);
            return -1;
        }
        if (with_sync && sync_data(fd) != 0) {            /* ждать, пока диск подтвердит запись */
            perror("sync");
            return -1;
        }
    }
    double t1 = now_us();
    return t0 < 0 || t1 < 0 ? -1 : (t1 - t0) / pages;
}

static int disk_sync(const char *dir)
{
    enum { WRITES = 200, PAGE = 8192 };
    static char page[PAGE];
    char path[4096];
    int len = snprintf(path, sizeof path, "%s/syscalls-lab-XXXXXX", dir);
    if (len < 0 || len >= (int) sizeof path) {
        fprintf(stderr, "слишком длинный путь к каталогу\n");
        return 1;
    }
    printf("\n3. СБРОС НА ДИСК: %d записей по 8 КБ в каталоге %s\n", WRITES, dir);
    int fd = mkstemp(path);                               /* новый файл с уникальным именем, права 0600 */
    if (fd < 0) {
        perror("mkstemp");
        return 1;
    }
    /* Подготовка вне замеров: файл заполнен и сброшен, обе серии — перезапись тех же страниц. */
    int failed = write_pages(fd, page, WRITES, PAGE, 0) < 0 || sync_data(fd) != 0;
    double buffered = failed ? -1 : write_pages(fd, page, WRITES, PAGE, 0);
    failed |= buffered < 0 || sync_data(fd) != 0;         /* сбросить первую серию до начала второй */
    double synced = failed ? -1 : write_pages(fd, page, WRITES, PAGE, 1);
    failed |= synced < 0;
    if (close(fd) != 0) {
        perror("close");
        failed = 1;
    }
    if (unlink(path) != 0) {                              /* удаляем только свой файл из mkstemp */
        perror("unlink");
        failed = 1;
    }
    if (failed) {
        fprintf(stderr, "   опыт 3 не удался\n");
        return 1;
    }
    printf("   pwrite без сброса:      %8.1f мкс на запись\n", buffered);
    printf("   pwrite и сброс на диск: %8.1f мкс на запись\n", synced);
    printf("   Без сброса измеряется буферизованная запись: её завершение не подтверждает сохранность.\n"
           "   Если сброс почти бесплатен, каталог может лежать в памяти (tmpfs): укажите другой\n"
           "   каталог аргументом. В macOS fsync не ждёт кеш самого диска, поэтому там цифры занижены.\n");
    return 0;
}

/* ── 4. Страничные ошибки ───────────────────────────────────────────────── */
static int page_faults(void)
{
    size_t size = 64 * 1024 * 1024;
    long page = sysconf(_SC_PAGESIZE);
    if (page <= 0) {
        perror("sysconf");
        return 1;
    }
    printf("\n4. СТРАНИЧНЫЕ ОШИБКИ: 64 МБ через mmap, страница %ld байт\n", page);
    char *p = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) {
        perror("mmap");
        return 1;
    }
    struct rusage r0, r1;
    int failed = usage(&r0);
    memset(p, 1, size);                                   /* первая запись в каждую страницу */
    failed |= usage(&r1);
    if (munmap(p, size) != 0) {
        perror("munmap");
        failed = 1;
    }
    if (failed)
        return 1;
    printf("   после mmap страниц ещё нет; запись дала %ld мелких страничных ошибок (страниц: %zu)\n",
           r1.ru_minflt - r0.ru_minflt, size / (size_t) page);
    printf("   Ядро выдало настоящие страницы по требованию; с большими страницами ошибок будет меньше.\n");
    return 0;
}

/* ── 5. Запрещённая инструкция ──────────────────────────────────────────── */
static int privileged(void)
{
    printf("\n5. ЗАПРЕЩЁННАЯ ИНСТРУКЦИЯ В ПОЛЬЗОВАТЕЛЬСКОМ РЕЖИМЕ\n");
#if defined(__linux__) && defined(__x86_64__)
    fflush(stdout);                                       /* иначе буфер напечатается и в ребёнке */
    pid_t child = fork();
    if (child < 0) {
        perror("fork");
        return 1;
    }
    if (child == 0) {
        __asm__ volatile("hlt");                          /* остановить процессор можно только в режиме ядра */
        _exit(0);
    }
    int status;
    pid_t done;
    do
        done = waitpid(child, &status, 0);
    while (done < 0 && errno == EINTR);
    if (done < 0) {
        perror("waitpid");
        return 1;
    }
    if (WIFSIGNALED(status) && WTERMSIG(status) == SIGSEGV) {
        printf("   дочерний процесс выполнил hlt и завершён сигналом %d (%s): ожидаемая ошибка защиты\n",
               WTERMSIG(status), strsignal(WTERMSIG(status)));
        return 0;
    }
    if (WIFSIGNALED(status))
        fprintf(stderr, "   неожиданный сигнал %d (%s)\n", WTERMSIG(status), strsignal(WTERMSIG(status)));
    else
        fprintf(stderr, "   дочерний процесс неожиданно завершился сам с кодом %d\n", WEXITSTATUS(status));
    return 1;
#else
    printf("   опыт только для Linux на x86-64: здесь пропущен\n");
    return 0;
#endif
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : ".";
    int failed = three_ways();
    failed |= small_calls();
    failed |= disk_sync(dir);
    failed |= page_faults();
    failed |= privileged();
    return failed;
}
