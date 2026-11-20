// The run evidence of the command drive (Phase 47, plan 47-01; 47-CONTEXT D-47-02 item 3, D-47-09): where a run's wire log, full command
// output and server stderr are kept, and what is kept about the run itself.
//
//   checkEvidenceDir     an evidence directory is an absolute path of an existing directory of mode 0700 that is NOT inside the repository
//                        checkout (found by real path, symlinks resolved); a refusal names a reason and never the path
//   writeRunEvidence     one run folder under it: wire.log, command-stdout.txt, command-stderr.txt, server-stderr.txt, run.json and
//                        reach.json, each mode 0600 in a folder of mode 0700; written before any assertion of the run
//   catalogueCodesIn     the Realm catalogue codes a text names, as names only
//
// The repository gets names, counts, flags, marks and catalogue codes (run.json, reach.json); the full command output and the server stderr
// stay in the evidence directory, which is outside the checkout. run.json never holds an environment value or a path. Nothing here reads the
// process environment or starts a process; the one place a directory is created is the run folder under an already checked directory.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ERROR_CODES } from "../../src/core/errors.js";
import type { ReachObservation } from "./host-live-reach.js";
import type { RunRecord } from "./wire-timeline.js";

// ---- The evidence directory ------------------------------------------------------------------------------------------------

export type EvidenceRefusal = "not-absolute" | "missing" | "not-a-directory" | "inside-checkout" | "not-mode-0700";

export type EvidenceDirCheck = { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: EvidenceRefusal };

// The fixed sentence of each refusal, with no path in it.
export const EVIDENCE_REFUSAL_TEXT: Readonly<Record<EvidenceRefusal, string>> = Object.freeze({
  "not-absolute": "the evidence directory must be an absolute path",
  missing: "the evidence directory does not exist; create it first, it is never created here",
  "not-a-directory": "the evidence path is not a directory",
  "inside-checkout": "the evidence directory is inside the repository checkout; keep the evidence outside it",
  "not-mode-0700": "the evidence directory must have mode 0700",
});

// Checks `path` against `checkout`, the repository checkout root. Never creates the directory.
export function checkEvidenceDir(path: string, checkout: string): EvidenceDirCheck {
  if (!isAbsolute(path)) {
    return { ok: false, reason: "not-absolute" };
  }
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!statSync(real).isDirectory()) {
    return { ok: false, reason: "not-a-directory" };
  }
  const away = relative(realpathSync(checkout), real);
  if (away === "" || (!away.startsWith("..") && !isAbsolute(away))) {
    return { ok: false, reason: "inside-checkout" };
  }
  if ((statSync(real).mode & 0o777) !== 0o700) {
    return { ok: false, reason: "not-mode-0700" };
  }
  return { ok: true, dir: real };
}

// ---- Catalogue codes ---------------------------------------------------------------------------------------------------------

// The sorted catalogue codes (src/core/errors.ts) that `text` names as whole words. Names only: no line of the text is kept.
export function catalogueCodesIn(text: string): string[] {
  return ERROR_CODES.filter((code) => new RegExp(`(?<![A-Z0-9_])${code}(?![A-Z0-9_])`).test(text)).sort();
}

// ---- The run folder ----------------------------------------------------------------------------------------------------------

// What the command drive is told about the evidence of its run.
export interface RunEvidenceSettings {
  // A checked evidence directory (checkEvidenceDir).
  readonly dir: string;
  // The run label recorded in run.json (derived from the switches, never typed).
  readonly label: string;
  // The part of the folder name after the counter.
  readonly folderLabel: string;
  // The run is a diagnostic variant: never recorded as the production tier.
  readonly diagnostic: boolean;
  // The control the run stands for (D-47-05), when it is one.
  readonly control?: "C1" | "C2" | "C3";
}

export interface RunEvidenceInput {
  readonly settings: RunEvidenceSettings;
  // The names the recorder restored in this run.
  readonly restore: readonly string[];
  readonly warm: boolean;
  // The before snapshot showed a cold stack.
  readonly cold: boolean;
  readonly elapsedMs: number;
  readonly returned: boolean;
  readonly exitCode?: number;
  // The recorder log to copy, and the host command's full output.
  readonly wireLog: string;
  readonly stdout: string;
  readonly stderr: string;
  // The file holding the recorder's copy of the server's stderr, when the recorder made one.
  readonly serverStderrFile?: string;
  readonly reach?: ReachObservation;
}

export interface RunEvidenceResult {
  readonly folder: string;
  // The members that could not be written; recorded in run.json too when run.json itself could be written.
  readonly failures: readonly string[];
}

const COUNTER_FOLDER = /^(\d+)-/;

// The next free counter under `dir`, two digits at least.
function nextCounter(dir: string): number {
  let highest = 0;
  for (const entry of readdirSync(dir)) {
    const match = COUNTER_FOLDER.exec(entry);
    if (match?.[1] !== undefined) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

function folderName(counter: number, label: string): string {
  return `${String(counter).padStart(2, "0")}-${label.replace(/[^A-Za-z0-9_.+-]/g, "_")}`;
}

function writePrivate(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readOrEmpty(file: string | undefined): string {
  return file !== undefined && existsSync(file) ? readFileSync(file, "utf8") : "";
}

// Writes one run folder (mode 0700) under the checked `settings.dir` and returns it. Every member is mode 0600. A member that cannot be
// written is named in `failures` and in run.json; it never throws for a member, so a failure here cannot mask the run's own failure.
export function writeRunEvidence(input: RunEvidenceInput): RunEvidenceResult {
  const { settings } = input;
  let folder = "";
  for (let counter = nextCounter(settings.dir); folder === ""; counter += 1) {
    const candidate = join(settings.dir, folderName(counter, settings.folderLabel));
    try {
      mkdirSync(candidate, { mode: 0o700 });
      folder = candidate;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw new Error("the run evidence folder cannot be created", { cause: error });
      }
    }
  }
  chmodSync(folder, 0o700);
  const failures: string[] = [];
  const put = (name: string, produce: () => string): void => {
    try {
      writePrivate(join(folder, name), produce());
    } catch {
      failures.push(name);
    }
  };
  put("wire.log", () => readOrEmpty(input.wireLog));
  put("command-stdout.txt", () => input.stdout);
  put("command-stderr.txt", () => input.stderr);
  const serverStderr = ((): string => {
    try {
      return readOrEmpty(input.serverStderrFile);
    } catch {
      failures.push("server-stderr.txt");
      return "";
    }
  })();
  put("server-stderr.txt", () => serverStderr);
  const reach = input.reach;
  put("reach.json", () =>
    JSON.stringify({
      polls: reach?.polls ?? [],
      firstReachedIndex: reach?.firstReachedIndex ?? null,
      reached: reach?.reached ?? false,
      failedSeams: reach?.failedSeams ?? [],
    }),
  );
  const record: RunRecord = {
    label: settings.label,
    restore: input.restore,
    warm: input.warm,
    diagnostic: settings.diagnostic,
    cold: input.cold,
    elapsedMs: input.elapsedMs,
    returned: input.returned,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    catalogueCodes: [...new Set([...catalogueCodesIn(serverStderr), ...(reach?.catalogueCodes ?? [])])].sort(),
    ...(settings.control === undefined ? {} : { control: settings.control }),
    ...(failures.length === 0 ? {} : { evidenceFailures: [...failures] }),
  };
  put("run.json", () => JSON.stringify(record, null, 2));
  return { folder, failures };
}
