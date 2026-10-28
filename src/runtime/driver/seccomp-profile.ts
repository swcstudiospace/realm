// The seccomp profile every sandbox container runs under (phase 9.6). It is Podman's default profile with the three keyring
// syscalls denied with EPERM, embedded here so the driver writes exactly these bytes and the verifier names exactly this file.
//
// Upstream: the containers/container-libs repository, module go.podman.io/common at v0.66.1 (the version Podman 5.7.1 pins),
// file pkg/seccomp/seccomp.json. Licence: Apache-2.0. The source file is 17525 bytes, SHA-256
// 886ae167646b7e5db381ecf7c31e6de720a8e8da15cf3202fe1f67f424af2b75 (UPSTREAM_SHA256 below).
//
// Transformation, and nothing else: `keyctl` is removed from the rule that allows it, and one explicit rule
// { names: [add_key, keyctl, request_key], action: SCMP_ACT_ERRNO, errnoRet: 1 } is inserted right after the first rule (the
// upstream rule that already denies other syscalls with EPERM). Every other rule, the rule order, the architectures and the
// default action (SCMP_ACT_ERRNO with errno 38) are upstream's. The default errno is ENOSYS, so deleting keyctl alone would
// answer ENOSYS; the explicit rule makes the keyring syscalls answer EPERM (PRD-ENF-03).
//
// The written text is JSON.stringify(profile, null, "\t") with no trailing newline, which is upstream's own formatting, so a text
// diff against the upstream file shows only the transformation. The key order of every object below is upstream's.

import { createHash } from "node:crypto";

// SHA-256 of the upstream file, before the transformation.
export const SECCOMP_UPSTREAM_SHA256 = "886ae167646b7e5db381ecf7c31e6de720a8e8da15cf3202fe1f67f424af2b75";

export interface SeccompArchitecture {
  readonly architecture: string;
  readonly subArchitectures: readonly string[];
}

export interface SeccompArgument {
  readonly index: number;
  readonly value: number;
  readonly valueTwo: number;
  readonly op: string;
}

// The conditions of a rule: the architectures it applies to, or the capabilities the container holds (includes) or lacks (excludes).
export interface SeccompCondition {
  readonly arches?: readonly string[];
  readonly caps?: readonly string[];
}

export interface SeccompRule {
  readonly names: readonly string[];
  readonly action: string;
  readonly args: readonly SeccompArgument[] | null;
  readonly comment: string;
  readonly includes: SeccompCondition;
  readonly excludes: SeccompCondition;
  readonly errnoRet?: number;
  readonly errno?: string;
}

export interface SeccompProfile {
  readonly defaultAction: string;
  readonly defaultErrnoRet: number;
  readonly defaultErrno: string;
  readonly archMap: readonly SeccompArchitecture[];
  readonly syscalls: readonly SeccompRule[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

export const SECCOMP_PROFILE: SeccompProfile = deepFreeze<SeccompProfile>({
  defaultAction: "SCMP_ACT_ERRNO",
  defaultErrnoRet: 38,
  defaultErrno: "ENOSYS",
  archMap: [
    {
      architecture: "SCMP_ARCH_X86_64",
      subArchitectures: ["SCMP_ARCH_X86", "SCMP_ARCH_X32"],
    },
    {
      architecture: "SCMP_ARCH_AARCH64",
      subArchitectures: ["SCMP_ARCH_ARM"],
    },
    {
      architecture: "SCMP_ARCH_MIPS64",
      subArchitectures: ["SCMP_ARCH_MIPS", "SCMP_ARCH_MIPS64N32"],
    },
    {
      architecture: "SCMP_ARCH_MIPS64N32",
      subArchitectures: ["SCMP_ARCH_MIPS", "SCMP_ARCH_MIPS64"],
    },
    {
      architecture: "SCMP_ARCH_MIPSEL64",
      subArchitectures: ["SCMP_ARCH_MIPSEL", "SCMP_ARCH_MIPSEL64N32"],
    },
    {
      architecture: "SCMP_ARCH_MIPSEL64N32",
      subArchitectures: ["SCMP_ARCH_MIPSEL", "SCMP_ARCH_MIPSEL64"],
    },
    {
      architecture: "SCMP_ARCH_S390X",
      subArchitectures: ["SCMP_ARCH_S390"],
    },
  ],
  syscalls: [
    {
      names: [
        "bdflush", "cachestat", "futex_requeue", "futex_wait", "futex_waitv", "futex_wake", "io_pgetevents",
        "io_pgetevents_time64", "kexec_file_load", "kexec_load", "map_shadow_stack", "migrate_pages", "move_pages",
        "nfsservctl", "nice", "oldfstat", "oldlstat", "oldolduname", "oldstat", "olduname", "pciconfig_iobase",
        "pciconfig_read", "pciconfig_write", "sgetmask", "ssetmask", "swapoff", "swapon", "syscall", "sysfs", "uselib",
        "userfaultfd", "ustat", "vm86", "vm86old", "vmsplice",
      ],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: {},
      errnoRet: 1,
      errno: "EPERM",
    },
    // The one rule this repository adds. It denies the keyring syscalls with EPERM. It sits before every allow rule so that, read
    // in order, the first rule that names one of these syscalls is this one. No other rule names them.
    {
      names: ["add_key", "keyctl", "request_key"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: {},
      errnoRet: 1,
      errno: "EPERM",
    },
    // Upstream's main allow rule, without keyctl (it sat between ipc and kill).
    {
      names: [
        "_llseek", "_newselect", "accept", "accept4", "access", "adjtimex", "alarm", "bind", "brk", "capget", "capset",
        "chdir", "chmod", "chown", "chown32", "clock_adjtime", "clock_adjtime64", "clock_getres", "clock_getres_time64",
        "clock_gettime", "clock_gettime64", "clock_nanosleep", "clock_nanosleep_time64", "clone", "clone3", "close",
        "close_range", "connect", "copy_file_range", "creat", "dup", "dup2", "dup3", "epoll_create", "epoll_create1",
        "epoll_ctl", "epoll_ctl_old", "epoll_pwait", "epoll_pwait2", "epoll_wait", "epoll_wait_old", "eventfd", "eventfd2",
        "execve", "execveat", "exit", "exit_group", "faccessat", "faccessat2", "fadvise64", "fadvise64_64", "fallocate",
        "fanotify_init", "fanotify_mark", "fchdir", "fchmod", "fchmodat", "fchmodat2", "fchown", "fchown32", "fchownat",
        "fcntl", "fcntl64", "fdatasync", "fgetxattr", "flistxattr", "flock", "fork", "fremovexattr", "fsconfig",
        "fsetxattr", "fsmount", "fsopen", "fspick", "fstat", "fstat64", "fstatat64", "fstatfs", "fstatfs64", "fsync",
        "ftruncate", "ftruncate64", "futex", "futex_time64", "futimesat", "get_mempolicy", "get_robust_list",
        "get_thread_area", "getcpu", "getcwd", "getdents", "getdents64", "getegid", "getegid32", "geteuid", "geteuid32",
        "getgid", "getgid32", "getgroups", "getgroups32", "getitimer", "getpeername", "getpgid", "getpgrp", "getpid",
        "getppid", "getpriority", "getrandom", "getresgid", "getresgid32", "getresuid", "getresuid32", "getrlimit",
        "getrusage", "getsid", "getsockname", "getsockopt", "gettid", "gettimeofday", "getuid", "getuid32", "getxattr",
        "inotify_add_watch", "inotify_init", "inotify_init1", "inotify_rm_watch", "io_cancel", "io_destroy",
        "io_getevents", "io_setup", "io_submit", "ioctl", "ioprio_get", "ioprio_set", "ipc", "kill",
        "landlock_add_rule", "landlock_create_ruleset", "landlock_restrict_self", "lchown", "lchown32", "lgetxattr",
        "link", "linkat", "listen", "listxattr", "llistxattr", "lremovexattr", "lseek", "lsetxattr", "lstat", "lstat64",
        "madvise", "mbind", "membarrier", "memfd_create", "memfd_secret", "mincore", "mkdir", "mkdirat", "mknod",
        "mknodat", "mlock", "mlock2", "mlockall", "mmap", "mmap2", "mount", "mount_setattr", "move_mount", "mprotect",
        "mq_getsetattr", "mq_notify", "mq_open", "mq_timedreceive", "mq_timedreceive_time64", "mq_timedsend",
        "mq_timedsend_time64", "mq_unlink", "mremap", "msgctl", "msgget", "msgrcv", "msgsnd", "msync", "munlock",
        "munlockall", "munmap", "name_to_handle_at", "nanosleep", "newfstatat", "open", "open_tree", "openat", "openat2",
        "pause", "pidfd_getfd", "pidfd_open", "pidfd_send_signal", "pipe", "pipe2", "pivot_root", "pkey_alloc",
        "pkey_free", "pkey_mprotect", "poll", "ppoll", "ppoll_time64", "prctl", "pread64", "preadv", "preadv2",
        "prlimit64", "process_mrelease", "process_vm_readv", "process_vm_writev", "pselect6", "pselect6_time64", "ptrace",
        "pwrite64", "pwritev", "pwritev2", "read", "readahead", "readlink", "readlinkat", "readv", "reboot", "recv",
        "recvfrom", "recvmmsg", "recvmmsg_time64", "recvmsg", "remap_file_pages", "removexattr", "rename", "renameat",
        "renameat2", "restart_syscall", "rmdir", "rseq", "rt_sigaction", "rt_sigpending", "rt_sigprocmask",
        "rt_sigqueueinfo", "rt_sigreturn", "rt_sigsuspend", "rt_sigtimedwait", "rt_sigtimedwait_time64",
        "rt_tgsigqueueinfo", "sched_get_priority_max", "sched_get_priority_min", "sched_getaffinity", "sched_getattr",
        "sched_getparam", "sched_getscheduler", "sched_rr_get_interval", "sched_rr_get_interval_time64",
        "sched_setaffinity", "sched_setattr", "sched_setparam", "sched_setscheduler", "sched_yield", "seccomp", "select",
        "semctl", "semget", "semop", "semtimedop", "semtimedop_time64", "send", "sendfile", "sendfile64", "sendmmsg",
        "sendmsg", "sendto", "set_mempolicy", "set_robust_list", "set_thread_area", "set_tid_address", "setfsgid",
        "setfsgid32", "setfsuid", "setfsuid32", "setgid", "setgid32", "setgroups", "setgroups32", "setitimer", "setns",
        "setpgid", "setpriority", "setregid", "setregid32", "setresgid", "setresgid32", "setresuid", "setresuid32",
        "setreuid", "setreuid32", "setrlimit", "setsid", "setsockopt", "setuid", "setuid32", "setxattr", "shmat", "shmctl",
        "shmdt", "shmget", "shutdown", "sigaltstack", "signal", "signalfd", "signalfd4", "sigprocmask", "sigreturn",
        "socketcall", "socketpair", "splice", "stat", "stat64", "statfs", "statfs64", "statx", "symlink", "symlinkat",
        "sync", "sync_file_range", "syncfs", "sysinfo", "syslog", "tee", "tgkill", "time", "timer_create", "timer_delete",
        "timer_getoverrun", "timer_gettime", "timer_gettime64", "timer_settime", "timer_settime64", "timerfd_create",
        "timerfd_gettime", "timerfd_gettime64", "timerfd_settime", "timerfd_settime64", "times", "tkill", "truncate",
        "truncate64", "ugetrlimit", "umask", "umount", "umount2", "uname", "unlink", "unlinkat", "unshare", "utime",
        "utimensat", "utimensat_time64", "utimes", "vfork", "wait4", "waitid", "waitpid", "write", "writev",
      ],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["personality"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 0, valueTwo: 0, op: "SCMP_CMP_EQ" }],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["personality"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 8, valueTwo: 0, op: "SCMP_CMP_EQ" }],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["personality"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 131072, valueTwo: 0, op: "SCMP_CMP_EQ" }],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["personality"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 131080, valueTwo: 0, op: "SCMP_CMP_EQ" }],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["personality"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 4294967295, valueTwo: 0, op: "SCMP_CMP_EQ" }],
      comment: "",
      includes: {},
      excludes: {},
    },
    {
      names: ["sync_file_range2", "swapcontext"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["ppc64le"] },
      excludes: {},
    },
    {
      names: ["arm_fadvise64_64", "arm_sync_file_range", "breakpoint", "cacheflush", "set_tls", "sync_file_range2"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["arm", "arm64"] },
      excludes: {},
    },
    {
      names: ["arch_prctl"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["amd64", "x32"] },
      excludes: {},
    },
    {
      names: ["modify_ldt"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["amd64", "x32", "x86"] },
      excludes: {},
    },
    {
      names: ["s390_pci_mmio_read", "s390_pci_mmio_write", "s390_runtime_instr"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["s390", "s390x"] },
      excludes: {},
    },
    {
      names: ["riscv_flush_icache"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { arches: ["riscv64"] },
      excludes: {},
    },
    {
      names: ["open_by_handle_at"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_DAC_READ_SEARCH"] },
      excludes: {},
    },
    {
      names: ["open_by_handle_at"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_DAC_READ_SEARCH"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["bpf", "lookup_dcookie", "quotactl", "quotactl_fd", "setdomainname", "sethostname", "setns"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_ADMIN"] },
      excludes: {},
    },
    {
      names: ["lookup_dcookie", "perf_event_open", "quotactl", "quotactl_fd", "setdomainname", "sethostname", "setns"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_ADMIN"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["chroot"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_CHROOT"] },
      excludes: {},
    },
    {
      names: ["chroot"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_CHROOT"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["delete_module", "finit_module", "init_module", "query_module"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_MODULE"] },
      excludes: {},
    },
    {
      names: ["delete_module", "finit_module", "init_module", "query_module"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_MODULE"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["acct"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_PACCT"] },
      excludes: {},
    },
    {
      names: ["acct"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_PACCT"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["kcmp", "process_madvise"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_PTRACE"] },
      excludes: {},
    },
    {
      names: ["kcmp", "process_madvise"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_PTRACE"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["ioperm", "iopl"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_RAWIO"] },
      excludes: {},
    },
    {
      names: ["ioperm", "iopl"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_RAWIO"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["clock_settime", "clock_settime64", "settimeofday", "stime"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_TIME"] },
      excludes: {},
    },
    {
      names: ["clock_settime", "clock_settime64", "settimeofday", "stime"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_TIME"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["vhangup"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_SYS_TTY_CONFIG"] },
      excludes: {},
    },
    {
      names: ["vhangup"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_TTY_CONFIG"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["socket"],
      action: "SCMP_ACT_ERRNO",
      args: [
        { index: 0, value: 16, valueTwo: 0, op: "SCMP_CMP_EQ" },
        { index: 2, value: 9, valueTwo: 0, op: "SCMP_CMP_EQ" },
      ],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_AUDIT_WRITE"] },
      errnoRet: 22,
      errno: "EINVAL",
    },
    {
      names: ["socket"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 2, value: 9, valueTwo: 0, op: "SCMP_CMP_NE" }],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_AUDIT_WRITE"] },
    },
    {
      names: ["socket"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 16, valueTwo: 0, op: "SCMP_CMP_NE" }],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_AUDIT_WRITE"] },
    },
    {
      names: ["socket"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 2, value: 9, valueTwo: 0, op: "SCMP_CMP_NE" }],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_AUDIT_WRITE"] },
    },
    {
      names: ["socket"],
      action: "SCMP_ACT_ALLOW",
      args: null,
      comment: "",
      includes: { caps: ["CAP_AUDIT_WRITE"] },
      excludes: {},
    },
    {
      names: ["bpf"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_ADMIN", "CAP_BPF"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["bpf"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_BPF"] },
      excludes: {},
    },
    {
      names: ["perf_event_open"],
      action: "SCMP_ACT_ERRNO",
      args: [],
      comment: "",
      includes: {},
      excludes: { caps: ["CAP_SYS_ADMIN", "CAP_BPF"] },
      errnoRet: 1,
      errno: "EPERM",
    },
    {
      names: ["perf_event_open"],
      action: "SCMP_ACT_ALLOW",
      args: [],
      comment: "",
      includes: { caps: ["CAP_PERFMON"] },
      excludes: {},
    },
  ],
});

// The exact text the driver writes: upstream's formatting (tab indent, no trailing newline) over the transformed profile.
export const SECCOMP_PROFILE_TEXT: string = JSON.stringify(SECCOMP_PROFILE, null, "\t");

// SHA-256 hex of SECCOMP_PROFILE_TEXT, computed at module load from the exact text.
export const SECCOMP_PROFILE_SHA256: string = createHash("sha256").update(SECCOMP_PROFILE_TEXT, "utf8").digest("hex");

// The first 16 hex digits of the digest. They name the file, so a file of that name with other content is a different profile.
export const SECCOMP_PROFILE_DIGEST_PREFIX: string = SECCOMP_PROFILE_SHA256.slice(0, 16);

// The name of the file the driver writes and the verifier looks for.
export const SECCOMP_PROFILE_FILE_NAME = `realm-seccomp-${SECCOMP_PROFILE_DIGEST_PREFIX}.json`;
