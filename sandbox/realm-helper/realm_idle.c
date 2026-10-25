/* realm_idle.c: PID 1 loop for `realm-helper idle`. See realm_idle.h. */
#define _GNU_SOURCE
#include "realm_idle.h"

#include <errno.h>
#include <signal.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile sig_atomic_t stop_requested;
static volatile sig_atomic_t reaped_total;

static void on_stop(int sig) {
    (void)sig;
    stop_requested = 1;
}

static void on_child(int sig) {
    int saved = errno;

    (void)sig;
    reaped_total = reaped_total + realm_reap_children();
    errno = saved;
}

int realm_reap_children(void) {
    int reaped = 0;

    for (;;) {
        int status = 0;
        pid_t pid = waitpid(-1, &status, WNOHANG);

        if (pid > 0) {
            reaped++;
            continue;
        }
        if (pid < 0 && errno == EINTR) {
            continue;
        }
        /* 0: children remain but none has exited. -1: no children (ECHILD). */
        break;
    }
    return reaped;
}

int realm_idle_install(void) {
    struct sigaction stop;
    struct sigaction child;

    memset(&stop, 0, sizeof stop);
    stop.sa_handler = on_stop;
    sigemptyset(&stop.sa_mask);
    if (sigaction(SIGTERM, &stop, NULL) != 0) {
        return -1;
    }
    if (sigaction(SIGINT, &stop, NULL) != 0) {
        return -1;
    }

    memset(&child, 0, sizeof child);
    child.sa_handler = on_child;
    child.sa_flags = SA_RESTART | SA_NOCLDSTOP;
    sigemptyset(&child.sa_mask);
    if (sigaction(SIGCHLD, &child, NULL) != 0) {
        return -1;
    }
    return 0;
}

int realm_idle_run(void) {
    sigset_t blocked;
    sigset_t previous;
    sigset_t suspend_mask;

    if (sigemptyset(&blocked) != 0 || sigaddset(&blocked, SIGTERM) != 0 ||
        sigaddset(&blocked, SIGINT) != 0) {
        return -1;
    }
    /* Block the stop signals and wait with sigsuspend, which unblocks them
     * atomically. A stop that arrives between the flag test and the wait
     * therefore cannot be lost. */
    if (sigprocmask(SIG_BLOCK, &blocked, &previous) != 0) {
        return -1;
    }
    suspend_mask = previous;
    if (sigdelset(&suspend_mask, SIGTERM) != 0 || sigdelset(&suspend_mask, SIGINT) != 0) {
        return -1;
    }
    while (stop_requested == 0) {
        (void)sigsuspend(&suspend_mask);
    }
    return 0;
}

int realm_idle_reaped(void) {
    return reaped_total;
}
