import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachSeccompEvidence,
  cloneRuleConfined,
  defaultErrnoIsEnosys,
  isolationSyscallsDenied,
  keyringSyscallsDenied,
  MAX_OCI_CONFIG_BYTES,
  readHostOciConfig,
  SECCOMP_EVIDENCE_FIELD,
} from "../../src/runtime/seccomp-evidence.js";
import {
  ALLOW_RULE,
  CONFORMING_OCI_CONFIG_TEXT,
  ISOLATION_DENY_RULES,
  KEYRING_DENY_RULE,
  MOUNT_DENY_RULE,
  NAMESPACE_DENY_RULE,
  CLONE3_DENY_RULE,
  CLONE_MASKED_RULE,
  conformingOciSpec,
  OCI_CONFIG_PATH,
  ociReaderOf,
  ociSpec,
  STATIC_DIR,
  UNSHARE_ALLOWED_OCI_CONFIG_TEXT,
} from "./seccomp-fixtures.js";

const deny = (names: readonly unknown[], errnoRet?: number): Record<string, unknown> =>
  errnoRet === undefined ? { names, action: "SCMP_ACT_ERRNO" } : { names, action: "SCMP_ACT_ERRNO", errnoRet };

void test("phase 9.6: the decision accepts the real shape of an API-created container's seccomp section", () => {
  assert.equal(keyringSyscallsDenied(ociSpec([ALLOW_RULE, KEYRING_DENY_RULE])), true);
  // Each syscall may be denied by a rule of its own.
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["keyctl"], 1), deny(["add_key"], 1), deny(["request_key"], 1)])), true);
});

void test("phase 9.6: the decision refuses keyctl in an ALLOW rule", () => {
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["add_key", "request_key"], 1), { names: ["keyctl"], action: "SCMP_ACT_ALLOW" }])), false);
});

void test("phase 9.6: the decision refuses keyctl denied with errnoRet 38 or with no errnoRet", () => {
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["add_key", "request_key"], 1), deny(["keyctl"], 38)])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["add_key", "request_key"], 1), deny(["keyctl"])])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["add_key", "keyctl", "request_key"])])), false);
});

void test("phase 9.6: the decision refuses a conflicting pair, whichever rule comes first", () => {
  const allow = { names: ["keyctl"], action: "SCMP_ACT_ALLOW" };
  assert.equal(keyringSyscallsDenied(ociSpec([KEYRING_DENY_RULE, allow])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([allow, KEYRING_DENY_RULE])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([KEYRING_DENY_RULE, deny(["keyctl"], 38)])), false);
});

void test("phase 9.6: the decision refuses a profile that does not list add_key or request_key", () => {
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["keyctl", "request_key"], 1)])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([deny(["keyctl", "add_key"], 1)])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([])), false);
});

void test("phase 9.6: the decision refuses a default action other than ERRNO, and a missing seccomp section", () => {
  const allowByDefault = ociSpec([KEYRING_DENY_RULE]);
  ((allowByDefault.linux as Record<string, unknown>).seccomp as Record<string, unknown>).defaultAction = "SCMP_ACT_ALLOW";
  assert.equal(keyringSyscallsDenied(allowByDefault), false);
  assert.equal(keyringSyscallsDenied({ ociVersion: "1.2.0", linux: {} }), false);
  assert.equal(keyringSyscallsDenied({ ociVersion: "1.2.0" }), false);
  for (const junk of [null, undefined, 42, "text", [], { linux: null }, { linux: { seccomp: [] } }]) {
    assert.equal(keyringSyscallsDenied(junk), false, JSON.stringify(junk));
  }
});

void test("phase 9.6: the decision ignores malformed rules for matching and never reads them as a deny", () => {
  const malformed: readonly unknown[] = [null, 7, "keyctl", { names: "keyctl", action: "SCMP_ACT_ERRNO", errnoRet: 1 }, { names: [1, null, {}], action: "SCMP_ACT_ALLOW" }];
  // A malformed rule does not supply a deny...
  assert.equal(keyringSyscallsDenied(ociSpec([...malformed, deny(["keyctl", "add_key"], 1)])), false);
  // ...and does not spoil a conforming profile.
  assert.equal(keyringSyscallsDenied(ociSpec([...malformed, KEYRING_DENY_RULE])), true);
  // A syscall list that is not an array is no deny at all.
  const noList = ociSpec([]);
  ((noList.linux as Record<string, unknown>).seccomp as Record<string, unknown>).syscalls = { names: ["keyctl"] };
  assert.equal(keyringSyscallsDenied(noList), false);
});

void test("phase 9.6: attachSeccompEvidence attaches the verdict of a good config, read from the path under StaticDir", () => {
  const paths: string[] = [];
  const attached = attachSeccompEvidence({ StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH, Id: "c1" }, (path) => {
    paths.push(path);
    return CONFORMING_OCI_CONFIG_TEXT;
  });
  assert.deepEqual(paths, [OCI_CONFIG_PATH]);
  assert.equal(attached[SECCOMP_EVIDENCE_FIELD], true);
  assert.equal(attached.Id, "c1");
  const refused = attachSeccompEvidence({ StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH }, () => JSON.stringify(ociSpec([])));
  assert.equal(refused[SECCOMP_EVIDENCE_FIELD], false);
});

void test("phase 9.6: attachSeccompEvidence does not change the inspect it was given", () => {
  const inspect = Object.freeze({ StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH });
  attachSeccompEvidence(inspect, ociReaderOf(CONFORMING_OCI_CONFIG_TEXT));
  assert.equal(Object.hasOwn(inspect, SECCOMP_EVIDENCE_FIELD), false);
});

void test("phase 9.6: attachSeccompEvidence attaches nothing for an absent, relative, or mistyped OCIConfigPath, and never reads", () => {
  const reads: string[] = [];
  const reader = (path: string): string => {
    reads.push(path);
    return CONFORMING_OCI_CONFIG_TEXT;
  };
  const cases: readonly Record<string, unknown>[] = [
    { StaticDir: STATIC_DIR },
    { StaticDir: STATIC_DIR, OCIConfigPath: "userdata/config.json" },
    { StaticDir: STATIC_DIR, OCIConfigPath: "config.json" },
    { StaticDir: STATIC_DIR, OCIConfigPath: 42 },
    { StaticDir: STATIC_DIR, OCIConfigPath: null },
    { OCIConfigPath: OCI_CONFIG_PATH },
    { StaticDir: "realm/containers/c1/userdata", OCIConfigPath: "realm/containers/c1/userdata/config.json" },
    { StaticDir: 7, OCIConfigPath: OCI_CONFIG_PATH },
  ];
  for (const inspect of cases) {
    assert.equal(Object.hasOwn(attachSeccompEvidence(inspect, reader), SECCOMP_EVIDENCE_FIELD), false, JSON.stringify(inspect));
  }
  assert.deepEqual(reads, []);
});

void test("phase 9.6: attachSeccompEvidence attaches nothing for a path outside StaticDir, whatever the file holds", () => {
  const reads: string[] = [];
  const reader = (path: string): string => {
    reads.push(path);
    return CONFORMING_OCI_CONFIG_TEXT;
  };
  const cases: readonly string[] = [
    "/attacker/config.json",
    `${STATIC_DIR}/other.json`,
    `${STATIC_DIR}/sub/config.json`,
    `${STATIC_DIR}/../config.json`,
    `${STATIC_DIR}/../c2/userdata/config.json`,
    `${STATIC_DIR}config.json`,
    `${STATIC_DIR}\0/config.json`,
  ];
  for (const path of cases) {
    const inspect = { StaticDir: STATIC_DIR, OCIConfigPath: path };
    assert.equal(Object.hasOwn(attachSeccompEvidence(inspect, reader), SECCOMP_EVIDENCE_FIELD), false, JSON.stringify(path));
  }
  // A StaticDir that climbs out of its tree does not tie the path to anything.
  const climbing = { StaticDir: "/realm/containers/c1/../../attacker", OCIConfigPath: "/realm/containers/attacker/config.json" };
  assert.equal(Object.hasOwn(attachSeccompEvidence(climbing, reader), SECCOMP_EVIDENCE_FIELD), false);
  assert.deepEqual(reads, []);
});

void test("phase 9.6: attachSeccompEvidence attaches nothing for an unreadable, oversize, or unparseable file, and does not throw", () => {
  const inspect = { StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH };
  const readers: readonly (() => string)[] = [
    () => {
      throw new Error("EACCES");
    },
    () => `${CONFORMING_OCI_CONFIG_TEXT}${" ".repeat(MAX_OCI_CONFIG_BYTES)}`,
    () => "{ not json",
    () => "",
    () => "null",
  ];
  for (const [index, reader] of readers.entries()) {
    const attached = attachSeccompEvidence(inspect, reader);
    // "null" parses; it carries no seccomp section, so it is attached as a refusal rather than a pass.
    assert.notEqual(attached[SECCOMP_EVIDENCE_FIELD], true, String(index));
  }
  for (const reader of readers.slice(0, 4)) {
    assert.equal(Object.hasOwn(attachSeccompEvidence(inspect, reader), SECCOMP_EVIDENCE_FIELD), false);
  }
});

void test("phase 9.6: attachSeccompEvidence drops a forged inbound field, and attaches nothing when the read fails", () => {
  const forged = { StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH, [SECCOMP_EVIDENCE_FIELD]: true };
  const unreadable = attachSeccompEvidence(forged, () => {
    throw new Error("EACCES");
  });
  assert.equal(Object.hasOwn(unreadable, SECCOMP_EVIDENCE_FIELD), false);
  const outside = attachSeccompEvidence({ ...forged, OCIConfigPath: "/attacker/config.json" }, ociReaderOf(CONFORMING_OCI_CONFIG_TEXT));
  assert.equal(Object.hasOwn(outside, SECCOMP_EVIDENCE_FIELD), false);
  const denied = attachSeccompEvidence(forged, () => JSON.stringify(ociSpec([])));
  assert.equal(denied[SECCOMP_EVIDENCE_FIELD], false, "the host read decides, not the forged value");
});

void test("phase 9.6: the host reader returns a file within the bound and throws on a larger one", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "realm-oci-config-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const small = join(dir, "small.json");
  writeFileSync(small, CONFORMING_OCI_CONFIG_TEXT);
  assert.equal(readHostOciConfig(small), CONFORMING_OCI_CONFIG_TEXT);
  const exact = join(dir, "exact.json");
  writeFileSync(exact, "x".repeat(MAX_OCI_CONFIG_BYTES));
  assert.equal(readHostOciConfig(exact).length, MAX_OCI_CONFIG_BYTES);
  const large = join(dir, "large.json");
  writeFileSync(large, "x".repeat(MAX_OCI_CONFIG_BYTES + 1));
  assert.throws(() => readHostOciConfig(large));
  assert.throws(() => readHostOciConfig(join(dir, "missing.json")));
});

const MOUNT_FAMILY = ["mount", "umount", "umount2", "mount_setattr", "move_mount", "open_tree", "pivot_root", "fsconfig", "fsmount", "fsopen", "fspick"];

void test("phase 9.7: the isolation decision accepts unshare, setns and the mount family denied with EPERM and clone3 denied with ENOSYS", () => {
  assert.equal(isolationSyscallsDenied(ociSpec([ALLOW_RULE, KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES])), true);
  assert.deepEqual([...MOUNT_DENY_RULE.names].sort(), [...MOUNT_FAMILY].sort());
  // Each syscall may be denied by a rule of its own.
  const single = [...MOUNT_FAMILY, "unshare", "setns"].map((name) => deny([name], 1));
  assert.equal(isolationSyscallsDenied(ociSpec([...single, deny(["clone3"], 38)])), true);
});

void test("phase 9.7: the isolation decision refuses a profile that leaves out unshare and setns, the mount family, or clone3", () => {
  assert.equal(isolationSyscallsDenied(ociSpec([MOUNT_DENY_RULE, CLONE3_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, CLONE3_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, MOUNT_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([])), false);
  for (const missing of MOUNT_FAMILY) {
    const partial = { ...MOUNT_DENY_RULE, names: MOUNT_DENY_RULE.names.filter((name) => name !== missing) };
    assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, partial, CLONE3_DENY_RULE])), false, missing);
  }
});

void test("phase 9.7: the isolation decision refuses an allow, a wrong errno, a missing errno, and a conflicting pair", () => {
  const base = [NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, CLONE3_DENY_RULE];
  for (const syscall of ["unshare", "setns", "mount", "pivot_root", "clone3"]) {
    const allow = { names: [syscall], action: "SCMP_ACT_ALLOW" };
    assert.equal(isolationSyscallsDenied(ociSpec([...base, allow])), false, `${syscall} allowed after the deny`);
    assert.equal(isolationSyscallsDenied(ociSpec([allow, ...base])), false, `${syscall} allowed before the deny`);
  }
  // clone3 must answer ENOSYS: EPERM or no errno is refused, and ENOSYS is the only accepted value.
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, deny(["clone3"], 1)])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, deny(["clone3"])])), false);
  // unshare, setns and the mount family must answer EPERM: ENOSYS or no errno is refused.
  assert.equal(isolationSyscallsDenied(ociSpec([deny(["setns", "unshare"], 38), MOUNT_DENY_RULE, CLONE3_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([deny(["setns", "unshare"]), MOUNT_DENY_RULE, CLONE3_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, deny(MOUNT_FAMILY, 38), CLONE3_DENY_RULE])), false);
});

void test("phase 9.7: the isolation decision refuses a default action other than ERRNO, a missing seccomp section, and junk", () => {
  const allowByDefault = ociSpec([NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, CLONE3_DENY_RULE]);
  ((allowByDefault.linux as Record<string, unknown>).seccomp as Record<string, unknown>).defaultAction = "SCMP_ACT_ALLOW";
  assert.equal(isolationSyscallsDenied(allowByDefault), false);
  for (const junk of [null, undefined, 42, "text", [], { linux: null }, { linux: {} }, { linux: { seccomp: [] } }]) {
    assert.equal(isolationSyscallsDenied(junk), false, JSON.stringify(junk));
  }
  const noList = ociSpec([]);
  ((noList.linux as Record<string, unknown>).seccomp as Record<string, unknown>).syscalls = { names: ["unshare"] };
  assert.equal(isolationSyscallsDenied(noList), false);
});

void test("phase 9.7: attachSeccompEvidence attaches true only when the keyring and the isolation denials both hold", () => {
  const inspect = { StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH };
  const verdictOf = (spec: Record<string, unknown>): unknown => attachSeccompEvidence(inspect, ociReaderOf(JSON.stringify(spec)))[SECCOMP_EVIDENCE_FIELD];
  assert.equal(verdictOf(ociSpec([ALLOW_RULE, KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES])), true);
  // The keyring denial alone is no longer enough.
  assert.equal(verdictOf(ociSpec([ALLOW_RULE, KEYRING_DENY_RULE])), false);
  // The isolation denials alone are not enough either.
  assert.equal(verdictOf(ociSpec([ALLOW_RULE, ...ISOLATION_DENY_RULES])), false);
  assert.equal(attachSeccompEvidence(inspect, ociReaderOf(UNSHARE_ALLOWED_OCI_CONFIG_TEXT))[SECCOMP_EVIDENCE_FIELD], false);
  assert.equal(attachSeccompEvidence(inspect, ociReaderOf(CONFORMING_OCI_CONFIG_TEXT))[SECCOMP_EVIDENCE_FIELD], true);
});

const INSPECT = { StaticDir: STATIC_DIR, OCIConfigPath: OCI_CONFIG_PATH };
const verdictOfSpec = (spec: Record<string, unknown>): unknown => attachSeccompEvidence(INSPECT, ociReaderOf(JSON.stringify(spec)))[SECCOMP_EVIDENCE_FIELD];
const withoutClone = [ALLOW_RULE, KEYRING_DENY_RULE, NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, CLONE3_DENY_RULE];
const maskedWith = (change: Record<string, unknown>): Record<string, unknown> => ({
  ...CLONE_MASKED_RULE,
  args: [{ ...CLONE_MASKED_RULE.args[0], ...change }],
});

void test("phase 9.7 correction: a deny rule gated by an argument condition is not a denial", () => {
  const gate = [{ index: 0, value: 1, valueTwo: 0, op: "SCMP_CMP_EQ" }];
  assert.equal(keyringSyscallsDenied(ociSpec([{ ...KEYRING_DENY_RULE, args: gate }])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([{ ...NAMESPACE_DENY_RULE, args: gate }, MOUNT_DENY_RULE, CLONE3_DENY_RULE])), false);
  assert.equal(isolationSyscallsDenied(ociSpec([NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, { ...CLONE3_DENY_RULE, args: gate }])), false);
  // A gated rule beside an unconditional one still conflicts, and an empty args list is no condition.
  assert.equal(keyringSyscallsDenied(ociSpec([KEYRING_DENY_RULE, { ...KEYRING_DENY_RULE, args: gate }])), false);
  assert.equal(keyringSyscallsDenied(ociSpec([{ ...KEYRING_DENY_RULE, args: [] }])), true);
  assert.equal(verdictOfSpec(ociSpec([ALLOW_RULE, { ...KEYRING_DENY_RULE, args: gate }, ...ISOLATION_DENY_RULES])), false);
});

void test("phase 9.7 correction: the clone rule must be the masked equality on argument 0 and nothing else", () => {
  assert.equal(cloneRuleConfined(ociSpec([CLONE_MASKED_RULE])), true);
  assert.equal(verdictOfSpec(ociSpec([...withoutClone, CLONE_MASKED_RULE])), true);
  // The OCI runtime spec omits a zero valueTwo from its JSON: an absent valueTwo is the same condition.
  const flagsArg = CLONE_MASKED_RULE.args[0];
  assert.notEqual(flagsArg, undefined);
  const noValueTwo = { index: flagsArg?.index, value: flagsArg?.value, op: flagsArg?.op };
  assert.equal(verdictOfSpec(ociSpec([...withoutClone, { ...CLONE_MASKED_RULE, args: [noValueTwo] }])), true);
  const refused: readonly (readonly [string, unknown])[] = [
    ["unconditional allow", { names: ["clone"], action: "SCMP_ACT_ALLOW" }],
    ["unconditional allow with empty args", { names: ["clone"], action: "SCMP_ACT_ALLOW", args: [] }],
    ["wrong mask", maskedWith({ value: 2114060288 - 0x10000000 })],
    ["wrong index", maskedWith({ index: 1 })],
    ["wrong valueTwo", maskedWith({ valueTwo: 1 })],
    ["wrong op", maskedWith({ op: "SCMP_CMP_EQ" })],
    ["two arguments", { ...CLONE_MASKED_RULE, args: [...CLONE_MASKED_RULE.args, ...CLONE_MASKED_RULE.args] }],
    ["denied clone", { names: ["clone"], action: "SCMP_ACT_ERRNO", errnoRet: 38 }],
  ];
  for (const [label, rule] of refused) {
    assert.equal(cloneRuleConfined(ociSpec([rule])), false, label);
    assert.equal(verdictOfSpec(ociSpec([...withoutClone, rule])), false, label);
  }
});

void test("phase 9.7 correction: a missing clone rule, or an unconditional allow beside the masked one, fails the verdict", () => {
  assert.equal(cloneRuleConfined(ociSpec([])), false);
  assert.equal(verdictOfSpec(ociSpec(withoutClone)), false);
  const open = { names: ["clone", "read"], action: "SCMP_ACT_ALLOW" };
  assert.equal(verdictOfSpec(ociSpec([...withoutClone, CLONE_MASKED_RULE, open])), false);
  assert.equal(verdictOfSpec(ociSpec([...withoutClone, open, CLONE_MASKED_RULE])), false);
  const allowByDefault = ociSpec([CLONE_MASKED_RULE]);
  ((allowByDefault.linux as Record<string, unknown>).seccomp as Record<string, unknown>).defaultAction = "SCMP_ACT_ALLOW";
  assert.equal(cloneRuleConfined(allowByDefault), false);
  for (const junk of [null, undefined, 42, "text", [], { linux: null }, { linux: {} }]) {
    assert.equal(cloneRuleConfined(junk), false, JSON.stringify(junk));
  }
});

void test("phase 9.7 correction: the applied defaultErrnoRet must be 38", () => {
  const specWith = (change: (seccomp: Record<string, unknown>) => void): Record<string, unknown> => {
    const spec = conformingOciSpec();
    change((spec.linux as Record<string, unknown>).seccomp as Record<string, unknown>);
    return spec;
  };
  assert.equal(defaultErrnoIsEnosys(conformingOciSpec()), true);
  assert.equal(verdictOfSpec(conformingOciSpec()), true);
  const absent = specWith((seccomp) => {
    delete seccomp.defaultErrnoRet;
  });
  assert.equal(defaultErrnoIsEnosys(absent), false);
  assert.equal(verdictOfSpec(absent), false);
  for (const other of [1, 0, 95, "38"]) {
    const spec = specWith((seccomp) => {
      seccomp.defaultErrnoRet = other;
    });
    assert.equal(defaultErrnoIsEnosys(spec), false, String(other));
    assert.equal(verdictOfSpec(spec), false, String(other));
  }
  for (const junk of [null, undefined, 42, { linux: {} }]) {
    assert.equal(defaultErrnoIsEnosys(junk), false, JSON.stringify(junk));
  }
});
