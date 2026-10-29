// An isolated Omp profile for one live scenario (HARN-01; decisions D-1202, D-1203 of phase 12).
//
// One temporary root under os.tmpdir() holds everything a scenario touches, so nothing lands in the operator's home, their Omp
// profile or their Realm configuration:
//   <root>/agent    Omp's agent directory (PI_CODING_AGENT_DIR) with models.yml for the scripted provider
//   <root>/home     HOME, so Omp's own logs (~/.omp/logs) stay inside the root
//   <root>/config   XDG_CONFIG_HOME; with `realm` set it holds realm/config.json (mode 0600)
//   <root>/state    the Realm state directory (mode 0700); with `realm` set it holds policy.json (mode 0600)
//   <root>/ws       the workspace Omp runs in (its cwd), canonical
// The root prefix is the short `rlv-` so the control socket path <root>/state/run/control.sock stays under the 107-byte limit of a
// Unix socket path (the profile throws when it does not).
//
// Frozen interface (other units import exactly these names):
//   createOmpProfile({ providerPort, realm?, path? }): OmpProfile
//     providerPort  the port of the ScriptedProvider; models.yml names provider `stub`, model `scripted`, api openai-completions
//     realm         when given, also writes config/realm/config.json, state/policy.json (with the explicit mode) and state/
//     path          the PATH value for Omp (the caller passes its own PATH so bun and omp resolve); defaults to the system bin dirs
//   OmpProfile.env      exactly PATH, HOME, XDG_CONFIG_HOME, PI_CODING_AGENT_DIR (the daemon is in-process, so no driver roots)
//   OmpProfile.root, agentDir, home, configHome, stateDir, workspace, modelsPath, configPath, policyPath, socketPath
//   OmpProfile.dispose()  removes the root; safe to call twice
//
// Nothing here reads the process environment.

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlSocketPath } from "../../src/session/paths.js";

// The 107-byte limit of a Unix socket path (sun_path is 108 bytes with its terminator).
const SOCKET_PATH_LIMIT_BYTES = 107;

// A well-formed digest pin that no registry holds: the in-process daemon runs over fakes and never pulls it.
export const PROFILE_IMAGE = `localhost/realm-agentos@sha256:${"0".repeat(64)}`;

const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";

export type ProfilePolicyMode = "advisory" | "fail-closed";

export interface ProfileRealm {
  // Written explicitly into policy.json: never rely on the default.
  readonly mode: ProfilePolicyMode;
}

export interface OmpProfileOptions {
  readonly providerPort: number;
  readonly realm?: ProfileRealm;
  readonly path?: string;
}

export interface OmpProfile {
  readonly root: string;
  readonly agentDir: string;
  readonly home: string;
  readonly configHome: string;
  readonly stateDir: string;
  readonly workspace: string;
  readonly modelsPath: string;
  readonly configPath: string;
  readonly policyPath: string;
  // <stateDir>/run/control.sock: where the daemon listens and the extension dials.
  readonly socketPath: string;
  // The whole environment Omp is given.
  readonly env: Readonly<Record<string, string>>;
  dispose(): void;
}

// models.yml for the scripted provider: the prototype's file, with the port filled in.
export function modelsYaml(providerPort: number): string {
  return [
    "providers:",
    "  stub:",
    `    baseUrl: http://127.0.0.1:${String(providerPort)}/v1`,
    "    api: openai-completions",
    "    apiKey: dummy",
    "    models:",
    "      - id: scripted",
    "        name: Scripted",
    "        contextWindow: 32000",
    "        maxTokens: 4000",
    "",
  ].join("\n");
}

export function createOmpProfile(options: OmpProfileOptions): OmpProfile {
  const { providerPort } = options;
  if (!Number.isInteger(providerPort) || providerPort < 1 || providerPort > 65535) {
    throw new RangeError("providerPort must be an integer from 1 to 65535");
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  const dispose = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const agentDir = join(root, "agent");
    const home = join(root, "home");
    const configHome = join(root, "config");
    const stateDir = join(root, "state");
    const workspace = join(root, "ws");
    const socketPath = controlSocketPath(stateDir);
    if (Buffer.byteLength(socketPath) > SOCKET_PATH_LIMIT_BYTES) {
      throw new Error("the temporary root is too long for the control socket path; set TMPDIR to a shorter directory");
    }
    for (const dir of [agentDir, home, workspace]) {
      mkdirSync(dir);
    }
    const modelsPath = join(agentDir, "models.yml");
    writeFileSync(modelsPath, modelsYaml(providerPort));
    const configPath = join(configHome, "realm", "config.json");
    const policyPath = join(stateDir, "policy.json");
    if (options.realm !== undefined) {
      mkdirSync(join(configHome, "realm"), { recursive: true });
      mkdirSync(stateDir);
      chmodSync(stateDir, 0o700);
      writeFileSync(configPath, `${JSON.stringify({ image: PROFILE_IMAGE, stateDir, workspaceRoot: workspace })}\n`, { mode: 0o600 });
      chmodSync(configPath, 0o600);
      writeFileSync(policyPath, `${JSON.stringify({ workspaceRoots: [workspace], mode: options.realm.mode })}\n`, { mode: 0o600 });
      chmodSync(policyPath, 0o600);
    }
    return {
      root,
      agentDir,
      home,
      configHome,
      stateDir,
      workspace,
      modelsPath,
      configPath,
      policyPath,
      socketPath,
      env: { PATH: options.path ?? DEFAULT_PATH, HOME: home, XDG_CONFIG_HOME: configHome, PI_CODING_AGENT_DIR: agentDir },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
