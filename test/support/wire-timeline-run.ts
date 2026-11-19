// The window verdict runner (Phase 47, 47-CONTEXT D-47-02 item 2): given a directory of run folders it reads each folder's wire.log (the
// recorder log), run.json (the run record) and reach.json (the reach polls), applies the frozen rules of wire-timeline.ts and prints one
// JSON object: the per-run classification, the reproduction outcome, the attribution and the ablation verdict. The result of a window is
// computed by this code and not by hand.
//
//   node dist/test/support/wire-timeline-run.js EVIDENCE_DIR
//
// It prints marks, counts, classes, flags, environment names and catalogue codes only: no message text, no parameter, no path, no
// environment value. It reads nothing but the directory it is given (no environment, no other path). Exit 0 when it ran, 2 when the
// directory cannot be read (one line, never a path).
//
// Which run counts for what:
//   reproduction  a run with no control that is in the 2026-11-18 condition (all three names restored, no warm control, no diagnostic flag)
//   C1 / C3       a run whose run.json names that control; its wire.log is classified like any other
//   C2            a run whose run.json names C2: the direct cold attach probe stands for it; it answered when it returned exit 0, and its
//                 duration is the elapsed time of that run
//   ablation      a run with no control, no warm control, whose restore set is all three names (SA), none (S0) or all minus one name

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ABLATION_NAMES,
  ablationVerdict,
  attributeCause,
  classifyToolsList,
  isHealthy,
  isReproCondition,
  nextStep,
  parseReachPolls,
  parseRunRecord,
  readWireTimeline,
  reproductionOutcome,
  runReached,
  type AblationRun,
  type AblationVerdict,
  type CauseVerdict,
  type Controls,
  type ReachPoll,
  type ReproResult,
  type ReproRun,
  type RunRecord,
  type RunVerdict,
} from "./wire-timeline.js";

export interface RunSummary {
  readonly folder: string;
  readonly record: RunRecord;
  readonly verdict: RunVerdict;
  readonly polls: readonly ReachPoll[];
  readonly reached: boolean;
}

export interface WindowSummary {
  readonly runs: readonly RunSummary[];
  // Folders that held no readable run.json.
  readonly skipped: readonly string[];
  readonly reproduction: ReproResult;
  readonly nextStep: "more" | "stop";
  readonly cause: CauseVerdict;
  readonly ablation: AblationVerdict;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function inAblation(record: RunRecord): boolean {
  if (record.control !== undefined || record.warm) {
    return false;
  }
  const kept = record.restore.filter((name) => ABLATION_NAMES.includes(name));
  return kept.length === record.restore.length && new Set(kept).size === kept.length && (kept.length === 0 || kept.length >= ABLATION_NAMES.length - 1);
}

// The verdict of a window held in `root`, a directory of run folders (one folder per run, read in name order).
export function summarizeRuns(root: string): WindowSummary {
  const runs: RunSummary[] = [];
  const skipped: string[] = [];
  for (const folder of readdirSync(root).sort()) {
    const record = parseRunRecord(readJson(join(root, folder, "run.json")));
    if (record === undefined) {
      skipped.push(folder);
      continue;
    }
    const polls = parseReachPolls(readJson(join(root, folder, "reach.json"))) ?? [];
    runs.push({ folder, record, verdict: classifyToolsList(readWireTimeline(join(root, folder, "wire.log"))), polls, reached: runReached(polls) });
  }
  const attempts: ReproRun[] = runs
    .filter((run) => run.record.control === undefined && isReproCondition(run.record))
    .map((run) => ({ cold: run.record.cold, condition: true, verdict: run.verdict }));
  const reproduction = reproductionOutcome(attempts);
  const failing = attempts.filter((run) => run.cold && run.verdict.valid && !isHealthy(run.verdict)).map((run) => run.verdict);
  const controls: Controls = {
    c1: runs.filter((run) => run.record.control === "C1").map((run) => run.verdict),
    c2: runs.filter((run) => run.record.control === "C2").map((run) => ({ answered: run.record.returned && run.record.exitCode === 0, ms: run.record.elapsedMs })),
    c3: runs.filter((run) => run.record.control === "C3").map((run) => run.verdict),
  };
  const ablationRuns: AblationRun[] = runs.filter((run) => inAblation(run.record)).map((run) => ({ restore: run.record.restore, polls: run.polls, catalogueCodes: run.record.catalogueCodes }));
  return {
    runs,
    skipped,
    reproduction,
    nextStep: nextStep(attempts),
    cause: attributeCause(reproduction.outcome, failing, controls),
    ablation: ablationVerdict(ablationRuns),
  };
}

function main(argv: readonly string[]): number {
  const root = argv[0];
  if (root === undefined || root === "") {
    process.stderr.write("wire-timeline-run: the evidence directory argument is missing\n");
    return 2;
  }
  let summary: WindowSummary;
  try {
    summary = summarizeRuns(root);
  } catch {
    process.stderr.write("wire-timeline-run: the evidence directory cannot be read\n");
    return 2;
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

// Run only as the entry point, so the test imports summarizeRuns without printing.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
