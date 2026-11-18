// The probe entry (35-02, D-35-03): one JSON specification on standard input, the JSON report in the file named by the first
// argument (written under a temporary name and renamed, so a reader never sees a partial file, mode 0600). Nothing on standard
// output. Exit 0 when the probe ran, 2 when the specification is refused (one line naming the member, never a value), 1 when the
// probe itself failed (one line naming the stage). A denied read is a result in the report, not a failure.

import { renameSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { errnoOf, parseSpec, probeProcess, runControlDescendant, SpecError, type ProbeReport } from "./memory-probe.js";
import { boundedWait } from "./timing.js";

const MAX_SPEC_BYTES = 1_048_576;
const READ_BOUND_MS = 10_000;

async function readSpecText(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  const done = new Promise<void>((resolve, reject) => {
    process.stdin.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_SPEC_BYTES) {
        reject(new SpecError("document", "larger than 1 MiB"));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", resolve);
    process.stdin.on("error", reject);
  });
  await boundedWait(done, "the probe specification on standard input", READ_BOUND_MS);
  return Buffer.concat(chunks).toString("utf8");
}

function writeReport(resultPath: string, report: ProbeReport): void {
  const temporary = `${resultPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(report), { mode: 0o600 });
  renameSync(temporary, resultPath);
}

async function main(): Promise<number> {
  const resultPath = process.argv[2];
  if (resultPath === undefined || resultPath === "") {
    process.stderr.write("memory-probe-run: the result path is missing\n");
    return 2;
  }
  let text: string;
  try {
    text = await readSpecText();
  } catch (error: unknown) {
    if (error instanceof SpecError) {
      process.stderr.write(`memory-probe-run: ${error.message}\n`);
      return 2;
    }
    process.stderr.write("memory-probe-run: failed at stage reading the specification\n");
    return 1;
  }
  let report: ProbeReport;
  try {
    const spec = parseSpec(text);
    report = spec.kind === "target" ? probeProcess(spec) : await runControlDescendant({ ...(spec.maxBytes === undefined ? {} : { maxBytes: spec.maxBytes }), ...(spec.maxMs === undefined ? {} : { maxMs: spec.maxMs }) });
  } catch (error: unknown) {
    if (error instanceof SpecError) {
      process.stderr.write(`memory-probe-run: ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`memory-probe-run: failed at stage probing (${errnoOf(error)})\n`);
    return 1;
  }
  try {
    writeReport(resultPath, report);
  } catch (error: unknown) {
    process.stderr.write(`memory-probe-run: failed at stage writing the report (${errnoOf(error)})\n`);
    return 1;
  }
  return 0;
}

void main().then((code) => {
  process.exit(code);
});
