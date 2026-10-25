/* test_policy.c: native tests for the pure policy in realm_policy.c.
 * Run with `make -C sandbox/realm-helper check`. No container is needed.
 *
 * The seccomp checks are behavioural. A classic-BPF interpreter runs the built
 * program against synthetic seccomp_data, the way the kernel does, and the
 * test asserts the verdict for each syscall and argument set. */
#define _GNU_SOURCE
#include <asm/unistd.h>
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>

#include "../realm_policy.h"

#if defined(__x86_64__)
#define TEST_AUDIT_ARCH AUDIT_ARCH_X86_64
#define TEST_X32_INSNS 1
/* The spike's 29 entries, plus the 28 added by the security gate. */
#define TEST_DENYLIST_LEN 57
#define TEST_EPERM_COUNT 54
#define TEST_ENOSYS_COUNT 1
#define TEST_CLONE_COUNT 1
#define TEST_PERSONALITY_COUNT 1
#elif defined(__aarch64__)
#define TEST_AUDIT_ARCH AUDIT_ARCH_AARCH64
#define TEST_X32_INSNS 0
/* iopl, ioperm, uselib, sysfs, and modify_ldt are x86 only. */
#define TEST_DENYLIST_LEN 52
#define TEST_EPERM_COUNT 49
#define TEST_ENOSYS_COUNT 1
#define TEST_CLONE_COUNT 1
#define TEST_PERSONALITY_COUNT 1
#else
#error "test_policy supports only x86_64 and aarch64"
#endif

#define VERDICT_ALLOW SECCOMP_RET_ALLOW
#define VERDICT_EPERM (SECCOMP_RET_ERRNO | EPERM)
#define VERDICT_ENOSYS (SECCOMP_RET_ERRNO | ENOSYS)
#define VERDICT_KILL SECCOMP_RET_KILL_PROCESS

static int failures;

#define CHECK(cond)                                                                        \
    do {                                                                                   \
        if (!(cond)) {                                                                     \
            fprintf(stderr, "test_policy: %s:%d: failed: %s\n", __FILE__, __LINE__, #cond); \
            failures++;                                                                    \
        }                                                                                  \
    } while (0)

/* ---- Classic BPF interpreter: the subset the helper emits. ---- */

static uint32_t sim_load_word(const struct seccomp_data *d, uint32_t off) {
    uint32_t v = 0;

    memcpy(&v, (const unsigned char *)d + off, sizeof v);
    return v;
}

static uint32_t sim_run(const struct sock_filter *prog, size_t len, const struct seccomp_data *d) {
    uint32_t a = 0;
    size_t pc = 0;
    size_t steps;

    for (steps = 0; steps < len; steps++) {
        const struct sock_filter *ins;

        if (pc >= len) {
            return VERDICT_KILL;
        }
        ins = &prog[pc];
        switch (ins->code) {
        case BPF_LD | BPF_W | BPF_ABS:
            a = sim_load_word(d, ins->k);
            pc += 1;
            break;
        case BPF_JMP | BPF_JEQ | BPF_K:
            pc += 1 + (a == ins->k ? ins->jt : ins->jf);
            break;
        case BPF_JMP | BPF_JSET | BPF_K:
            pc += 1 + ((a & ins->k) != 0 ? ins->jt : ins->jf);
            break;
        case BPF_RET | BPF_K:
            return ins->k;
        default:
            return VERDICT_KILL;
        }
    }
    return VERDICT_KILL;
}

static uint32_t verdict(const struct sock_filter *prog, size_t len, uint32_t arch, int nr,
                        uint64_t arg0) {
    struct seccomp_data d;

    memset(&d, 0, sizeof d);
    d.nr = nr;
    d.arch = arch;
    d.args[0] = arg0;
    return sim_run(prog, len, &d);
}

/* ---- Pure policy checks. ---- */

static void test_landlock_abi_gate(void) {
    CHECK(realm_landlock_abi_ok(-1) == 0);
    CHECK(realm_landlock_abi_ok(0) == 0);
    CHECK(realm_landlock_abi_ok(1) == 0);
    CHECK(realm_landlock_abi_ok(2) == 0);
    CHECK(realm_landlock_abi_ok(3) == 1);
    CHECK(realm_landlock_abi_ok(4) == 1);
}

static void test_path_validation(void) {
    CHECK(realm_validate_paths("/workspace", "/scratch", "/realm-state") == 0);
    CHECK(realm_validate_paths("/workspace", "/tmpfs-scratch", "/realm-state") == 0);

    CHECK(realm_validate_paths("", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("workspace", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("//", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/scratch", NULL) != 0);

    /* No root under /tmp, for any of the three roots. */
    CHECK(realm_validate_paths("/workspace", "/tmp", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/tmp/x", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/./tmp", "/realm-state") != 0);
    CHECK(realm_validate_paths("/tmp/w", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/scratch", "/tmp/s") != 0);

    /* ".." is refused. */
    CHECK(realm_validate_paths("/workspace/..", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/scratch/../etc", "/realm-state") != 0);

    /* Writable roots are refused under the system prefixes. */
    CHECK(realm_validate_paths("/usr/w", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/etc/s", "/realm-state") != 0);
    CHECK(realm_validate_paths("/proc/w", "/scratch", "/realm-state") != 0);
    CHECK(realm_validate_paths("/dev/w", "/scratch", "/realm-state") != 0);

    /* Overlapping roots are refused, in every pairing. */
    CHECK(realm_validate_paths("/workspace", "/workspace/s", "/realm-state") != 0);
    CHECK(realm_validate_paths("/workspace", "/scratch", "/workspace") != 0);
    CHECK(realm_validate_paths("/workspace", "/scratch", "/scratch/sub") != 0);
    CHECK(realm_validate_paths("/workspace", "/workspace", "/realm-state") != 0);
}

static void test_path_predicates(void) {
    /* Prefix matching is by whole segment. */
    CHECK(realm_path_is_under("/usr/bin", "/usr") == 1);
    CHECK(realm_path_is_under("/usr", "/usr") == 1);
    CHECK(realm_path_is_under("/./usr/x", "/usr") == 1);
    CHECK(realm_path_is_under("/usrx", "/usr") == 0);
    CHECK(realm_path_is_under("/workspace", "/usr") == 0);
    CHECK(realm_path_is_under("/", "/usr") == 0);

    /* System prefixes: /usr, /etc, /proc, /dev. */
    CHECK(realm_path_is_system("/usr") == 1);
    CHECK(realm_path_is_system("/usr/local/bin") == 1);
    CHECK(realm_path_is_system("/etc/passwd") == 1);
    CHECK(realm_path_is_system("/proc/self") == 1);
    CHECK(realm_path_is_system("/dev/shm") == 1);
    CHECK(realm_path_is_system("/etcetera") == 0);
    CHECK(realm_path_is_system("/usr2") == 0);
    CHECK(realm_path_is_system("/home") == 0);
    CHECK(realm_path_is_system("/workspace") == 0);

    /* /tmp prefix: /tmp and below only. */
    CHECK(realm_path_is_tmp("/tmp") == 1);
    CHECK(realm_path_is_tmp("/tmp/x") == 1);
    CHECK(realm_path_is_tmp("/./tmp") == 1);
    CHECK(realm_path_is_tmp("/tmpfs") == 0);
    CHECK(realm_path_is_tmp("/var/tmp") == 0);

    /* Overlap: one is a path-boundary prefix of the other, or they are equal. */
    CHECK(realm_roots_overlap("/workspace", "/workspace/sub") == 1);
    CHECK(realm_roots_overlap("/workspace/sub", "/workspace") == 1);
    CHECK(realm_roots_overlap("/workspace", "/workspace") == 1);
    CHECK(realm_roots_overlap("/a/b", "/a") == 1);
    CHECK(realm_roots_overlap("/workspace", "/workspace2") == 0);
    CHECK(realm_roots_overlap("/a", "/b") == 0);
}

static void test_prog_validation(void) {
    CHECK(realm_prog_ok("/usr/bin/node") == 1);
    CHECK(realm_prog_ok("node") == 0);
    CHECK(realm_prog_ok("") == 0);
    CHECK(realm_prog_ok("/") == 0);
    CHECK(realm_prog_ok("/usr/../bin/sh") == 0);
    CHECK(realm_prog_ok(NULL) == 0);
}

static void test_env_filter(void) {
    /* Refused: the loader and locale search paths. */
    CHECK(realm_env_allowed("LD_PRELOAD=/workspace/x.so") == 0);
    CHECK(realm_env_allowed("LD_LIBRARY_PATH=/workspace") == 0);
    CHECK(realm_env_allowed("LD_") == 0);
    CHECK(realm_env_allowed("GCONV_PATH=/workspace/gconv") == 0);
    CHECK(realm_env_allowed("LOCPATH=/workspace/locale") == 0);
    CHECK(realm_env_allowed("NLSPATH=/workspace/%L") == 0);

    /* Kept: ordinary variables, and names that only start like the refused ones. */
    CHECK(realm_env_allowed("PATH=/usr/bin:/bin") == 1);
    CHECK(realm_env_allowed("HOME=/workspace") == 1);
    CHECK(realm_env_allowed("LDX=1") == 1);
    CHECK(realm_env_allowed("GCONV_PATHX=1") == 1);
    CHECK(realm_env_allowed("LANG=C.UTF-8") == 1);
    CHECK(realm_env_allowed(NULL) == 0);
}

static void test_execve_exit_codes(void) {
    CHECK(realm_execve_exit_code(EACCES) == 126);
    CHECK(realm_execve_exit_code(ENOENT) == 127);
    CHECK(realm_execve_exit_code(EINVAL) == 125);
    CHECK(realm_execve_exit_code(ENOEXEC) == 125);
    CHECK(realm_execve_exit_code(EPERM) == 125);

    CHECK(REALM_EXIT_USAGE == 2);
    CHECK(REALM_EXIT_NNP == 70);
    CHECK(REALM_EXIT_LANDLOCK == 71);
    CHECK(REALM_EXIT_CAPS == 72);
    CHECK(REALM_EXIT_ENV == 73);
    CHECK(REALM_EXIT_SECCOMP == 74);
    CHECK(REALM_EXIT_EXEC_OTHER == 125);
    CHECK(REALM_EXIT_EXEC_DENIED == 126);
    CHECK(REALM_EXIT_EXEC_MISSING == 127);
}

static void test_parse_valid_run(void) {
    char *argv[] = {"realm-helper", "run", "--workspace", "/workspace", "--scratch", "/scratch",
                    "--state", "/realm-state", "--", "/usr/bin/node", "x.js"};
    struct realm_command cmd;

    CHECK(realm_parse_args((int)(sizeof argv / sizeof argv[0]), argv, &cmd) == 0);
    CHECK(cmd.kind == REALM_CMD_RUN);
    CHECK(cmd.workspace != NULL && strcmp(cmd.workspace, "/workspace") == 0);
    CHECK(cmd.scratch != NULL && strcmp(cmd.scratch, "/scratch") == 0);
    CHECK(cmd.state != NULL && strcmp(cmd.state, "/realm-state") == 0);
    CHECK(cmd.prog_index == 9);
    CHECK(strcmp(argv[cmd.prog_index], "/usr/bin/node") == 0);
}

static void test_parse_accepts_options_in_any_order(void) {
    char *argv[] = {"realm-helper", "run", "--state", "/realm-state", "--scratch", "/scratch",
                    "--workspace", "/workspace", "--", "/usr/bin/true"};
    struct realm_command cmd;

    CHECK(realm_parse_args((int)(sizeof argv / sizeof argv[0]), argv, &cmd) == 0);
    CHECK(cmd.prog_index == 9);
}

static void test_parse_refusals(void) {
    struct realm_command cmd;

    /* run without "--" */
    char *no_separator[] = {"realm-helper", "run", "--workspace", "/w", "--scratch", "/s",
                            "--state", "/st", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof no_separator / sizeof no_separator[0]), no_separator, &cmd) != 0);

    /* missing PROG after "--" */
    char *no_prog[] = {"realm-helper", "run", "--workspace", "/w", "--scratch", "/s",
                       "--state", "/st", "--"};
    CHECK(realm_parse_args((int)(sizeof no_prog / sizeof no_prog[0]), no_prog, &cmd) != 0);

    /* relative PROG */
    char *relative_prog[] = {"realm-helper", "run", "--workspace", "/w", "--scratch", "/s",
                             "--state", "/st", "--", "true"};
    CHECK(realm_parse_args((int)(sizeof relative_prog / sizeof relative_prog[0]), relative_prog, &cmd) != 0);

    /* each required option missing */
    char *no_workspace[] = {"realm-helper", "run", "--scratch", "/s", "--state", "/st",
                            "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof no_workspace / sizeof no_workspace[0]), no_workspace, &cmd) != 0);

    char *no_scratch[] = {"realm-helper", "run", "--workspace", "/w", "--state", "/st",
                          "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof no_scratch / sizeof no_scratch[0]), no_scratch, &cmd) != 0);

    char *no_state[] = {"realm-helper", "run", "--workspace", "/w", "--scratch", "/s",
                        "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof no_state / sizeof no_state[0]), no_state, &cmd) != 0);

    /* unknown option */
    char *unknown[] = {"realm-helper", "run", "--bogus", "/w", "--workspace", "/w", "--scratch", "/s",
                       "--state", "/st", "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof unknown / sizeof unknown[0]), unknown, &cmd) != 0);

    /* duplicate option */
    char *duplicate[] = {"realm-helper", "run", "--workspace", "/w", "--workspace", "/x",
                         "--scratch", "/s", "--state", "/st", "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof duplicate / sizeof duplicate[0]), duplicate, &cmd) != 0);

    /* the separator used as an option value */
    char *separator_as_value[] = {"realm-helper", "run", "--workspace", "--", "--scratch", "/s",
                                  "--state", "/st", "--", "/usr/bin/true"};
    CHECK(realm_parse_args((int)(sizeof separator_as_value / sizeof separator_as_value[0]),
                           separator_as_value, &cmd) != 0);

    /* unknown subcommand, no subcommand, idle with extra arguments */
    char *unknown_sub[] = {"realm-helper", "frob"};
    CHECK(realm_parse_args((int)(sizeof unknown_sub / sizeof unknown_sub[0]), unknown_sub, &cmd) != 0);

    char *bare[] = {"realm-helper"};
    CHECK(realm_parse_args(1, bare, &cmd) != 0);

    char *idle_extra[] = {"realm-helper", "idle", "extra"};
    CHECK(realm_parse_args((int)(sizeof idle_extra / sizeof idle_extra[0]), idle_extra, &cmd) != 0);

    /* NULL argv and NULL out */
    CHECK(realm_parse_args(2, NULL, &cmd) != 0);
    CHECK(realm_parse_args(1, bare, NULL) != 0);
}

static void test_parse_idle(void) {
    char *argv[] = {"realm-helper", "idle"};
    struct realm_command cmd;

    CHECK(realm_parse_args((int)(sizeof argv / sizeof argv[0]), argv, &cmd) == 0);
    CHECK(cmd.kind == REALM_CMD_IDLE);
}

/* ---- Denylist. ---- */

static size_t count_action(const struct realm_deny_entry *t, size_t len, int action) {
    size_t c = 0;

    for (size_t i = 0; i < len; i++) {
        if (t[i].action == action) {
            c++;
        }
    }
    return c;
}

static int table_has(const struct realm_deny_entry *t, size_t len, int nr) {
    for (size_t i = 0; i < len; i++) {
        if (t[i].nr == nr) {
            return 1;
        }
    }
    return 0;
}

static void test_denylist_contents(void) {
    const struct realm_deny_entry *table = realm_denylist();
    const size_t len = realm_denylist_len();

    CHECK(len == TEST_DENYLIST_LEN);
    CHECK(count_action(table, len, REALM_DENY_EPERM) == TEST_EPERM_COUNT);
    CHECK(count_action(table, len, REALM_DENY_ENOSYS) == TEST_ENOSYS_COUNT);
    CHECK(count_action(table, len, REALM_DENY_CLONE_NS) == TEST_CLONE_COUNT);
    CHECK(count_action(table, len, REALM_DENY_PERSONALITY) == TEST_PERSONALITY_COUNT);

    for (size_t i = 0; i < len; i++) {
        for (size_t j = i + 1; j < len; j++) {
            CHECK(table[i].nr != table[j].nr);
        }
    }

    /* Syscalls from the spike, present on every architecture. */
    CHECK(table_has(table, len, SYS_mount));
    CHECK(table_has(table, len, SYS_ptrace));
    CHECK(table_has(table, len, SYS_bpf));
    CHECK(table_has(table, len, SYS_open_by_handle_at));
    CHECK(table_has(table, len, SYS_keyctl));

#if defined(__NR_clone)
    CHECK(table_has(table, len, __NR_clone));
#endif
#if defined(__NR_clone3)
    CHECK(table_has(table, len, __NR_clone3));
#endif
#if defined(__NR_personality)
    CHECK(table_has(table, len, __NR_personality));
#endif

#if defined(__x86_64__)
    /* The spike's 29 numbers on x86_64, and the 26 new ones. */
    {
        static const int spike[29] = {
            165, 166, 155, 161, 272, 308, 321, 250, 248, 249,
            323, 298, 310, 311, 101, 246, 320, 175, 313, 176,
            304, 303, 167, 168, 169, 163, 179, 172, 173,
        };
        static const int added[28] = {
            56, 435, 430, 431, 432, 429, 428, 442, 425, 426, 427, 135, 305,
            159, 164, 227, 170, 171, 153, 103, 212, 312, 438, 134, 139, 154,
            433, 443,
        };
        for (size_t i = 0; i < sizeof spike / sizeof spike[0]; i++) {
            CHECK(table_has(table, len, spike[i]));
        }
        for (size_t i = 0; i < sizeof added / sizeof added[0]; i++) {
            CHECK(table_has(table, len, added[i]));
        }
    }
#endif

    /* Not in the denylist, on purpose: memfd_create and fanotify_init. */
#if defined(__NR_memfd_create)
    CHECK(!table_has(table, len, __NR_memfd_create));
#endif
#if defined(__NR_fanotify_init)
    CHECK(!table_has(table, len, __NR_fanotify_init));
#endif
}

/* ---- Seccomp program, run through the interpreter. ---- */

static void test_seccomp_filter_length(void) {
    struct sock_filter prog[REALM_SECCOMP_MAX_INSNS];
    const size_t expected = 4 + TEST_X32_INSNS + realm_denylist_len() + 12;
    size_t n = realm_build_seccomp_filter(prog, REALM_SECCOMP_MAX_INSNS);

    CHECK(expected <= REALM_SECCOMP_MAX_INSNS);
    CHECK(n == expected);
    CHECK(realm_build_seccomp_filter(prog, expected - 1) == 0);
    CHECK(realm_build_seccomp_filter(NULL, REALM_SECCOMP_MAX_INSNS) == 0);
#if defined(__x86_64__)
    CHECK(n == 74);
#else
    CHECK(n == 68);
#endif
}

static void test_seccomp_verdicts(void) {
    struct sock_filter prog[REALM_SECCOMP_MAX_INSNS];
    const size_t len = realm_build_seccomp_filter(prog, REALM_SECCOMP_MAX_INSNS);
    const struct realm_deny_entry *table = realm_denylist();
    const size_t n = realm_denylist_len();

    if (len == 0) {
        CHECK(len != 0);
        return;
    }

    /* Ordinary syscalls are allowed. */
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, SYS_read, 0) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, SYS_getpid, 0) == VERDICT_ALLOW);

    /* Every listed syscall gets its action, for any arguments. */
    for (size_t i = 0; i < n; i++) {
        uint32_t want;

        switch (table[i].action) {
        case REALM_DENY_EPERM:
            want = VERDICT_EPERM;
            break;
        case REALM_DENY_ENOSYS:
            want = VERDICT_ENOSYS;
            break;
        default:
            /* clone and personality depend on arguments: checked below. */
            continue;
        }
        CHECK(verdict(prog, len, TEST_AUDIT_ARCH, table[i].nr, 0) == want);
        CHECK(verdict(prog, len, TEST_AUDIT_ARCH, table[i].nr, 0xffffffffffffffffULL) == want);
    }

    /* Wrong architecture is killed. */
    CHECK(verdict(prog, len, AUDIT_ARCH_I386, SYS_read, 0) == VERDICT_KILL);
    CHECK(verdict(prog, len, AUDIT_ARCH_I386, SYS_mount, 0) == VERDICT_KILL);

#if defined(__NR_clone)
    /* clone: a CLONE_NEW* bit in the low 32 bits of args[0] is EPERM. */
    {
        static const uint32_t new_bits[] = {
            0x00020000U, 0x02000000U, 0x04000000U, 0x08000000U,
            0x10000000U, 0x20000000U, 0x40000000U, 0x00000080U,
        };
        for (size_t i = 0; i < sizeof new_bits / sizeof new_bits[0]; i++) {
            CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, new_bits[i]) == VERDICT_EPERM);
            CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, new_bits[i] | SIGCHLD) == VERDICT_EPERM);
        }
    }
    /* Ordinary thread and process clones are allowed. */
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, SIGCHLD) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, 0) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone,
                  0x00010000U | 0x00000100U | 0x00000200U | 0x00000400U | 0x00000800U | 0x00000f00U) ==
          VERDICT_ALLOW);
    /* Only the low 32 bits count: a high-half bit alone is allowed. */
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, 1ULL << 40) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_clone, (1ULL << 40) | 0x10000000U) == VERDICT_EPERM);
#endif

#if defined(__NR_personality)
    /* personality: only the query value and PER_LINUX are allowed. */
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_personality, 0x0) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_personality, 0xffffffffULL) == VERDICT_ALLOW);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_personality, 0x8) == VERDICT_EPERM);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_personality, 0x0040000) == VERDICT_EPERM);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_personality, 0xfffffffeULL) == VERDICT_EPERM);
#endif

#if defined(__x86_64__)
    /* x32 syscalls: the x32 bit makes any syscall EPERM, listed or not. */
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, SYS_read | 0x40000000, 0) == VERDICT_EPERM);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, SYS_getpid | 0x40000000, 0) == VERDICT_EPERM);
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, SYS_mount | 0x40000000, 0) == VERDICT_EPERM);
#endif

    /* memfd_create and fanotify_init are not denied. */
#if defined(__NR_memfd_create)
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_memfd_create, 0) == VERDICT_ALLOW);
#endif
#if defined(__NR_fanotify_init)
    CHECK(verdict(prog, len, TEST_AUDIT_ARCH, __NR_fanotify_init, 0) == VERDICT_ALLOW);
#endif
}

int main(void) {
    test_landlock_abi_gate();
    test_path_validation();
    test_path_predicates();
    test_prog_validation();
    test_env_filter();
    test_execve_exit_codes();
    test_parse_valid_run();
    test_parse_accepts_options_in_any_order();
    test_parse_refusals();
    test_parse_idle();
    test_denylist_contents();
    test_seccomp_filter_length();
    test_seccomp_verdicts();

    if (failures != 0) {
        fprintf(stderr, "test_policy: %d failure(s)\n", failures);
        return 1;
    }
    puts("test_policy: all checks passed");
    return 0;
}
