# Omp snippet: Realm extension (live test and install)

Source: `docs/integration/omp.md` (read 2026-10-21). The live Omp session is not
yet observed; see the live verification status in that file. Official pages:
https://omp.sh/docs/extension-authoring, https://omp.sh/docs/marketplace.

Omp loads Realm as an extension, not as an MCP server. The Omp wiring is
`src/omp/extension.ts`, built to `dist/src/omp/extension.js`. The package
declares it under the `omp` key in `package.json`:

```json
"omp": { "extensions": ["./dist/src/omp/extension.js"] }
```

This snippet carries no token, secret, or host path.

## Load the built extension for one session

Load the extension by absolute path, with no install. Use an isolated profile
so no persistent Omp state changes:

```bash
omp -e /absolute/path/to/agent-realm/dist/src/omp/extension.js --profile=<name>
```

`-e` is repeatable. `--no-extensions` disables ambient extension discovery.
For the headless status capture, run in `--mode=rpc` or `--mode=rpc-ui`, which
carry the status item; print mode may not.

## Dry-run install check

Check the installable package without installing it:

```bash
omp plugin install --dry-run
```

The persistent install (`omp plugin install --scope=user`) is a separate step.
Run it only after the dry run passes and `~/.omp/agent/config.yml` has been
backed up. It is not part of this snippet.

## Live install record (ONB-05)

Run on 2026-10-30 with Omp 18.12.6 (`omp --version`), under an isolated HOME (`<tmp>`), so the real `~/.omp` was not read or changed (its listing was compared before and after).

- `omp plugin install --dry-run <workspace>/agent-realm --json`: exit 0, action `link`, the package path reported.
- `omp plugin install <workspace>/agent-realm --scope=user`: exit 0, linked `agent-realm`. Omp printed that `--scope` applies only to marketplace installs and ignored it for a path.
- `omp plugin list --json`: one npm entry `agent-realm` 0.3.24, `enabled: true`, `extensions: ["./dist/src/omp/extension.js"]`.

This is a link to a local checkout, not a registry install. The published package and a marketplace install are not verified. The persistent install into the real `~/.omp` is still not run.


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
through an MCP entry. Local install path semantics for `omp plugin install` are
not verified; use `--dry-run` first.
