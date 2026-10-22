# Phase 7 supply-chain review (QUAL-03)

Review date: 2026-10-22. Repository HEAD at review: `a0335c7`. Scope: the six direct dependencies in `package.json`, the lockfile integrity status of the full tree, and container image pinning. The repo builds no container image in this phase.

Verdict: no blocking supply-chain defect was found. Every direct dependency is exact-pinned, its lockfile integrity matches an independently recomputed tarball hash, its registry signature verifies, and the advisory audit is clean. Three items stay open or need a decision before the first release (section 7: S-1, S-4, S-5).

## 1. Method

- Manifest: `package.json` lines 8-10 (engines), 18-24 (devDependencies), 25-27 (dependencies).
- Lockfile: `package-lock.json`, `lockfileVersion` 3 (line 4), root entry lines 7-22.
- Registry metadata read for each direct dependency at `https://registry.npmjs.org/<name>/<version>` (licence, engines, `dist.integrity`, `dist.signatures`, `dist.attestations`).
- Each direct dependency's tarball was fetched from its lockfile `resolved` URL and hashed with SHA-512. The result was compared with the lockfile `integrity` field.
- `npm audit --package-lock-only --json` (advisories) and `npm audit signatures` (registry signatures and provenance attestations) were run. Neither modifies the tree.
- Not run: tests, typecheck, lint, build, and install.

## 2. Direct dependencies

Locked version is exact in both `package.json` and `package-lock.json`. Licence and engines come from the registry manifest. Integrity was recomputed from the tarball.

| Package | Section | Locked | Licence | Engines (registry) | Lock integrity | Registry signature | Provenance attestation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ajv` | dependencies (runtime) | 8.20.0 | MIT | none declared | matches recomputed SHA-512 | verified | none |
| `@types/node` | devDependencies | 22.20.5 | MIT | none declared | matches recomputed SHA-512 | verified | none |
| `@eslint/js` | devDependencies | 10.0.1 | MIT | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | matches recomputed SHA-512 | verified | none |
| `eslint` | devDependencies | 10.13.0 | MIT | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | matches recomputed SHA-512 | verified | none |
| `typescript` | devDependencies | 6.0.3 | Apache-2.0 | `>=14.17` | matches recomputed SHA-512 | verified | none |
| `typescript-eslint` | devDependencies | 8.72.0 | MIT | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | matches recomputed SHA-512 | verified | SLSA v1 provenance, verified |

Sources and lock citations:

- `ajv` 8.20.0: registry `https://registry.npmjs.org/ajv/8.20.0`; lock lines 550-554 (`license` line 554). Runtime, not `dev`. No `engines` field in the registry manifest.
- `@types/node` 22.20.5: registry `https://registry.npmjs.org/@types/node/22.20.5`; lock lines 287-296. No `engines` field in the registry manifest.
- `@eslint/js` 10.0.1: registry `https://registry.npmjs.org/@eslint/js/10.0.1`; lock lines 131-139.
- `eslint` 10.13.0: registry `https://registry.npmjs.org/eslint/10.13.0`; lock lines 656-661.
- `typescript` 6.0.3: registry `https://registry.npmjs.org/typescript/6.0.3`; lock lines 1312-1324.
- `typescript-eslint` 8.72.0: registry `https://registry.npmjs.org/typescript-eslint/8.72.0`; lock lines 1326-1331. Its registry `dist.attestations` names `https://slsa.dev/provenance/v1`.

The five devDependencies carry `"dev": true` in the lock. `ajv` is the only runtime dependency. The `npm audit` metadata counts 6 prod and 97 dev packages (102 total).

## 3. Lockfile integrity status

- Root entry matches `package.json`: `ajv` 8.20.0 under dependencies, the other five under devDependencies, `engines.node` `>=22` (lock lines 7-22).
- Resolved sources: 102 `resolved` entries, all on `registry.npmjs.org`. Zero non-registry sources.
- Integrity: 102 `integrity` fields, one per locked package.
- Install scripts: zero `hasInstallScript` flags in the lockfile.
- Direct dependencies: all six lockfile `integrity` values equal the SHA-512 recomputed from the fetched tarball. This was checked for each package.
- Registry signatures: `npm audit signatures` reports 102 verified registry signatures, 0 invalid, 0 missing.
- Provenance attestations: 31 verified across the tree. Among the direct dependencies, only `typescript-eslint` has one. The registry manifests for the other five show `dist.signatures` but no `dist.attestations`.
- Advisories: `npm audit` reports 0 across info, low, moderate, high, and critical for 102 packages.

Limits: transitive tarballs were not hashed by hand. Their integrity rests on the registry signature check and the lockfile. This is a point-in-time record for lockfile `a0335c7`.

Observation (informational): the registry manifest for `typescript` 6.0.3 includes publish-time `_from` and `_resolved` fields that point at a build-agent path, plus an `overrides` entry. Its `dist.integrity` matches the lockfile, so no action is needed.

## 4. Container image pinning

- Build status: this phase builds no container image. The repo has no `Dockerfile`, `Containerfile`, compose file, `.dockerignore`, or `.github/` workflow. Pinning of build images is therefore not applicable here.
- Runtime image references are digest-enforced at config load:
  - `src/runtime/config.ts:20` defines `IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/`.
  - `src/runtime/config.ts:80-84` (`requireImage`) rejects any value that fails the pattern. Tag-only references are refused at load (comment at `config.ts:11`, decision D-52).
  - `src/runtime/config.ts:3` states that Phase 3 supplies no default image. `src/runtime/hardening.ts:163-166` (`digestOf`) extracts the digest.
- Limits: the check is a shape check on the reference string. It does not confirm the digest exists in a registry, that the image is signed, or what the image contains. The character class has no `:`, so a registry host with a port is refused at load. This follows from reading the regex and was not exercised.

## 5. Anda licence conflict: OPEN

Source: `docs/integration/anda-decision.md` section 5 (lines 57-65), with the licence row at line 15. The decision records the conflict between `MIT OR Apache-2.0` metadata and MIT-only README text, under OQ-P3-11. Status is open. The note makes no legal determination.

Checks made in this review:

- `package.json` has no Anda dependency (lines 18-27).
- `package-lock.json` has no `anda` package entries.
- `src/anda/` holds `client.ts` and `shape.ts` only (directory listing). A search for `LICENSE-MIT`, `LICENSE-APACHE`, and `anda` in the manifest, lockfile, and `src/anda/` returned no vendored licence file.

The conflict remains open. It still blocks adding any Anda code, dependency, or vendored file, and this review does not resolve it.

## 6. Engines and runtime compatibility

- Project: `engines.node` is `>=22` (`package.json` lines 8-10).
- `eslint` 10.13.0 and `@eslint/js` 10.0.1 declare `^22.13.0` on the 22.x line. Node 22.0.0 through 22.12.x therefore satisfies the project range but not those packages' engines. npm reports this as a mismatch but does not block install unless `engine-strict` is set. Runtime behavior on those Node versions was not tested. See S-1.
- `typescript-eslint` 8.72.0 and `typescript` 6.0.3 are compatible with Node 22 and later.
- This review's run environment is Node v24.18.0 and npm 11.16.0.

## 7. Findings

- S-1 (Low, decision needed): project `engines` (`>=22`) is wider than `eslint` and `@eslint/js` support on 22.x (`^22.13.0`). Either raise the project floor to `>=22.13.0` or accept the gap and document it. No change made in this phase.
- S-2 (Info): only one of six direct dependencies (`typescript-eslint`) has a provenance attestation. The other five are registry-signed only. If the release gate requires provenance, these five would need an exception or an alternative.
- S-3 (Info): `eslint` requests `ajv` `^6.14.0` (lock line 676). That copy is in the dev tree and does not reach the runtime. The runtime `ajv` is 8.20.0.
- S-4 (Open, carried): Anda licence conflict, `docs/integration/anda-decision.md` section 5. Blocks any Anda code, dependency, or vendored file.
- S-5 (Open, release decision): the project's own licence is not declared. `package.json` has no `license` field (lines 1-28), and the repo root has no `LICENSE` file. QUAL-03 does not name this, but it is relevant to the release gate.
- S-6 (Info): no container image is built in this phase. Runtime enforces digest-only image references by regex (`src/runtime/config.ts:20`, `:80-84`). The check is shape-only. Build-image pinning becomes applicable when a Dockerfile or equivalent is added.
- S-7 (Info): the registry packument for `typescript` 6.0.3 contains a build-agent path in `_from` and `_resolved`. Integrity matches the lockfile.

## 8. Reproduce

- `npm audit --package-lock-only --json`
- `npm audit signatures`
- For each direct dependency: fetch the `resolved` URL from `package-lock.json`, compute SHA-512, compare with `integrity`.
- Registry manifests: `https://registry.npmjs.org/<name>/<version>`.
