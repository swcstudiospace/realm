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
