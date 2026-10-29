// Packed-package smoke test. Packs the package (or takes a ready tarball with --tarball), installs the tarball into a
// throwaway consumer, loads every JSON schema through the shipped validator, asserts that every host adapter file and
// every file under adapters/ and licenses/ shipped in the tarball, and with --expect-version that the installed package
// and adapter manifests carry the release version.
// The schemas are read at runtime from <package root>/src/..., so a tarball that
// omits them fails here with ENOENT. Run `npm run build` first; check:pack does not build.
//
// Usage: pack-smoke.mjs [--tarball <file>] [--expect-version <x.y.z>]

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RELEASE_VERSION_FILES } from "../release/sync-version.mjs";

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALIDATOR = join("dist", "src", "contract", "validate.js");
const MAX_BUFFER = 16 * 1024 * 1024;
const USAGE = "usage: pack-smoke.mjs [--tarball <file>] [--expect-version <x.y.z>]";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// Every host adapter manifest, MCP entry, snippet and guide that the package must ship (paths relative to the package
// root). The list is explicit because it documents intent; missingWalkedFiles catches a file added without a line here.
export const ADAPTER_FILES = [
  "adapters/claude-plugin/.claude-plugin/plugin.json",
  "adapters/claude-plugin/.mcp.json",
  "adapters/muse-code/.muse-plugin/plugin.json",
  "adapters/muse-code/mcp-settings.snippet.json",
  "adapters/hermes-agent/plugin.json",
  "adapters/hermes-agent/mcp.json",
  "adapters/hermes-agent/mcp.snippet.yaml",
  "adapters/prime-agent/package.json",
  "adapters/prime-agent/MCP.md",
  "adapters/prime-agent/skills/realm/SKILL.md",
];

// Source directories whose every file must exist in the installed package.
export const WALKED_DIRECTORIES = ["adapters", "licenses"];

// The consumer imports the installed package by its bare name, so the probe
// resolves through node_modules exactly as a real user's code would.
// validate() compiles a schema on first use and throws if its file is missing.
// Calling it with {} exercises all three schemas, and the result is never
// inspected beyond its shape, since only the load matters here.
const PROBE_SOURCE = `import { validate } from "agent-realm/dist/src/contract/validate.js";

for (const schema of ["policy", "tools", "sessionRecord"]) {
  const result = validate(schema, {});
  if (typeof result.ok !== "boolean") {
    throw new Error("validate returned no result for " + schema);
  }
}
console.log("schemas loaded: policy, tools, sessionRecord");
`;

export function buildPackArgs(destination) {
  return ["pack", "--json", "--pack-destination", destination];
}

export function buildInstallArgs(tarball) {
  return ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball];
}

// npm pack --json prints one entry per packed tarball. Anything else is a failure.
export function tarballFromPackOutput(stdout, destination) {
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries) || entries.length !== 1 || typeof entries[0]?.filename !== "string") {
    throw new Error("npm pack --json did not report exactly one tarball");
  }
  return join(destination, entries[0].filename);
}

// Parses the command line (without node and the script path). Unknown flags, positional arguments, repeated options and
// options without a value are errors that carry the usage message.
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag !== "--tarball" && flag !== "--expect-version") {
      throw new Error(`unknown argument ${JSON.stringify(flag)}; ${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} needs a value; ${USAGE}`);
    }
    const key = flag === "--tarball" ? "tarball" : "expectVersion";
    if (key in options) {
      throw new Error(`${flag} given more than once; ${USAGE}`);
    }
    if (key === "expectVersion" && !VERSION_PATTERN.test(value)) {
      throw new Error(`--expect-version must look like x.y.z, got ${JSON.stringify(value)}; ${USAGE}`);
    }
    options[key] = value;
  }
  return options;
}

// Lists the adapter files absent under an installed package root.
export function missingAdapterFiles(packageRoot) {
  return ADAPTER_FILES.filter((path) => !existsSync(join(packageRoot, path)));
}

// Lists every file under a directory as "/"-joined paths relative to the base, sorted.
function listFiles(base, relativeDir) {
  const found = [];
  for (const entry of readdirSync(join(base, relativeDir), { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...listFiles(base, relative));
    } else {
      found.push(relative);
    }
  }
  return found.sort();
}

// Walks the given directories in the source tree and lists each file (relative to the root, sorted per directory) that is
// absent under the installed package root. It needs no hand list, so a newly added adapter or licence file is checked.
export function missingWalkedFiles(sourceRoot, packageRoot, directories = WALKED_DIRECTORIES) {
  const missing = [];
  for (const directory of directories) {
    if (!existsSync(join(sourceRoot, directory))) {
      throw new Error(`source directory ${directory} is missing under ${sourceRoot}`);
    }
    for (const path of listFiles(sourceRoot, directory)) {
      if (!existsSync(join(packageRoot, path))) {
        missing.push(path);
      }
    }
  }
  return missing;
}

// Lists "<file>: <version>" for each release version file that the installed package ships and whose "version" is not the
// expected one. Files absent from the package (package-lock.json is never in a tarball) are skipped, except package.json,
// which is reported: an install without it cannot be this package.
export function versionMismatches(packageRoot, expected) {
  const mismatches = [];
  for (const file of RELEASE_VERSION_FILES) {
    const path = join(packageRoot, file);
    if (!existsSync(path)) {
      if (file === "package.json") {
        mismatches.push(`${file}: missing`);
      }
      continue;
    }
    let version;
    try {
      version = JSON.parse(readFileSync(path, "utf8")).version;
    } catch (error) {
      throw new Error(`cannot read the version from ${file}: ${error.message}`, { cause: error });
    }
    if (version !== expected) {
      mismatches.push(`${file}: ${version === undefined ? "no version" : String(version)}`);
    }
  }
  return mismatches;
}

// Lists each entry point the installed manifest declares (the CLI bin and the Omp extension) that is absent.
export function missingDeclaredEntries(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const declared = [...Object.values(manifest.bin ?? {}), ...(manifest.omp?.extensions ?? [])];
  return declared.filter((path) => !existsSync(join(packageRoot, path)));
}

// The vendored compute driver protos and their provenance file, relative to the package root. The driver loads them at
// start, so a package without them cannot serve the gateway.
export const DRIVER_PROTO_FILES = [
  "src/runtime/driver/proto/PROVENANCE.md",
  "src/runtime/driver/proto/compute_driver.proto",
  "src/runtime/driver/proto/datamodel.proto",
  "src/runtime/driver/proto/extension.proto",
  "src/runtime/driver/proto/options.proto",
  "src/runtime/driver/proto/sandbox.proto",
];

// Lists the driver protos absent under an installed package root.
export function missingDriverProtos(packageRoot) {
  return DRIVER_PROTO_FILES.filter((path) => !existsSync(join(packageRoot, path)));
}

// The project licence, its notice, and the licence text of the Apache-2.0 material that NOTICE lists. Apache-2.0 section 4(a)
// requires the text to travel with a redistributed copy of that material.
export const LEGAL_FILES = ["LICENSE", "NOTICE", "licenses/Apache-2.0.txt"];

// Lists the legal files absent under an installed package root.
export function missingLegalFiles(packageRoot) {
  return LEGAL_FILES.filter((path) => !existsSync(join(packageRoot, path)));
}

async function run(file, args, options) {
  try {
    return await execFileAsync(file, args, {
      ...options,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, npm_config_update_notifier: "false" },
    });
  } catch (error) {
    const detail = String(error.stderr ?? "").trim() || error.message;
    throw new Error(`${file} ${args.join(" ")} failed: ${detail}`, { cause: error });
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const givenTarball = options.tarball === undefined ? undefined : resolve(options.tarball);
  if (givenTarball === undefined) {
    if (!existsSync(join(ROOT, VALIDATOR))) {
      throw new Error(`${VALIDATOR} is missing; run "npm run build" before check:pack`);
    }
  } else if (!existsSync(givenTarball)) {
    throw new Error(`tarball ${givenTarball} does not exist`);
  }

  let packDir;
  let consumerDir;
  try {
    consumerDir = await mkdtemp(join(tmpdir(), "realm-consumer-"));

    let tarball = givenTarball;
    if (tarball === undefined) {
      packDir = await mkdtemp(join(tmpdir(), "realm-pack-"));
      const packed = await run("npm", buildPackArgs(packDir), { cwd: ROOT });
      tarball = tarballFromPackOutput(packed.stdout, packDir);
    }

    await writeFile(join(consumerDir, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
    await run("npm", buildInstallArgs(tarball), { cwd: consumerDir });

    const installed = join(consumerDir, "node_modules", "agent-realm");
    const missing = missingAdapterFiles(installed);
    if (missing.length > 0) {
      throw new Error(`packed package is missing adapter files: ${missing.join(", ")}`);
    }
    const missingWalked = missingWalkedFiles(ROOT, installed);
    if (missingWalked.length > 0) {
      throw new Error(`packed package is missing files under ${WALKED_DIRECTORIES.join(", ")}: ${missingWalked.join(", ")}`);
    }
    const missingEntries = missingDeclaredEntries(installed);
    if (missingEntries.length > 0) {
      throw new Error(`packed package is missing declared entries: ${missingEntries.join(", ")}`);
    }
    const missingProtos = missingDriverProtos(installed);
    if (missingProtos.length > 0) {
      throw new Error(`packed package is missing driver protos: ${missingProtos.join(", ")}`);
    }
    const missingLegal = missingLegalFiles(installed);
    if (missingLegal.length > 0) {
      throw new Error(`packed package is missing legal files: ${missingLegal.join(", ")}`);
    }
    if (options.expectVersion !== undefined) {
      const mismatches = versionMismatches(installed, options.expectVersion);
      if (mismatches.length > 0) {
        throw new Error(`packed package is not at version ${options.expectVersion}: ${mismatches.join(", ")}`);
      }
    }

    await writeFile(join(consumerDir, "probe.mjs"), PROBE_SOURCE);
    const probe = await run(process.execPath, ["probe.mjs"], { cwd: consumerDir });
    process.stdout.write(probe.stdout);
    process.stdout.write(`adapter files: ${ADAPTER_FILES.length} present\n`);
    process.stdout.write(`driver protos: ${DRIVER_PROTO_FILES.length} present\n`);
    process.stdout.write(`legal files: ${LEGAL_FILES.length} present\n`);
    if (options.expectVersion !== undefined) {
      process.stdout.write(`version: ${options.expectVersion}\n`);
    }
    return 0;
  } finally {
    await Promise.all(
      [packDir, consumerDir]
        .filter((dir) => dir !== undefined)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`check:pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}
