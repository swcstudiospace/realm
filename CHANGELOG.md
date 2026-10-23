# Changelog

This changelog follows Keep a Changelog 1.1.0, and the project follows Semantic Versioning. The release line rule is described in AGENTS.md under Versioning and release.

## [Unreleased]

### Added

- Host plugin adapter bundles: `adapters/claude-plugin` (shared by Claude Code and Grok Build), `adapters/muse-code`, `adapters/hermes-agent`, and `adapters/prime-agent`, each built from the host's documented shape. The host validators have not run on this host (blocked), so none is validator verified yet.
- Host snippets for Prime Agent (`docs/hosts/snippets/prime-agent.md`) and host tiers in `docs/integration/hosts.md`.
- Omp live verification notes in `docs/integration/omp.md`. The live Omp session is blocked on this host; only the isolated CLI status was observed (`disconnected`, `REALM_NOT_ACTIVE`).
- Opt-in devnet anchoring of one session's audit-log root: `realm anchor --session <id>` prints the anchor record with no network; `--publish` sends it to devnet as a Solana Memo, signed by the key file named in `REALM_ANCHOR_KEY_FILE`. Only the session id, line count, Merkle root, and time are published. Plan: `docs/integration/hardening-plan.md`.

### Changed

- Host snippets refreshed with paths and commands from the host notes; unverified manifest key names removed.
- README gains a Hosts section.
- Milestone v2.0 set in `release/milestone.json` (minor 2); the first release in this line is 0.2.0.
- Policy reference states that `advisory` stays the default and `fail-closed` is a per-project opt-in.

## [0.1.2] - 2026-10-22

### Changed
- Archive milestone v1.0 with its audit and deferred verification (#4) (58d2daa)

## [0.1.1] - 2026-10-22

### Changed
- Add the GitHub Pages docs site built from the repository markdown (#3) (118499c)

## [0.1.0] - 2026-10-22

### Added

- Strict ESM TypeScript package with typecheck, lint, test, and build scripts (FOUND-01).
- Frozen shared contracts: six-state machine, typed error catalogue, tool, session-record, and policy schemas, with schema rejection tests (FOUND-02).
- Integration notes under `docs/integration/`, each citing its official URL and read date (FOUND-03).
- State machine that rejects disallowed transitions, one display-label mapping ("realm active" or "realm disconnected") with reason and transition time, and a typed event bus (CORE-01, CORE-02, CORE-04).
- Policy engine with advisory mode as the default and a visible warning, and fail-closed mode as an opt-in per project (CORE-03).
- Mutation gate on state `active` with a bounded queue wait, and idempotent lifecycle operations (CORE-05, CORE-06).
- Filesystem lockdown: root-allowlisted canonical paths that reject escapes with `PATH_ESCAPE`, credential-path denial, advisory write locks with content-hash re-check, and atomic writes that report `WRITE_NOT_ATOMIC` (FS-01, FS-03, FS-04, FS-05).
- User-only control socket: directory 0700, socket 0600 (RT-06).
- Session record written before container creation (RT-07).
- Redacted JSONL audit log, and no host environment injected into the sandbox (AUD-01, AUD-02).
- `realm up` reports `PODMAN_MISSING` and exits promptly when Podman is absent; `realm doctor` lists each prerequisite with its fix (CLI-02, CLI-03).
- Six tools behind one schema, with every input validated before any sandbox call; argv-first exec, with shell mode gated by policy (TOOL-01, TOOL-02).
- Suite taxonomy with Podman-gated skips, and the policy reference and security and supply-chain reviews in `docs/policy-reference.md` (QUAL-02, QUAL-03).
- Silent-catch rule for the codebase, with a named list of exceptions (QUAL-01, amended 2026-10-22).
- Omp status as one item that carries the reason and transition time in its text (OMP-03, accepted approximation: the host has no tooltip API).

Open items, not part of 0.1.0:

- RT-04 (in-sandbox AgentOS runner) and CLI-01 (`realm up` reaching active) are deferred to a follow-up milestone.
- `realm up` fails closed with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver exists.
- Live verification is deferred to a host running Podman 5.x. The affected requirements are RT-01, RT-02, RT-03, RT-05, RT-08, RT-09, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02, OMP-04, OMP-05, CLI-04, ANDA-01, ANDA-02, ANDA-03, and ANDA-04.
- FS-02 (race-resistant path resolution) is a partial, accepted approximation that awaits confirmation.

### Changed

- Licence is AGPL-3.0-only (`LICENSE`, `NOTICE`).
- Release automation runs from CI: it computes the next version, syncs the version, generates the changelog and release notes, tags the release, and creates the GitHub release.
- Documentation is published as a GitHub Pages site.
