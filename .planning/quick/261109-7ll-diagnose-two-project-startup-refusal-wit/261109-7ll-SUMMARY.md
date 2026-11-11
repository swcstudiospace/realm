---
task: 261109-7ll
status: complete
---

# Two-project startup diagnostic

Added hermetic controls for a daemon registry in a different state directory from the driver's and for other `create.workspace` refusal paths. The tests show a split registry fails for both single- and two-project arrangements while matching registry controls succeed. They do not identify the branch responsible for the historical live failure or explain the earlier single-project success. Code commit: `315b4fd`.

Parent verification: typecheck, lint, build, 199 focused checkpoint/live-helper/driver tests, `check:docs`, `check:gates`, the full test suite, script tests, `check:pack` and `check:mcp` passed. A read-only review found no evidence-backed flaw in the diagnostic controls. No live stack operations were run.
