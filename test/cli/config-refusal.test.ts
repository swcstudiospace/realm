// The refusal a state-directory command prints when the realm config does not load (ONB-04 follow-up), driven through
// runCli with a real config file in a scratch XDG_CONFIG_HOME. Each refusal exits 2 with empty stdout, keeps the shipped
// sentence as its prefix, names the failing key or the file state, and points at realm doctor. No config value and no
// path is printed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const WORKSPACE = "/realm-test-workspace";
const SENTINEL = "SENTINEL-do-not-print";
const SHIPPED =
  "cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)";
const POINTER = "Run realm doctor for the full report.";

interface Command {
  readonly label: string;
  readonly argv: readonly string[];
}

const COMMANDS: readonly Command[] = [
  { label: "realm status", argv: ["status", "--workspace", WORKSPACE] },
  { label: "realm up", argv: ["up", "--workspace", WORKSPACE] },
  { label: "realm down", argv: ["down", "--workspace", WORKSPACE] },
  { label: "realm audit verify", argv: ["audit", "verify", "--session", SESSION] },
  { label: "realm audit verify", argv: ["audit", "verify"] },
  { label: "realm checkpoint", argv: ["checkpoint", "create", "--workspace", WORKSPACE, "--id", SESSION] },
];

interface Case {
  readonly name: string;
  // The text of realm/config.json, or undefined when the file is absent.
  readonly text: string | undefined;
  readonly reason: string;
}

const CASES: readonly Case[] = [
  {
    name: "an image that is not digest-pinned",
    text: JSON.stringify({ image: `${SENTINEL}:latest`, stateDir: "/realm-test-state", workspaceRoot: WORKSPACE }),
    reason: "image is absent or not a digest-pinned reference",
  },
  { name: "an absent config file", text: undefined, reason: "config.json is absent" },
  { name: "a config file that is not JSON", text: `${SENTINEL} {`, reason: "config.json is not a readable JSON file" },
];

// Runs the body with a scratch XDG_CONFIG_HOME, holding realm/config.json when text is given, and removes it after.
async function withConfigHome(text: string | undefined, body: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "realm-config-refusal-"));
  try {
    if (text !== undefined) {
      mkdirSync(join(home, "realm"));
      writeFileSync(join(home, "realm", "config.json"), text);
    }
    await body(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

for (const command of COMMANDS) {
  for (const kase of CASES) {
    void test(`${command.argv.join(" ")} refuses ${kase.name} and names the key`, async () => {
      await withConfigHome(kase.text, async (home) => {
        const result = await runCli(command.argv, { env: { XDG_CONFIG_HOME: home } });
        assert.equal(result.exitCode, 2);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, `${command.label}: ${SHIPPED}; ${kase.reason}. ${POINTER}\n`);
        assert.ok(!result.stderr.includes(home), "stderr names no path");
        assert.ok(!result.stderr.includes(SENTINEL), "stderr names no config value");
      });
    });
  }
}
