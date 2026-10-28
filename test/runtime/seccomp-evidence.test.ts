import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachSeccompEvidence,
  keyringSyscallsDenied,
  MAX_OCI_CONFIG_BYTES,
  readHostOciConfig,
  SECCOMP_EVIDENCE_FIELD,
} from "../../src/runtime/seccomp-evidence.js";
import {
  ALLOW_RULE,
  CONFORMING_OCI_CONFIG_TEXT,
  KEYRING_DENY_RULE,
  OCI_CONFIG_PATH,
  ociReaderOf,
  ociSpec,
  STATIC_DIR,
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
