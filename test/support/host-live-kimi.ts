// The Kimi pieces the shared live harness does not have (phase 43; 43-CONTEXT E-43-08, E-43-09, D-43-04 to D-43-07).
//
// Two products share the command name `kimi`: the legacy Python CLI (1.x, kimi-cli) and Kimi Code (2.x, @moonshot-ai/kimi-code). Kimi Code
// needs a key variable to define a provider at all, and it forwards its whole environment to a stdio server; the legacy CLI forwards only
// HOME and PATH. This module holds what the two live files need on top of host-live.ts and host-live-session.ts:
//   KIMI_REHEARSAL_KEY, KIMI_REHEARSAL_MODEL         the one fixed non-secret key and the model alias of a Kimi Code session drive
//   kimiCodeSessionArgs, kimiCodeDriveEnv            the Kimi Code argument list and the variables its session needs
//   kimiContainmentEnv                               the validator-tier containment: no update check, no telemetry, a dead proxy
//   KIMI_RESTORED_ENV                                the names the legacy command drive gives back to the realm server
//   credentialNamesOf                                the names in an environment that look like a credential, for the hermetic proof
//
// Nothing here reads the process environment or starts a process at import time. The hermetic test is
// test/integration/host-live-kimi-helpers.test.ts.

import { CODEX_FORWARDED_ENV, SESSION_PROMPT } from "./host-live-session.js";

// The one fixed literal a Kimi Code session drive uses as KIMI_MODEL_API_KEY. It is NOT a credential: it is a throwaway placeholder that
// opens no account, and it is never replaced by an operator value. The refusing loopback provider is the only endpoint it is ever sent to.
export const KIMI_REHEARSAL_KEY = "rehearsal-key-not-a-secret";

// The model alias of a Kimi Code session drive. No model by that name exists; the provider refuses every request.
export const KIMI_REHEARSAL_MODEL = "rehearsal-model";

// The argument list of Kimi Code for one non-interactive session: the single option `-p` and the fixed prompt. No other flag.
export function kimiCodeSessionArgs(): string[] {
  return ["-p", SESSION_PROMPT];
}

// The switches that stop Kimi Code from checking for updates and from sending telemetry.
const SWITCHES: Readonly<Record<string, string>> = Object.freeze({
  KIMI_DISABLE_TELEMETRY: "1",
  KIMI_CODE_NO_AUTO_UPDATE: "1",
  KIMI_CLI_NO_AUTO_UPDATE: "1",
});

// The variables a Kimi Code session needs on top of the isolated or production environment: a model name, the fixed key, the loopback
// provider as the base URL and an OpenAI-compatible provider type, plus the update and telemetry switches. It never sets KIMI_CODE_HOME
// (the rig or the runner owns that). `baseUrl` must be a loopback URL of the refusing provider.
export function kimiCodeDriveEnv(baseUrl: string): Readonly<Record<string, string>> {
  if (!baseUrl.startsWith("http://127.0.0.1:")) {
    throw new Error("the Kimi Code drive may only point at the loopback refusing provider (http://127.0.0.1:PORT/...)");
  }
  return Object.freeze({
    KIMI_MODEL_NAME: KIMI_REHEARSAL_MODEL,
    KIMI_MODEL_API_KEY: KIMI_REHEARSAL_KEY,
    KIMI_MODEL_BASE_URL: baseUrl,
    KIMI_MODEL_PROVIDER_TYPE: "openai",
    ...SWITCHES,
  });
}

// A loopback port nothing listens on: a connection through it is refused at once.
const DEAD_PROXY = "http://127.0.0.1:9";
const NO_PROXY = "127.0.0.1,localhost,::1";

// The containment of a validator-tier Kimi command (D-43-07): the update and telemetry switches and a proxy that goes nowhere, so a Kimi
// binary that contacts a Moonshot endpoint despite the switches is refused instead of connecting. Loopback stays direct (NO_PROXY), so
// the refusing provider is still reached. The production tiers do not use it: the production stack needs the network its sandbox uses.
export function kimiContainmentEnv(): Readonly<Record<string, string>> {
  return Object.freeze({
    ...SWITCHES,
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    all_proxy: DEAD_PROXY,
    NO_PROXY,
    no_proxy: NO_PROXY,
  });
}

// The names the legacy command drive restores: the same set as CODEX_FORWARDED_ENV (the daemon needs them to find the account's runtime
// directory and the compute driver), but for a different reason. Codex forwards them on request; the legacy Kimi CLI forwards HOME and
// PATH only (43-CONTEXT E-43-09), so the recorder gives them back to `realm mcp`.
export const KIMI_RESTORED_ENV: readonly string[] = CODEX_FORWARDED_ENV;

// The sorted names in `env` that look like a credential: a KIMI_ or MOONSHOT_ variable, or one that ends in _API_KEY or _TOKEN.
export function credentialNamesOf(env: Readonly<Record<string, string>>): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith("KIMI_") || name.startsWith("MOONSHOT_") || name.endsWith("_API_KEY") || name.endsWith("_TOKEN"))
    .sort();
}
