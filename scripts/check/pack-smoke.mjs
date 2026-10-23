// Packed-package smoke test. Packs the package, installs the tarball into a
// throwaway consumer, loads every JSON schema through the shipped validator, and
// asserts that every host adapter manifest shipped in the tarball.
// The schemas are read at runtime from <package root>/src/..., so a tarball that
// omits them fails here with ENOENT. Run `npm run build` first; check:pack does not build.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALIDATOR = join("dist", "src", "contract", "validate.js");
const MAX_BUFFER = 16 * 1024 * 1024;

// Every host adapter manifest and MCP entry that the package must ship (paths relative to the package root).
export const ADAPTER_MANIFESTS = [
  "adapters/claude-plugin/.claude-plugin/plugin.json",
  "adapters/claude-plugin/.mcp.json",
  "adapters/muse-code/.muse-plugin/plugin.json",
  "adapters/hermes-agent/plugin.yaml",
  "adapters/prime-agent/package.json",
];

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

// Lists the adapter manifests absent under an installed package root.
export function missingAdapterManifests(packageRoot) {
  return ADAPTER_MANIFESTS.filter((path) => !existsSync(join(packageRoot, path)));
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

async function main() {
  const validatorPath = join(ROOT, VALIDATOR);
  if (!existsSync(validatorPath)) {
    throw new Error(`${VALIDATOR} is missing; run "npm run build" before check:pack`);
  }

  let packDir;
  let consumerDir;
  try {
    packDir = await mkdtemp(join(tmpdir(), "realm-pack-"));
    consumerDir = await mkdtemp(join(tmpdir(), "realm-consumer-"));

    const packed = await run("npm", buildPackArgs(packDir), { cwd: ROOT });
    const tarball = tarballFromPackOutput(packed.stdout, packDir);

    await writeFile(join(consumerDir, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
    await run("npm", buildInstallArgs(tarball), { cwd: consumerDir });

    const missing = missingAdapterManifests(join(consumerDir, "node_modules", "agent-realm"));
    if (missing.length > 0) {
      throw new Error(`packed package is missing adapter manifests: ${missing.join(", ")}`);
    }

    await writeFile(join(consumerDir, "probe.mjs"), PROBE_SOURCE);
    const probe = await run(process.execPath, ["probe.mjs"], { cwd: consumerDir });
    process.stdout.write(probe.stdout);
    process.stdout.write(`adapter manifests: ${ADAPTER_MANIFESTS.length} present\n`);
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
    process.exitCode = await main();
  } catch (error) {
    console.error(`check:pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}
