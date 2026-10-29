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

## Not documented

Omp's plugin manifest key names for an MCP server entry are not verified, so
this snippet gives none. Realm reaches Omp through the extension above, not
through an MCP entry. Local install path semantics for `omp plugin install` are
not verified; use `--dry-run` first.
