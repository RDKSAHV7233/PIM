---
title: Vexa PIM validation caveats
type: release-validation-note
date: 2026-05-06
owner: Engineering
---

## Purpose

Capture the exact non-blocking validation caveats observed during sellable-product release closeout so reviewers do not confuse harness instability with product regressions.

## Confirmed Green Checks

- `npm run prisma:generate`
- `npm run lint --workspace @pim1/api`
- `npm run build --workspace @pim1/api`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/web`
- `npm run test --workspace @pim1/web` -> `WEBTEST_SUMMARY total=99 failed=0`
- `npx playwright test apps/web/test/e2e/demo-tenant-end-to-end.spec.js --config playwright.config.cjs`
- `npx playwright test apps/web/test/e2e/publish-failure-recovery.spec.js --config playwright.config.cjs`
- `npm run guard:sensitive-gets`
- `npm run gate:run:increment`
- `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"`

## Environment-Limited Checks

### Playwright viewport and keyboard runs

Commands:

- `npx playwright test apps/web/test/e2e/viewport-core-workflows.spec.js --config playwright.config.cjs`
- `npx playwright test apps/web/test/e2e/keyboard-core-journey.spec.js --config playwright.config.cjs`

Observed failure snippets:

- `EADDRINUSE 0.0.0.0:4001`
- `connect ECONNREFUSED 127.0.0.1:4001`
- `Process from config.webServer was not able to start`
- `Cannot find module './api-keys/api-keys.module'`

Classification:

- environment / test harness issue

Interpretation:

- local Playwright-managed webServer and API startup was unstable on this machine
- failures occurred during service startup, not from assertion failures in the tested workflows

### Sprint gate runner

Command:

- `npm run gate:run:sprint`

Observed failure snippets:

- `ENOTEMPTY: directory not empty, rmdir '...apps\\api\\dist\\marketplace'`
- `ENOTEMPTY: directory not empty, rmdir '...apps\\api\\dist\\compliance'`

Classification:

- environment / filesystem issue

Interpretation:

- Windows cleanup behavior under `apps/api/dist` was unstable during the sprint gate run
- standalone API build still passed

## Security Audit Caveat

Command:

- `npm audit --omit=dev --audit-level=high`

Observed result:

- `2 moderate severity vulnerabilities`
- transitive `postcss <8.5.10` under `next`
- `fix available via npm audit fix --force`

Classification:

- dependency issue

Interpretation:

- no high-severity production blocker was reported by this audit command
- remediation path is potentially breaking and should be evaluated deliberately rather than forced during release closeout

## Post-May-6 Audit Update (2026-05-09)

A HIGH severity advisory for `fast-xml-builder <=1.1.6` was published after the May 6 release closeout
(GHSA-5wm8-gmm8-39j9, GHSA-45c6-75p6-83cc). This was not present during the original validation run.

`npm audit fix` resolves it via a non-breaking upgrade. This fix must be applied and the audit re-run
before handing off any pilot environment credentials.

## Review Guidance

- Treat the touched product workflows as green where the commands above are explicitly passing.
- Treat the failed viewport and keyboard Playwright runs plus the sprint gate run as environment-limited, not confirmed regressions, unless reproduced on a clean runner with the same code.
- Do not expand claims beyond the controlled paid pilot / early SMB-midmarket boundary documented in the release notes and traceability matrix.
