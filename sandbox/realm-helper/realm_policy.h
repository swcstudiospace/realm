/* realm_policy.h: pure policy for realm-helper (phase 9.2).
 *
 * Nothing behind these functions performs I/O or a system call, so the native
 * tests run them without a container. The helper's main file parses arguments,
 * calls these functions, and makes the kernel calls itself. */
#ifndef REALM_POLICY_H
#define REALM_POLICY_H

#include <stddef.h>

/* Landlock ABI 3 adds LANDLOCK_ACCESS_FS_TRUNCATE. Below it, the rule set
 * cannot express the full write policy, so the helper refuses to run. */
#define REALM_LANDLOCK_MIN_ABI 3

/* Upper bound for the seccomp program. The x86_64 program is 74 instructions
 * and the aarch64 program is 68. */
#define REALM_SECCOMP_MAX_INSNS 128

/* Exit codes. Usage and path or root refusals are 2. Setup failures keep the
 * codes they had before the security gate. Failures of execve are mapped by
 * realm_execve_exit_code. */
#define REALM_EXIT_USAGE 2
#define REALM_EXIT_NNP 70
#define REALM_EXIT_LANDLOCK 71
#define REALM_EXIT_CAPS 72
#define REALM_EXIT_ENV 73
#define REALM_EXIT_SECCOMP 74
#define REALM_EXIT_EXEC_OTHER 125
#define REALM_EXIT_EXEC_DENIED 126
#define REALM_EXIT_EXEC_MISSING 127

enum realm_command_kind { REALM_CMD_NONE = 0, REALM_CMD_IDLE, REALM_CMD_RUN };

struct realm_command {
    enum realm_command_kind kind;
    const char *workspace;
    const char *scratch;
    const char *state;
    /* Index in argv of PROG; argv[prog_index..] is the workload's argv. */
    int prog_index;
};

/* What the seccomp program does with a listed syscall. */
enum realm_deny_action {
    REALM_DENY_EPERM = 1,      /* EPERM for every argument set */
    REALM_DENY_ENOSYS,         /* ENOSYS; glibc falls back from clone3 to clone */
    REALM_DENY_CLONE_NS,       /* EPERM when args[0] has a CLONE_NEW* bit; else allow */
    REALM_DENY_PERSONALITY     /* EPERM unless args[0] is 0x0 or 0xffffffff; else allow */
};

struct realm_deny_entry {
    int nr;
    int action;
};

struct sock_filter;

/* Returns 1 when abi is REALM_LANDLOCK_MIN_ABI or higher, else 0. */
int realm_landlock_abi_ok(int abi);

/* Returns 0 when the three roots pass every root check, else -1:
 *   - each root is absolute, names something other than the root, and has no ".." segment;
 *   - no root is at or under /tmp;
 *   - no writable root (workspace, scratch) is at or under /usr, /etc, /proc, or /dev;
 *   - no two roots overlap (one is a path-boundary prefix of the other, or they are equal). */
int realm_validate_paths(const char *workspace, const char *scratch, const char *state);

/* Path predicates. Each compares whole segments, so /usr matches /usr/bin
 * but not /usrx. A path containing ".." is treated as inside every base, so
 * callers that refuse on a match fail closed. */
int realm_path_is_under(const char *path, const char *base);
int realm_path_is_system(const char *path);
int realm_path_is_tmp(const char *path);
int realm_roots_overlap(const char *a, const char *b);

/* Returns 1 when prog is an absolute path that names a file, with no ".." segment. */
int realm_prog_ok(const char *prog);

/* Returns 1 when an environment entry ("NAME=value") may reach the workload.
 * Drops LD_*, GCONV_PATH=, LOCPATH=, and NLSPATH=. */
int realm_env_allowed(const char *entry);

/* Maps an execve errno to the exit code: EACCES 126, ENOENT 127, else 125. */
int realm_execve_exit_code(int err);

/* Parses `idle` or `run --workspace P --scratch P --state P -- PROG [ARGS...]`.
 * Returns 0 on success and -1 on any refusal. out is always zeroed first. */
int realm_parse_args(int argc, char *const argv[], struct realm_command *out);

/* The denylist, with one entry per syscall for the running architecture. */
const struct realm_deny_entry *realm_denylist(void);
size_t realm_denylist_len(void);

/* Writes the seccomp program into out (capacity cap) and returns its length,
 * or 0 when the program does not fit or out is NULL.
 * Length is 4 + x32 + N + 12, where x32 is 1 on x86_64 and 0 elsewhere, and
 * N is realm_denylist_len(). */
size_t realm_build_seccomp_filter(struct sock_filter *out, size_t cap);

#endif
