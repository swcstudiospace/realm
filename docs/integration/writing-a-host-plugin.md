# Writing a Realm host plugin

This guide is for a contributor with this repository checked out who wants Realm to work with one more CLI agent. It gives the route in order: what you are adding, the evidence to gather first, the table row, the recipe, the manifest, the boot hook, the tests, the docs, how live evidence is gated, the Enterprise baseline and the pull request gates. It does not repeat the facts that already have a page: the manifest rules, the capability catalogue, the recipe engine, the refusals and the evidence limits are in [Host plugin contract and installer](host-plugin-contract.md); what each host supports and proves today is in the [Host support matrix](host-support-matrix.md); what is not proven is tracked in [Host plugin gaps](host-plugin-gaps.md).

Placeholders: ID is a host id, HOST is a host's product name and VERSION a version. Paths below are repository-relative; the temporary directories the tests use are created under the real path of `os.tmpdir()`.

## What a host is and what you are adding

A host is a CLI agent that Realm may run inside. The direction is fixed and is not reopened by a new host: the plugin loads into the CLI agent, the agent is the host process and Realm is the sandbox it attaches to. Realm never runs the host. The owner's other fixed decisions apply to every host: the Enterprise baseline only (the structured logger, redaction, least privilege and the hash-chained audit trail) and merge when CI is green.

There are two integration kinds, defined in the table of the contract page:

| Kind | What it means | Hosts today |
| --- | --- | --- |
| `extension` | the host loads a JavaScript entry in process | `omp` only |
| `mcp-config` | a user-level configuration entry makes the host launch `realm mcp --host ID` over stdio | the other 18 |

Most new hosts are `mcp-config` and config-only: one table row, one recipe that edits one entry in one user-level file, no new code. Adding a host means adding facts (a row, a recipe value, a registry record, a snippet, goldens) and the tests that hold those facts, not a new feature. A new recipe kind or a new engine behavior is a different change and is out of scope here.

## Gather evidence first

Decide from evidence, not from another tool's table. The tiers of fact used in Phases 24 and 25, and the way each is written in a snippet or a comment:

| Tag | Meaning |
| --- | --- |
| O | observed by running the host in an isolated `HOME` |
| D | the host's official documentation |
| S | another tool's source code (for example the GSD Core installer) |
| 3 | a third-party report |
| I | inference, written as INFERENCE and never presented as a fact |

Habits that paid off:

- Run the host from a scratch directory with an isolated `HOME` and the host's own override variables inside that directory. Put a stub `realm` on `PATH` that records its argv: a recorded `mcp --host ID` establishes "the host spawns the server" and nothing more.
- Use the host's own add command once to see the exact bytes it writes. The recipe value should equal that canonical output where it was observed, so a later rewrite by the host leaves the entry intact.
- Keep the machine inventory: version, file, entry shape, override variable, validator command, what the host does to the file when it rewrites it.

The ship-or-defer rule (decision D-25-02). A recipe ships only when the official documentation names the file and the entry shape and the shape was observed on a running host, or when at least two official pages agree and the file is plain JSON that holds MCP configuration only. A deferral is a legitimate outcome: leave `recipe` unset in the row, write the reason and the open question in a comment on the row and in [the deferred hosts page](../hosts/snippets/deferred-hosts.md), and the host keeps refusing `realm host install` as `recipe-pending` without changing any file. Three hosts are deferred today (`windsurf`, `trae`, `zcode`), each by owner decision.

Traps recorded in Phase 25:

- The homes that GSD Core lists are skills homes, not MCP homes. Confirm where the host reads MCP configuration.
- Use the host's own override variable, never GSD's. Names such as `CURSOR_CONFIG_DIR` are GSD-only and the hosts do not read them; the row checker rejects them.
- Hosts rewrite the shared file and normalize the entry. A recipe value that differs from the host's own canonical output reads as drift after the host's first write.
- A new file can hide an older one. When a host reads the first of several files that exist, use `shadows` so an install refuses to create the new file next to the old ones (CodeBuddy is the example).
- A host that edits with a comment-dropping editor orphans comment markers (Codex dropped one marker comment and kept the other). Ownership is by key, table or header, never by a comment.

## Step 1: the table row

Add the id to `HOST_IDS` in `src/host/types.ts` and a row to `HOST_RUNTIMES` in `src/host/runtimes.ts`. The table is a full record over `HOST_IDS`, so a missing row fails compilation. Each row is built with `entry()`, which freezes it at every level and checks `envBase` and `shadows`.

| Field | What it is |
| --- | --- |
| `flag` | the GSD Core installer flag: two dashes plus the id (the installer flags themselves are not accepted by `realm host`) |
| `aliases` | other names that resolve to the id; unique across the table and never equal to an id |
| `displayName` | the name shown to a person |
| `tier` | `reference`, `proven` or `config-only`: the project's classification of where end-to-end effort goes, not a statement of evidence |
| `homes` | relative paths below the user's home, POSIX separators, no `..`; a bare string is a `config` home; the roles are `config` (the host's configuration directory, a detection home), `skills` (a skills directory, a detection home) and `mcp` (the directory that holds the MCP file when it is not the config home; never a detection home) |
| `homeVerified` | whether a person confirmed the home on a machine with the host installed |
| `envOverride` | the host's own variable that moves the config and `mcp` homes; an absolute value replaces them and never a `skills` home |
| `envBase` | a variable that names a base directory, with the subdirectory the host uses (OpenCode and Kilo: `XDG_CONFIG_HOME` plus a subdirectory); never together with `envOverride` |
| `binaries` | executable names used to detect the host on an absolute `PATH` directory; leave empty when two products share a command name (`kimi` and `kimi-code`) |
| `recipe` | the install recipe, or none for a deferred host |
| `conflicts` | paths relative to the home whose presence means the host already loads Realm another way, so an install would load it twice |
| `shadows` | at most four paths that an older host version still reads and that a new recipe file would hide; each has a base of `home` or `config` |

A worked example for a fictional host, `acme-agent`. It is not in the table and is not a real product; the paths and the variable are invented. First the id in `src/host/types.ts`, then the row in `src/host/runtimes.ts`:

```ts
// src/host/types.ts: add "acme-agent" to the HOST_IDS list.

// src/host/runtimes.ts: a row of HOST_RUNTIMES.
// Evidence O1, O2 and D-1 (a comment names the notes that hold them): the file is mcp.json under the
// config home, the entry shape is the one `acme mcp add` writes, ACME_HOME moves the directory.
"acme-agent": entry("acme-agent", {
  flag: "--acme-agent",
  displayName: "Acme Agent",
  tier: "config-only",
  homes: [".acme"],
  envOverride: "ACME_HOME",
  binaries: ["acme"],
  recipe: {
    kind: "json-merge",
    file: "mcp.json",
    keyPath: ["mcpServers", "realm"],
    value: { command: "realm", args: ["mcp", "--host", "acme-agent"] },
  },
}),
```

What the new id picks up from the table without another edit: `realm host list|detect|status|install|uninstall`, `realm mcp --host ID` and `realm acp --host ID` (the flag accepts the canonical ids of the `mcp-config` hosts), the boot-report vocabulary and `defaultManifestFor`. Nothing else needs a list edit except the ones in Step 5.

## Step 2: choose the recipe

The engine supports five recipe kinds. The contract page has the full rules; the choice is this:

| Kind | What is written | Ownership | Drift rule |
| --- | --- | --- | --- |
| `json-merge` | one value at a key path in a JSON file | the canonical value at the key path, and any parent object Realm created | a changed owned value is drift; an edit elsewhere is not |
| `toml-table` | one TOML table, no marker | the table text, located by its exact header | a changed table is drift; an absent table is `missing` |
| `yaml-map` | one block-style entry `parent.child` in a YAML file, no marker | the entry, by key and by parsed value | a changed entry is drift; an absent entry is `missing` |
| `bundle-copy` | the files of a shipped `adapters` directory under a destination in the host home | every copied file and every directory Realm created | any changed or missing copied file is drift |
| `text-block` | a block between two marker comments | the text between the markers | a changed block is drift |

Decision order:

1. A plain JSON file with a top-level map of servers is a `json-merge` with a key path, and needs no engine work.
2. A TOML host uses `toml-table`; a block-style YAML host uses `yaml-map`.
3. A host that loads code in process uses `bundle-copy` (Omp is the only one).
4. `text-block` is the legacy kind; no table row uses it, and comment markers are not safe against hosts that rewrite the file.

Rules every recipe follows:

- The registered command is the bare `realm` and the arguments are the ones the manifest names, `mcp --host ID`; a test holds the recipe value equal to `defaultManifestFor(ID, VERSION).launch`. Never an absolute path.
- The value equals the host's own canonical output where it was observed.
- JSON with comments is refused, not merged: a JSONC-aware merge is deferred.
- One entry, owned by its parsed value. A host that reformats the entry but keeps the value leaves it `ok`.
- User-level files only. Nothing project-level is ever written.

Refusals a contributor will see when testing a recipe: `unparseable` (the file cannot be parsed safely), `foreign-content` (content Realm does not own is in the way), `symlink` (a symlink lies on the path), `concurrent-change` (the file changed while the operation ran) and `recipe-pending` (a deferred host). The full list of eleven reasons and their catalogue codes is on the contract page.

## Step 3: the manifest and capabilities

`defaultManifestFor(id, VERSION)` in `src/host/manifest.ts` builds the manifest the installer uses. An `mcp-config` host launches `realm mcp --host ID` and requests the six-capability ceiling: `daemon.attach`, `fs.read`, `fs.write`, `fs.list`, `exec.argv` and `exec.shell`. A capability is granted only when the policy admits it (`resolveCapabilities` in `src/host/capabilities.ts`, and the table on the contract page): the three `fs.*` capabilities need a workspace root and `exec.shell` needs the shell to be enabled. Request nothing outside the ceiling. `host.tools.restrict` and the boot block belong to `extension` hosts. `parseHostPluginManifest` is strict: an unknown key, a prototype key or a value outside the rules is refused with a fixed message. The row checker in `test/support/host-contract.ts` runs the default manifest of every row under three policies and fails on a request outside the ceiling or a grant the policy does not admit.

## Step 4: the boot hook

For an `mcp-config` host there is nothing to write. `bootHookOf(entry)` in `src/host/boot-driver.ts` returns the production driver for the row, and `realm mcp|acp --host ID` runs the six numbered steps of the contract page (resolve, ensure, up, readback, settle, expose). The driver is host-neutral; the manifest is the only thing that differs between hosts.

For an `extension` host, write a `HostBootHookFactory` (`src/host/types.ts`): take every bound from `resolveBoot` (`src/host/boot.ts`), arm every timer through the injected timers, never send `down` and close only your own client. Then run the conformance harness against it from a `node:test` file with `defineBootConformance` (`test/support/host-boot-conformance.ts`), which registers nine cases against fakes. Read the seeded-defect table in `test/host/boot-conformance.test.ts` to see what a failing hook looks like: each row there is a deliberately broken hook and the exact set of cases it must fail. The real Omp plugin runs through the harness in `test/omp/boot-conformance.test.ts`.

## Step 5: the tests

What you add:

- A recipe suite descriptor in `test/host/`: `defineHostRecipeSuite` (JSON), `defineHostTomlSuite` or `defineHostYamlSuite` from `test/support/host-recipe-suite.ts`. It is one call per host, or one descriptor table for several hosts as `test/host/wave2-json-recipes.test.ts` does. The suite registers the lifecycle, drift, concurrency, mode, doctor, override, symlink, hostile content and format cases on the real row.
- Goldens in `test/support/host-config-goldens.ts`, each tagged with its source and date: the host's own output, observed.
- The pins in `test/host/runtimes.test.ts`: the id list, the flag, tier, homes, override, binaries and the recipe-count split.
- The registry record in `test/support/host-registry.ts`: the recipe family, the suite files, the snippet, the live key, the dated T2 and T3 results (or none) and, for a deferral, the reason and the open question. The type is a full record over `HOST_IDS`, so a host without a record fails compilation.
- A live spec when the host's CLI can be run: an entry in `test/support/host-live.ts` (`HOST_LIVE`) and, for a config-only host, a row in `test/support/host-live-wave2.ts` run by `test/integration/host-live-wave2.test.ts`.

What picks the new row up automatically, by file:

| File | What it does for every row |
| --- | --- |
| `test/host/host-contract-matrix.test.ts` | runs the twelve static rules of `test/support/host-contract.ts` on the real row (frozen, identity, homes, environment, launch, manifest, capabilities, shadows, pending) |
| `test/host/host-lifecycle-matrix.test.ts` | runs the generic install and uninstall scenario on the real row: nothing written outside the home and the state directory, exact restoration, no planted secret in any sink |
| `test/host/host-registry.test.ts` | fails when a row has no record, a record disagrees with the table, a suite file lacks its define call or a snippet is missing |
| `test/docs/host-support-matrix.test.ts` | fails when the support matrix page differs from the table, the registry and the live specs |
| `test/host/boot-driver-conformance.test.ts` | runs the nine conformance cases against the production driver of every `mcp-config` row |
| `test/cli/stdio-host-matrix.test.ts` | the scripted boot matrix: every `mcp-config` id through `realm mcp` and `realm acp` on scripted daemons |
| `test/integration/host-boot-matrix.test.ts` | the real-daemon boot matrix: every `mcp-config` id against a real in-process daemon over fakes, no Podman |

All of these run on fixtures and fakes. They prove the contract, not a real host (GAP-26-01).

### If this fails, look here

| Failing test | Likely cause | Open |
| --- | --- | --- |
| `TEST-HOST-01 ID: the row satisfies the contract` | the message lists violation codes: `not-frozen`, `identity`, `home-unsafe`, `env-shape`, `home-resolution`, `recipe-kind`, `launch-unsafe`, `launch-mismatch`, `manifest`, `capability-grant`, `shadow-shape` or `pending-inert`; the row or its recipe value breaks that rule | `src/host/runtimes.ts`; the rule is in `test/support/host-contract.ts` |
| `TEST-HOST-02: the registry is complete and agrees with the table` | the message lists every problem: a missing record, a family that differs from the recipe kind, a suite file that does not exist or lacks the define call or the id literal, a missing snippet | `test/support/host-registry.ts` |
| `TEST-HOST-03 ID: the lifecycle contract holds on the real row` | the message lists lifecycle codes such as `outside-write`, `uninstall-not-restoring`, `audit-secret` or `log-secret`: the recipe or the adapter wrote outside the home, left a stray file, did not restore the bytes or let the planted marker reach a sink | the recipe in `src/host/runtimes.ts`; the engine in `src/host/install.ts` |
| the support matrix drift test | the page no longer equals the rendering of the table, the registry and the live specs | regenerate with the command in Step 6 |
| `boot driver (ID)` conformance cases | a driver or manifest change broke one of the nine cases for that host | `src/host/boot-driver.ts`; the case is in `test/support/host-boot-conformance.ts` |
| `TEST-HOST-05 ID` and `TEST-HOST-06 ID` | the boot of that id differs from the others: readiness, retry, failure isolation, teardown or a `down` request on a boot path | `src/cli/stdio-host.ts`; `test/host/boot-no-down.test.ts` pins that no boot source sends `down` |
| the recipe suite of the host | the golden, the entry value or the format rules disagree with what the engine writes | `test/support/host-config-goldens.ts`; the row in `src/host/runtimes.ts` |
| `test/host/runtimes.test.ts` | a pin differs from the row, or the 16 and 3 split changed | update the pin in that file when the change is intended |

## Step 6: the docs

Each host has a snippet under `docs/hosts/snippets/`. The layout of the Phase 24 and 25 snippets, which a new one follows (`docs/hosts/snippets/cursor.md` and `docs/hosts/snippets/claude-code.md` are the models):

1. Sources and dates: every claim tagged with its tier (O, D, S, 3 or INFERENCE), every URL with the date it was read.
2. Install with `realm host`: the four commands and what each prints.
3. What changes: the one file and the one entry, with the golden.
4. Manual registration and the host's own tools: how the host's own add and remove commands interact with the recipe.
5. Refusals and recovery.
6. Project-level configuration and shadowing: whether and how the host loads project-level configuration, with the warning that a workload can write one.
7. Evidence reached: the T1, T2 and T3 rows, each saying what was run, when and with which version, or `not run`.
8. Known limits.

No host-local path, secret or token goes into a snippet; placeholders are capital words. A deferred host gets a section in [the deferred hosts page](../hosts/snippets/deferred-hosts.md) with the reason, the evidence, the alternative recipe an owner could choose and the open question that would lift it.

Also add one line for the host in `docs/integration/hosts.md` (the list under the host plugin contract) and a row in the contract page's tables when the host's recipe changes what they state. Then regenerate the support matrix and commit the result:

```sh
npm run build
REALM_WRITE_HOST_MATRIX=1 node --test dist/test/docs/host-support-matrix.test.js
```

The write is refused when `CI` is set and touches only the text between the markers of `docs/integration/host-support-matrix.md`. Review the difference before you commit. If the host adds or closes a gap, update [Host plugin gaps](host-plugin-gaps.md) too.

## Evidence tiers and live rehearsal

The three tiers are defined on the [Host support matrix](host-support-matrix.md) page; this is what each may claim.

| Tier | May claim | May not claim |
| --- | --- | --- |
| T1, offline fixture | the recipe is correct against the host's observed output on a fixture host: lifecycle, drift, hostile content, restoration | that any real host reads what Realm writes |
| T2, host validator | the host's own command parses the entry, and for some hosts launches the registered argv, in an isolated `HOME` | that a Realm session runs, or that a newer version of the host behaves the same |
| T3, live session | a real session through the host against a Podman 5.x stack opened a workspace | anything about another host or version |

T3 is defined for the proven tier only; a config-only host has none by owner decision (OQ-25-09). Nothing runs a host CLI or Podman in CI.

The gate. A live file runs only when the host's opt-in variable is exactly `1`: `REALM_LIVE_ID=1` with the host id in capitals (`REALM_LIVE_CLAUDE`, `REALM_LIVE_QWEN`). An optional `REALM_ID_BIN` names the executable by absolute path. The production tier also needs `REALM_LIVE_PRODUCTION=1` and a Podman 5.x stack. `hostLiveSkipReason` in `test/support/host-live.ts` returns the first failing check, in this order: the opt-in variable, the platform (Linux), the executable, the version probe (a broken install fails here), the host's minimum version (`pi` below 1.3.0), the archived Kimi stub, the built CLI, and for the production tier the stack and the absence of a Realm receipt in the shared state directory. No test ever sets a gate variable; a skipped test is not a pass.

The isolation rules:

- An isolated `HOME` and the host's own override variables, all inside a temporary directory under the real path of `os.tmpdir()`; the environment passed to the host is an allowlist.
- A stub `realm` on `PATH` that records its argv (`writeStubRealm` and `readStubArgv`).
- The operator's real host files are hashed before and after and must be byte-equal.
- The host runs as the leader of its own process group with bounded output and is killed as a group on timeout.
- No model prompt and no credential is ever sent.
- Realm is never registered in a real host configuration without the owner's explicit approval, per host.

A cell says `not run` until a dated result is written into the registry (`test/support/host-registry.ts`) and the host's snippet. Record the date, the host version and the result, and keep the evidence outside the repository.

## Enterprise baseline checklist

Realm is held to the Enterprise baseline only. Before a host change is ready, each item holds and is backed by a test that already runs on the row:

- [ ] Logging: every operation logs through the structured logger to `host.log` in the state directory.
- [ ] Logging: event names come from the closed set (`host.install.plan`, `.applied`, `.refused`, `.audit_failed` and the uninstall equivalents) and carry no free text.
- [ ] Logging: the level comes from `REALM_LOG_LEVEL`; a default run writes nothing it did not write before.
- [ ] Redaction: receipts, audit lines, logs and boot reports carry ids, relative paths, byte counts and hashes only, never file content or a value read from a host configuration.
- [ ] Redaction: a planted marker in the seed never appears in any sink; the lifecycle matrix asserts it for every recipe.
- [ ] Redaction: no doc, golden or test holds a secret value or a host-local path.
- [ ] Least privilege: user-level files only, and nothing is written outside the resolved home and the state directory.
- [ ] Least privilege: the receipt and the log are mode 0600 and the state directory is 0700.
- [ ] Least privilege: a symlinked home or path is refused, and no project-level configuration is written.
- [ ] Least privilege: the manifest requests nothing outside the integration kind's capability ceiling.
- [ ] Audit: every applied install or uninstall adds two lines (an admission before any change and a result after) to the `host-plugins` chain.
- [ ] Audit: `realm audit verify` covers the chain; the boots of the stdio hosts are on the `host-boot` chain, written only by the daemon.

## The pull request checklist and gates

- [ ] The row in `src/host/types.ts` and `src/host/runtimes.ts`, with a comment naming the evidence.
- [ ] The recipe follows the rules of Step 2 and the default manifest passes the checker of Step 3.
- [ ] The recipe suite runs on the real row and the goldens carry source and date.
- [ ] The pins in `test/host/runtimes.test.ts` are updated.
- [ ] The registry record in `test/support/host-registry.ts`, with a dated result only where one exists.
- [ ] The live spec, when the host CLI can be run.
- [ ] The snippet, and the one line in `docs/integration/hosts.md`.
- [ ] The support matrix regenerated and the diff reviewed.
- [ ] [Host plugin gaps](host-plugin-gaps.md) updated if the host adds or closes a gap.
- [ ] Nothing claims live evidence the repository does not hold.

The commands to run (the table in `CONTRIBUTING.md` is the source): `npm run typecheck`; `npm run build`; the named files with `node --test dist/test/...` or `npm test`; `npm run test:integration`; `npm run test:scripts`; `npm run lint`; `npm run check:gates`; `npm run check:docs`; `npm run check:pack`; `npm run check:mcp`.

The CI jobs that run on the pull request (`.github/workflows/ci.yml`): typecheck, lint, unit tests, coverage floors, integration tests, script tests, check docs, gate closure, build, the packed package smoke, the MCP smoke, the docs site build and the dependency audit. Merge when CI is green (owner decision). Registering Realm in a live host configuration needs the owner's explicit approval per host.

## What never to do

- Never read `process.env` in `src/host`; the CLI edge fills `HostEnv` and the host layer takes it as a parameter.
- Never import `src/omp` from `src/host`; the host layer is host-neutral.
- Never send `down` from a boot path; `test/host/boot-no-down.test.ts` pins that no boot source names the method.
- Never write outside the resolved home and the state directory.
- Never use a comment marker as ownership; use a key, a table or a header.
- Never put a host-local path or a secret in a doc, a golden or a test.
- Never run a host CLI in a test that is not gated by its opt-in variable.
- Never turn a `not run` cell into a result without a dated run behind it.
