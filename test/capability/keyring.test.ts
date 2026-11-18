import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import {
  ensureKeyring,
  keyringIdentity,
  keyringPathOf,
  readKeyring,
  rotateKeyring,
  type KeyringOptions,
  type KeyringSnapshot,
} from "../../src/capability/keyring.js";
import { mintToken, verifyToken } from "../../src/capability/token.js";
import { RealmError } from "../../src/core/errors.js";

// CAPT-03: the keyring at rest, rotation and revocation. Real files in a temporary directory, an injected clock
// and an injected uid; no root needed.

const UID = process.getuid?.() ?? 0;
const GRACE = 86400 + 60;

function withState(run: (stateDir: string) => void): void {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-keyring-")));
  try {
    run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function clockAt(start: number): { options: KeyringOptions; set: (seconds: number) => void } {
  let now = start;
  return {
    options: { now: () => now },
    set: (seconds) => {
      now = seconds;
    },
  };
}

function isDenied(error: unknown): boolean {
  return error instanceof RealmError && error.code === "POLICY_DENIED" && !("causeCode" in error);
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("the call did not throw");
}

// Writes a keyring file by hand with the given directory and file modes.
function plant(stateDir: string, content: string, modes: { dir?: number; file?: number } = {}): string {
  const dir = join(stateDir, "capability");
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, modes.dir ?? 0o700);
  const file = join(dir, "keys.json");
  writeFileSync(file, content);
  chmodSync(file, modes.file ?? 0o600);
  return file;
}

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const KEY_TEXTS = [K1, K2].flatMap((key) => [key.toString("base64url"), key.toString("base64"), key.toString("hex")]);

function ring(over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    version: 1,
    active: "k1",
    keys: [{ kid: "k1", key: K1.toString("base64url"), createdAt: 1000 }],
    ...over,
  });
}

function entry(kid: string, key: Buffer, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { kid, key: key.toString("base64url"), createdAt: 1000, ...extra };
}

function assertNoKeyText(value: unknown, label: string): void {
  const text = [
    typeof value === "string" ? value : "",
    value instanceof Error ? (value.stack ?? "") : "",
    inspect(value, { depth: null, showHidden: true }),
    JSON.stringify(value) as string | undefined,
  ].join("\n");
  for (const key of KEY_TEXTS) {
    assert.equal(text.includes(key), false, `${label} contains key text`);
  }
}

function keysIn(stateDir: string): { kid: string; retiredAt?: number }[] {
  const parsed = JSON.parse(readFileSync(keyringPathOf(stateDir), "utf8")) as { keys: { kid: string; retiredAt?: number }[] };
  return parsed.keys;
}

void test("ensureKeyring creates a 0700 directory and a 0600 file with one active key k1", () => {
  withState((stateDir) => {
    const clock = clockAt(1000);
    const snapshot = ensureKeyring(stateDir, clock.options);
    assert.equal(snapshot.active, "k1");
    assert.deepEqual(snapshot.retired, []);
    assert.equal(snapshot.lookup("k1")?.length, 32);
    assert.equal(statSync(join(stateDir, "capability")).mode & 0o777, 0o700);
    assert.equal(statSync(keyringPathOf(stateDir)).mode & 0o777, 0o600);
    assert.equal(statSync(keyringPathOf(stateDir)).uid, UID);
    assert.deepEqual(keysIn(stateDir), [{ kid: "k1", key: Buffer.from(snapshot.lookup("k1") ?? new Uint8Array()).toString("base64url"), createdAt: 1000 }]);
    assert.deepEqual(readdirSync(join(stateDir, "capability")), ["keys.json"], "no temp file is left behind");
  });
});

void test("ensureKeyring returns an existing valid file untouched", () => {
  withState((stateDir) => {
    const file = plant(stateDir, ring());
    const before = readFileSync(file, "utf8");
    const mtime = statSync(file).mtimeMs;
    const snapshot = ensureKeyring(stateDir);
    assert.equal(snapshot.active, "k1");
    assert.deepEqual(snapshot.lookup("k1"), K1);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(statSync(file).mtimeMs, mtime);
  });
});

void test("ensureKeyring creates the file when the directory already exists with the right mode", () => {
  withState((stateDir) => {
    mkdirSync(join(stateDir, "capability"), { mode: 0o700 });
    chmodSync(join(stateDir, "capability"), 0o700);
    assert.equal(ensureKeyring(stateDir).active, "k1");
  });
});

void test("an absent directory and an absent file read as absent, not as an error", () => {
  withState((stateDir) => {
    assert.deepEqual(readKeyring(stateDir), { present: false });
    mkdirSync(join(stateDir, "capability"), { mode: 0o700 });
    chmodSync(join(stateDir, "capability"), 0o700);
    assert.deepEqual(readKeyring(stateDir), { present: false });
    assert.equal(keyringIdentity(stateDir), null);
  });
});

void test("two creators racing leave one key and both read the same file", () => {
  withState((stateDir) => {
    let raced = false;
    // The seam runs the other creator to completion in the window between this creator's check and its link.
    const racing: KeyringOptions = {
      randomBytes: (size) => {
        if (!raced) {
          raced = true;
          ensureKeyring(stateDir);
        }
        return randomBytes(size);
      },
    };
    const first = ensureKeyring(stateDir, racing);
    const second = ensureKeyring(stateDir);
    assert.equal(raced, true);
    assert.deepEqual(first.lookup("k1"), second.lookup("k1"));
    assert.deepEqual(
      keysIn(stateDir).map((key) => key.kid),
      ["k1"],
    );
    assert.deepEqual(readdirSync(join(stateDir, "capability")), ["keys.json"]);
  });
});

const GUARD_ROWS: readonly { name: string; run: (stateDir: string) => void }[] = [
  { name: "file mode 0644", run: (dir) => plant(dir, ring(), { file: 0o644 }) },
  { name: "file mode 0400", run: (dir) => plant(dir, ring(), { file: 0o400 }) },
  { name: "file mode 0660", run: (dir) => plant(dir, ring(), { file: 0o660 }) },
  { name: "directory mode 0755", run: (dir) => plant(dir, ring(), { dir: 0o755 }) },
  { name: "directory mode 0770", run: (dir) => plant(dir, ring(), { dir: 0o770 }) },
  {
    name: "a symlink at the file",
    run: (dir) => {
      const target = join(dir, "elsewhere.json");
      writeFileSync(target, ring(), { mode: 0o600 });
      mkdirSync(join(dir, "capability"), { mode: 0o700 });
      chmodSync(join(dir, "capability"), 0o700);
      symlinkSync(target, join(dir, "capability", "keys.json"));
    },
  },
  {
    name: "a symlink at the directory",
    run: (dir) => {
      const real = join(dir, "real");
      mkdirSync(real, { mode: 0o700 });
      chmodSync(real, 0o700);
      writeFileSync(join(real, "keys.json"), ring(), { mode: 0o600 });
      symlinkSync(real, join(dir, "capability"));
    },
  },
  {
    name: "a directory where the file belongs",
    run: (dir) => {
      mkdirSync(join(dir, "capability", "keys.json"), { recursive: true, mode: 0o600 });
      chmodSync(join(dir, "capability"), 0o700);
      chmodSync(join(dir, "capability", "keys.json"), 0o600);
    },
  },
  { name: "a file over 64 KiB", run: (dir) => plant(dir, `${ring()}${" ".repeat(64 * 1024)}`) },
  { name: "empty file", run: (dir) => plant(dir, "") },
  { name: "malformed JSON", run: (dir) => plant(dir, `{"version":1,"active":"k1","keys":[{"kid":"k1","key":"${K1.toString("base64url")}"`) },
  { name: "a JSON array", run: (dir) => plant(dir, "[]") },
  { name: "null", run: (dir) => plant(dir, "null") },
  { name: "wrong version", run: (dir) => plant(dir, ring({ version: 2 })) },
  { name: "version as a string", run: (dir) => plant(dir, ring({ version: "1" })) },
  { name: "missing active kid", run: (dir) => plant(dir, ring({ active: undefined })) },
  { name: "unknown active kid", run: (dir) => plant(dir, ring({ active: "k2" })) },
  { name: "no keys", run: (dir) => plant(dir, ring({ keys: [] })) },
  { name: "keys not an array", run: (dir) => plant(dir, ring({ keys: {} })) },
  { name: "an extra top-level key", run: (dir) => plant(dir, ring({ extra: 1 })) },
  { name: "key of 31 bytes", run: (dir) => plant(dir, ring({ keys: [entry("k1", randomBytes(31))] })) },
  { name: "key of 33 bytes", run: (dir) => plant(dir, ring({ keys: [entry("k1", randomBytes(33))] })) },
  { name: "key text outside base64url", run: (dir) => plant(dir, ring({ keys: [{ kid: "k1", key: "+".repeat(43), createdAt: 1000 }] })) },
  { name: "key that is not a string", run: (dir) => plant(dir, ring({ keys: [{ kid: "k1", key: 5, createdAt: 1000 }] })) },
  { name: "duplicate kid", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1), entry("k1", K2, { retiredAt: 2000 })] })) },
  { name: "kid with an uppercase letter", run: (dir) => plant(dir, ring({ active: "K1", keys: [entry("K1", K1)] })) },
  { name: "kid of 17 characters", run: (dir) => plant(dir, ring({ active: "a".repeat(17), keys: [entry("a".repeat(17), K1)] })) },
  { name: "empty kid", run: (dir) => plant(dir, ring({ active: "", keys: [entry("", K1)] })) },
  { name: "a retired key with no retiredAt", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1), entry("k2", K2)] })) },
  { name: "the active key with a retiredAt", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1, { retiredAt: 2000 })] })) },
  { name: "an extra key in an entry", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1, { extra: 1 })] })) },
  { name: "createdAt as a string", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1, { createdAt: "1000" })] })) },
  { name: "negative createdAt", run: (dir) => plant(dir, ring({ keys: [entry("k1", K1, { createdAt: -1 })] })) },
  { name: "an entry that is not an object", run: (dir) => plant(dir, ring({ keys: ["k1"] })) },
];

for (const row of GUARD_ROWS) {
  void test(`guard: ${row.name} refuses with POLICY_DENIED and no key text, on read and on rotate`, () => {
    withState((stateDir) => {
      row.run(stateDir);
      const onRead = thrown(() => readKeyring(stateDir));
      assert.ok(isDenied(onRead), "read");
      assertNoKeyText(onRead, "read error");
      const onEnsure = thrown(() => ensureKeyring(stateDir));
      assert.ok(isDenied(onEnsure), "ensure");
      assertNoKeyText(onEnsure, "ensure error");
      const onRotate = thrown(() => rotateKeyring(stateDir, { revokePrevious: false }));
      assert.ok(isDenied(onRotate), "rotate");
      assertNoKeyText(onRotate, "rotate error");
    });
  });
}

void test("guard: a file or directory owned by another user refuses", () => {
  withState((stateDir) => {
    plant(stateDir, ring());
    assert.ok(isDenied(thrown(() => readKeyring(stateDir, { uid: UID + 1 }))));
    assert.ok(isDenied(thrown(() => ensureKeyring(stateDir, { uid: UID + 1 }))));
    assert.ok(isDenied(thrown(() => rotateKeyring(stateDir, { revokePrevious: false }, { uid: UID + 1 }))));
    assert.equal(readKeyring(stateDir, { uid: UID }).present, true);
  });
});

void test("guard: a state directory entry that is not a directory refuses", () => {
  withState((stateDir) => {
    writeFileSync(join(stateDir, "capability"), "x");
    assert.ok(isDenied(thrown(() => readKeyring(stateDir))));
  });
});

void test("a refused rotation leaves the file byte-identical", () => {
  withState((stateDir) => {
    const file = plant(stateDir, ring(), { file: 0o644 });
    const before = readFileSync(file, "utf8");
    assert.ok(isDenied(thrown(() => rotateKeyring(stateDir, { revokePrevious: false }))));
    assert.equal(readFileSync(file, "utf8"), before);
  });
});

void test("no thrown error, toString, JSON or inspect output of a snapshot or a result carries key text", () => {
  withState((stateDir) => {
    plant(stateDir, ring({ keys: [entry("k1", K1, { retiredAt: 5000 }), entry("k2", K2)], active: "k2" }));
    const read = readKeyring(stateDir);
    assert.ok(read.present);
    const snapshot: KeyringSnapshot = read.snapshot;
    // Positive control: the lookup does return the key, so the checks below are not vacuous.
    assert.deepEqual(snapshot.lookup("k2"), K2);
    assertNoKeyText(snapshot, "snapshot");
    assertNoKeyText(Object.prototype.toString.call(snapshot), "snapshot string");
    assertNoKeyText(read, "read result");
    assertNoKeyText(snapshot.lookup, "lookup function");
    assertNoKeyText(snapshot.retired, "retired list");
    const rotation = rotateKeyring(stateDir, { revokePrevious: false });
    assertNoKeyText(rotation, "rotation result");
    assertNoKeyText(ensureKeyring(stateDir), "ensured snapshot");
  });
});

void test("lookup: a valid ring serves its active key; unknown kids are undefined", () => {
  withState((stateDir) => {
    plant(stateDir, ring());
    const read = readKeyring(stateDir);
    assert.ok(read.present);
    assert.deepEqual(read.snapshot.lookup("k1"), K1);
    assert.equal(read.snapshot.lookup("k2"), undefined);
    assert.equal(read.snapshot.lookup("toString"), undefined);
    assert.equal(read.snapshot.lookup(""), undefined);
  });
});

void test("lookup: a retired key verifies until retiredAt plus 86400 plus 60 seconds, to the second", () => {
  withState((stateDir) => {
    plant(stateDir, ring({ active: "k2", keys: [entry("k1", K1, { retiredAt: 5000 }), entry("k2", K2)] }));
    const clock = clockAt(5000);
    const read = readKeyring(stateDir, clock.options);
    assert.ok(read.present);
    clock.set(5000 + GRACE - 1);
    assert.deepEqual(read.snapshot.lookup("k1"), K1);
    clock.set(5000 + GRACE);
    assert.equal(read.snapshot.lookup("k1"), undefined);
    clock.set(5000 + GRACE + 1);
    assert.equal(read.snapshot.lookup("k1"), undefined);
    assert.deepEqual(read.snapshot.lookup("k2"), K2, "the active key never expires");
    assert.deepEqual(read.snapshot.retired, [{ kid: "k1", retiredAt: 5000, pastGrace: false }], "pastGrace is fixed at read time");
    const later = readKeyring(stateDir, clock.options);
    assert.ok(later.present);
    assert.deepEqual(later.snapshot.retired, [{ kid: "k1", retiredAt: 5000, pastGrace: true }]);
  });
});

void test("rotateKeyring appends k2 as active and keeps k1 verifying for the grace window and not after", () => {
  withState((stateDir) => {
    const clock = clockAt(1000);
    const first = ensureKeyring(stateDir, clock.options);
    const oldKey = Buffer.from(first.lookup("k1") ?? Buffer.alloc(0));
    clock.set(2000);
    const result = rotateKeyring(stateDir, { revokePrevious: false }, clock.options);
    assert.deepEqual(result, { active: "k2", retired: ["k1"], revoked: [] });
    assert.equal(statSync(keyringPathOf(stateDir)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(stateDir, "capability")), ["keys.json"]);
    assert.deepEqual(keysIn(stateDir).map((key) => [key.kid, key.retiredAt]), [["k1", 2000], ["k2", undefined]]);
    const read = readKeyring(stateDir, clock.options);
    assert.ok(read.present);
    assert.equal(read.snapshot.active, "k2");
    assert.notDeepEqual(read.snapshot.lookup("k2"), oldKey);
    assert.deepEqual(read.snapshot.lookup("k1"), oldKey, "the old key is unchanged");
    clock.set(2000 + GRACE - 1);
    assert.deepEqual(read.snapshot.lookup("k1"), oldKey);
    clock.set(2000 + GRACE);
    assert.equal(read.snapshot.lookup("k1"), undefined);
    assert.equal(read.snapshot.lookup("k2")?.length, 32);
  });
});

void test("a token signed under k1 still verifies after a planned rotation and fails unknown-kid after a revoke", () => {
  withState((stateDir) => {
    const clock = clockAt(10_000);
    const first = ensureKeyring(stateDir, clock.options);
    const oldKey = first.lookup("k1");
    assert.ok(oldKey !== undefined);
    const claims = { kid: "k1", sid: "s1", host: "cursor", caps: ["fs.read"], iat: 10_000, exp: 13_600 } as const;
    const token = mintToken(oldKey, claims);
    rotateKeyring(stateDir, { revokePrevious: false }, clock.options);
    const afterPlanned = readKeyring(stateDir, clock.options);
    assert.ok(afterPlanned.present);
    assert.equal(verifyToken(token, afterPlanned.snapshot.lookup, "s1", "fs.read", 10_001).ok, true);
    rotateKeyring(stateDir, { revokePrevious: true }, clock.options);
    const afterRevoke = readKeyring(stateDir, clock.options);
    assert.ok(afterRevoke.present);
    const verdict = verifyToken(token, afterRevoke.snapshot.lookup, "s1", "fs.read", 10_001);
    assert.deepEqual(verdict, { ok: false, refusal: "unknown-kid" });
  });
});

void test("pruning drops only retired keys past their grace, at the exact second, and never the active key", () => {
  withState((stateDir) => {
    const clock = clockAt(1000);
    ensureKeyring(stateDir, clock.options);
    clock.set(2000);
    assert.deepEqual(rotateKeyring(stateDir, { revokePrevious: false }, clock.options), { active: "k2", retired: ["k1"], revoked: [] });
    clock.set(3000);
    assert.deepEqual(rotateKeyring(stateDir, { revokePrevious: false }, clock.options), { active: "k3", retired: ["k1", "k2"], revoked: [] });
    // k1 was retired at 2000: one second before its grace ends it is kept, at its grace end it is pruned.
    clock.set(2000 + GRACE - 1);
    assert.deepEqual(rotateKeyring(stateDir, { revokePrevious: false }, clock.options), { active: "k4", retired: ["k1", "k2", "k3"], revoked: [] });
    clock.set(2000 + GRACE);
    assert.deepEqual(rotateKeyring(stateDir, { revokePrevious: false }, clock.options), { active: "k5", retired: ["k2", "k3", "k4"], revoked: [] });
    assert.deepEqual(
      keysIn(stateDir).map((key) => key.kid),
      ["k2", "k3", "k4", "k5"],
    );
    const read = readKeyring(stateDir, clock.options);
    assert.ok(read.present);
    assert.equal(read.snapshot.active, "k5");
    assert.equal(read.snapshot.lookup("k1"), undefined);
    assert.equal(read.snapshot.lookup("k5")?.length, 32);
  });
});

void test("revoke removes every non-active key at once and keeps only the new active key", () => {
  withState((stateDir) => {
    const clock = clockAt(1000);
    ensureKeyring(stateDir, clock.options);
    rotateKeyring(stateDir, { revokePrevious: false }, clock.options);
    const result = rotateKeyring(stateDir, { revokePrevious: true }, clock.options);
    assert.deepEqual(result, { active: "k3", retired: [], revoked: ["k1", "k2"] });
    assert.deepEqual(
      keysIn(stateDir).map((key) => key.kid),
      ["k3"],
    );
    const read = readKeyring(stateDir, clock.options);
    assert.ok(read.present);
    assert.equal(read.snapshot.lookup("k1"), undefined);
    assert.equal(read.snapshot.lookup("k2"), undefined);
    assert.equal(read.snapshot.lookup("k3")?.length, 32);
    assert.deepEqual(read.snapshot.retired, []);
  });
});

void test("rotating an absent keyring creates k1 with no retired and no revoked kid", () => {
  withState((stateDir) => {
    assert.deepEqual(rotateKeyring(stateDir, { revokePrevious: false }), { active: "k1", retired: [], revoked: [] });
    assert.deepEqual(rotateKeyring(join(stateDir, "other-absent"), { revokePrevious: true }), { active: "k1", retired: [], revoked: [] });
  });
});

void test("rotation is atomic: a concurrent rotation between the read and the write is LOCK_CONFLICT and wins whole", () => {
  withState((stateDir) => {
    ensureKeyring(stateDir);
    let raced = false;
    const racing: KeyringOptions = {
      randomBytes: (size) => {
        if (!raced) {
          raced = true;
          rotateKeyring(stateDir, { revokePrevious: false });
        }
        return randomBytes(size);
      },
    };
    const error = thrown(() => rotateKeyring(stateDir, { revokePrevious: false }, racing));
    assert.ok(error instanceof RealmError);
    assert.equal(error.code, "LOCK_CONFLICT");
    assert.deepEqual(
      keysIn(stateDir).map((key) => key.kid),
      ["k1", "k2"],
    );
    assert.deepEqual(readdirSync(join(stateDir, "capability")), ["keys.json"]);
  });
});

void test("the change detector shows a rotation, and a reader that reloads on the change sees the new active key", () => {
  withState((stateDir) => {
    const first = ensureKeyring(stateDir);
    assert.deepEqual(keyringIdentity(stateDir), first.identity);
    rotateKeyring(stateDir, { revokePrevious: false });
    const changed = keyringIdentity(stateDir);
    assert.notDeepEqual(changed, first.identity);
    assert.notEqual(changed, null);
    const reloaded = readKeyring(stateDir);
    assert.ok(reloaded.present);
    assert.equal(reloaded.snapshot.active, "k2");
    assert.deepEqual(reloaded.snapshot.identity, changed);
    // The stale snapshot still holds its own view: nothing mutates it.
    assert.equal(first.active, "k1");
  });
});

void test("a failed random source refuses and creates nothing", () => {
  withState((stateDir) => {
    const error = thrown(() => ensureKeyring(stateDir, { randomBytes: () => Buffer.alloc(16) }));
    assert.ok(isDenied(error));
    assert.deepEqual(readKeyring(stateDir), { present: false });
  });
});
