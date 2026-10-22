@AGENTS.md

## Claude Code notes

- Planning changes go through GSD commands, as `.agents/GEMINI.md` requires: `/gsd-quick` for small fixes and documentation updates, `/gsd-debug` for investigation, and `/gsd-execute-phase` for planned phase work.
- Run the gates listed in AGENTS.md before you claim a change works, and report the results you actually saw.
- Never run `gh pr merge`. Merge through the ship flow (the `ultrathink-ship` skill).
- Stop and flag a change to a high-risk path listed in AGENTS.md for human review. Do not merge it yourself.
- Do not edit the release-owned files (`CHANGELOG.md`, and the versions in `package.json` and `package-lock.json`) in a pull request.
- Keep answers terse and evidence-first: state the claim, then the file, line, or command output behind it.
