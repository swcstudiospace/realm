// The host supervisor's stop (phase 9.5, U5). A supervisor that survives SIGKILL fails the stop with CLEANUP_FAILED within its bound,
// so the delete that awaits it cannot hang. A supervisor that exits within its bounds is stopped without failure. No real process
// survives SIGKILL, so the process here is a fake whose exit the test controls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../../src/core/errors.js";
import { endSupervisorProcess } from "../../../src/runtime/driver/supervisor.js";

function codeIs(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// A process that records the signals sent to it. It exits when one of exitsOn is sent; exited settles then. The executor form is used
// because tsconfig's ES2023 lib has no Promise.withResolvers.
function fakeProcess(exitsOn: readonly NodeJS.Signals[]): {
  readonly child: { kill(signal: NodeJS.Signals): boolean };
  readonly exited: Promise<void>;
  readonly signals: NodeJS.Signals[];
} {
  const signals: NodeJS.Signals[] = [];
  let exit: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    exit = () => {
      resolve();
    };
  });
  const child = {
    kill(signal: NodeJS.Signals): boolean {
      signals.push(signal);
      if (exitsOn.includes(signal)) {
        exit();
      }
      return true;
    },
  };
  return { child, exited, signals };
}

void test("a supervisor that does not exit after SIGKILL fails the stop with CLEANUP_FAILED within its bound, instead of hanging (phase 9.5, U5)", { timeout: 5000 }, async () => {
  const fake = fakeProcess([]);
  await assert.rejects(
    endSupervisorProcess(fake.child, fake.exited, { graceMs: 10, killWaitMs: 10 }),
    codeIs("CLEANUP_FAILED"),
  );
  assert.deepEqual(fake.signals, ["SIGTERM", "SIGKILL"]);
});

void test("a supervisor that exits on SIGTERM within its grace is stopped without SIGKILL (phase 9.5, U5)", { timeout: 5000 }, async () => {
  const fake = fakeProcess(["SIGTERM"]);
  await endSupervisorProcess(fake.child, fake.exited, { graceMs: 1000, killWaitMs: 10 });
  assert.deepEqual(fake.signals, ["SIGTERM"]);
});

void test("a supervisor that exits on SIGKILL within its wait is stopped without failure (phase 9.5, U5)", { timeout: 5000 }, async () => {
  const fake = fakeProcess(["SIGKILL"]);
  await endSupervisorProcess(fake.child, fake.exited, { graceMs: 10, killWaitMs: 1000 });
  assert.deepEqual(fake.signals, ["SIGTERM", "SIGKILL"]);
});
