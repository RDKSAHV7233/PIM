## Reviewer Checklist

Please review this PR against the bounded sellability target, not enterprise scope.

### Product workflow checks

- approval review is evidence-based, not queue-only
- import flow is staged and validate-before-import
- product, mapping, publish, jobs, audit, and governance workflows remain intact
- no primary action on the touched advanced surfaces is hidden behind horizontal scroll at `375` or `768`

### Claim-boundary checks

- docs and release notes do not call Vexa enterprise-ready
- connector claims stay honest to current implementation
- self-serve billing and full MFA enforcement are not implied

### Validation checks

- web lint/build/test are green
- API lint/build are green
- approval and import contract coverage is present
- demo-tenant and publish-recovery browser proofs are present

### Known environment-limited checks

These should not be treated as product regressions unless reproduced on a clean runner:

- viewport Playwright startup instability
- keyboard Playwright startup instability
- `gate:run:sprint` Windows cleanup instability under `apps/api/dist`

Reference:

- [VEXA_PIM_PR_SUMMARY_2026-05-06.md](C:/Users/Om%20Computers/PIM1/docs/review/VEXA_PIM_PR_SUMMARY_2026-05-06.md)
- [VEXA_PIM_VALIDATION_CAVEATS_2026-05-06.md](C:/Users/Om%20Computers/PIM1/docs/execution/VEXA_PIM_VALIDATION_CAVEATS_2026-05-06.md)
