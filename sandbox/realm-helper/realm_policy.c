/* realm_policy.c: pure policy for realm-helper. See realm_policy.h. */
#define _GNU_SOURCE
#include "realm_policy.h"

#include <asm/unistd.h>
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/syscall.h>

#if defined(__x86_64__)
#define REALM_AUDIT_ARCH AUDIT_ARCH_X86_64
/* x32 syscalls report AUDIT_ARCH_X86_64 and set this bit in nr, so a filter
 * that compares only nr would let them skip the denylist. */
#define REALM_X32_CHECK 1
#define REALM_X32_SYSCALL_BIT 0x40000000U
#elif defined(__aarch64__)
#define REALM_AUDIT_ARCH AUDIT_ARCH_AARCH64
#define REALM_X32_CHECK 0
#else
#error "realm-helper supports only x86_64 and aarch64"
#endif

/* CLONE_NEW* flags, compared against the low 32 bits of clone's flags argument. */
#define REALM_CLONE_NS_MASK                                                             \
    (0x00020000U /* CLONE_NEWNS */ | 0x02000000U /* CLONE_NEWCGROUP */ |                 \
     0x04000000U /* CLONE_NEWUTS */ | 0x08000000U /* CLONE_NEWIPC */ |                   \
     0x10000000U /* CLONE_NEWUSER */ | 0x20000000U /* CLONE_NEWPID */ |                  \
     0x40000000U /* CLONE_NEWNET */ | 0x00000080U /* CLONE_NEWTIME */)
/* CLONE_NEWTIME (0x80) shares the low byte with the exit-signal range (signals 1 to 127).
 * That overlap is harmless: the mask tests only the flag bit, and valid signal
 * numbers are below 128, so an ordinary exit signal never sets it. */

/* personality(2) takes an unsigned int; the kernel reads its low 32 bits. */
#define REALM_PERSONALITY_QUERY 0xffffffffU

/* The denylist. Each entry names one syscall and an action. Every entry
 * carries its reason here, and SECCOMP.md repeats them. Entries guarded by
 * #ifdef exist only on some architectures, so the count depends on the
 * target: 57 on x86_64 and 52 on aarch64. Do not add or remove an entry
 * without a recorded reason. */
static const struct realm_deny_entry realm_denylist_table[] = {
    /* Mount and namespace surface. */
    { SYS_mount, REALM_DENY_EPERM },          /* changes the mount table; a new mount widens reach past Landlock */
    { SYS_umount2, REALM_DENY_EPERM },        /* detaches mounts; can hide or expose paths the policy relies on */
    { SYS_pivot_root, REALM_DENY_EPERM },     /* replaces the root filesystem; a container escape step */
    { SYS_chroot, REALM_DENY_EPERM },         /* changes the root directory; escape step when combined with mounts */
    { SYS_unshare, REALM_DENY_EPERM },        /* creates namespaces, including user namespaces that grant mount rights */
    { SYS_setns, REALM_DENY_EPERM },          /* joins existing namespaces outside the sandbox */
#ifdef __NR_clone
    { __NR_clone, REALM_DENY_CLONE_NS },      /* clone with a CLONE_NEW* flag creates a namespace; other clones are allowed */
#endif
#ifdef __NR_clone3
    { __NR_clone3, REALM_DENY_ENOSYS },       /* clone3 carries its flags in a struct the filter cannot read; ENOSYS makes glibc fall back to clone */
#endif
#ifdef __NR_fsopen
    { __NR_fsopen, REALM_DENY_EPERM },        /* new-API mount: opens a filesystem context, bypassing mount(2) checks */
#endif
#ifdef __NR_fsconfig
    { __NR_fsconfig, REALM_DENY_EPERM },      /* configures a filesystem context for the new mount API */
#endif
#ifdef __NR_fsmount
    { __NR_fsmount, REALM_DENY_EPERM },       /* creates a mount from a filesystem context */
#endif
#ifdef __NR_move_mount
    { __NR_move_mount, REALM_DENY_EPERM },    /* attaches a detached mount into the mount table */
#endif
#ifdef __NR_open_tree
    { __NR_open_tree, REALM_DENY_EPERM },     /* detached bind mount of a path; a mount-surface bypass */
#endif
#ifdef __NR_mount_setattr
    { __NR_mount_setattr, REALM_DENY_EPERM }, /* changes mount attributes (e.g. clears read-only or noexec) */
#endif
#ifdef __NR_fspick
    { __NR_fspick, REALM_DENY_EPERM },        /* selects a mount in the new mount API for reconfiguration; mount-surface bypass */
#endif
    { SYS_bpf, REALM_DENY_EPERM },            /* loads kernel BPF programs; large kernel attack surface, not needed */
    { SYS_keyctl, REALM_DENY_EPERM },         /* manipulates kernel keyrings; kernel attack surface; probe expects EPERM */
    { SYS_add_key, REALM_DENY_EPERM },        /* creates kernel keyring keys; kernel attack surface */
    { SYS_request_key, REALM_DENY_EPERM },    /* kernel keyring upcalls to userspace; kernel attack surface */
    { SYS_userfaultfd, REALM_DENY_EPERM },    /* pauses kernel-side faults; widely used to widen kernel race windows */
    { SYS_perf_event_open, REALM_DENY_EPERM },   /* performance counters; side channel and kernel attack surface */
    { SYS_process_vm_readv, REALM_DENY_EPERM },  /* reads another process's memory across the process boundary */
    { SYS_process_vm_writev, REALM_DENY_EPERM }, /* writes another process's memory across the process boundary */
    { SYS_ptrace, REALM_DENY_EPERM },         /* inspects and injects into other processes */
    { SYS_kexec_load, REALM_DENY_EPERM },     /* loads a replacement kernel image */
    { SYS_kexec_file_load, REALM_DENY_EPERM }, /* loads a replacement kernel image from a file */
    { SYS_init_module, REALM_DENY_EPERM },    /* loads a kernel module */
    { SYS_finit_module, REALM_DENY_EPERM },   /* loads a kernel module from a file descriptor */
    { SYS_delete_module, REALM_DENY_EPERM },  /* unloads a kernel module */
    { SYS_open_by_handle_at, REALM_DENY_EPERM }, /* opens by file handle, bypassing path-based Landlock checks */
    { SYS_name_to_handle_at, REALM_DENY_EPERM }, /* produces the handles that open_by_handle_at consumes */
    { SYS_swapon, REALM_DENY_EPERM },         /* changes host swap configuration */
    { SYS_swapoff, REALM_DENY_EPERM },        /* changes host swap configuration */
    { SYS_reboot, REALM_DENY_EPERM },         /* reboots or powers off the host */
    { SYS_acct, REALM_DENY_EPERM },           /* enables host process accounting to a file */
    { SYS_quotactl, REALM_DENY_EPERM },       /* changes filesystem quota state on the host */
#ifdef __NR_quotactl_fd
    { __NR_quotactl_fd, REALM_DENY_EPERM },   /* changes filesystem quota state through an open file descriptor; host-level effect, same as quotactl */
#endif
#ifdef __NR_io_uring_setup
    { __NR_io_uring_setup, REALM_DENY_EPERM },    /* io_uring: large kernel attack surface; not needed by workloads */
#endif
#ifdef __NR_io_uring_enter
    { __NR_io_uring_enter, REALM_DENY_EPERM },    /* io_uring: submits work to the kernel ring */
#endif
#ifdef __NR_io_uring_register
    { __NR_io_uring_register, REALM_DENY_EPERM }, /* io_uring: registers buffers and files with the kernel ring */
#endif
#ifdef __NR_personality
    { __NR_personality, REALM_DENY_PERSONALITY }, /* changes execution-domain flags; only the query (0xffffffff) and PER_LINUX (0) are allowed */
#endif
    /* Clock and host identity. */
#ifdef __NR_clock_adjtime
    { __NR_clock_adjtime, REALM_DENY_EPERM },     /* adjusts the host clock */
#endif
#ifdef __NR_adjtimex
    { __NR_adjtimex, REALM_DENY_EPERM },          /* adjusts the host clock rate and state */
#endif
#ifdef __NR_settimeofday
    { __NR_settimeofday, REALM_DENY_EPERM },      /* sets the host time */
#endif
#ifdef __NR_clock_settime
    { __NR_clock_settime, REALM_DENY_EPERM },     /* sets a host clock */
#endif
#ifdef __NR_sethostname
    { __NR_sethostname, REALM_DENY_EPERM },       /* changes the host name in the UTS namespace it reaches */
#endif
#ifdef __NR_setdomainname
    { __NR_setdomainname, REALM_DENY_EPERM },     /* changes the NIS domain name */
#endif
    /* Terminal, logging, and kernel-introspection surface. */
#ifdef __NR_vhangup
    { __NR_vhangup, REALM_DENY_EPERM },           /* hangs up the controlling terminal; host-level effect */
#endif
#ifdef __NR_syslog
    { __NR_syslog, REALM_DENY_EPERM },            /* reads or clears the kernel log */
#endif
#ifdef __NR_lookup_dcookie
    { __NR_lookup_dcookie, REALM_DENY_EPERM },    /* resolves kernel dentry cookies; kernel address disclosure surface */
#endif
#ifdef __NR_kcmp
    { __NR_kcmp, REALM_DENY_EPERM },              /* compares kernel resources across processes; information disclosure */
#endif
#ifdef __NR_pidfd_getfd
    { __NR_pidfd_getfd, REALM_DENY_EPERM },       /* duplicates another process's file descriptor */
#endif
#ifdef __NR_uselib
    { __NR_uselib, REALM_DENY_EPERM },            /* legacy a.out library load; x86 only */
#endif
#ifdef __NR_sysfs
    { __NR_sysfs, REALM_DENY_EPERM },             /* legacy filesystem-type query; x86 only */
#endif
#ifdef __NR_modify_ldt
    { __NR_modify_ldt, REALM_DENY_EPERM },        /* changes the x86 local descriptor table; x86 only */
#endif
#ifdef SYS_iopl
    { SYS_iopl, REALM_DENY_EPERM },               /* grants direct x86 I/O port access; x86 only */
#endif
#ifdef SYS_ioperm
    { SYS_ioperm, REALM_DENY_EPERM },             /* grants direct x86 I/O port access for a port range; x86 only */
#endif
    /* Not listed, on purpose: memfd_create (not a boundary by itself; denying
     * it breaks legitimate runtimes) and fanotify_init (needs CAP_SYS_ADMIN;
     * informational). See SECCOMP.md. */
};

int realm_landlock_abi_ok(int abi) {
    return abi >= REALM_LANDLOCK_MIN_ABI ? 1 : 0;
}

/* Returns the next named segment. Empty segments and "." are skipped; ".."
 * is returned, so callers can refuse it. Returns 0 at the end of the path. */
static int next_segment(const char **cursor, const char **start, size_t *len) {
    const char *s = *cursor;
    const char *end;

    for (;;) {
        while (*s == '/') {
            s++;
        }
        if (*s == '\0') {
            *cursor = s;
            return 0;
        }
        end = s;
        while (*end != '\0' && *end != '/') {
            end++;
        }
        if (end - s == 1 && s[0] == '.') {
            s = end;
            continue;
        }
        *start = s;
        *len = (size_t)(end - s);
        *cursor = end;
        return 1;
    }
}

static int has_dotdot(const char *path) {
    const char *cursor = path;
    const char *seg;
    size_t len;

    while (next_segment(&cursor, &seg, &len)) {
        if (len == 2 && seg[0] == '.' && seg[1] == '.') {
            return 1;
        }
    }
    return 0;
}

/* Absolute, names something other than the root, and has no ".." segment. */
static int path_usable(const char *path) {
    const char *cursor;
    const char *seg;
    size_t len;
    int named = 0;

    if (path == NULL || path[0] != '/') {
        return 0;
    }
    cursor = path;
    while (next_segment(&cursor, &seg, &len)) {
        if (len == 2 && seg[0] == '.' && seg[1] == '.') {
            return 0;
        }
        named = 1;
    }
    return named;
}

int realm_path_is_under(const char *path, const char *base) {
    const char *pc;
    const char *bc;
    const char *ps;
    const char *bs;
    size_t pl;
    size_t bl;

    if (path == NULL || base == NULL) {
        return 1;
    }
    /* Conservative: a ".." path cannot be placed, so it counts as inside. */
    if (has_dotdot(path) || has_dotdot(base)) {
        return 1;
    }
    pc = path;
    bc = base;
    while (next_segment(&bc, &bs, &bl)) {
        if (!next_segment(&pc, &ps, &pl)) {
            return 0;
        }
        if (pl != bl || memcmp(ps, bs, bl) != 0) {
            return 0;
        }
    }
    return 1;
}

int realm_path_is_system(const char *path) {
    return realm_path_is_under(path, "/usr") || realm_path_is_under(path, "/etc") ||
           realm_path_is_under(path, "/proc") || realm_path_is_under(path, "/dev");
}

int realm_path_is_tmp(const char *path) {
    return realm_path_is_under(path, "/tmp");
}

int realm_roots_overlap(const char *a, const char *b) {
    return realm_path_is_under(a, b) || realm_path_is_under(b, a);
}

int realm_validate_paths(const char *workspace, const char *scratch, const char *state) {
    if (!path_usable(workspace) || !path_usable(scratch) || !path_usable(state)) {
        return -1;
    }
    if (realm_path_is_tmp(workspace) || realm_path_is_tmp(scratch) || realm_path_is_tmp(state)) {
        return -1;
    }
    if (realm_path_is_system(workspace) || realm_path_is_system(scratch)) {
        return -1;
    }
    if (realm_roots_overlap(workspace, scratch) || realm_roots_overlap(workspace, state) ||
        realm_roots_overlap(scratch, state)) {
        return -1;
    }
    return 0;
}

int realm_prog_ok(const char *prog) {
    return path_usable(prog) ? 1 : 0;
}

int realm_env_allowed(const char *entry) {
    if (entry == NULL) {
        return 0;
    }
    if (strncmp(entry, "LD_", 3) == 0) {
        return 0;
    }
    if (strncmp(entry, "GCONV_PATH=", 11) == 0) {
        return 0;
    }
    if (strncmp(entry, "LOCPATH=", 8) == 0) {
        return 0;
    }
    if (strncmp(entry, "NLSPATH=", 8) == 0) {
        return 0;
    }
    return 1;
}

int realm_execve_exit_code(int err) {
    if (err == EACCES) {
        return REALM_EXIT_EXEC_DENIED;
    }
    if (err == ENOENT) {
        return REALM_EXIT_EXEC_MISSING;
    }
    return REALM_EXIT_EXEC_OTHER;
}

int realm_parse_args(int argc, char *const argv[], struct realm_command *out) {
    const char *opt;
    const char *value;
    const char **slot;
    int i;

    if (out == NULL) {
        return -1;
    }
    memset(out, 0, sizeof *out);
    if (argv == NULL || argc < 2 || argv[1] == NULL) {
        return -1;
    }
    if (strcmp(argv[1], "idle") == 0) {
        if (argc != 2) {
            return -1;
        }
        out->kind = REALM_CMD_IDLE;
        return 0;
    }
    if (strcmp(argv[1], "run") != 0) {
        return -1;
    }
    out->kind = REALM_CMD_RUN;

    i = 2;
    while (i < argc) {
        opt = argv[i];
        slot = NULL;
        if (opt == NULL) {
            return -1;
        }
        if (strcmp(opt, "--") == 0) {
            break;
        }
        if (strcmp(opt, "--workspace") == 0) {
            slot = &out->workspace;
        } else if (strcmp(opt, "--scratch") == 0) {
            slot = &out->scratch;
        } else if (strcmp(opt, "--state") == 0) {
            slot = &out->state;
        } else {
            return -1;
        }
        if (*slot != NULL || i + 1 >= argc) {
            return -1;
        }
        value = argv[i + 1];
        if (value == NULL || value[0] == '\0' || strcmp(value, "--") == 0) {
            return -1;
        }
        *slot = value;
        i += 2;
    }

    /* Reaching the end without "--" is a refusal: `run` without `--`. */
    if (i >= argc) {
        return -1;
    }
    if (out->workspace == NULL || out->scratch == NULL || out->state == NULL) {
        return -1;
    }
    if (i + 1 >= argc || !realm_prog_ok(argv[i + 1])) {
        return -1;
    }
    out->prog_index = i + 1;
    return 0;
}

const struct realm_deny_entry *realm_denylist(void) {
    return realm_denylist_table;
}

size_t realm_denylist_len(void) {
    return sizeof realm_denylist_table / sizeof realm_denylist_table[0];
}

/* Index distance from `from` to `target` for a forward jump. A BPF jump
 * offset counts the instructions skipped after `from`. */
static int jump_to(size_t from, size_t target, uint8_t *out) {
    size_t distance;

    if (target <= from) {
        return -1;
    }
    distance = target - from - 1;
    if (distance > UINT8_MAX) {
        return -1;
    }
    *out = (uint8_t)distance;
    return 0;
}

/* Program layout. Let N be the table length and H the header length (4, or 5 on x86_64):
 *   [0, H)            arch check (KILL on mismatch), load nr, x32 bit check (x86_64)
 *   [H, H+N)          one JEQ per table entry, each to its action block
 *   H+N               RET ALLOW (default)
 *   e_eperm           RET ERRNO(EPERM)
 *   e_enosys          RET ERRNO(ENOSYS)
 *   clone_blk         LD args[0]; JSET CLONE_NS_MASK -> clone_blk+3; RET ALLOW;
 *                     RET ERRNO(EPERM)                                            (4)
 *   pers_blk          LD args[0]; JEQ 0 -> allow; JEQ 0xffffffff -> allow;
 *                     RET ERRNO(EPERM); allow: RET ALLOW                          (5)
 * Total: H + N + 12. Every jump is forward: BPF has no backward jumps. */
size_t realm_build_seccomp_filter(struct sock_filter *out, size_t cap) {
    const struct realm_deny_entry *table = realm_denylist_table;
    const size_t n = realm_denylist_len();
    const size_t hdr = 4 + REALM_X32_CHECK;
    const size_t e_eperm = hdr + n + 1;
    const size_t e_enosys = e_eperm + 1;
    const size_t clone_blk = e_enosys + 1;
    const size_t pers_blk = clone_blk + 4;
    const size_t pers_allow = pers_blk + 4;
    const size_t total = pers_allow + 1;
    const size_t arg0 = offsetof(struct seccomp_data, args);
    size_t i = 0;
    size_t k;
    size_t target = 0;
    uint8_t jt = 0;

    if (out == NULL || cap < total) {
        return 0;
    }

    out[i++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
    out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REALM_AUDIT_ARCH, 1, 0);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
#if REALM_X32_CHECK
    if (jump_to(i, e_eperm, &jt) != 0) {
        return 0;
    }
    out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, REALM_X32_SYSCALL_BIT, jt, 0);
#endif

    for (k = 0; k < n; k++) {
        switch (table[k].action) {
        case REALM_DENY_EPERM:
            target = e_eperm;
            break;
        case REALM_DENY_ENOSYS:
            target = e_enosys;
            break;
        case REALM_DENY_CLONE_NS:
            target = clone_blk;
            break;
        case REALM_DENY_PERSONALITY:
            target = pers_blk;
            break;
        default:
            return 0;
        }
        if (jump_to(i, target, &jt) != 0) {
            return 0;
        }
        out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)table[k].nr, jt, 0);
    }

    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS);

    /* clone: deny only when a CLONE_NEW* bit is set in the low 32 bits of args[0]. */
    out[i++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (uint32_t)arg0);
    if (jump_to(i, clone_blk + 3, &jt) != 0) {
        return 0;
    }
    out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, REALM_CLONE_NS_MASK, jt, 0);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);

    /* personality: allow only the query value and PER_LINUX (both in the low 32 bits). */
    out[i++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (uint32_t)arg0);
    if (jump_to(i, pers_allow, &jt) != 0) {
        return 0;
    }
    out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0x0U, jt, 0);
    if (jump_to(i, pers_allow, &jt) != 0) {
        return 0;
    }
    out[i++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REALM_PERSONALITY_QUERY, jt, 0);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    out[i++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);

    if (i != total) {
        return 0;
    }
    return i;
}
