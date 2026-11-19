// The production tier of the two Phase 40 wave-2 hosts that 48-01 examined: Grok Build and Prime Agent (Phase 48, HTIER-03, HTIER-04, HTIER-01).
// The validator tier of every wave-2 host is test/integration/host-live-wave2.test.ts; this file holds only what runs on the production stack.
//
// Prime Agent has no credential-free drive (48-01 blocker B-48-02: an MCP server starts on first use from a model tool call, and none of its
// commands starts the registered server), so its production test is a skip with the fixed blocker sentence, never a drive that cannot run.
//
// Grok Build runs `grok mcp doctor` (with a per-run leader socket inside the scenario) against `realm mcp --host grok-build` on the production
// stack, cold, from a new project directory under the pinned workspace root. The registered `realm` is the wire recorder. Grok runs with HOME set
// to a scenario directory (its only relocation, 48-CONTEXT E-48-10); the recorder gives the real `realm mcp` the account's HOME. Three tests:
//   production   the plain tier: the recipe's config.toml table alone; the wire (handshake, tools/list, the six names, one start with the
//                arguments mcp --host grok-build) and the daemon (one attached boot report or the wire complete, an empty presence directory and
//                no live session afterwards) decide; the audit line is a diagnostic
//   attribution  both files: `realm host install grok-build` and `realm host install claude` in the same isolated home; the attach audit line,
//                the presence directory and the attached boot report must all name grok-build (HTIER-01, 48-01 Outcome A)
//   control      the Claude file alone: the same drive from another new project directory; the audit line, the presence directory and the boot
//                report name claude (the residual the documents state, shown rather than asserted in prose)
//
// Gate (no test ever sets a gate variable): REALM_LIVE_PRODUCTION=1 and the host's own opt-in REALM_LIVE_GROK_BUILD=1 (REALM_LIVE_PRIME_AGENT=1 for
// Prime Agent), the executable (REALM_GROK_BUILD_BIN or `grok` on PATH), the built CLI and the production prerequisites. The two tests that install
// the Claude file also skip while the shared state directory holds a Realm receipt for claude. REALM_LIVE_GROK_WARM=1 turns the two attribution
// tests into the warm diagnostic variant (the session is brought up before the host command); with it the label says so and it is never the
// production tier. No prompt is sent, no credential is forwarded and no value is printed. The operator's real ~/.grok/config.toml and
// ~/.claude.json are hashed before and after and must not change.
//
//   REALM_LIVE_PRODUCTION=1 REALM_LIVE_GROK_BUILD=1 REALM_LIVE_IMAGE=... REALM_LIVE_DRIVER_CONFIG=... REALM_DRIVER_SOCKET=... \
//     node --test --test-name-pattern "grok-build production" dist/test/integration/host-live-wave2-production.test.js

import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectHostLiveGate, gateBin, HOST_LIVE, hostVersionNote, runHostProduction } from "../support/host-live.js";
import { GROK_WARM_VARIABLE, grokProductionDrive } from "../support/host-live-production.js";
import { readLiveInputs } from "../support/production-live.js";
import { testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

const grok = await collectHostLiveGate("grok-build", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const prime = await collectHostLiveGate("prime-agent", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

// The label of a warm variant: the warm control is a diagnostic variant of the Kimi switch, never the production tier.
const WARM = process.env[GROK_WARM_VARIABLE] === "1";
const WARM_LABEL = WARM ? " [warm diagnostic variant]" : "";

// The operator's real Claude file, hashed beside Grok's own config: the attribution tests write the Claude file in their isolated home.
const realGrokFiles = (home: string): readonly string[] => [join(home, ".claude.json")];

// A real Claude receipt in the shared state directory: the tests that install the Claude file refuse to touch a real install. Read only after the
// gate has passed (the production inputs exist then).
function claudeReceiptReason(): string | false {
  const stateDir = readLiveInputs(process.env, CLI_PATH).driverStateDir;
  return stateDir !== undefined && existsSync(join(stateDir, "hosts", "claude.receipt.json"))
    ? "the shared state directory already holds a Realm host receipt for claude; refusing to touch a real install"
    : false;
}

void test("prime-agent production: blocked by B-48-02, no credential-free command starts the registered server", { skip: prime.skip, ...testTimeout(60_000) }, () => {
  // A closed gate never reaches this body: a host with a production gap always answers its gate with a skip reason. Reaching it means the
  // production tier was wired without a drive, which is the one thing this plan forbids.
  throw new Error(`prime-agent has no production drive (${String(HOST_LIVE["prime-agent"].productionGap)}); a body must not run`);
});

void test(
  `grok-build production: grok mcp doctor launches realm mcp --host grok-build on the production stack and lists the six tools${WARM_LABEL}`,
  { skip: grok.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("grok-build", grok));
    await runHostProduction(t, {
      host: "grok-build",
      bin: gateBin(grok),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".grok", "config.toml"),
      drive: grokProductionDrive(false),
      attribution: { installs: ["grok-build"], attributedTo: "grok-build", audit: "diagnostic", alsoReal: realGrokFiles },
    });
  },
);

void test(
  `grok-build production attribution: with realm in config.toml and in the Claude file the attach audit line, the presence directory and the boot report name grok-build${WARM_LABEL}`,
  { skip: grok.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("grok-build", grok));
    const refused = claudeReceiptReason();
    if (refused !== false) {
      t.skip(refused);
      return;
    }
    await runHostProduction(t, {
      host: "grok-build",
      bin: gateBin(grok),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".grok", "config.toml"),
      drive: grokProductionDrive(WARM),
      attribution: { installs: ["grok-build", "claude"], attributedTo: "grok-build", audit: "required", alsoReal: realGrokFiles },
    });
  },
);

void test(
  `grok-build production control: with the Claude file alone the attach audit line, the presence directory and the boot report name claude${WARM_LABEL}`,
  { skip: grok.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("grok-build", grok));
    const refused = claudeReceiptReason();
    if (refused !== false) {
      t.skip(refused);
      return;
    }
    await runHostProduction(t, {
      host: "grok-build",
      bin: gateBin(grok),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".grok", "config.toml"),
      drive: grokProductionDrive(WARM),
      attribution: { installs: ["claude"], attributedTo: "claude", audit: "required", alsoReal: realGrokFiles },
    });
  },
);
