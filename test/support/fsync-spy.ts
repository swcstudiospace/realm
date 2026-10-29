import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";

// Replaces fs.fsyncSync for the length of one test and republishes it to the ES module named
// exports, which the code under test imports. The spy records whether each synced descriptor is a
// directory and calls the real fsync unless it is told to fail. onFsync, when given, runs at the
// moment of each fsync, before it is recorded, so a test can assert what already happened.
export function spyOnFsync(
  t: TestContext,
  failure?: Error,
  onFsync?: () => void,
): { readonly calls: boolean[] } {
  const calls: boolean[] = [];
  const real = fs.fsyncSync;
  const mocked = t.mock.method(fs, "fsyncSync", (fd: number): void => {
    onFsync?.();
    calls.push(fs.fstatSync(fd).isDirectory());
    if (failure !== undefined) {
      throw failure;
    }
    real(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
  return { calls };
}
