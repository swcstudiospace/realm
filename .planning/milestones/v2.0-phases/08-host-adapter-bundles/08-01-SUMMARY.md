# Phase 8 summary

Evidence: the validator logs from each isolated scratch home. The logs are not committed.

- Claude Code: "Validation passed with warnings".
- Grok Build: manifest valid, version 0.1.2, with the MCP entry realm mcp.
- Muse Code: the realm native bundle reports valid.
- Hermes Agent: "Validation passed." The recorded exit status is 0.
- Prime Agent: the install printed "Installed", and the list shows the package under project packages. Both exit statuses are 0.

Changed files in this phase: none. The wording amendment is in .planning/REQUIREMENTS.md, committed as dcb11dc.

Deviations: the Prime check is install plus list, as the amended HOST-02 wording says.

Gaps: none for HOST-01 or HOST-02. HOST-03 belongs to phase 10.

## Addendum 2026-10-24: closure evidence

Validator exit codes from the isolated scratch run of 2026-10-23, recorded in its results file and cited here on 2026-10-24. The logs stay outside the repository and are not committed.

| Validator step | Exit code | Log | Outcome |
|---|---|---|---|
| Claude Code validate | 0 | claude.log | Validation passed with warnings |
| Grok Build validate | 0 | grok.log | Manifest valid, version 0.1.2, MCP entry realm mcp |
| Muse Code validate | 0 | muse.log | Realm native bundle reports valid |
| Hermes Agent validate | 0 | hermes.log | Validation passed. |
| Prime Agent install | 0 | prime-install.log | Installed |
| Prime Agent list | 0 | prime-list.log | Package listed under project packages |

Closure: phase 8 is closed on this evidence under the owner's 2026-10-24 decision. CONTEXT, PLAN, SUMMARY, and VERIFICATION were written by hand; VERIFICATION is an orchestrator evidence check, not a gsd-verifier run. Owner ratification is pending.
