// Builds the sandbox runtime image from the committed digests in sandbox/expected-digests.json.
//
//   node scripts/image/build-image.mjs [--tag <ref>] [--context <dir>] [--expected <file>]
//                                      [--podman <command>]
//
// The digests file is parsed and validated first, and its values are passed to
// `podman build` as build arguments, so a rebuild whose binaries differ from the recorded
// digests fails the Dockerfile's own sha256 gates. After a successful build the image is
// verified the same way as `check:image-digests --image <tag>`.
//
// Exit 0: built and every digest and label matches. Exit 1: the image built but a file is
// missing or a digest or label differs. Exit 2: bad arguments, an unreadable or malformed
// digests file, a missing build context, or a failed build or verification. Output names entries and the first 12
// characters of digests, never file contents.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ImageNotFoundError,
  ImageReadError,
  createPodmanRunner,
  formatFinding,
  parseExpected,
  verifyImage,
} from "../check/verify-image-digests.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_TAG = "localhost/realm-agentos:build";
const DEFAULT_EXPECTED = join(ROOT, "sandbox", "expected-digests.json");
const DOCKERFILE = "sandbox/Dockerfile";

export function parseArgs(argv) {
  const options = { tag: DEFAULT_TAG, context: ROOT, expected: DEFAULT_EXPECTED, podman: "podman" };
  const fields = { "--tag": "tag", "--context": "context", "--expected": "expected", "--podman": "podman" };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!Object.hasOwn(fields, flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    if (value === undefined || value.length === 0) {
      throw new Error(`${flag} needs a value`);
    }
    options[fields[flag]] = value;
  }
  return options;
}

// The argument vector of the build. Every value is its own element: nothing is joined into a
// shell string.
export function buildArgs(expected, tag, context) {
  return [
    "build",
    "-f",
    DOCKERFILE,
    "--build-arg",
    `RUNTIME_SHA256=${expected.runtime.sha256}`,
    "--build-arg",
    `CARGO_LOCK_SHA256=${expected.cargoLockSha256}`,
    "--build-arg",
    `AGENTOS_RUNNER_SHA256=${expected.agentosRunner.sha256}`,
    "--build-arg",
    `AGENTOS_PROBE_SHA256=${expected.agentosProbe.sha256}`,
    "--build-arg",
    `OPENSHELL_REVISION=${expected.openshellRevision}`,
    "-t",
    tag,
    context,
  ];
}

// The default effects. The build runs in the context directory, so the relative Dockerfile
// path resolves there whatever the caller's working directory is.
export const DEFAULT_IO = {
  build(command, args, cwd) {
    execFileSync(command, args, { cwd, stdio: "inherit" });
  },
  verify(ref, expected, command) {
    return verifyImage(ref, expected, createPodmanRunner(command));
  },
};

// True when path is an existing directory. A path that cannot be examined at all (absent, or
// below a file) is not a usable context, and the caller reports it as such.
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function main(argv, io = DEFAULT_IO) {
  let options;
  let expected;
  try {
    options = parseArgs(argv);
    expected = parseExpected(readFileSync(options.expected, "utf8"));
  } catch (error) {
    console.error(`build:image: ${error instanceof Error ? error.message : "invalid input"}`);
    return 2;
  }
  const context = resolve(options.context);
  if (!isDirectory(context)) {
    console.error("build:image: build context not found");
    return 2;
  }
  try {
    io.build(options.podman, buildArgs(expected, options.tag, context), context);
  } catch {
    console.error(`build:image: podman build of ${options.tag} failed`);
    return 2;
  }
  let findings;
  try {
    findings = io.verify(options.tag, expected, options.podman);
  } catch (error) {
    console.error(
      `build:image: ${
        error instanceof ImageNotFoundError || error instanceof ImageReadError
          ? error.message
          : "could not read the built image"
      }`,
    );
    return 2;
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`build:image: ${formatFinding(finding)}`);
    }
    return 1;
  }
  console.log(`build:image: ok (${options.tag})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
