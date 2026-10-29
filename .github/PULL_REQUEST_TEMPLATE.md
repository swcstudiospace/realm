## Summary

<!-- What this change does and why. -->

## Requirements

<!-- Requirement IDs from .planning/REQUIREMENTS.md that this change addresses, for example CRASH-01, ONB-02. Write "none" if no requirement applies. -->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run test:coverage` (CI enforces the floors on the Node 22.x leg)
- [ ] `npm run test:scripts`
- [ ] `npm run check:docs`
- [ ] `npm run build`
- [ ] `npm run check:gates`
- [ ] `npm run check:pack`
- [ ] `npm run check:mcp`

## Risk and rollback

<!-- The main risks of this change and how to revert it. -->

## Checklist

- [ ] No host-local absolute paths appear in the changed files.
- [ ] No suppression comments are added.
- [ ] If dependencies changed, `npm audit --omit=dev --audit-level=high` passes (result recorded in this pull request).
- [ ] No new dependency is added, or its justification is recorded in this pull request.
- [ ] Release-owned files are not edited: `CHANGELOG.md` and the `version` fields of `package.json`, `package-lock.json`, and the four adapter manifests (AGENTS.md, Versioning and release).
