# realm-helper seccomp denylist

This is the review input for the security gate (A10). The helper applies these
rules after no_new_privs, the capability drop, and the Landlock rule set, and
before `execve`. Each listed syscall gets its action. Every other syscall is
allowed. The architecture is checked first: a process with any other
architecture is killed.

The list is a denylist, as in the spike. An allowlist would be stronger. Whether
it stays a denylist for v2.0 is the A10 decision. The verdict is recorded in the
phase SUMMARY, not here.

## Actions

| Action | Meaning |
|--------|---------|
| EPERM | return `-EPERM` for every argument set |
| ENOSYS | return `-ENOSYS`. glibc falls back from clone3 to clone on ENOSYS, and would fail on EPERM |
| CLONE_NS | EPERM only when a `CLONE_NEW*` bit is set in the low 32 bits of args[0]; otherwise allow |
| PERSONALITY | EPERM unless args[0] (low 32 bits) is `0x0` or `0xffffffff`; otherwise allow |

## Filter rule (not a denylist entry)

| Rule | Applies to | Reason |
|------|------------|--------|
| R0: any syscall with the x32 bit (`0x40000000`) set returns EPERM | x86_64 only | x32 syscalls report the x86_64 audit arch and carry this bit in `nr`. Without this rule they would skip the denylist. |

## Denylist

Counts: **x86_64: 57 entries** (29 from the spike, 28 added by the security
gate: 25 EPERM, plus clone, clone3, and personality). Of the 57, **54 are
EPERM**. **aarch64: 52 entries, 49 EPERM.** The x86-only names (`iopl`,
`ioperm`, `uselib`, `sysfs`, `modify_ldt`) are compiled out there. Every
entry added by the security gate is guarded with `#ifdef`, so each architecture
compiles. The x86_64 numbers are shown below.

| # | Syscall | x86_64 nr | Action | Reason |
|---|---------|-----------|--------|--------|
| 1 | `mount` | 165 | EPERM | Changes the mount table. A new bind or overlay could widen filesystem reach past Landlock. |
| 2 | `umount2` | 166 | EPERM | Detaches mounts. Can hide or expose paths the policy relies on. |
| 3 | `pivot_root` | 155 | EPERM | Replaces the root filesystem. A container escape step. |
| 4 | `chroot` | 161 | EPERM | Changes the root directory. An escape step when combined with mounts. |
| 5 | `unshare` | 272 | EPERM | Creates namespaces, including user namespaces that grant mount rights. |
| 6 | `setns` | 308 | EPERM | Joins existing namespaces outside the sandbox. |
| 7 | `clone` | 56 | CLONE_NS | A clone with a `CLONE_NEW*` flag creates a namespace (NEWNS, NEWCGROUP, NEWUTS, NEWIPC, NEWUSER, NEWPID, NEWNET, NEWTIME). Mask `0x00020000 \| 0x02000000 \| 0x04000000 \| 0x08000000 \| 0x10000000 \| 0x20000000 \| 0x40000000 \| 0x00000080` on the low 32 bits of args[0]. Plain thread and process clones are allowed. |
| 8 | `clone3` | 435 | ENOSYS | Its flags sit in a struct the filter cannot read, so it cannot be argument-checked. ENOSYS makes glibc fall back to clone, which the filter does check. |
| 9 | `fsopen` | 430 | EPERM | New-API mount: opens a filesystem context, bypassing the mount(2) checks. |
| 10 | `fsconfig` | 431 | EPERM | Configures a filesystem context for the new mount API. |
| 11 | `fsmount` | 432 | EPERM | Creates a mount from a filesystem context. |
| 12 | `move_mount` | 429 | EPERM | Attaches a detached mount into the mount table. |
| 13 | `open_tree` | 428 | EPERM | Detached bind mount of a path. A mount-surface bypass. |
| 14 | `mount_setattr` | 442 | EPERM | Changes mount attributes, for example clearing read-only or noexec. |
| 15 | `fspick` | 433 | EPERM | Selects an existing mount in the new mount API for reconfiguration. A mount-surface bypass in the same class as fsopen and fsconfig. |
| 16 | `bpf` | 321 | EPERM | Loads kernel BPF programs. Large kernel attack surface; workloads do not need it. |
| 17 | `keyctl` | 250 | EPERM | Manipulates kernel keyrings. Kernel attack surface. The probe expects EPERM here. |
| 18 | `add_key` | 248 | EPERM | Creates kernel keyring keys. Kernel attack surface. |
| 19 | `request_key` | 249 | EPERM | Kernel keyring upcalls to userspace. Kernel attack surface. |
| 20 | `userfaultfd` | 323 | EPERM | Pauses kernel-side faults. Widely used to widen kernel race windows. |
| 21 | `perf_event_open` | 298 | EPERM | Performance counters. Side channel and kernel attack surface. |
| 22 | `process_vm_readv` | 310 | EPERM | Reads another process's memory across the process boundary. |
| 23 | `process_vm_writev` | 311 | EPERM | Writes another process's memory across the process boundary. |
| 24 | `ptrace` | 101 | EPERM | Inspects and injects into other processes. |
| 25 | `kexec_load` | 246 | EPERM | Loads a replacement kernel image. |
| 26 | `kexec_file_load` | 320 | EPERM | Loads a replacement kernel image from a file. |
| 27 | `init_module` | 175 | EPERM | Loads a kernel module. |
| 28 | `finit_module` | 313 | EPERM | Loads a kernel module from a file descriptor. |
| 29 | `delete_module` | 176 | EPERM | Unloads a kernel module. |
| 30 | `open_by_handle_at` | 304 | EPERM | Opens by file handle, bypassing path-based Landlock checks. |
| 31 | `name_to_handle_at` | 303 | EPERM | Produces the handles that `open_by_handle_at` consumes. |
| 32 | `swapon` | 167 | EPERM | Changes host swap configuration. |
| 33 | `swapoff` | 168 | EPERM | Changes host swap configuration. |
| 34 | `reboot` | 169 | EPERM | Reboots or powers off the host. |
| 35 | `acct` | 163 | EPERM | Enables host process accounting to a file. |
| 36 | `quotactl` | 179 | EPERM | Changes filesystem quota state on the host. |
| 37 | `quotactl_fd` | 443 | EPERM | Changes filesystem quota state through an open file descriptor. Host-level effect, the same as quotactl. |
| 38 | `io_uring_setup` | 425 | EPERM | io_uring: large kernel attack surface; workloads do not need it. |
| 39 | `io_uring_enter` | 426 | EPERM | io_uring: submits work to the kernel ring. |
| 40 | `io_uring_register` | 427 | EPERM | io_uring: registers buffers and files with the kernel ring. |
| 41 | `personality` | 135 | PERSONALITY | Changes execution-domain flags. Only the query value `0xffffffff` and PER_LINUX `0x0` are allowed. |
| 42 | `clock_adjtime` | 305 | EPERM | Adjusts the host clock. |
| 43 | `adjtimex` | 159 | EPERM | Adjusts the host clock rate and state. |
| 44 | `settimeofday` | 164 | EPERM | Sets the host time. |
| 45 | `clock_settime` | 227 | EPERM | Sets a host clock. |
| 46 | `sethostname` | 170 | EPERM | Changes the host name. |
| 47 | `setdomainname` | 171 | EPERM | Changes the NIS domain name. |
| 48 | `vhangup` | 153 | EPERM | Hangs up the controlling terminal. Host-level effect. |
| 49 | `syslog` | 103 | EPERM | Reads or clears the kernel log. |
| 50 | `lookup_dcookie` | 212 | EPERM | Resolves kernel dentry cookies. Kernel address disclosure surface. |
| 51 | `kcmp` | 312 | EPERM | Compares kernel resources across processes. Information disclosure. |
| 52 | `pidfd_getfd` | 438 | EPERM | Duplicates another process's file descriptor. |
| 53 | `uselib` | 134 | EPERM | Legacy a.out library load. x86 only. |
| 54 | `sysfs` | 139 | EPERM | Legacy filesystem-type query. x86 only. |
| 55 | `modify_ldt` | 154 | EPERM | Changes the x86 local descriptor table. x86 only. |
| 56 | `iopl` | 172 | EPERM | Grants direct x86 I/O port access. x86 only. |
| 57 | `ioperm` | 173 | EPERM | Grants direct x86 I/O port access for a port range. x86 only. |

### Not denied, and why

- **`memfd_create` (319)**: not a boundary by itself. It creates an anonymous memory file, which a legitimate runtime (JIT engines, language runtimes, `memfd`-based IPC) uses. Denying it breaks those runtimes without closing a boundary. The exec path is controlled by Landlock EXECUTE and, in phase 9.3, the noexec workspace mount.
- **`fanotify_init` (300)**: needs CAP_SYS_ADMIN, which the capability drop removes. It is informational and is not on the list.

## Architecture differences

| Item | x86_64 | aarch64 |
|------|--------|---------|
| Denylist entries | 57 | 52 |
| EPERM entries | 54 | 49 |
| ENOSYS, CLONE_NS, PERSONALITY entries | 1, 1, 1 | 1, 1, 1 |
| Filter length (instructions) | 74 | 68 |
| x32 rule R0 | present | not applicable |
| `iopl`, `ioperm`, `uselib`, `sysfs`, `modify_ldt` | compiled in | compiled out |
| Audit arch checked | `AUDIT_ARCH_X86_64` | `AUDIT_ARCH_AARCH64` |

The probe's X32_EPERM check is meaningful on x86_64 only. On aarch64 it reports
FAIL, because the x32 ABI does not exist there.

## Exit codes

| Code | Meaning |
|------|---------|
| 2 | Usage error, refused argument, or refused root: path rules, `/tmp`, system prefix, overlap, or a symlink root, including a root that cannot be stat'd |
| 70 | no_new_privs could not be set |
| 71 | Landlock ABI probe failed, ABI below 3, or the rule set could not be built |
| 72 | Capability drop failed: a bounding-set read or drop, the ambient clear, the inheritable clear (capget or capset), or a capability still in the bounding set after the drop |
| 73 | Environment copy could not be allocated |
| 74 | seccomp filter could not be built or installed |
| 125 | execve failed with an errno other than EACCES or ENOENT |
| 126 | execve failed with EACCES (includes Landlock EXECUTE denial) |
| 127 | execve failed with ENOENT |
| 1 | `idle` only: signal handler or wait failure |

`idle` (PID 1 in the container) exits 0 on SIGINT or SIGTERM.

## Capability handling

After no_new_privs, the helper:

1. drops every capability from the bounding set (only if the set holds it);
2. clears the ambient set;
3. zeroes the inheritable set with capget and capset (`_LINUX_CAPABILITY_VERSION_3`). Effective and permitted are written back as read. Lowering a set needs no CAP_SETPCAP;
4. re-reads the bounding set and refuses if any capability is still set.

The probe checks CapEff and CapInh read as zero (CAPEFF_ZERO, CAPINH_ZERO).

## Residual risks

- **Landlock EXECUTE is enforced only on execve.** A binary in the workspace can still be mapped by a loader or by `mmap(PROT_EXEC)`. Phase 9.3 must mount the workspace `noexec`. The probe's LOADER_WORKSPACE_REFUSED check fails without that mount.
- **`/proc/<pid>/mem` is readable under the `/proc` read rule.** A workload can read the memory of a sibling process it can see. Deploy with `hidepid=2`, or with no sibling processes in the container.
- **TIOCSTI.** An ioctl on a terminal can inject input into it. Run the workload without a tty.
- **`idle` exits 0 on SIGINT and SIGTERM.** This is intended for PID 1 in the container only. Do not run `realm-helper idle` as a workload or outside the container, where a stop signal would look like a clean exit.
- **Denylist, not allowlist.** A syscall not listed is allowed. A new or uncommon syscall stays open until someone adds it.
- **Landlock covers filesystem access only.** Network and IPC are not constrained by this helper.
- **Intermediate symlinks.** The helper refuses a root that is itself a symlink. A symlink in a parent component of a root path is followed by the kernel. The path comes from the operator, not from the workload.
- **Effective and permitted sets on a root start.** The helper does not clear effective or permitted. A non-root start has none of these. A root start keeps them in CapEff, and the probe's CAPEFF_ZERO check fails. The runtime image starts as uid 1001, so this does not arise there.

## Conditions for later phases

These conditions were set by the A10 re-review. The verdict below depends on them.

- C1 (phase 9.3): /workspace is mounted noexec. This also gates LOADER_WORKSPACE_REFUSED.
- C2 (phase 9.3): the runner lies under /usr or the state path. Landlock enforces this; realm_prog_ok checks syntax only.
- C3 (phase 9.6): the probe runs in the built image, including CAPINH_ZERO.
- C4 (image only): useradd and groupadd work on the node base; the clone3 ENOSYS fallback works in glibc 2.36; libuv falls back from io_uring in Node 24; the node digest is the slim variant.
- C5 (phase 9.3): the state root holds no secret readable by uid 1001. The state root is granted read and execute, so the gateway PKI must not live there.
- C6 (phase 9.3): the workload runs without a tty, because TIOCSTI is not denied; and the container uses hidepid=2, because /proc/<pid>/mem is readable under the /proc rule.

Security gate verdict: PASS WITH CONDITIONS C1 to C6 on 2026-10-25 (re-review); N1 and N2 fixed.
