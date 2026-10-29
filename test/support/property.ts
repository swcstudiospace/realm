// Shared fast-check configuration for the property tests (QR-07, D-1307).
//
// Every property runs DEFAULT_NUM_RUNS inputs from one fixed seed, so a run is deterministic and a
// failure on CI reproduces locally. REALM_PROPERTY_SEED overrides the seed with an integer; the value
// "random" draws a fresh seed to explore beyond the fixed inputs, and the failure message names it.

import fc from "fast-check";

export const DEFAULT_NUM_RUNS = 200;
export const DEFAULT_SEED = 20261029;

export function propertySeed(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["REALM_PROPERTY_SEED"];
  if (raw === undefined || raw === "") {
    return DEFAULT_SEED;
  }
  if (raw === "random") {
    return Math.floor(Math.random() * 2 ** 31);
  }
  const seed = Number(raw);
  if (!Number.isInteger(seed)) {
    throw new Error(`REALM_PROPERTY_SEED must be an integer or "random", got "${raw}"`);
  }
  return seed;
}

export interface PropertyOptions {
  readonly numRuns?: number;
}

// Runs a synchronous property. A failure is rethrown with the seed, the replay instruction and
// fast-check's report, which holds the shrunk counterexample and the replay path.
export function assertProperty<Ts>(property: fc.IProperty<Ts>, options: PropertyOptions = {}): void {
  const seed = propertySeed();
  const numRuns = options.numRuns ?? DEFAULT_NUM_RUNS;
  try {
    fc.assert(property, { numRuns, seed, verbose: fc.VerbosityLevel.Verbose });
  } catch (error: unknown) {
    const report = error instanceof Error ? error.message : String(error);
    throw new Error(`property failed with seed ${String(seed)}; rerun with REALM_PROPERTY_SEED=${String(seed)}\n${report}`, {
      cause: error,
    });
  }
}
