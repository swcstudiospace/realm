/* realm-helper: native enforcement wrapper for realm workloads (PRD-ENF-01).
 *
 *   realm-helper idle
 *   realm-helper run --workspace P --scratch P --state P -- PROG [ARGS...]
 *
 * `run` is fail-closed. It applies, in order: root checks, the Landlock ABI
 * gate, no_new_privs, the capability drop, the Landlock rule set, the seccomp
 * denylist, and a filtered environment, and then execve. Any failure before
 * execve exits non-zero, and the workload never runs. Argument rules, root
 * rules, and the denylist live in realm_policy.c. PID 1 handling lives in
 * realm_idle.c. This file makes only the kernel calls. */
#define _GNU_SOURCE
#include <asm/unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include "realm_idle.h"
#include "realm_policy.h"

/* Landlock syscall numbers are the same on x86_64 and aarch64. Use these
 * only when the C library does not provide them. */
#ifndef SYS_landlock_create_ruleset
#define SYS_landlock_create_ruleset 444
#define SYS_landlock_add_rule 445
#define SYS_landlock_restrict_self 446
#endif
#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#endif

/* Landlock access rights, ABI 1 to 3. Defined here only when the headers lack them. */
#ifndef LANDLOCK_ACCESS_FS_EXECUTE
#define LANDLOCK_ACCESS_FS_EXECUTE (1ULL << 0)
#endif
#ifndef LANDLOCK_ACCESS_FS_WRITE_FILE
#define LANDLOCK_ACCESS_FS_WRITE_FILE (1ULL << 1)
#endif
#ifndef LANDLOCK_ACCESS_FS_READ_FILE
#define LANDLOCK_ACCESS_FS_READ_FILE (1ULL << 2)
#endif
#ifndef LANDLOCK_ACCESS_FS_READ_DIR
#define LANDLOCK_ACCESS_FS_READ_DIR (1ULL << 3)
#endif
#ifndef LANDLOCK_ACCESS_FS_REMOVE_DIR
#define LANDLOCK_ACCESS_FS_REMOVE_DIR (1ULL << 4)
#endif
#ifndef LANDLOCK_ACCESS_FS_REMOVE_FILE
#define LANDLOCK_ACCESS_FS_REMOVE_FILE (1ULL << 5)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_CHAR
#define LANDLOCK_ACCESS_FS_MAKE_CHAR (1ULL << 6)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_DIR
#define LANDLOCK_ACCESS_FS_MAKE_DIR (1ULL << 7)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_REG
#define LANDLOCK_ACCESS_FS_MAKE_REG (1ULL << 8)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_SOCK
#define LANDLOCK_ACCESS_FS_MAKE_SOCK (1ULL << 9)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_FIFO
#define LANDLOCK_ACCESS_FS_MAKE_FIFO (1ULL << 10)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_BLOCK
#define LANDLOCK_ACCESS_FS_MAKE_BLOCK (1ULL << 11)
#endif
#ifndef LANDLOCK_ACCESS_FS_MAKE_SYM
#define LANDLOCK_ACCESS_FS_MAKE_SYM (1ULL << 12)
#endif
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#ifndef PR_CAPBSET_READ
#define PR_CAPBSET_READ 23
#endif
#ifndef PR_CAPBSET_DROP
#define PR_CAPBSET_DROP 24
#endif
#ifndef PR_CAP_AMBIENT
#define PR_CAP_AMBIENT 47
#endif
#ifndef PR_CAP_AMBIENT_CLEAR_ALL
#define PR_CAP_AMBIENT_CLEAR_ALL 4
#endif
/* The highest capability number the kernel defines is below 64. */
#define REALM_CAP_LAST 63

/* Every filesystem right known at ABI 3. Handling a right denies it everywhere
 * except where a rule grants it. ABI 3 is required, so all of these exist. */
#define FS_HANDLED_ALL                                                                  \
    (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE |                       \
     LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |                       \
     LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |                   \
     LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |                       \
     LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |                       \
     LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |                     \
     LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER |                           \
     LANDLOCK_ACCESS_FS_TRUNCATE)

/* Writable roots get these rights. MAKE_CHAR, MAKE_BLOCK, MAKE_SOCK, and
 * MAKE_FIFO are omitted: device nodes and sockets are not needed in a root. */
#define FS_ROOT_RW                                                                      \
    (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE |                     \
     LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR |                      \
     LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_DIR |                     \
     LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SYM |                        \
     LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE)

/* Read and execute only: system files, the helper and probe binaries, procfs, devices, state. */
#define FS_ROOT_RX (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_EXECUTE)

static _Noreturn void fail(int code, const char *what, int err) {
    fprintf(stderr, "realm-helper: %s: %s\n", what, strerror(err));
    _exit(code);
}

/* Refuses a root that is a symbolic link. lstat does not follow the final component. */
static void refuse_symlink_root(const char *root) {
    struct stat st;

    if (lstat(root, &st) != 0) {
        fail(REALM_EXIT_USAGE, root, errno);
    }
    if (S_ISLNK(st.st_mode)) {
        fprintf(stderr, "realm-helper: root is a symbolic link (fail closed): %s\n", root);
        _exit(REALM_EXIT_USAGE);
    }
}

static int landlock_abi_probe(void) {
    long abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);

    return abi < 0 ? -1 : (int)abi;
}

/* Adds a rule for path. Roots are opened with O_NOFOLLOW, so a root that is a
 * symbolic link fails here as well as in refuse_symlink_root. */
static void add_path(int ruleset, const char *path, uint64_t allowed, int is_root) {
    struct landlock_path_beneath_attr attr;
    int flags = O_PATH | O_CLOEXEC;
    int fd;

    if (is_root) {
        flags |= O_NOFOLLOW;
    }
    fd = open(path, flags);
    if (fd < 0) {
        fail(REALM_EXIT_LANDLOCK, path, errno);
    }
    memset(&attr, 0, sizeof attr);
    attr.allowed_access = allowed;
    attr.parent_fd = fd;
    if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &attr, 0U) != 0) {
        fail(REALM_EXIT_LANDLOCK, "landlock_add_rule", errno);
    }
    close(fd);
}

/* Everything outside these paths is denied. /tmp and /run are not listed, so
 * writes there fail with EACCES. */
static void install_landlock(const struct realm_command *cmd) {
    const uint64_t handled = FS_HANDLED_ALL;
    struct landlock_ruleset_attr attr;
    int ruleset;

    memset(&attr, 0, sizeof attr);
    attr.handled_access_fs = handled;
    ruleset = (int)syscall(SYS_landlock_create_ruleset, &attr, sizeof attr, 0U);
    if (ruleset < 0) {
        fail(REALM_EXIT_LANDLOCK, "landlock_create_ruleset", errno);
    }

    add_path(ruleset, "/usr", FS_ROOT_RX, 0);
    add_path(ruleset, "/etc", FS_ROOT_RX, 0);
    add_path(ruleset, "/proc", FS_ROOT_RX, 0);
    add_path(ruleset, "/dev", FS_ROOT_RX, 0);
    /* The null device is the one device node a workload may write, for ordinary redirects. */
    add_path(ruleset, "/dev/null", LANDLOCK_ACCESS_FS_WRITE_FILE, 0);
    add_path(ruleset, cmd->state, FS_ROOT_RX, 1);
    add_path(ruleset, cmd->workspace, FS_ROOT_RW, 1);
    add_path(ruleset, cmd->scratch, FS_ROOT_RW, 1);

    if (syscall(SYS_landlock_restrict_self, ruleset, 0U) != 0) {
        fail(REALM_EXIT_LANDLOCK, "landlock_restrict_self", errno);
    }
    close(ruleset);
}

static void install_seccomp(void) {
    struct sock_filter prog[REALM_SECCOMP_MAX_INSNS];
    struct sock_fprog fprog;
    size_t len = realm_build_seccomp_filter(prog, REALM_SECCOMP_MAX_INSNS);

    if (len == 0) {
        fprintf(stderr, "realm-helper: seccomp filter build refused (fail closed)\n");
        _exit(REALM_EXIT_SECCOMP);
    }
    memset(&fprog, 0, sizeof fprog);
    fprog.len = (unsigned short)len;
    fprog.filter = prog;
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &fprog, 0, 0) != 0) {
        fail(REALM_EXIT_SECCOMP, "seccomp filter", errno);
    }
}

/* Zeroes the inheritable set with capget and capset. Lowering a set needs no
 * CAP_SETPCAP. Effective and permitted are written back as read, so only the
 * inheritable bits change. Any failure exits with REALM_EXIT_CAPS. */
static void clear_inheritable(void) {
    struct __user_cap_header_struct hdr;
    struct __user_cap_data_struct data[2];

    memset(&hdr, 0, sizeof hdr);
    memset(data, 0, sizeof data);
    hdr.version = _LINUX_CAPABILITY_VERSION_3;
    hdr.pid = 0;
    if (syscall(SYS_capget, &hdr, data) != 0) {
        fail(REALM_EXIT_CAPS, "capget", errno);
    }
    data[0].inheritable = 0;
    data[1].inheritable = 0;
    if (syscall(SYS_capset, &hdr, data) != 0) {
        fail(REALM_EXIT_CAPS, "capset", errno);
    }
}

/* Drops every capability from the bounding set, clears the ambient set, and
 * zeroes the inheritable set. A start with an already empty bounding set needs
 * no drop, and so needs no CAP_SETPCAP. The bounding set is re-read afterwards,
 * and any capability still set refuses the run. */
static void realm_drop_capabilities(void) {
    int cap;
    int r;

    for (cap = 0; cap <= REALM_CAP_LAST; cap++) {
        r = prctl(PR_CAPBSET_READ, cap, 0, 0, 0);
        if (r < 0) {
            if (errno == EINVAL) {
                break;
            }
            fail(REALM_EXIT_CAPS, "capability bounding read", errno);
        }
        if (r == 1 && prctl(PR_CAPBSET_DROP, cap, 0, 0, 0) != 0) {
            fail(REALM_EXIT_CAPS, "capability bounding drop", errno);
        }
    }

    if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0) {
        fail(REALM_EXIT_CAPS, "ambient capability clear", errno);
    }

    clear_inheritable();

    for (cap = 0; cap <= REALM_CAP_LAST; cap++) {
        r = prctl(PR_CAPBSET_READ, cap, 0, 0, 0);
        if (r < 0) {
            if (errno == EINVAL) {
                break;
            }
            fail(REALM_EXIT_CAPS, "capability bounding re-read", errno);
        }
        if (r == 1) {
            fprintf(stderr, "realm-helper: capability %d still in bounding set (fail closed)\n", cap);
            _exit(REALM_EXIT_CAPS);
        }
    }
}

/* Copies the environment, dropping entries that realm_env_allowed refuses. */
static char **filtered_environment(void) {
    char **e;
    char **out;
    size_t count = 0;
    size_t kept = 0;

    for (e = environ; *e != NULL; e++) {
        count++;
    }
    out = malloc((count + 1) * sizeof *out);
    if (out == NULL) {
        fail(REALM_EXIT_ENV, "environment allocation", errno);
    }
    for (e = environ; *e != NULL; e++) {
        if (realm_env_allowed(*e)) {
            out[kept++] = *e;
        }
    }
    out[kept] = NULL;
    return out;
}

static _Noreturn void run_workload(const struct realm_command *cmd, char *const argv[]) {
    int abi = landlock_abi_probe();
    char **envp;
    int err;

    /* 1. Landlock ABI gate. Refuse before any control is applied. */
    if (abi < 0) {
        fail(REALM_EXIT_LANDLOCK, "landlock ABI probe (fail closed)", errno);
    }
    if (!realm_landlock_abi_ok(abi)) {
        fprintf(stderr, "realm-helper: landlock ABI %d is below required %d (fail closed)\n",
                abi, REALM_LANDLOCK_MIN_ABI);
        _exit(REALM_EXIT_LANDLOCK);
    }

    /* 2. No new privileges. Required before Landlock and seccomp may be installed unprivileged. */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        fail(REALM_EXIT_NNP, "no_new_privs", errno);
    }

    /* 3. Capabilities, then 4. the Landlock rule set, then 5. the seccomp denylist. */
    realm_drop_capabilities();
    install_landlock(cmd);
    install_seccomp();

    /* 6. Filtered environment, then 7. replace this process with the workload. */
    envp = filtered_environment();
    execve(argv[cmd->prog_index], &argv[cmd->prog_index], envp);
    err = errno;
    fprintf(stderr, "realm-helper: execve workload: %s\n", strerror(err));
    _exit(realm_execve_exit_code(err));
}

int main(int argc, char **argv) {
    struct realm_command cmd;

    if (realm_parse_args(argc, argv, &cmd) != 0) {
        fprintf(stderr, "usage: realm-helper idle | realm-helper run --workspace P --scratch P "
                        "--state P -- PROG [ARGS...]\n");
        return REALM_EXIT_USAGE;
    }

    if (cmd.kind == REALM_CMD_IDLE) {
        if (realm_idle_install() != 0) {
            fail(EXIT_FAILURE, "idle signal handlers", errno);
        }
        if (realm_idle_run() != 0) {
            fail(EXIT_FAILURE, "idle loop", errno);
        }
        return 0;
    }

    if (realm_validate_paths(cmd.workspace, cmd.scratch, cmd.state) != 0) {
        fprintf(stderr, "realm-helper: refused root argument (absolute, not root, no \"..\"; "
                        "no root under /tmp; writable roots not under /usr, /etc, /proc, /dev; "
                        "no overlapping roots)\n");
        return REALM_EXIT_USAGE;
    }
    refuse_symlink_root(cmd.workspace);
    refuse_symlink_root(cmd.scratch);
    refuse_symlink_root(cmd.state);

    run_workload(&cmd, argv);
}
