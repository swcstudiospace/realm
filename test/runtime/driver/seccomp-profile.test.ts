import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SECCOMP_PROFILE,
  SECCOMP_PROFILE_DIGEST_PREFIX,
  SECCOMP_PROFILE_FILE_NAME,
  SECCOMP_PROFILE_SHA256,
  SECCOMP_PROFILE_TEXT,
  SECCOMP_UPSTREAM_SHA256,
  type SeccompProfile,
  type SeccompRule,
} from "../../../src/runtime/driver/seccomp-profile.js";

// The syscalls the in-container runtime needs: its Landlock filesystem rules, its own seccomp filter, thread creation through clone
// (clone3 answers ENOSYS and glibc falls back to clone), and the file, descriptor and memory calls its dependencies make.
const REQUIRED_SYSCALLS: readonly string[] = [
  "landlock_create_ruleset",
  "landlock_add_rule",
  "landlock_restrict_self",
  "seccomp",
  "rseq",
  "faccessat2",
  "openat2",
  "close_range",
  "pidfd_open",
  "process_vm_readv",
  "memfd_create",
];

const KEYRING_SYSCALLS: readonly string[] = ["add_key", "keyctl", "request_key"];
const NAMESPACE_SYSCALLS: readonly string[] = ["unshare", "setns"];
const MOUNT_SYSCALLS: readonly string[] = [
  "mount",
  "umount",
  "umount2",
  "mount_setattr",
  "move_mount",
  "open_tree",
  "pivot_root",
  "fsconfig",
  "fsmount",
  "fsopen",
  "fspick",
];
const CROSS_PROCESS_DENIED: readonly string[] = ["ptrace", "process_vm_writev", "pidfd_getfd"];

// CLONE_NEWNS, CLONE_NEWCGROUP, CLONE_NEWUTS, CLONE_NEWIPC, CLONE_NEWUSER, CLONE_NEWPID and CLONE_NEWNET.
const CLONE_NAMESPACE_FLAGS: readonly number[] = [0x00020000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000];
const CLONE_NAMESPACE_MASK = 2114060288;

// What a sandbox container holds: a sandbox runs with every capability dropped and none added, on the host's x86-64 kernel.
const SANDBOX_CONTEXT = { arch: "amd64", capabilities: new Set<string>() };

interface Context {
  readonly arch: string;
  readonly capabilities: ReadonlySet<string>;
}

interface Decision {
  readonly action: string;
  readonly errnoRet: number | undefined;
  // The index of the rule that decided, or null when the default action did.
  readonly ruleIndex: number | null;
  // The rules that name the syscall and were set aside because they depend on its arguments. A decision with any of these is not
  // unconditional: the argument values could change it.
  readonly argumentRules: readonly number[];
}

// A test-only model of how a profile is read: the rules in order, the first that names the syscall and whose conditions hold decides,
// and the default action decides otherwise. A rule's conditions hold when the architecture is one of includes.arches (when listed),
// every capability of includes.caps is held, and none of excludes.caps is held. This models the file's own fields; it makes no claim about libseccomp's internals.
// A rule with argument conditions is never applied, only reported, so a decision never rests on an argument value this model cannot see.
// The container engine's loader may not read the rules strictly in order, so a separate test also requires that no rule other than
// the deciding one names the keyring syscalls: with a single rule naming them, the reading order cannot change the decision.
function decide(profile: SeccompProfile, syscall: string, context: Context): Decision {
  const argumentRules: number[] = [];
  for (const [index, rule] of profile.syscalls.entries()) {
    if (!rule.names.includes(syscall) || !conditionsHold(rule, context)) {
      continue;
    }
    if (rule.args !== null && rule.args.length > 0) {
      argumentRules.push(index);
      continue;
    }
    return { action: rule.action, errnoRet: rule.errnoRet, ruleIndex: index, argumentRules };
  }
  return { action: profile.defaultAction, errnoRet: profile.defaultErrnoRet, ruleIndex: null, argumentRules };
}

function conditionsHold(rule: SeccompRule, context: Context): boolean {
  const arches = rule.includes.arches;
  if (arches !== undefined && !arches.includes(context.arch)) {
    return false;
  }
  const required = rule.includes.caps;
  if (required !== undefined && !required.every((capability) => context.capabilities.has(capability))) {
    return false;
  }
  const forbidden = rule.excludes.caps;
  if (forbidden !== undefined && forbidden.some((capability) => context.capabilities.has(capability))) {
    return false;
  }
  return true;
}

function isUnconditional(rule: SeccompRule): boolean {
  return (
    (rule.args === null || rule.args.length === 0) &&
    Object.keys(rule.includes).length === 0 &&
    Object.keys(rule.excludes).length === 0
  );
}

function rulesNaming(syscall: string): readonly SeccompRule[] {
  return SECCOMP_PROFILE.syscalls.filter((rule) => rule.names.includes(syscall));
}

void test("phase 9.6: the default action is ERRNO with errno 38, so an unlisted syscall is refused", () => {
  assert.equal(SECCOMP_PROFILE.defaultAction, "SCMP_ACT_ERRNO");
  assert.equal(SECCOMP_PROFILE.defaultErrnoRet, 38);
  const unlisted = decide(SECCOMP_PROFILE, "no_such_syscall", SANDBOX_CONTEXT);
  assert.deepEqual(
    { action: unlisted.action, errnoRet: unlisted.errnoRet, ruleIndex: unlisted.ruleIndex },
    { action: "SCMP_ACT_ERRNO", errnoRet: 38, ruleIndex: null },
  );
});

void test("phase 9.6 (PRD-ENF-03): add_key, keyctl and request_key each decide ERRNO with errno 1 (EPERM), not the default ENOSYS", () => {
  for (const syscall of KEYRING_SYSCALLS) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ERRNO", syscall);
    assert.equal(decision.errnoRet, 1, syscall);
    assert.notEqual(decision.ruleIndex, null, `${syscall} is decided by an explicit rule, not by the default action`);
    assert.deepEqual(decision.argumentRules, [], syscall);
    assert.equal(SECCOMP_PROFILE.syscalls[decision.ruleIndex ?? -1]?.errno, "EPERM", syscall);
  }
});

void test("phase 9.6: the keyring denial is one unconditional rule, and no other rule names a keyring syscall under any context", () => {
  for (const syscall of KEYRING_SYSCALLS) {
    const rules = rulesNaming(syscall);
    assert.equal(rules.length, 1, `${syscall} is named by exactly one rule`);
    assert.ok(rules.every(isUnconditional), `${syscall} has no condition that could switch the denial off`);
  }
  const denial = rulesNaming("keyctl")[0];
  assert.ok(denial !== undefined);
  assert.deepEqual(denial.names, ["add_key", "keyctl", "request_key"]);
  assert.equal(denial.action, "SCMP_ACT_ERRNO");
  assert.equal(denial.errnoRet, 1);
  // It sits before every allow rule, so a reader that stops at the first rule naming the syscall also reaches the denial.
  const firstAllow = SECCOMP_PROFILE.syscalls.findIndex((rule) => rule.action === "SCMP_ACT_ALLOW");
  assert.ok(SECCOMP_PROFILE.syscalls.indexOf(denial) < firstAllow);
});

void test("phase 9.6: every syscall the sandbox runtime needs decides ALLOW, through one unconditional rule", () => {
  for (const syscall of REQUIRED_SYSCALLS) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ALLOW", syscall);
    assert.deepEqual(decision.argumentRules, [], `${syscall} does not depend on an argument value`);
    const rules = rulesNaming(syscall);
    assert.equal(rules.length, 1, `${syscall} is named by exactly one rule`);
    assert.ok(rules.every(isUnconditional), `${syscall} sits in an unconditional rule, so no architecture or capability condition applies`);
  }
});

void test("phase 9.6: rules other than the keyring one keep upstream's decisions for a sandbox without capabilities", () => {
  // process_vm_readv and pidfd_open stay allowed: the in-container runtime may need them (REQUIRED_SYSCALLS).
  const allowed = ["read", "write", "execve", "openat", "mmap", "futex", "socket", "arch_prctl", "process_vm_readv", "pidfd_open"];
  for (const syscall of allowed) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    // socket carries argument rules for AF_NETLINK audit sockets, and its capability-free rules are argument-conditioned.
    assert.ok(decision.action === "SCMP_ACT_ALLOW" || decision.argumentRules.length > 0, syscall);
  }
  const denied = ["kexec_load", "userfaultfd", "vmsplice", "bpf", "chroot", "init_module", "clock_settime", "open_by_handle_at", "perf_event_open"];
  for (const syscall of denied) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ERRNO", syscall);
    assert.equal(decision.errnoRet, 1, syscall);
  }
});

void test("phase 9.6: the profile is deeply frozen, so nothing can change it after load", () => {
  const rules = SECCOMP_PROFILE.syscalls;
  assert.ok(Object.isFrozen(SECCOMP_PROFILE));
  assert.ok(Object.isFrozen(rules));
  assert.ok(Object.isFrozen(SECCOMP_PROFILE.archMap));
  for (const rule of rules) {
    assert.ok(Object.isFrozen(rule));
    assert.ok(Object.isFrozen(rule.names));
    assert.ok(Object.isFrozen(rule.includes));
    assert.ok(Object.isFrozen(rule.excludes));
    if (rule.args !== null) {
      assert.ok(Object.isFrozen(rule.args));
      assert.ok(rule.args.every((argument) => Object.isFrozen(argument)));
    }
  }
  assert.throws(() => {
    (rules as SeccompRule[]).pop();
  }, TypeError);
  assert.throws(() => {
    (rules[1]?.names as string[]).push("ptrace");
  }, TypeError);
});

void test("phase 9.6: the text is the profile in upstream's formatting, and parses back to the same profile", () => {
  assert.deepEqual(JSON.parse(SECCOMP_PROFILE_TEXT) as unknown, JSON.parse(JSON.stringify(SECCOMP_PROFILE)) as unknown);
  assert.equal(SECCOMP_PROFILE_TEXT, JSON.stringify(SECCOMP_PROFILE, null, "\t"));
  assert.ok(SECCOMP_PROFILE_TEXT.startsWith('{\n\t"defaultAction": "SCMP_ACT_ERRNO",\n'));
  assert.ok(SECCOMP_PROFILE_TEXT.endsWith("\t]\n}"), "no trailing newline, as upstream");
});

void test("phase 9.6: the digest is the SHA-256 of the exact text, the prefix is its first 16 hex digits, and the file name carries it", () => {
  const digest = createHash("sha256").update(SECCOMP_PROFILE_TEXT, "utf8").digest("hex");
  assert.equal(SECCOMP_PROFILE_SHA256, digest);
  assert.equal(SECCOMP_PROFILE_DIGEST_PREFIX, digest.slice(0, 16));
  assert.equal(SECCOMP_PROFILE_FILE_NAME, `realm-seccomp-${digest.slice(0, 16)}.json`);
  assert.match(SECCOMP_PROFILE_FILE_NAME, /^realm-seccomp-[0-9a-f]{16}\.json$/);
});

// The vendored profile is a security control: a change to its content moves this digest and byte length, so it is a reviewed edit
// of both values together with the docs/integration/openshell.md transformation text, never an incidental one (phase 9.7, A10 F4).
const PINNED_PROFILE_SHA256 = "ed2525c01cd7377938a6027c64dda140c281a64b6937aaceac07fbb17b4885fa";
const PINNED_PROFILE_BYTES = 18615;

void test("phase 9.7: the vendored profile's content is pinned by digest and byte length", () => {
  assert.equal(SECCOMP_PROFILE_SHA256, PINNED_PROFILE_SHA256);
  assert.equal(Buffer.byteLength(SECCOMP_PROFILE_TEXT, "utf8"), PINNED_PROFILE_BYTES);
});

void test("phase 9.6: the profile is not the upstream file it was made from", () => {
  assert.notEqual(SECCOMP_UPSTREAM_SHA256, SECCOMP_PROFILE_SHA256);
  assert.match(SECCOMP_UPSTREAM_SHA256, /^[0-9a-f]{64}$/);
});

void test("phase 9.7: unshare and setns each decide ERRNO with errno 1 (EPERM) through one unconditional rule", () => {
  for (const syscall of NAMESPACE_SYSCALLS) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ERRNO", syscall);
    assert.equal(decision.errnoRet, 1, syscall);
    assert.notEqual(decision.ruleIndex, null, `${syscall} is decided by an explicit rule, not by the default action`);
    assert.deepEqual(decision.argumentRules, [], syscall);
    const rules = rulesNaming(syscall);
    assert.equal(rules.length, 1, `${syscall} is named by exactly one rule`);
    assert.ok(rules.every(isUnconditional), `${syscall} has no condition that could switch the denial off`);
    assert.equal(SECCOMP_PROFILE.syscalls[decision.ruleIndex ?? -1]?.errno, "EPERM", syscall);
  }
  assert.deepEqual(rulesNaming("unshare")[0]?.names, ["setns", "unshare"]);
});

void test("phase 9.7: the mount family decides ERRNO with errno 1 (EPERM) through one unconditional rule", () => {
  for (const syscall of MOUNT_SYSCALLS) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ERRNO", syscall);
    assert.equal(decision.errnoRet, 1, syscall);
    assert.notEqual(decision.ruleIndex, null, `${syscall} is decided by an explicit rule, not by the default action`);
    assert.deepEqual(decision.argumentRules, [], syscall);
    const rules = rulesNaming(syscall);
    assert.equal(rules.length, 1, `${syscall} is named by exactly one rule`);
    assert.ok(rules.every(isUnconditional), `${syscall} has no condition that could switch the denial off`);
    assert.equal(SECCOMP_PROFILE.syscalls[decision.ruleIndex ?? -1]?.errno, "EPERM", syscall);
  }
  assert.deepEqual([...(rulesNaming("mount")[0]?.names ?? [])].sort(), [...MOUNT_SYSCALLS].sort());
});

void test("phase 9.7: clone3 decides ERRNO with errno 38 (ENOSYS) through one explicit rule, so glibc falls back to clone", () => {
  const decision = decide(SECCOMP_PROFILE, "clone3", SANDBOX_CONTEXT);
  assert.equal(decision.action, "SCMP_ACT_ERRNO");
  assert.equal(decision.errnoRet, 38);
  assert.notEqual(decision.ruleIndex, null, "clone3 is decided by an explicit rule, not only by the default action");
  assert.deepEqual(decision.argumentRules, []);
  const rules = rulesNaming("clone3");
  assert.equal(rules.length, 1);
  assert.ok(rules.every(isUnconditional));
  assert.equal(rules[0]?.errno, "ENOSYS");
  assert.deepEqual(rules[0].names, ["clone3"]);
});

void test("phase 9.7: clone is allowed only through the masked-equality rule, so a clone with any namespace flag is refused", () => {
  const rules = rulesNaming("clone");
  assert.equal(rules.length, 1, "clone is named by exactly one rule");
  const rule = rules[0];
  assert.ok(rule !== undefined);
  assert.equal(rule.action, "SCMP_ACT_ALLOW");
  assert.ok(Object.keys(rule.includes).length === 0 && Object.keys(rule.excludes).length === 0);
  assert.deepEqual(rule.args, [{ index: 0, value: CLONE_NAMESPACE_MASK, valueTwo: 0, op: "SCMP_CMP_MASKED_EQ" }]);
  // The mask is exactly the seven namespace flags.
  assert.equal(
    CLONE_NAMESPACE_FLAGS.reduce((mask, flag) => mask | flag, 0),
    CLONE_NAMESPACE_MASK,
  );
  // The model cannot evaluate arguments, so it reports the clone rule as argument-conditioned and falls to the default action.
  const decision = decide(SECCOMP_PROFILE, "clone", SANDBOX_CONTEXT);
  assert.deepEqual(decision.argumentRules, [SECCOMP_PROFILE.syscalls.indexOf(rule)]);
  assert.equal(decision.action, SECCOMP_PROFILE.defaultAction);
  assert.equal(decision.errnoRet, 38, "a clone that matches no rule answers ENOSYS");
  // SCMP_CMP_MASKED_EQ allows the call when (argument & value) equals valueTwo.
  const argument = rule.args[0];
  assert.ok(argument !== undefined);
  const allowedByRule = (flags: number): boolean => (flags & argument.value) === argument.valueTwo;
  const SIGCHLD = 17;
  const CLONE_VM = 0x100;
  const CLONE_FS = 0x200;
  const CLONE_FILES = 0x400;
  const CLONE_SIGHAND = 0x800;
  const CLONE_THREAD = 0x10000;
  for (const flags of [0, SIGCHLD, CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD]) {
    assert.equal(allowedByRule(flags), true, `clone flags ${String(flags)} stay allowed`);
  }
  for (const flag of CLONE_NAMESPACE_FLAGS) {
    assert.equal(allowedByRule(SIGCHLD | flag), false, `clone flags with ${String(flag)} are refused`);
    assert.equal(allowedByRule(flag), false, `clone flag ${String(flag)} alone is refused`);
  }
});

void test("phase 9.7: ptrace, process_vm_writev and pidfd_getfd are denied with EPERM by a rule of their own; process_vm_readv and pidfd_open stay allowed", () => {
  for (const syscall of CROSS_PROCESS_DENIED) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ERRNO", syscall);
    assert.equal(decision.errnoRet, 1, syscall);
    assert.notEqual(decision.ruleIndex, null, syscall);
    assert.deepEqual(decision.argumentRules, [], syscall);
    const rules = rulesNaming(syscall);
    assert.equal(rules.length, 1, `${syscall} is named by exactly one rule`);
    assert.ok(rules.every(isUnconditional), syscall);
    assert.equal(rules[0]?.errno, "EPERM", syscall);
  }
  // Group 2 is its own rule, so it can be dropped alone: it names nothing from the namespace, mount, keyring or clone rules.
  const group = rulesNaming("ptrace")[0];
  assert.ok(group !== undefined);
  assert.deepEqual([...group.names].sort(), [...CROSS_PROCESS_DENIED].sort());
  for (const syscall of ["process_vm_readv", "pidfd_open", "clone"]) {
    assert.ok(!group.names.includes(syscall), syscall);
  }
  for (const syscall of ["process_vm_readv", "pidfd_open"]) {
    const decision = decide(SECCOMP_PROFILE, syscall, SANDBOX_CONTEXT);
    assert.equal(decision.action, "SCMP_ACT_ALLOW", syscall);
    assert.equal(rulesNaming(syscall).length, 1, syscall);
  }
});

void test("phase 9.7: every deny rule added for namespaces, mounts, clone3 and cross-process access precedes the first allow rule, and no syscall is named twice", () => {
  const rules = SECCOMP_PROFILE.syscalls;
  const firstAllow = rules.findIndex((rule) => rule.action === "SCMP_ACT_ALLOW");
  const added = [...NAMESPACE_SYSCALLS, ...MOUNT_SYSCALLS, "clone3", ...CROSS_PROCESS_DENIED];
  for (const syscall of added) {
    const rule = rulesNaming(syscall)[0];
    assert.ok(rule !== undefined, syscall);
    assert.ok(rules.indexOf(rule) < firstAllow, `${syscall} is denied before any allow rule`);
  }
  // Whatever the context, no syscall appears in two rules that the added rules name, so the order the engine reads them in is moot.
  for (const syscall of [...added, ...KEYRING_SYSCALLS]) {
    assert.equal(rulesNaming(syscall).length, 1, syscall);
  }
  const clone = rulesNaming("clone")[0];
  assert.ok(clone !== undefined && rules.indexOf(clone) > firstAllow);
});
