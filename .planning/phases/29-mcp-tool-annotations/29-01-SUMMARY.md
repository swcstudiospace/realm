---
phase: 29-mcp-tool-annotations
plan: "01"
subsystem: mcp-tool-annotations
tags: [mcp, tool-annotations, readOnlyHint, destructiveHint, idempotentHint, openWorldHint, pins, mutation-test]
requires: []
provides:
  - "src/mcp/protocol.ts: the McpToolAnnotations type (five required keys: title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint) and the McpToolDescriptor extended with title and annotations; the specification makes every key optional, Realm's type requires all five so a missing value is a compile error"
  - "src/mcp/server.ts: a static, frozen annotation table over the six tool names, with the hints-are-not-a-control comment, and MCP_TOOL_DESCRIPTORS built from it; the same descriptors answer tools/list in the legacy era (2025-11-25 and 2025-06-18) and the modern era (2026-07-28)"
  - "test/support/mcp-annotation-pins.ts: the independent pin table (ANNOTATION_PINS), HINT_KEYS, loadContract and annotationViolations(tools), the checker the wire, mutation and gate tests share; rules are derived from src/contract/tools.schema.json"
  - "test/mcp/annotations.test.ts: conformance to the pins and to the contract-derived rules, behavior honesty tests, and a generated mutation set of 93 mutants (as written in the test; not recounted by the closer)"
  - "test/mcp/descriptors.test.ts and test/mcp/server.test.ts: the descriptor shape, wire tests of tools/list in both eras, deep equality of the two eras' tool arrays, a mutated wire descriptor reported, and the hostile-argument test showing a read-only hint relaxes nothing"
affects: [src/mcp/protocol.ts, src/mcp/server.ts, test/support/mcp-annotation-pins.ts, test/mcp/annotations.test.ts, test/mcp/descriptors.test.ts, test/mcp/server.test.ts]
key-files:
  created:
    - test/support/mcp-annotation-pins.ts
    - test/mcp/annotations.test.ts
  modified:
    - src/mcp/protocol.ts
    - src/mcp/server.ts
    - test/mcp/descriptors.test.ts
    - test/mcp/server.test.ts
decisions:
  - "D-29-03 values: exec (readOnly false, destructive true, idempotent false, openWorld true); read, list, status (true, false, true, false); write (false, true, true, false); retry (false, false, true, false)"
  - "title is emitted at the top level and inside annotations, equal (OQ-29-03 default)"
  - "The table is static for the life of the process; where behavior depends on policy the broader value is stated, so a mistake costs an extra prompt and never skips a needed one"
  - "No src code reads an annotation; annotations are hints for a host that chooses to use them, never a security control"
requirements: [MCPA-01, MCPA-02]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 29 Plan 01: Annotate every Realm tool and pin the annotations in process Summary

Merged to main in PR 134 (squash `63f89c0`, plans 29-01 and 29-02 together). After this plan every one of the six descriptors in `MCP_TOOL_DESCRIPTORS` carries a top-level `title` and an `annotations` object with four explicit boolean hints, in both protocol eras, and a pin module, a contract-derived checker and a mutation test make a changed annotation fail a test.

## What shipped

- `src/mcp/protocol.ts`: `McpToolAnnotations` with the five required keys and the `title` and `annotations` fields on `McpToolDescriptor`. A comment records that the three served revisions (2025-06-18, 2025-11-25, 2026-07-28) share one ToolAnnotations shape.
- `src/mcp/server.ts`: a frozen table `TOOL_ANNOTATIONS` over `ToolName`, with the per-tool basis in a comment (exec runs an arbitrary workload with the workspace mounted read-write and policy may open egress; read and list return workspace data; write replaces the whole target and repeats leave the same file; status returns the controller snapshot; retry acts only on Realm's own session container). `MCP_TOOL_DESCRIPTORS` takes `title` and `annotations` from it. The comment states that no code in `src` reads the hints and names the real enforcement (the dispatcher's schema check, the shell gate, policy mode, the mutation gate, path locks, the sandbox). "Environment" excludes Realm's own audit and metric bookkeeping, otherwise no tool could be read-only.
- `test/support/mcp-annotation-pins.ts`: `ANNOTATION_PINS` as a separate literal; `annotationViolations(tools)` reports violations that name the tool. Rules are derived from the frozen contract: write is the only tool with a `content` property and is non-read-only and destructive; every path-only tool is read-only; exec is the only tool with `argv` and is destructive and open world; a read-only tool is non-destructive and idempotent; only exec is open world.
- `test/mcp/annotations.test.ts`: the exported descriptors conform to the pins and the rules; the pin table names exactly the six tools the frozen schema defines, in descriptor order; the derived rules read the contract, not a copy; a generated mutant set (flip, delete, rename, add, remove, swap, drop, add a tool) is asserted at 93 mutants and every mutant is reported with the mutated tool named; behavior honesty tests (read, list and status leave every workspace byte unchanged; write of the same path and content is idempotent; a repeated write with `ifMatchSha256` is refused and changes nothing; retry in `active` changes nothing and creates no container; retry in `error` is the only call that creates).
- `test/mcp/descriptors.test.ts`: each descriptor has `annotations` as a non-null object.
- `test/mcp/server.test.ts`: a legacy `tools/list`, a legacy 2025-11-25 session and a modern `tools/list` each carry the pinned title and annotations; both eras list identical tool objects; a mutated wire descriptor is reported; "a read-only hint relaxes nothing" (a hostile path argument is still refused over the wire).

## Observed

- Read of `origin/main` at `63f89c0` on 2026-11-17: the table in `src/mcp/server.ts` has the six rows with the D-29-03 values; `McpToolAnnotations` and the extended descriptor are in `src/mcp/protocol.ts`; the pin module exports `ANNOTATION_PINS`, `HINT_KEYS`, `ANNOTATION_KEYS`, `loadContract` and `annotationViolations`; `test/mcp/annotations.test.ts` contains `assert.equal(mutants.length, 93)`; the MCPA-01 and MCPA-02 test titles above exist in `test/mcp/server.test.ts` and `test/mcp/annotations.test.ts`.
- CI on PR 134 passed after one fix round (see Deviations).

## Not verified here

- No MCP client or host behavior with the hints was observed. What Claude Code, Grok Build, Omp or any other host does with the hints (auto-approve, prompt, plan mode, ignore) is host-dependent (OQ-29-05).
- The mutant count of 93 is the figure asserted in the test; the closer did not recount or re-run the generator.
- The tests were not run by the closer; the claim rests on CI of PR 134.
- The acceptance step "change one value in `src/mcp/server.ts`, rebuild, see the tests fail, revert" was a parent step of the plan; the closer did not repeat it.

## Deviations from plan

- None found in the plan 29-01 files. The one fix round of the pull request concerned plan 29-02 (the docs test file name; see its summary).
