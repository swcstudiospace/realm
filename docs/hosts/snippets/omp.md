# Omp snippet: Realm extension (live test and install)

Sources: `package.json`, `src/omp/extension.ts`, `src/cli/init.ts`,
`src/cli/main.ts` and `docs/integration/omp.md`. The isolated local-link
receipt below is historical (2026-10-30, Omp18.12.6). The separate actual
parent lifecycle capture is dated 2026-10-31 (Realm0.3.26, Podman5.7.1);
its normalized command/stdout transcript is in [README Quick start](../../../README.md#captured-lifecycle-transcript).
Neither receipt proves Omp containment or a registry installation.
Official pages: https://omp.sh/docs/extension-authoring,
https://omp.sh/docs/marketplace.

Omp loads Realm as an extension, not as an MCP server. The Omp wiring is
`src/omp/extension.ts`, built to `dist/src/omp/extension.js`. The package
declares it under the `omp` key in `package.json`:

```json
"omp": { "extensions": ["./dist/src/omp/extension.js"] }
```

This snippet carries no token, secret, or host path.

## Load the built extension for one session

Load the extension by absolute path, with no install. `REALM_CHECKOUT` means
the absolute path to the built checkout:

```bash
omp --no-extensions -e "$REALM_CHECKOUT/dist/src/omp/extension.js" --profile=realm-local
```

`-e` is repeatable. `--no-extensions` disables ambient extension discovery.
For the headless status capture, run in `--mode=rpc` or `--mode=rpc-ui`, which
carry the status item; print mode may not.

A named profile alone is not an isolated home. For a no-install rehearsal,
use the isolated `HOME`, `PI_CODING_AGENT_DIR` and `XDG_CONFIG_HOME` environment
below too. For actual runtime use, select the generated Realm config and
preconfigured gateway described under initialization instead.

## Install a built local checkout

Use Node.js 22.13.0 or newer and a checkout whose dependencies are installed
and whose `dist/src/omp/extension.js` is built. From that checkout, prepare it
with `npm ci` and `npm run build` if needed. `REALM_CHECKOUT` is its absolute
path, **not** the extension file. `OMP_HOME` is a fresh isolated directory:

```bash
REALM_CHECKOUT=/absolute/path/to/agent-realm
OMP_HOME=/absolute/path/to/isolated-omp-home
mkdir -p "$OMP_HOME" "$OMP_HOME/agent" "$OMP_HOME/config"
(
  export HOME="$OMP_HOME"
  export PI_CODING_AGENT_DIR="$OMP_HOME/agent"
  export XDG_CONFIG_HOME="$OMP_HOME/config"
  omp plugin install --dry-run "$REALM_CHECKOUT" --json
  # Review the dry run before proceeding.
  omp plugin install "$REALM_CHECKOUT"
  omp plugin list --json
)
```

These commands adapt the retained local-link procedure; they are not a new
successful install/load capture for the current package. The subshell leaves
the caller's home/config selection unchanged. A path install links the
checkout, so keep its directory, dependencies and build in place.
`--scope=user` is not needed: the record below shows Omp ignores it for local
links. Do not run this rehearsal against a real home by accident; a deliberate
persistent install needs the operator's configuration backup and approval.
Registry and marketplace installs remain unverified.

## Live install record (ONB-05)

Run on 2026-10-30 with Omp 18.12.6 (`omp --version`), under an isolated `HOME`,
so the real Omp home was not read or changed (its listing was compared before
and after). The package in this historical receipt was 0.3.24, not 0.3.26:

- `omp plugin install --dry-run <workspace>/agent-realm --json`: exit 0, action `link`, the package path reported.
- `omp plugin install <workspace>/agent-realm --scope=user`: exit 0, linked `agent-realm`. Omp printed that `--scope` applies only to marketplace installs and ignored it for a path.
- `omp plugin list --json`: one npm entry `agent-realm` 0.3.24, `enabled: true`, `extensions: ["./dist/src/omp/extension.js"]`.

This is a link to a local checkout, not a registry install. The published package and a marketplace install are not verified. The persistent install into the real `~/.omp` is still not run.

## Initialize Realm before launching Omp

`init` writes local templates; it does **not** provision the runtime stack.
Startup requires Linux with rootless Podman 5.x, cgroups v2 and its active
user API socket, plus the OpenShell CLI, a registered default gateway under
the selected `HOME`, working gateway trust, the Realm compute driver,
supervisor and a usable digest-pinned workload image. Gateway, driver,
supervisor and image provisioning remain external (TD-02); see
`docs/integration/openshell.md`. An isolated `HOME` also changes OpenShell's
gateway/profile lookup: an Omp plugin link alone does not configure it.

Use the image digest actually provisioned for the driver, not a tag or a
made-up digest. The separately running driver and Realm daemon must read the
**same physical `config.json`** using matching `HOME`/`XDG_CONFIG_HOME`, with
the same workspace and image. Sharing a config loader does not make two
service environments select the same file. Do not restart the driver
casually: its startup sweep is account-wide.

The [README quickstart](../../../README.md#initialize-and-start) defines
`REALM_CHECKOUT` (built checkout), `WORKSPACE` (existing account-owned project),
`STATE_DIR` (private Realm state) and `CONFIG_HOME` (XDG config base). All are
absolute operator-selected paths; these names normalize the private paths in
the parent capture. Keep state/config outside the workspace and keep
`STATE_DIR` short enough for its Unix socket. With the runtime account's
preconfigured `HOME` retained:

```bash
export XDG_CONFIG_HOME="$CONFIG_HOME"
REALM_IMAGE=localhost/realm-agentos@sha256:9511929b0b1a23120c30c04d2383317c7b8108ec8ee915e9a1538920e1c9596b
node "$REALM_CHECKOUT/dist/src/cli/main.js" init \
  --image "$REALM_IMAGE" --workspace "$WORKSPACE" --state-dir "$STATE_DIR"
# The separately configured matching driver must read this generated config.
node "$REALM_CHECKOUT/dist/src/cli/main.js" up --workspace "$WORKSPACE"
node "$REALM_CHECKOUT/dist/src/cli/main.js" status
node "$REALM_CHECKOUT/dist/src/cli/main.js" down
```

The image pin is the parent's actual local image, not a published download
or invented example. Substitute only a real provisioned matching digest.
The parent captured the no-argument `up` from the workspace directory; the
explicit workspace form above also works from another cwd by the CLI contract.
The temporary rebuilt driver used for that capture is not a released
installer/package provisioning guarantee.

The init templates keep `secretRoot` and `sandboxStateRoot` omitted: the
shared runtime loader derives `<stateDir>/secrets` and
`<stateDir>/sandboxes`. Init preflights those roots with `stateDir`, creates
missing private directories at 0700 and publishes the two templates at 0600
without overwriting existing files. Unsafe existing roots are refused, not
chmodded. Existing workspace and ancestor modes are preserved. On a write
failure, published templates are rolled back; any template whose removal
fails is named. Newly created private directories and their ancestors remain;
the private directories are reported for inspection before retrying, rather
than deleting potentially live state.

`up` selects `--workspace` or the **current working directory**, not the
`workspaceRoot` saved by init. Using `runuser` or setting `HOME` alone does
not enter the project. Either keep the explicit `--workspace` above, or
`cd "$WORKSPACE"` before running `up`. Start Omp from that same
project directory too. A wrong-cwd `POLICY_DENIED` is a workspace-pin refusal,
not evidence that the policy needs broader roots; do not weaken the
allowlist or pinning to work around it.

For doctor diagnostics, expose the real `REALM_DRIVER_SOCKET` and
`REALM_DRIVER_GATEWAY_ENDPOINT` in the caller/daemon environment. Those
diagnostics do not inspect a separately running service's environment;
exporting the variables does not provision a driver or gateway. The driver
also needs the remaining environment contract documented in the OpenShell
integration guide. In the actual 2026-10-31 parent capture, the matching rebuilt
driver and daemon used one freshly generated config, no legacy root variables
and no manual JSON edits: init reported `mode: fail-closed`; up/status reported
`snapshot.state: active`, reason `container running`; down reported
`snapshot.state: unbound`, reason `no workspace`, label `realm disconnected`.
Exactly one rootless container was active. Existing production scenarios 5/6
(crash/reap/reattach and actual MCP exec/write/read) passed 2/2 with 0 skips.
The original service was restored active, no containers remained, and the
owned temporary config was removed, with no permanent unit/package changes.
See README for the normalized exact stdout and timestamps. This supersedes
the old stale-image startup failure for this run, not all historical records.

## Doctor: preview before applying

Use the same generated config selection as the daemon:

```bash
node "$REALM_CHECKOUT/dist/src/cli/main.js" doctor
node "$REALM_CHECKOUT/dist/src/cli/main.js" doctor --fix --dry-run
# Review proposals, then apply only if appropriate.
node "$REALM_CHECKOUT/dist/src/cli/main.js" doctor --fix
node "$REALM_CHECKOUT/dist/src/cli/main.js" doctor --fix
```

`--dry-run` without `--fix` is a usage error. Fix mode needs a valid config,
works locally even when the daemon answers, and never starts a daemon.
It only creates or tightens `STATE_DIR`, `STATE_DIR/run` and
`STATE_DIR/sessions` to 0700; the parent directory must exist. It refuses
symlinks (including ancestors), foreign ownership, unreadable paths and unsafe
home/workspace targets. It does not provision or repair private driver roots,
the workspace, Podman, gateway or supervisor.

Configured-root failures need **manual recovery**, not another `realm init`:
init refuses an existing `config.json` or `policy.json`. Preserve both files
and all existing data. Look up the root **key** in the diagnostic in the same
physical config selected by the driver and daemon; diagnostics intentionally
do not print configured path values or turn them into shell commands.

- For an absent root, locate or restore the intended directory and its data
  from its known location or backup. Only if a private root is genuinely new,
  manually create the confirmed directory under the runtime account at 0700,
  after inspecting its ancestors for symlinks. Select an existing account-owned
  project for `workspaceRoot`; do not create or chmod a workspace via doctor.
- For an unreadable root, inspect the directory and ancestors as the runtime
  account, checking ownership and owner read/search access. Restore access only
  on confirmed directories that account owns; do not recursively chmod or
  change ownership.
- For a symlink or non-directory, leave the entry and data intact. Locate or
  restore the intended real directory, or correct only the root key if the
  config names the wrong location. Inspect without following symlinks.
- For a private-mode failure, confirm the intended non-symlink directory and
  ancestors and account ownership before manually setting only that private
  directory to 0700. This does not authorize workspace permission changes or
  ownership repair: an account-owned 0755 workspace is accepted.
- Omitted `secretRoot` and `sandboxStateRoot` keys use the defaults under
  `stateDir`. Healthy defaults produce a warning, not a failure: retain the
  omissions if intended, or explicitly name the intended private directories.
  A missing or unsafe default still fails and needs the manual recovery above.

Rerun doctor with the same config selection after recovery. `--fix` still
handles only state/run/sessions; it cannot repair or provision private roots
or a workspace, or change ownership. First-time setup without either template
is the case for `realm init`, not recovery of an already configured runtime.

Stdout reports `dryRun`, `fixes` and `checks`; stderr describes actions and
refusals. Dry-run changes nothing, an idempotent repeat reports `fixes: []`,
and a later failure reports already-applied actions. Inspect `checks` even
when exit 0: completed diagnostics are not necessarily healthy diagnostics.
The parent recorded 31 nonroot doctor tests passed with 0 skips and actual
CLI dry-run/apply/idempotence on 2026-10-31. Current documentation edits still
need parent docs checks.


## Policy mode

The extension follows the policy mode the daemon reports. The default is
`fail-closed` (decision D4): a policy file with no `mode` key, and a missing
policy file, both load as `fail-closed`. `advisory` is an explicit opt-in, set
with `"mode": "advisory"` in `<state-dir>/policy.json`
(`docs/policy-reference.md`).

- `fail-closed`: attaching removes Omp's built-in tools that are outside a
  fixed allowlist (`setActiveTools`, read back), such as `bash`, `edit` and
  `eval`, and Realm `write` replaces the built-in `write`. The guard refuses
  `bash` and `eval` unless the mode is advisory, and refuses host `edit` and
  Realm `write` while the realm is not active, with `REALM_NOT_ACTIVE` or the
  code of the realm's state. This is a guard, not containment: the spike
  recorded a `write` transport that survived removal of the built-in write, and
  the live check is pending (`docs/integration/omp.md`).
- `advisory`: the built-ins the plugin removed come back. While the realm is
  not active, host `edit` and Realm `write` proceed with a warning when the
  daemon is reachable; with the daemon unreachable, Realm `write` refuses with
  `REALM_NOT_ACTIVE`. This is not containment.

## Not documented

Omp's plugin manifest key names for an MCP server entry are not verified, so
this snippet gives none. Realm reaches Omp through the extension above, not
through an MCP entry. A local path install is a link to the checkout, as the live record above shows for Omp 18.12.6. A registry or marketplace install is not verified; use `--dry-run` first.
