/* probe.c: in-container check that realm-helper's controls are active (PRD-ENF-03).
 *
 * Run it as the workload under the helper:
 *   realm-helper run --workspace /workspace --scratch /scratch --state /realm-state -- /path/probe
 *
 * It prints one line per check, NAME=PASS or NAME=FAIL, and exits 0 only when
 * every check passes. The decision functions are pure. The seams supply the
 * observations, so test_probe.c can drive them with fake results.
 *
 * LOADER_WORKSPACE_REFUSED depends on the workspace being mounted noexec (phase 9.3).
 * Without that mount, the loader can map a workspace binary and the check fails. */
#define _GNU_SOURCE
#include <asm/unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define PROBE_TMP_PATH "/tmp/realm-probe-write"
#define PROBE_WORKSPACE_PATH "/workspace/realm-probe-write"
#define PROBE_LOADER_TARGET "/workspace/realm-probe-ld"
#define PROBE_TRUE_SRC "/usr/bin/true"
#define PROBE_KEYCTL_GET_KEYRING_ID 0L
#define PROBE_KEY_SPEC_SESSION_KEYRING (-3L)
#define PROBE_X32_BIT 0x40000000L

#if defined(__x86_64__)
#define PROBE_LOADER_PATH "/lib64/ld-linux-x86-64.so.2"
#elif defined(__aarch64__)
#define PROBE_LOADER_PATH "/lib/ld-linux-aarch64.so.1"
#endif

/* Seams. Each int-returning seam gives 0 on success or errno on failure, except
 * where noted. status_field returns 0 when the field was read, else -1.
 *   unshare_userns: unshare(CLONE_NEWUSER). 0 means it succeeded.
 *   clone_userns:   raw clone with CLONE_NEWUSER. A failure gives errno. 0 means a child was created.
 *   x32_syscall:    raw syscall with the x32 bit set. 0 means it succeeded.
 *   loader_workspace: ld-linux running a workspace binary. 0 means it ran
 *                   (exit 0), 1 means it was refused (non-zero exit or killed),
 *                   -1 means the probe could not run it. */
struct probe_seams {
    int (*tmp_write)(void);
    int (*workspace_write)(void);
    int (*keyctl)(void);
    int (*unshare_userns)(void);
    int (*clone_userns)(void);
    int (*x32_syscall)(void);
    int (*loader_workspace)(void);
    int (*status_field)(const char *key, int base, unsigned long long *value);
};

static int decide_tmp_denied(int err) {
    return err == EACCES;
}

static int decide_write_ok(int err) {
    return err == 0;
}

static int decide_eperm(int err) {
    return err == EPERM;
}

static int decide_loader_refused(int status) {
    return status == 1;
}

static int decide_equal(unsigned long long got, unsigned long long want) {
    return got == want;
}

static int report(FILE *out, const char *name, int pass) {
    fprintf(out, "%s=%s\n", name, pass ? "PASS" : "FAIL");
    return pass ? 0 : 1;
}

static int check_status(const struct probe_seams *s, const char *key, int base,
                        unsigned long long want) {
    unsigned long long got = 0;

    return s->status_field(key, base, &got) == 0 && decide_equal(got, want);
}

static int probe_run(const struct probe_seams *s, FILE *out) {
    int failures = 0;

    failures += report(out, "TMP_WRITE_EACCES", decide_tmp_denied(s->tmp_write()));
    failures += report(out, "WORKSPACE_WRITE_OK", decide_write_ok(s->workspace_write()));
    failures += report(out, "KEYCTL_EPERM", decide_eperm(s->keyctl()));
    failures += report(out, "NO_NEW_PRIVS_1", check_status(s, "NoNewPrivs", 10, 1));
    failures += report(out, "SECCOMP_2", check_status(s, "Seccomp", 10, 2));
    failures += report(out, "UNSHARE_USERNS_EPERM", decide_eperm(s->unshare_userns()));
    failures += report(out, "CLONE_USERNS_EPERM", decide_eperm(s->clone_userns()));
    failures += report(out, "X32_EPERM", decide_eperm(s->x32_syscall()));
    failures += report(out, "CAPEFF_ZERO", check_status(s, "CapEff", 16, 0));
    failures += report(out, "CAPINH_ZERO", check_status(s, "CapInh", 16, 0));
    failures += report(out, "LOADER_WORKSPACE_REFUSED", decide_loader_refused(s->loader_workspace()));
    return failures;
}

static int real_tmp_write(void) {
    int fd = open(PROBE_TMP_PATH, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);

    if (fd < 0) {
        return errno;
    }
    close(fd);
    unlink(PROBE_TMP_PATH);
    return 0;
}

static int real_workspace_write(void) {
    static const char payload[] = "realm-probe\n";
    const ssize_t want = (ssize_t)(sizeof payload - 1);
    ssize_t wrote;
    int err = 0;
    int fd = open(PROBE_WORKSPACE_PATH, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);

    if (fd < 0) {
        return errno;
    }
    wrote = write(fd, payload, (size_t)want);
    if (wrote < 0) {
        err = errno;
    } else if (wrote != want) {
        err = EIO;
    }
    close(fd);
    unlink(PROBE_WORKSPACE_PATH);
    return err;
}

static int real_keyctl(void) {
    long r = syscall(SYS_keyctl, PROBE_KEYCTL_GET_KEYRING_ID, PROBE_KEY_SPEC_SESSION_KEYRING, 0L);

    return r < 0 ? errno : 0;
}

static int real_unshare_userns(void) {
    if (unshare(CLONE_NEWUSER) == 0) {
        return 0;
    }
    return errno;
}

/* A raw clone with CLONE_NEWUSER. If it succeeds, the child exits at once and
 * is reaped here, and the seam returns 0 so the check fails. */
static int real_clone_userns(void) {
    long r = syscall(SYS_clone, (long)(CLONE_NEWUSER | SIGCHLD), 0L, 0L, 0L, 0L);

    if (r == 0) {
        _exit(0);
    }
    if (r < 0) {
        return errno;
    }
    waitpid((pid_t)r, NULL, 0);
    return 0;
}

static int real_x32_syscall(void) {
#if defined(__x86_64__)
    long r = syscall((long)(SYS_getpid | PROBE_X32_BIT));

    return r < 0 ? errno : 0;
#else
    /* The x32 ABI exists only on x86_64. Elsewhere the check cannot pass. */
    return ENOSYS;
#endif
}

static int copy_fd(int in, int out) {
    char buf[4096];
    ssize_t n;

    while ((n = read(in, buf, sizeof buf)) > 0) {
        ssize_t off = 0;

        while (off < n) {
            ssize_t w = write(out, buf + off, (size_t)(n - off));

            if (w < 0) {
                return -1;
            }
            off += w;
        }
    }
    return n < 0 ? -1 : 0;
}

/* Copies /usr/bin/true into the workspace, then runs the loader on it with an
 * empty environment. A pipe with CLOEXEC reports an execve failure of the
 * loader itself, so that case is not mistaken for a refusal. */
static int real_loader_workspace(void) {
#if defined(PROBE_LOADER_PATH)
    int in_fd;
    int out_fd;
    int pipefd[2];
    pid_t pid;
    int copied;
    int e = 0;
    int status = 0;
    ssize_t got;
    char *const argv[] = {(char *)PROBE_LOADER_PATH, (char *)PROBE_LOADER_TARGET, NULL};
    char *const envp[] = {NULL};

    in_fd = open(PROBE_TRUE_SRC, O_RDONLY | O_CLOEXEC);
    if (in_fd < 0) {
        return -1;
    }
    out_fd = open(PROBE_LOADER_TARGET, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0755);
    if (out_fd < 0) {
        close(in_fd);
        return -1;
    }
    copied = copy_fd(in_fd, out_fd);
    close(in_fd);
    close(out_fd);
    if (copied != 0) {
        unlink(PROBE_LOADER_TARGET);
        return -1;
    }
    if (pipe2(pipefd, O_CLOEXEC) != 0) {
        unlink(PROBE_LOADER_TARGET);
        return -1;
    }
    pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        unlink(PROBE_LOADER_TARGET);
        return -1;
    }
    if (pid == 0) {
        int child_err;

        close(pipefd[0]);
        execve(PROBE_LOADER_PATH, argv, envp);
        child_err = errno;
        {
            ssize_t w = write(pipefd[1], &child_err, sizeof child_err);

            (void)w;
        }
        _exit(127);
    }
    close(pipefd[1]);
    got = read(pipefd[0], &e, sizeof e);
    close(pipefd[0]);
    waitpid(pid, &status, 0);
    unlink(PROBE_LOADER_TARGET);

    if (got == (ssize_t)sizeof e) {
        return -1;
    }
    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        return 0;
    }
    return 1;
#else
    return -1;
#endif
}

/* Reads a line from /proc/self/status and parses its value in the given base. */
static int real_status_field(const char *key, int base, unsigned long long *value) {
    FILE *f = fopen("/proc/self/status", "r");
    char line[256];
    size_t klen = strlen(key);
    int found = -1;

    if (f == NULL) {
        return -1;
    }
    while (fgets(line, sizeof line, f) != NULL) {
        if (strncmp(line, key, klen) == 0 && line[klen] == ':') {
            char *end = NULL;
            unsigned long long v;

            errno = 0;
            v = strtoull(line + klen + 1, &end, base);
            if (errno == 0 && end != line + klen + 1) {
                *value = v;
                found = 0;
            }
            break;
        }
    }
    fclose(f);
    return found;
}

int main(void) {
    static const struct probe_seams live = {
        .tmp_write = real_tmp_write,
        .workspace_write = real_workspace_write,
        .keyctl = real_keyctl,
        .unshare_userns = real_unshare_userns,
        .clone_userns = real_clone_userns,
        .x32_syscall = real_x32_syscall,
        .loader_workspace = real_loader_workspace,
        .status_field = real_status_field,
    };

    return probe_run(&live, stdout) == 0 ? 0 : 1;
}
