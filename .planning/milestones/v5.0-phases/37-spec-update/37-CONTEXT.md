# Phase 37: Spec update - Context

**Gathered:** 2026-11-18, from a full read of `docs/specs/realm-spec.xml` (513 lines, 79289 bytes, at the v5.0 milestone start commit 2159258), the v5.0 section of `.planning/REQUIREMENTS.md` (SPEC-01), the Phase 37 block of `.planning/ROADMAP.md`, `.planning/MILESTONE-CONTEXT.md` (D-v5-6), `AGENTS.md` (the spec rule), `docs/integration/runtime-decision.md` (the Phase 27 section "Anda bridge removal"), `docs/integration/anda-replacement-research.md`, the v4.0 records `.planning/milestones/v4.0-phases/27-anda-disposition-and-v4-0-requirement-closure/27-CONTEXT.md` (E-27-09, OQ-27-02, R-27-02) and `.planning/milestones/v4.0-phases/28-remove-the-anda-bridge/28-CONTEXT.md` (D-28-10, OQ-28-01), the git history of the spec file, and the code that the spec's contract lines describe (`src/core/states.ts`, `src/core/errors.ts`, `src/runtime/config.ts`).
**Status:** Planned (one plan, nothing executed). SPEC-01 is already registered in `.planning/REQUIREMENTS.md`. This phase does not edit ROADMAP, STATE, REQUIREMENTS or PROJECT; the orchestrator does (section "Tracker hand-off").
**Precondition:** none from Phases 33 to 36 (the roadmap says 36 and 37 are independent of 33 to 35 and of each other). The Phase 28 removal is on the branch (it is: `src/anda/` is gone, `src/core/states.ts` has five states). Phase 37 depends on Phase 32 only through the roadmap order.

<domain>
## Phase Boundary

`docs/specs/realm-spec.xml` stops describing the Anda bridge. The statements that require the bridge for `active`, require the `degraded` state, list the two `ANDA_` error codes, or define a bridge section are removed or rewritten. The planning-history content of the spec (the Graph of Thought nodes and the issue list) that discusses the bridge is kept as history and marked retired. Everything else in the spec stays byte-identical.

This is an **owner-directed edit of the authoritative spec**. The authority is the owner's HITL decision **D-v5-6 of 2026-11-18**, taken at the v5.0 milestone start (`.planning/MILESTONE-CONTEXT.md`). `AGENTS.md` (Conventions, spec bullet) allows it: "An owner-directed edit is allowed when the owner asks for it, and the pull request must record the owner's instruction and the reason." The pull request body must therefore state the instruction (date, decision id, the words of the instruction) and the reason (D-27-01 removed the bridge in v4.0 and the spec was the one record still requiring it). Plan 37-01 carries the exact body text.

### What changes, in one paragraph

Of the 60 lines that name Anda (101 mentions), 1 line stays verbatim (the owner's original request, line 2); 24 lines are deleted, rewritten or tombstoned (the layer stack, the scope item, the bridge section, the state definitions, the failure rule, the workflow step, the assumption and the open question, plus the "fixed requirements" statements of node n1 and the frozen contracts of node n6, including the error code list); 35 lines are kept as history under a `retired` marker (nodes n2, n3, n4, n7, n8 and 10 issue titles). The `degraded` state disappears from the spec; the state count goes from six to five in the statements that enumerate the states. 43 old lines are touched in total (the 24, the 15 marked start tags and issue lines, and 4 lines that name no Anda but list the states); 7 of them are deleted outright.

### Out of scope, stated so no task drifts into it

- No edit of any statement that is not about the bridge or a dependent of the bridge. In particular the default-mode statements annotated under owner decision D4 (old lines 189, 200, 256, 267, 328, 365, 376, 480, 483) are not touched, and line 227 keeps its D4 annotation.
- No edit of line 2 (the verbatim original request, a CDATA block) and no change to any tracker identifier, tracker URL or Notion URL in the issue list.
- No renumbering of any numbered list (tombstones keep the numbers, D-37-04).
- No code, schema, test, script, workflow, `CHANGELOG.md`, version field, `LICENSE`, `NOTICE`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` or `.planning/PROJECT.md` edit by the executor of this phase.
- No new repository test or check script that parses the spec (D-37-09).
- No live window. This phase is documentation only; the owner's authorization of 2026-11-18 for live windows is not used.
- No edit of `docs/policy-reference.md` line 78 (it concerns the D4 default-mode line, which this phase leaves alone), `AGENTS.md` (its line 113 already records the removal) or `docs/integration/anda-decision.md` (its notice does not mention the spec).
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-18, tier)

Tiers: **Observed** = read in this worktree today; **Measured** = a command was run today and its output read; **[INFERENCE]** = reasoning from those.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-37-01 | The spec is one well-formed XML document with root BUILD_PROMPT: `xmllint --noout docs/specs/realm-spec.xml` exits 0 and `python3` `xml.etree.ElementTree.parse` accepts it. Node 24 has no built-in XML parser and the repository has no XML dependency, so the Node-based check is a line scan, not a parse. | commands run | Measured |
| E-37-02 | Structure: ORIGINAL (line 2, a CDATA block of 2507 characters, the owner's verbatim request), SYSTEM_ROLE, APP_CONTEXT (LAYER_STACK at 21 to 24), SCOPE, CONSTRAINTS, PLATFORM_CONSTRAINTS, REALM_SANDBOX (lines 69 to 91), OMP_PLUGIN, HOST_INTEGRATIONS, STATES (117 to 124), SECURITY_AND_VALIDATION, GRACEFUL_DEGRADATION (130 to 142), WORKFLOW (144 to 154), ACCEPTANCE_CRITERIA, OUT_OF_SCOPE, ASSUMPTIONS (186 to 193), AMBIGUITIES (195 to 205); then GRAPH_OF_THOUGHT (207 to 402: nodes n1, n2, n3, n5, n4, n6, n7, n8 and a WORKFLOW of waves), ISSUES (403 to 476, tracker mirror with SPE identifiers and Linear and Notion URLs) and CLARIFICATIONS (478 to 512, no Anda text). | file read | Observed |
| E-37-03 | A case-sensitive scan for `Anda`, `anda` not preceded by a letter, and `ANDA` finds **101 mentions on 60 lines** (script in "Acceptance scripts"). A case-insensitive grep finds 63 lines because it also matches "standalone" (lines 12, 36, 208), which is not a mention. The earlier estimate of "about 52" is superseded by 101 mentions. | script run | Measured |
| E-37-04 | The spec never contains the key `andaUrl` (0 matches, any case). The roadmap and requirement wording "requires `andaUrl`" is read as: the spec requires the bridge, and the bridge is what `andaUrl` configured. The two `ANDA_` codes are on line 325 only. | `grep -c -i andaUrl` | Measured |
| E-37-05 | `degraded` (lower case, the state) occurs on lines 121, 139, 215, 315, 318 and 324 only. The uppercase section name GRACEFUL_DEGRADATION (lines 101, 130, 142, 319) is a different thing: it names the section about failure handling and stays. "six states" and "six-state" occur on lines 210, 212 and 216 (the state count). "six tools" (320, 454), "Six doc gates" (341) and "six documentation gates" (357) are unrelated counts. | scan | Measured |
| E-37-06 | The code already matches the post-edit spec: `src/core/states.ts` has five states and a frozen 9-edge table (unbound to connecting; connecting to active, error, stopping; active to error, stopping; error to connecting, stopping; stopping to unbound), `src/core/errors.ts` has no `ANDA_` code, and `src/runtime/config.ts` carries only the retired-key refusal for `andaUrl`. The spec edit therefore describes existing behaviour; no code changes. | files read; grep of `src` for Anda finds only that refusal and unrelated words | Observed |
| E-37-07 | No test, script or workflow parses or reads the spec. The only reference is a synthetic fixture string in `scripts/check/default-mode.test.mjs` (line 173, a file map passed to a pure function) and the exclusion `EXCLUDED_DIRECTORIES = ["docs/specs"]` in `scripts/check/default-mode.mjs` (the spec is not scanned for advisory-default claims, because D4 annotates its old lines). `scripts/check/host-paths.mjs` scans `.xml` files under `docs` and `.planning` for host-local path patterns and passes on the spec today. `scripts/docs/sync-site.mjs` copies Markdown only. | grep of `test`, `scripts`, `src`, `.github`, `site` | Measured |
| E-37-08 | Docs that quote the spec's Anda statements: `docs/integration/runtime-decision.md` line 636 (the supersession-table row "Not edited (OQ-27-02); read as superseded by this section") and line 642 (R-27-02: "the product spec still names the bridge and `degraded` until the owner directs an edit"); `docs/integration/anda-replacement-research.md` lines 22, 42, 296, 304, 306 and 336 (research observations dated 2026-11-17 about the spec). `AGENTS.md` lines 85 and 163 name the spec and its edit rule but say nothing about Anda in it. `docs/policy-reference.md` line 78 concerns the D4 default-mode line only. | grep | Measured |
| E-37-09 | Precedent for spec edits: commits 237048c and fc07976 (owner instruction 2026-11-13, DEF-02) annotated historical default-mode lines as superseded by D4 and stated "Historical planning content is annotated, not rewritten"; commit 78ea260 (owner decision 2026-11-15) added an error code to the frozen list in node n6 (line 325). Commit subjects use the scope `docs(spec)`. The recorded instruction and reason sit in the commit body. | `git log -- docs/specs/realm-spec.xml` | Observed |
| E-37-10 | Phase 27 recorded E-27-09 (the spec lines naming Anda), asked the owner (OQ-27-02, default "no edit") and listed the spec passages as superseded by D-27-01 in `runtime-decision.md`. Phase 28 repeated the question (OQ-28-01, default "no edit"). The owner answered on 2026-11-18 with D-v5-6. | v4.0 records | Observed |

### D-37-01. Every Anda mention gets exactly one disposition

Five classes, used in the mapping table below:

| Class | Meaning |
| --- | --- |
| **V** | Verbatim. Kept byte for byte. Only line 2 (the owner's original request). |
| **D** | Delete the line or the element. Used where the Anda text is an unnumbered, stand-alone line or element. |
| **R** | Rewrite. Cut the Anda clause or item from a sentence and keep the rest of the statement unchanged; where a statement counted the states, the count goes from six to five. |
| **T** | Tombstone. The line is a numbered list item whose whole content is about the bridge. It is replaced by one line that keeps the number and says it was retired by D-27-01, so no other item is renumbered. |
| **H** | History kept, marked retired. The line stays unchanged inside an element that carries a `retired` attribute (D-37-05). |

### D-37-02. Live statements are removed or rewritten, not annotated

Anything a builder could read as a current requirement is edited: the layer stack (22, 23), the scope item (32), the bridge section (79 to 81), the state definitions (120, 121), the failure rule (139), the workflow step (149), the assumption (192), the ambiguity (199), the "fixed requirements" of node n1 (210 to 227) and the frozen contracts of node n6 (315, 317, 318, 324, 325). Reason: the owner's instruction is that the spec stops describing the bridge and stops requiring `degraded`; the D4 precedent of annotating applies to superseded statements that remain true as history, not to a requirement the product no longer has. Node n1 and node n6 are edited rather than marked because they are the statements the Phase 2 code was derived from (`states.ts`, `errors.ts`); an annotated copy would leave a six-state table and two dead codes in the contract node.

### D-37-03. The six to five state count is part of the retirement

Removing `degraded` makes "the six-state machine", "the six states" and "unbound, connecting, active, degraded, error and stopping" false. Lines 210, 212, 216, 315, 318 and 324 change the count and the list. The edit table (below) changes nothing else in those lines. The transition table on line 324 is rewritten to the 9 edges that `src/core/states.ts` freezes. [INFERENCE] The owner's phrase "the statements that require the degraded state are removed or retired" covers these: each of them lists `degraded` as a required state.

### D-37-04. Tombstones keep numbering

Lines 32 (scope item 3), 149 (workflow step 5) and 215 (n1 rationale step 4) are numbered items whose content is only about the bridge. Deleting them would renumber later items, which changes statements the owner did not ask to change ("all other spec content stays"). Each becomes one line that keeps its number and its indentation and says it was retired by D-27-01 on 2026-11-17. No other list is renumbered.

### D-37-05. Planning history is kept and marked with a `retired` attribute

The Graph of Thought nodes n2 (module split), n3 (blocking unknowns), n4 (option comparison), n7 (documentation gates) and n8 (waves and asks) are the recorded output of the planning run that produced the spec. Their Anda content (46 mentions on 25 lines) is an analysis of the bridge, a recommendation for its boundary, a doc gate for it and a wave that builds it. Removing it would delete numbered steps (renumbering), would split questions that label options (a), (b), (c), and would change records that the ISSUES list mirrors. The D4 precedent (E-37-09) is to annotate historical planning content. So each of those five NODE start tags gains the attribute below; the text stays. The ISSUES list is a mirror of Linear and Notion issues: 10 issue lines carry Anda in a title or in a URL slug, and a URL, an identifier or a title in the tracker cannot be changed from here; each of those 10 SUBISSUE lines gains the same attribute and nothing else changes.

The attribute text (one constant, used 15 times, all on lines the table marks H and touching no existing attribute):

```
retired="Statements about the Anda bridge in this element are history: the bridge was removed by owner decision D-27-01 (2026-11-17); spec edit instructed 2026-11-18"
```

The attribute is inserted after the `notionUrl` attribute, before the closing greater-than sign of the start tag. Reading rule, stated once in the ASSUMPTIONS statement (D-37-06): statements about Anda in the original request, and in any element carrying `retired`, are history, not requirements.

Alternative considered and not taken: delete or rewrite all of n2, n3, n4, n7, n8 and ISSUES. It would remove 64 more mentions but needs renumbering of at least seven rationale lists, relabelling the option letters of n4, changing the "Six doc gates" counts of n7 and n8 and the wave list, and it would make the spec disagree with the tracker mirror. It also contradicts "all other statements are unchanged" more than a marker does. OQ-37-01 records the choice for the owner; the default stands unless the owner says otherwise.

### D-37-06. One retirement statement in ASSUMPTIONS, replacing the Anda assumption

Line 192 says "The Anda boundary is decided by the documentation spike, not by this spec." It is the spec's own statement about the bridge boundary and the natural place for the retirement. It is replaced by one line (the text is in the edit table). It names the decision (D-27-01, 2026-11-17), the instruction (2026-11-18), states the five states, and gives the reading rule for the history. It does not mention `degraded` or `andaUrl`, so that a search of the spec for those two finds nothing.

### D-37-07. Documents that quote the spec

Per the Phase 28 convention ("dated records keep their text and gain a marker sentence"):

1. `docs/integration/runtime-decision.md`: append "Superseded on 2026-11-18: edited by Phase 37 (D-37-1)." to the table row on line 636; append "Closed on 2026-11-18 by D-37-1: the spec was edited." to R-27-02 on line 642; add one paragraph **D-37-1** after the "Accepted residuals" paragraph, still inside the Phase 27 section (a tail section would collide with the sections that Phases 33 to 35 append; this edit touches lines 636 to 643 only).
2. `docs/integration/anda-replacement-research.md`: append one marker sentence to its Status paragraph (line 3) saying the spec edit that its risk table lists as an option was made on 2026-11-18 and that its observations about the spec describe the spec as read on 2026-11-17. Its evidence text stays unchanged.

The exact texts are in "Document edits".

### D-37-08. Commit shape

Two commits, both documentation, neither a breaking change (no `!`):

1. `docs(spec): retire the Anda bridge statements on the owner's instruction`. Body: the instruction (2026-11-18, D-v5-6, HITL), the reason, the counts, `Refs: SPEC-01`. Touches only `docs/specs/realm-spec.xml`.
2. `docs(integration): record the Phase 37 spec edit in the decision notes`. Touches the two documents of D-37-07.

[INFERENCE] A squash merge makes the pull request title the notes entry; it is `docs(spec): drop the Anda bridge from the product spec`.

### D-37-09. Verification is one-off, not a new repository test

Acceptance is three commands and two scripts (section "Acceptance scripts"), run by the executor and pasted into the summary: `xmllint --noout`, an `xml.etree` parse as the second opinion, a changed-line-set check against the base commit, a residual-mention check, and an identifier-preservation check. No permanent test or `scripts/check` file is added: the repository has no XML parser dependency (E-37-01) and the `AGENTS.md` rule is no source-text tests; a new dependency needs the justification, licence and maintenance checks of `CONTRIBUTING.md` for a file the owner controls and that changes about once a milestone. The existing guards that touch the files edited (`npm run check:docs`, `npm run test:scripts`, the docs tests) are run unchanged.

### D-37-10. Hygiene constraints for the plan

No host-local absolute path in any committed text (the spec's own `~/src/repos/agent-realm/` strings stay; they are not a host-local path under `host-paths.mjs`). No advisory-default claim in the edited Markdown (the default-mode guard scans `docs/integration`). New text in Markdown avoids raw angle tokens outside code. Tabs in the spec are preserved: the count of lines containing a tab character is 161 before and must be 161 after, because the 15 marked start tags and all edited n1 and n6 lines keep their leading tabs and no deleted line has one.

### Threat model (summary; the plan carries the STRIDE rows)

Assets: the integrity of the authoritative spec (the fail-closed statements above all), the record that the owner directed the edit, the tracker mirror, and the accuracy of the notes that quote the spec.

| Actor or event | Risk | Handling |
| --- | --- | --- |
| An over-broad edit deletes a fail-closed, default-mode or security statement | The authoritative spec loses content the owner did not ask to change | The changed-line set must equal the 43 listed old lines exactly; the D4 lines are not in the set; shortstat is 36 insertions and 43 deletions |
| The instruction is not recorded | The edit is unauthorised by `AGENTS.md` | Commit body, pull request body and D-37-1 all carry instruction and reason |
| A malformed edit breaks the XML | Any future consumer of the spec fails | `xmllint` and `ElementTree`; tabs and entity count checks |
| Tracker identifiers or URLs altered | The mirror points at the wrong issue | Identifier and URL lists compared with the base commit |
| Other documents still say the spec names the bridge | Readers believe the spec and the code disagree | D-37-07 markers; a closing search |
| Rebase conflict with Phases 33 to 36 on `runtime-decision.md` | A lost or doubled edit | The edit touches lines 636 to 643 only; re-read before editing |

## Mapping of every Anda mention (101 mentions, 60 lines)

Line numbers are those of the file at commit 2159258 (the v5.0 milestone start). The plan's first step re-runs the scan and stops if the numbers differ. "Count" is the number of mentions on the line.

### Verbatim

| Line | Count | Where | Class | Note |
| --- | --- | --- | --- | --- |
| 2 | 6 | ORIGINAL, the owner's original request (CDATA) | V | The request as the owner wrote it: it names the Anda repository, "Anda Engine" and the idea that Rust might be needed. A verbatim record of the request is not rewritten. Covered by the reading rule in the ASSUMPTIONS line. |

### Normative sections (D-37-02)

| Line | Count | Element | Class | Action |
| --- | --- | --- | --- | --- |
| 5 | 1 | SYSTEM_ROLE | R | Drop Anda from the list of dependencies whose docs must be read first. |
| 22 | 1 | LAYER_STACK | R | The stack ends at AgentOS running on OpenShell. |
| 23 | 2 | LAYER_STACK | D | Delete the line ("Anda is primarily Rust ... Add Rust only where no TypeScript boundary exists"). |
| 32 | 2 | IN_SCOPE_NOW item 3 | T | Tombstone, number 3 kept. |
| 79 | 1 | opening tag of the Anda bridge section in REALM_SANDBOX | D | Delete the three lines 79 to 81 (the whole section). |
| 80 | 2 | the section body (version handshake, reconnection, Rust shim) | D | Same deletion. |
| 81 | 1 | closing tag of the section | D | Same deletion. |
| 120 | 1 | STATE active | R | "Container, OpenShell, and AgentOS are healthy." |
| 121 | 1 | STATE degraded | D | Delete the line (this is also the `degraded` state). |
| 139 | 1 | FAILURE_CASES | D | Delete "Anda bridge unreachable: degraded, with a retry in the background." |
| 149 | 1 | WORKFLOW step 5 | T | Tombstone, number 5 kept. |
| 192 | 1 | ASSUMPTIONS | R | Replace by the retirement statement (D-37-06). |
| 199 | 2 | AMBIGUITIES | D | Delete "Whether Anda is consumed through a TypeScript-native boundary or requires a Rust shim ...". |

### Node n1, the "fixed requirements" (D-37-02, D-37-03)

| Line | Count | Statement | Class | Action |
| --- | --- | --- | --- | --- |
| 210 | 1 | QUESTION: the list of fixed requirements (also "six-state") | R | Drop Anda from the list; five-state. |
| 212 | 1 | RATIONALE 1, fixed requirements (also "six states") | R | Drop Anda; five states. |
| 213 | 1 | RATIONALE 2, open decisions (also names the Rust shim) | R | Drop the Anda boundary item. |
| 214 | 1 | RATIONALE 3, required chain for the slice | R | Drop "then an Anda version handshake". |
| 215 | 2 | RATIONALE 4, the "tension" (also names degraded) | T | Tombstone, number 4 kept. |
| 216 | 0 | RATIONALE 5 ("Model the six states") | R | Not an Anda line; the count becomes five (D-37-03). |
| 219 | 1 | CONCLUSION, the minimal path | R | Drop "the Anda handshake, then". |
| 221 | 1 | CONCLUSION, the vertical slice adapters | R | "the Rivet and OpenShell adapters". |
| 225 | 1 | CONCLUSION, deferrals (also names the Rust shim) | R | Drop "and any Rust shim unless the Anda spike forces one". |
| 227 | 2 | CONCLUSION, decisions to record | R | Drop the Anda boundary decision and the Anda default; the D4 annotation stays. |

### Node n6, the frozen contracts (D-37-02, D-37-03)

| Line | Count | Statement | Class | Action |
| --- | --- | --- | --- | --- |
| 315 | 0 | QUESTION, the state list (`degraded`) | R | Remove `degraded` from the list. |
| 317 | 1 | RATIONALE 1, module list | R | Remove `anda` from the list. |
| 318 | 0 | RATIONALE 2, the transition rule (`degraded`) | R | Remove the `degraded` clauses. |
| 324 | 0 | CONCLUSION, `src/core/states.ts` and the 13-edge table | R | Five states, 9 edges, as in the code. |
| 325 | 2 | CONCLUSION, `src/core/errors.ts` code list | R | Remove `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH`. |

### Planning history kept and marked (D-37-05)

Each row lies inside a NODE whose start tag gains the `retired` attribute (node start tags on lines 229, 252, 298, 330 and 353).

| Node (start tag line) | Lines (count) | Content | Class |
| --- | --- | --- | --- |
| n2 (229) | 230 (1), 234 (3), 238 (2), 244 (5) | The module split names `src/anda`, the port, the `anda` module entry with its Rust directory and its dependency group | H |
| n3 (252) | 253 (1), 257 (1), 262 (1), 266 (3) | The blocking unknown about the Anda boundary and its default | H |
| n4 (298) | 299 (1), 301 (1), 302 (1), 303 (1), 304 (2), 308 (1), 309 (3), 312 (1) | Option (a), the comparison and the recommendation for the boundary, handshake and reconnection | H |
| n7 (330) | 331 (1), 335 (4), 344 (2) | The documentation gate for Anda and its bullet | H |
| n8 (353) | 354 (1), 356 (1), 359 (1), 364 (2), 375 (1), 383 (5) | The wave that builds the bridge spike, the doc gate file, the default and the ask | H |

### Issue list mirror (D-37-05)

Each row is one SUBISSUE line; the line gains the `retired` attribute and nothing else.

| Line | Count | Where the mention is | Class |
| --- | --- | --- | --- |
| 408 | 1 | title "Tension: active requires a healthy Anda bridge" | H |
| 416 | 2 | URL slug and title ("Runtime and Anda are split into ports") | H |
| 425 | 2 | URL slug and title | H |
| 441 | 1 | title | H |
| 442 | 2 | URL slug and title | H |
| 443 | 2 | URL slug and title | H |
| 444 | 2 | URL slug and title | H |
| 461 | 4 | URL slug and title ("Gate Anda ...") | H |
| 469 | 1 | title | H |
| 472 | 1 | title | H |

Line 406 (n1 step 2) ends its truncated title at "And" and has no Anda mention; it is not marked.

### Totals

| Class | Lines | Mentions |
| --- | --- | --- |
| V | 1 | 6 |
| D | 7 (23, 79, 80, 81, 121, 139, 199) | 10 |
| R | 14 (5, 22, 120, 192, 210, 212, 213, 214, 219, 221, 225, 227, 317, 325) | 16 |
| T | 3 (32, 149, 215) | 5 |
| H (nodes) | 25 | 46 |
| H (issues) | 10 | 18 |
| Lines changed (no mention but changed) | 216, 315, 318, 324 | 0 |

The 43 old lines that change are: 5, 22, 23, 32, 79, 80, 81, 120, 121, 139, 149, 192, 199 (13); 210, 212, 213, 214, 215, 216, 219, 221, 225, 227 (10); 315, 317, 318, 324, 325 (5); 229, 252, 298, 330, 353 (5); 408, 416, 425, 441, 442, 443, 444, 461, 469, 472 (10). The mentions on the H lines of the node group (46) and the issue group (18) stay, plus the six of line 2, plus the new tombstone and assumption lines.

## Edit table (exact fragments)

Whitespace: every substitution replaces only the quoted fragment and keeps the line's own indentation. Lines 5 to 199 are indented with spaces; lines from 209 on use tab characters for the element depth and four spaces for continuation lines. The arrow in line 22 is the Unicode arrow (U+2192). In the table, a `.` result means the fragment is replaced by a full stop.

```
L5   "(Rivet, Podman, NVIDIA OpenShell, Anda)"                  -> "(Rivet, Podman, NVIDIA OpenShell)"
L22  " → Anda Engine components reached from the TypeScript client."  -> "."
L23  delete the whole line
L32  whole line (6 spaces indent) ->
     "      3. Retired: the Anda bridge was removed by owner decision D-27-01 (2026-11-17). Realm has no Anda dependency."
L79-81  delete the three lines (the whole bridge section)
L120 "Container, OpenShell, AgentOS, and Anda bridge are healthy."  -> "Container, OpenShell, and AgentOS are healthy."
L121 delete the whole line (the degraded STATE)
L139 delete the whole line
L149 whole line (4 spaces indent) ->
     "    5. Retired: the Anda bridge spike was removed with the bridge (owner decision D-27-01, 2026-11-17)."
L192 whole line (4 spaces indent) ->
     "    The Anda bridge was removed (owner decision D-27-01, 2026-11-17; spec edited on the owner's instruction of 2026-11-18). Realm does not connect to Anda and has five states: unbound, connecting, active, error and stopping. Statements about Anda that remain in the original request and in elements marked retired are history, not requirements."
L199 delete the whole line
L210 "AgentOS on OpenShell, Anda reached from the TypeScript client, the six-state machine"  -> "AgentOS on OpenShell, the five-state machine"
L212 "AgentOS via its supported API only; Anda reached from TypeScript; the six states;"      -> "AgentOS via its supported API only; the five states;"
L213 "(Rivet actor or separate product); Anda boundary (TypeScript-native or Rust shim); default policy mode" -> "(Rivet actor or separate product); default policy mode"
L214 "then an AgentOS health probe, then an Anda version handshake, then active."              -> "then an AgentOS health probe, then active."
L215 whole line (4 spaces indent) ->
     "    4. Retired: this step concerned the Anda bridge, removed by owner decision D-27-01 (2026-11-17)."
L216 "Model the six states internally"                                                          -> "Model the five states internally"
L219 "then AgentOS, then the Anda handshake, then state active."                              -> "then AgentOS, then state active."
L221 "with the Rivet, OpenShell, and Anda adapters behind interfaces"                          -> "with the Rivet and OpenShell adapters behind interfaces"
L225 "the Omp plugin and status bar, and any Rust shim unless the Anda spike forces one."      -> "the Omp plugin and status bar."
L227 "AgentOS identity, Anda boundary, default policy mode,"                                   -> "AgentOS identity, default policy mode,"
L227 "; TypeScript-native Anda only if its docs confirm a supported boundary."                 -> "."
L315 "unbound, connecting, active, degraded, error and stopping"                               -> "unbound, connecting, active, error and stopping"
L317 "runtime, anda, contract"                                                                 -> "runtime, contract"
L318 "is the forward path, degraded is a side state of active, error is reachable from connecting, active, and degraded, error to connecting" -> "is the forward path, error is reachable from connecting and active, error to connecting"
L324 whole line (4 spaces indent) ->
     "    - src/core/states.ts: unbound, connecting, active, error, stopping. Allowed: unbound&gt;connecting; connecting&gt;active|error|stopping; active&gt;error|stopping; error&gt;connecting|stopping; stopping&gt;unbound. Else REALM_INVALID_TRANSITION."
L325 "AGENTOS_CRASH_LOOP, ANDA_UNREACHABLE, ANDA_VERSION_MISMATCH, POLICY_DENIED"              -> "AGENTOS_CRASH_LOOP, POLICY_DENIED"
L229, L252, L298, L330, L353 (NODE start tags) and
L408, L416, L425, L441, L442, L443, L444, L461, L469, L472 (SUBISSUE lines):
     replace the first occurrence of  '?pvs=204">'  on the line  with  '?pvs=204" retired="Statements about the Anda bridge in this element are history: the bridge was removed by owner decision D-27-01 (2026-11-17); spec edit instructed 2026-11-18">'
```

Result: 36 new lines replace 43 old lines (7 deleted); the file goes from 513 to 506 lines; `git diff --shortstat` against the base shows 36 insertions and 43 deletions for the spec; the file stays well-formed.

## Document edits (exact texts)

`docs/integration/runtime-decision.md`

1. End of the table row at line 636, after "read as superseded by this section." add: " Superseded on 2026-11-18: edited by Phase 37 (D-37-1)."
2. End of the R-27-02 sentence at line 642 ("... this section governs where they differ.") add: " Closed on 2026-11-18 by D-37-1: the spec was edited."
3. New paragraph after the line-642 paragraph and before the "Capability token spike" heading:

```
**D-37-1 (2026-11-18). Product spec edit. Owner decision (HITL, v5.0 milestone start, D-v5-6).** On 2026-11-18 the owner directed that `docs/specs/realm-spec.xml` stop describing the Anda bridge. Reason: D-27-01 removed the bridge in v4.0 (Phase 28), and the spec was the one authoritative record that still required it: a healthy bridge for `active`, a `degraded` state, a bridge section and two error codes. Phase 37 (SPEC-01) removed or rewrote those statements and the state and error contracts that named them (the state count is now five, as in `src/core/states.ts`), kept the original request verbatim, and kept the planning history that discusses the bridge, marked with a `retired` attribute. Every other statement of the spec is unchanged, including the default-mode lines annotated under D4. No code or schema changed. This entry supersedes the "Not edited (OQ-27-02)" row and R-27-02 above; it does not rewrite them.
```

`docs/integration/anda-replacement-research.md`: at the end of the Status paragraph (line 3, after "The evidence sections are unchanged and keep their original read dates.") add:

```
Update 2026-11-18: the owner directed the edit of the product spec that the risk table lists as an option, and Phase 37 made it (`docs/integration/runtime-decision.md`, D-37-1). The passages below that say the spec names the bridge, the `degraded` state or six states describe the spec as read on 2026-11-17.
```

## Acceptance scripts

Both scripts are Python 3 (E-37-01: Node has no XML parser). The executor saves each to a temporary file outside the repository (for example under `mktemp -d`), runs it from the repository root, and pastes the output into the summary.

Script 1, the scope check. `BASE` is the merge base with the main branch; the script compares the working tree and index against it, so it works before and after the commits.

```python
import re, subprocess, sys
BASE = subprocess.run(["git", "merge-base", "origin/main", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
PATH = "docs/specs/realm-spec.xml"
ALLOWED = {5, 22, 23, 32, 79, 80, 81, 120, 121, 139, 149, 192, 199,
           210, 212, 213, 214, 215, 216, 219, 221, 225, 227,
           315, 317, 318, 324, 325,
           229, 252, 298, 330, 353,
           408, 416, 425, 441, 442, 443, 444, 461, 469, 472}
diff = subprocess.run(["git", "diff", "-U0", "--no-color", BASE, "--", PATH], capture_output=True, text=True, check=True).stdout
changed = set()
for m in re.finditer(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", diff, re.M):
    start = int(m.group(1)); count = 1 if m.group(2) is None else int(m.group(2))
    changed.update(range(start, start + count))
print("unexpected changed lines:", sorted(changed - ALLOWED))
print("expected lines not changed:", sorted(ALLOWED - changed))
base_text = subprocess.run(["git", "show", BASE + ":" + PATH], capture_output=True, text=True, check=True).stdout
new_text = open(PATH, encoding="utf-8").read()
ref = re.compile(r'(?:identifier|url|notionUrl|issueUrl|notionTaskUrl|graphId|id)="[^"]*"')
print("tracker attributes preserved:", ref.findall(base_text) == ref.findall(new_text))
print("line 2 identical:", base_text.split("\n")[1] == new_text.split("\n")[1])
sys.exit(0 if not (changed - ALLOWED) and not (ALLOWED - changed) and ref.findall(base_text) == ref.findall(new_text) else 1)
```

Script 2, the residual check and well-formedness (run after script 1).

```python
import re, sys, xml.etree.ElementTree as ET
PATH = "docs/specs/realm-spec.xml"
ET.parse(PATH)  # raises ParseError if the file is not well formed
text = open(PATH, encoding="utf-8").read()
lines = text.split("\n")
anda = re.compile(r"(?<![A-Za-z])[Aa]nda|ANDA")
bad, in_retired = [], False
for n, line in enumerate(lines, 1):
    s = line.strip()
    if s.startswith("<NODE ") and 'retired="' in s:
        in_retired = True
    ok = (n == 2) or in_retired or 'retired="' in line or "D-27-01" in line
    if anda.search(line) and not ok:
        bad.append(n)
    if s == "</NODE>":
        in_retired = False
print("Anda mentions outside verbatim, retired or tombstone lines:", bad)
print("degraded (state) occurrences:", len(re.findall(r"degraded", text)))
print("andaUrl occurrences:", len(re.findall(r"andaUrl", text)))
print("six-state wording:", len(re.findall(r"[Ss]ix[- ]states?", text)))
print("lines with a tab:", sum(1 for l in lines if "\t" in l))
print("retired attributes:", text.count('retired="'))
sys.exit(0 if not bad and "degraded" not in text and "andaUrl" not in text and not re.search(r"[Ss]ix[- ]states?", text) and sum(1 for l in lines if "\t" in l) == 161 and text.count('retired="') == 15 else 1)
```

Expected output of script 2 after the edit: an empty list, `0`, `0`, `0`, `161`, `15`.

## Canonical References

- `docs/specs/realm-spec.xml` (the file edited) and `AGENTS.md` (Conventions: the spec bullet; Layout: the spec path).
- `.planning/MILESTONE-CONTEXT.md` (D-v5-6, constraints: the spec is modified only by Phase 37 and only as D-v5-6 states), `.planning/REQUIREMENTS.md` (SPEC-01), `.planning/ROADMAP.md` (Phase 37).
- `docs/integration/runtime-decision.md` (section "Anda bridge removal (Phase 27, ANDAX-01, 2026-11-17)", the supersession table, R-27-02), `docs/integration/anda-replacement-research.md`, `docs/integration/anda-decision.md` (the superseded notice).
- `.planning/milestones/v4.0-phases/27-anda-disposition-and-v4-0-requirement-closure/27-CONTEXT.md` (E-27-09, OQ-27-02), `.planning/milestones/v4.0-phases/28-remove-the-anda-bridge/28-CONTEXT.md` (D-28-10, OQ-28-01), `28-03-PLAN.md` (the marker convention and the pull request body style).
- `src/core/states.ts`, `src/core/errors.ts`, `src/runtime/config.ts` (the code the edited contract lines describe).
- `scripts/check/default-mode.mjs`, `scripts/check/host-paths.mjs`, `scripts/docs/sync-site.mjs` (the guards that touch the edited files).
- Precedent commits of the spec: 237048c, fc07976, 78ea260.

## Existing Code Insights

- Nothing in `src` or `test` reads the spec, so the edit cannot break a build or a test by content. The docs gates that run are `check:docs` (host paths, agents sync, default mode) and `test:scripts`.
- The two documents edited are scanned by `default-mode.mjs` (`docs/integration`): the new text states no advisory default.
- `docs/integration/runtime-decision.md` is pinned by `test/docs/capability-token-doc.test.ts` only for the D32-1 entry; the edit does not touch that entry.
</decisions>

<specifics>
## Wave Structure

One plan, one wave. Plan 37-01 does the spec edit, the two document edits, the verification, and the pull request record. There is no second plan: the work is one coherent diff of three files with one acceptance run, and splitting it would separate the spec edit from the note that records it.

## Requirement IDs

SPEC-01 (already registered): satisfied when the spec edit is merged, the scripts pass and the pull request body records the owner's instruction and reason.

## Tracker hand-off (for the orchestrator; this phase edits none of these)

- `.planning/REQUIREMENTS.md`: mark SPEC-01 complete after merge, citing the merge commit and this phase's `37-01-SUMMARY.md`.
- `.planning/ROADMAP.md`: Phase 37 plans line "1 plan"; tick the plan.
- `.planning/STATE.md`: record the Phase 37 completion.
- `.planning/PROJECT.md`: line 100 says the spec is "read-only source of truth; do not modify" and line 102 lists Anda among the dependencies whose docs are read; both are v1 project text and need an owner-directed note or a dated marker; this phase does not edit PROJECT.md.

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-37-01.** Is marking the planning history (nodes n2, n3, n4, n7, n8 and 10 issue lines) acceptable, or does the owner want it deleted? Default: marked (D-37-05), following the 2026-11-13 precedent "annotated, not rewritten". If the owner wants deletion, Task 1 grows by about 64 mentions and the numbered lists need renumbering; the owner's answer changes only Task 1.
- **OQ-37-02.** Are the six to five state-count edits (lines 210, 212, 216, 315, 318, 324) within "statements that require the degraded state"? Default: yes (D-37-03); they list `degraded` as a required state, and the code already has five.
- **OQ-37-03.** Merge method. The pull request has two documentation commits; with a squash merge the title is the notes entry. Default: follow the repository's `ship.mergeMethod`; no breaking marker is needed either way.

## Success Criteria (from the roadmap, made observable)

1. A search of the spec for Anda, `ANDA_`, `andaUrl` and the state `degraded` finds: the original request (line 2), the lines inside elements marked retired, and the tombstone and retirement lines that cite D-27-01; no `degraded`, no `andaUrl`, no "six states". Script 2 prints an empty offender list and zeros.
2. The diff of the spec against the base touches exactly the 43 listed old lines (36 insertions, 43 deletions); script 1 prints two empty lists and `True` twice; every D4 line is unchanged.
3. The pull request body records the owner's instruction of 2026-11-18 (D-v5-6, HITL) and the reason (the bridge was removed in v4.0 under D-27-01; the spec was the record still requiring it).
4. The spec is well formed: `xmllint --noout` exits 0 and the `ElementTree` parse succeeds.
5. The two quoting documents carry the dated markers and the D-37-1 entry; `npm run check:docs` and `npm run test:scripts` pass.
</specifics>

<deferred>
## Deferred Ideas

- A permanent guard that the spec stays well-formed XML (needs an XML parser dependency and its justification, or a vendored line scanner); not worth it for an owner-controlled file that changes about once a milestone.
- Deleting the retired planning history from the spec and the matching tracker issues (OQ-37-01); needs the owner and the tracker.
- Regenerating the Graph of Thought and the issue list from a fresh planning run; out of scope.
</deferred>
