// Verifies the sandbox runtime image contents against sandbox/expected-digests.json.
//
//   node scripts/check/verify-image-digests.mjs --dir <dir>     hash the listed paths under <dir>
//   node scripts/check/verify-image-digests.mjs --image <ref>   copy the listed files out of a
//                                                               podman image and hash them, then
//                                                               compare the image labels
//
// Exit 0: every digest matches. Exit 1: a file is missing or a digest differs. Exit 2: bad
// arguments, an unreadable or malformed digests file, or an image that is not in local
// podman storage (the image is never pulled). Output names each failing entry and
// the first 12 characters of the digests, never file contents or runtime text.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_EXPECTED = join(ROOT, "sandbox", "expected-digests.json");
const PODMAN_TIMEOUT_MS = 120_000;
const PREFIX_LENGTH = 12;

// Expected-file entries in the digests file. Each names a file path inside the image.
export const FILE_ENTRIES = ["runtime", "agentosRunner", "agentosProbe"];

// Image labels that must repeat values of the digests file (label name, digests-file field).
export const LABEL_CHECKS = [
  ["io.realm.openshell.revision", "openshellRevision"],
  ["io.realm.runtime.sha256", "runtime"],
  ["io.realm.cargo-lock.sha256", "cargoLockSha256"],
  ["io.realm.agentos.runner.sha256", "agentosRunner"],
  ["io.realm.agentos.probe.sha256", "agentosProbe"],
];

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

function fail(message) {
  throw new Error(`expected-digests: ${message}`);
}

function requireDigest(value, field) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${field} must be a 64-character lowercase hex sha256`);
  }
  return value;
}

function requireFileEntry(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object with path and sha256`);
  }
  const { path } = value;
  if (typeof path !== "string" || path.length === 0 || path.split("/").includes("..")) {
    fail(`${field}.path must be a non-empty path without ".." segments`);
  }
  return { path, sha256: requireDigest(value.sha256, `${field}.sha256`) };
}

// Parses and validates the digests file text. Throws an Error naming the first bad field.
export function parseExpected(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("file is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("file must hold a JSON object");
  }
  if (data.schema !== 1) {
    fail("schema must be 1");
  }
  if (typeof data.openshellRevision !== "string" || !REVISION_PATTERN.test(data.openshellRevision)) {
    fail("openshellRevision must be a 40-character lowercase hex commit id");
  }
  return {
    openshellRevision: data.openshellRevision,
    cargoLockSha256: requireDigest(data.cargoLockSha256, "cargoLockSha256"),
    runtime: requireFileEntry(data.runtime, "runtime"),
    agentosRunner: requireFileEntry(data.agentosRunner, "agentosRunner"),
    agentosProbe: requireFileEntry(data.agentosProbe, "agentosProbe"),
  };
}

// sha256 of a file as lowercase hex, or null when the file does not exist.
export function sha256OfFile(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return createHash("sha256").update(bytes).digest("hex");
}

// Hashes each expected file under dir. Returns one finding per missing file or mismatch.
export function compareDirectory(expected, dir) {
  const findings = [];
  for (const name of FILE_ENTRIES) {
    const entry = expected[name];
    const actual = sha256OfFile(join(dir, entry.path));
    if (actual === null) {
      findings.push({ name, kind: "missing", expected: entry.sha256, actual: null });
    } else if (actual !== entry.sha256) {
      findings.push({ name, kind: "mismatch", expected: entry.sha256, actual });
    }
  }
  return findings;
}

function expectedLabelValue(expected, field) {
  const value = expected[field];
  return typeof value === "string" ? value : value.sha256;
}

// Compares the image labels with the digests file. A label that is absent is a finding.
export function compareLabels(expected, labels) {
  const findings = [];
  for (const [label, field] of LABEL_CHECKS) {
    const want = expectedLabelValue(expected, field);
    const have = typeof labels?.[label] === "string" ? labels[label] : null;
    if (have === null) {
      findings.push({ name: label, kind: "missing", expected: want, actual: null });
    } else if (have !== want) {
      findings.push({ name: label, kind: "mismatch", expected: want, actual: have });
    }
  }
  return findings;
}

function short(value) {
  return value === null ? "none" : value.slice(0, PREFIX_LENGTH);
}

export function formatFinding(finding) {
  return `${finding.name}: ${finding.kind} (expected ${short(finding.expected)}, actual ${short(finding.actual)})`;
}

// Builds a runner that invokes the given podman command with an argument vector, never a shell.
export function createPodmanRunner(command) {
  return (args) =>
    execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PODMAN_TIMEOUT_MS,
    });
}

const runPodman = createPodmanRunner("podman");

// A missing local image is a different failure from a file that is missing inside an image.
export class ImageNotFoundError extends Error {
  constructor(ref) {
    super(`image ${ref} is not in local podman storage (it is never pulled); build or load it first`);
    this.name = "ImageNotFoundError";
  }
}

// A copy that podman could not complete for a reason other than an absent file: a timeout, an
// unwritable destination, a podman failure. The message names the entry and nothing else, so no
// host path or digest reaches the output.
export class ImageReadError extends Error {
  constructor(name) {
    super(`could not copy ${name} out of the image`);
    this.name = "ImageReadError";
  }
}

// True only for the podman message of a file that is absent from the container filesystem.
function isAbsentFile(error) {
  const stderr = error !== null && typeof error === "object" ? String(error.stderr ?? "").toLowerCase() : "";
  return stderr.includes("could not be found on container") && stderr.includes("no such file or directory");
}

// Throws ImageNotFoundError when podman reports the image absent (`podman image exists`
// exits 1). Any other failure, such as a timeout or a podman error, is rethrown unchanged.
function requireLocalImage(ref, run) {
  try {
    run(["image", "exists", ref]);
  } catch (error) {
    if (error !== null && typeof error === "object" && error.status === 1) {
      throw new ImageNotFoundError(ref);
    }
    throw error;
  }
}

// A failing removal must never hide the findings or turn them into a tool failure: it is
// reported on its own stderr line and the caller keeps the findings and their exit code.
function removeContainer(container, run) {
  try {
    run(["rm", "--force", container]);
  } catch {
    console.error(`check:image-digests: could not remove scratch container ${container}`);
  }
}

// Copies each expected file out of the image into destination, mirroring its in-image path.
// A file that podman reports absent from the image is left absent, and compareDirectory reports it
// as missing. Any other copy failure throws ImageReadError.
export function extractImageFiles(ref, expected, destination, run = runPodman) {
  requireLocalImage(ref, run);
  const container = run(["create", "--pull=never", "--entrypoint", "/bin/true", ref]).trim();
  if (container.length === 0) {
    throw new Error("podman create returned no container id");
  }
  try {
    for (const name of FILE_ENTRIES) {
      const { path } = expected[name];
      const target = join(destination, path);
      mkdirSync(dirname(target), { recursive: true });
      try {
        run(["cp", `${container}:${path}`, target]);
      } catch (error) {
        if (!isAbsentFile(error)) {
          throw new ImageReadError(name);
        }
      }
    }
  } finally {
    removeContainer(container, run);
  }
}

export function readImageLabels(ref, run = runPodman) {
  const labels = JSON.parse(run(["image", "inspect", "--format", "{{json .Labels}}", ref]));
  return typeof labels === "object" && labels !== null ? labels : {};
}

export function verifyImage(ref, expected, run = runPodman) {
  const scratch = mkdtempSync(join(tmpdir(), "realm-image-digests-"));
  try {
    extractImageFiles(ref, expected, scratch, run);
    return [...compareDirectory(expected, scratch), ...compareLabels(expected, readImageLabels(ref, run))];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const options = { dir: null, image: null, expected: DEFAULT_EXPECTED };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.length === 0) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === "--image" && value.startsWith("-")) {
      throw new Error("--image must be an image reference, not an option");
    }
    if (flag === "--dir") {
      options.dir = value;
    } else if (flag === "--image") {
      options.image = value;
    } else if (flag === "--expected") {
      options.expected = value;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if ((options.dir === null) === (options.image === null)) {
    throw new Error("give exactly one of --dir <dir> or --image <ref>");
  }
  return options;
}

function main(argv) {
  let options;
  let expected;
  try {
    options = parseArgs(argv);
    expected = parseExpected(readFileSync(options.expected, "utf8"));
  } catch (error) {
    console.error(`check:image-digests: ${error instanceof Error ? error.message : "invalid input"}`);
    return 2;
  }
  let findings;
  try {
    findings = options.dir === null ? verifyImage(options.image, expected) : compareDirectory(expected, options.dir);
  } catch (error) {
    if (error instanceof ImageNotFoundError || error instanceof ImageReadError) {
      console.error(`check:image-digests: ${error.message}`);
    } else {
      console.error("check:image-digests: could not read the image or directory");
    }
    return 2;
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`check:image-digests: ${formatFinding(finding)}`);
    }
    return 1;
  }
  console.log("check:image-digests: ok");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
