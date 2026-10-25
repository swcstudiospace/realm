/* test_idle.c: native tests for the PID 1 reap seam and the idle loop.
 * Run with `make -C sandbox/realm-helper check`. */
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../realm_idle.h"

static int failures;

#define CHECK(cond)                                                                      \
    do {                                                                                 \
        if (!(cond)) {                                                                   \
            fprintf(stderr, "test_idle: %s:%d: failed: %s\n", __FILE__, __LINE__, #cond); \
            failures++;                                                                  \
        }                                                                                \
    } while (0)

static void test_reap_with_no_children(void) {
    CHECK(realm_reap_children() == 0);
}

static void test_reap_seam_reaps_exited_child(void) {
    siginfo_t info;
    pid_t pid = fork();

    if (pid == 0) {
        _exit(7);
    }
    CHECK(pid > 0);
    if (pid <= 0) {
        return;
    }
    memset(&info, 0, sizeof info);
    /* WNOWAIT: wait for the exit without reaping, so the zombie stays. */
    CHECK(waitid(P_PID, (id_t)pid, &info, WEXITED | WNOWAIT) == 0);
    CHECK(realm_reap_children() == 1);
    errno = 0;
    CHECK(waitpid(pid, NULL, WNOHANG) == -1 && errno == ECHILD);
}

/* Child body for the idle test. It acts as PID 1: it installs the handlers,
 * forks a grandchild that exits at once, and waits for the SIGCHLD handler to
 * reap it. It then reports readiness on wfd and enters the idle loop. Exit 0
 * means the child was reaped and the loop stopped cleanly on SIGTERM. */
static void idle_child(int wfd) {
    pid_t grandchild;

    alarm(30);
    if (realm_idle_install() != 0) {
        _exit(2);
    }
    grandchild = fork();
    if (grandchild < 0) {
        _exit(3);
    }
    if (grandchild == 0) {
        _exit(0);
    }
    while (realm_idle_reaped() < 1) {
        usleep(1000);
    }
    if (write(wfd, "r", 1) != 1) {
        _exit(4);
    }
    if (realm_idle_run() != 0) {
        _exit(5);
    }
    _exit((realm_reap_children() == 0 && realm_idle_reaped() == 1) ? 0 : 6);
}

static void test_idle_reaps_child_and_exits_zero_on_sigterm(void) {
    int fds[2];
    int status = 0;
    char byte = 0;
    pid_t pid;

    CHECK(pipe(fds) == 0);
    if (fds[0] < 0 || fds[1] < 0) {
        return;
    }
    pid = fork();
    if (pid == 0) {
        close(fds[0]);
        idle_child(fds[1]);
    }
    CHECK(pid > 0);
    close(fds[1]);
    CHECK(read(fds[0], &byte, 1) == 1 && byte == 'r');
    close(fds[0]);
    CHECK(kill(pid, SIGTERM) == 0);
    CHECK(waitpid(pid, &status, 0) == pid);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);
}

int main(void) {
    test_reap_with_no_children();
    test_reap_seam_reaps_exited_child();
    test_idle_reaps_child_and_exits_zero_on_sigterm();

    if (failures != 0) {
        fprintf(stderr, "test_idle: %d failure(s)\n", failures);
        return 1;
    }
    puts("test_idle: all checks passed");
    return 0;
}
