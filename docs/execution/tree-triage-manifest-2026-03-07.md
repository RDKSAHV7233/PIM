# TEJ PIM Dirty Tree Triage Manifest (2026-03-07)

- Repo: `C:\Users\Om Computers\PIM1`
- Current HEAD before archive-ignore closure: `2a9bc48`
- `origin/main` baseline: `c577216`
- Method: preserve-first triage; no move/delete/revert in this pass.
- Rule: dirty source is keep-by-default unless proven generated/noise or superseded.

## Action Legend
- `commit-now`: ready to commit as part of active product/runtime/governance work.
- `keep-open`: active work, but should stay open until related changes are grouped and validated.
- `archive-to-unused`: safe candidate for archive/noise handling.
- `revert`: only with regression proof. None assigned in this pass.
- `owner-review`: requires explicit product/engineering owner call before commit/archive.

## Runtime and Test Files

| File | Diff | Bucket | Evidence | Proposed action |
|---|---:|---|---|---|
| `.env-templates/.env.example` | `+3/-0` | `active-new-development` | Adds active feature/config flags used by runtime: `DASHBOARD_CACHE_REDIS_DISABLED` is read in `apps/api/src/dashboard/dashboard.service.ts`; `FEATURE_ONDC_ENABLED` is consumed in `apps/api/src/app.module.ts`. | `commit-now` |
| `.env.example` | `+3/-0` | `active-new-development` | Root local env example carries the same active runtime flags as above; not safe to archive. | `commit-now` |
| `.env.staging.example` | `+3/-0` | `active-new-development` | Staging env example now aligns with runtime feature flags and dashboard cache control; this affects deploy/config posture. | `commit-now` |
| `apps/api/src/app.module.ts` | `+4/-1` | `active-new-development` | Root Nest module imports active runtime modules and now gates `OndcModule` behind `FEATURE_ONDC_ENABLED`; validated in `d02839b` with ONDC feature-gating integration coverage. | `commit-now` |
| `apps/api/src/bulk-edit/bulk-edit.service.ts` | `+39/-3` | `active-new-development` | Workflow status transitions are now enforced in bulk edit apply operations and committed in `6326749`; validated by product workflow and bulk-edit integration suites. | `commit-now` |
| `apps/api/src/bulk-edit/dto/bulk-edit-scope.dto.ts` | `+1/-1` | `active-new-development` | Bulk edit scope status contract now includes workflow statuses and shipped in `6326749`. | `commit-now` |
| `apps/api/src/bulk-import/bulk-import.service.ts` | `+60/-4` | `active-new-development` | Bulk import now rejects non-draft workflow entry statuses as failed rows instead of retry churn; committed in `6326749`. | `commit-now` |
| `apps/api/src/catalog/catalog.controller.ts` | `+13/-2` | `active-new-development` | Product update path now passes actor context for status transition audit logging; committed in `6326749`. | `commit-now` |
| `apps/api/src/catalog/catalog.service.ts` | `+74/-5` | `active-new-development` | Catalog create/update/stats now enforce workflow lifecycle and pending approval counts; committed in `6326749`. | `commit-now` |
| `apps/api/src/catalog/dto/create-product.dto.ts` | `+3/-2` | `active-new-development` | Product create DTO now accepts optional workflow status input while enforcing draft-only entry in service logic; committed in `6326749`. | `commit-now` |
| `apps/api/src/catalog/dto/update-product.dto.ts` | `+1/-1` | `active-new-development` | Product update DTO now recognizes workflow status values used by the lifecycle transition rules in `6326749`. | `commit-now` |
| `apps/api/test/integration/product-workflow-transitions.test.cjs` | `scope expansion` | `active-new-development` | Expanded in `6326749` to verify pending approval stats and bulk-edit workflow transition failure recording. | `commit-now` |
| `apps/api/src/common/audit/audit-log.interceptor.ts` | `+3/-6` | `active-new-development` | Audit interceptor now ignores spoofable `x-pim-actor` input and derives actor identity strictly from authenticated request context; validated in `6331d11`. | `commit-now` |
| `apps/api/test/integration/audit-actor-context.test.cjs` | `scope expansion` | `active-new-development` | Added in `6331d11` to verify spoofed actor headers do not influence audit attribution on authenticated writes. | `commit-now` |
| `apps/api/src/common/env-validation.ts` | `+2/-0` | `active-new-development` | Startup env validation now includes `FEATURE_ONDC_ENABLED`; validated in `d02839b` with env-validation and ONDC feature-gating integration coverage. | `commit-now` |
| `apps/api/src/compliance/dto/issue-inbox-query.dto.ts` | `+2/-2` | `active-new-development` | Issue inbox product status filter now accepts workflow states (`in_review`, `approved`, `rejected`) and was validated in `9554865` with integration coverage. | `commit-now` |
| `apps/api/test/integration/issue-inbox.test.cjs` | `scope expansion` | `active-new-development` | Expanded in `9554865` to verify `productStatus=in_review` filter behavior after workflow status expansion. | `commit-now` |
| `apps/api/src/dashboard/dashboard.service.ts` | `+297/-186` | `active-new-development` | Active runtime service under `DashboardModule`; validated with API build + dashboard integration suite and committed as dashboard-specific work in `c7e66c8`. | `commit-now` |
| `apps/api/src/marketplace/dto/connector-mapping.dto.ts` | `+9/-0` | `active-new-development` | Added explicit rollback DTO contract with confirmation and reason fields so rollback is a first-class lifecycle action, not an overloaded publish path; committed in `27f612f`. | `commit-now` |
| `apps/api/src/marketplace/marketplace.controller.ts` | `+17/-0` | `active-new-development` | Marketplace mapping controller now exposes `POST /marketplace/connectors/:connectorSlug/mappings/versions/:versionId/rollback` for bounded rollback semantics under the existing mapping domain; committed in `27f612f`. | `commit-now` |
| `apps/api/src/marketplace/connector-mapping.service.ts` | `+46/-1`, later `+177/-0` bounded reopen | `active-new-development` | Mapping lifecycle now emits `mapping.completion_percent` metrics after publish/archive and supports bounded rollback by cloning a prior non-draft version into a new published version while preserving one-published-per-scope; committed in `5539682` and `27f612f`. | `commit-now` |
| `apps/api/src/metrics/metrics.service.ts` | `+177/-0` | `active-new-development` | KPI trends endpoint now exposes mapping completion, first publish success, setup time to first publish, blocker resolution rate, and median blocker resolution hours with verified physical table naming and UTC-safe timestamp comparison; committed in `5539682`. | `commit-now` |
| `apps/api/test/integration/metrics-kpi-trends.test.cjs` | `+110/-1` | `active-new-development` | Expanded in `5539682` to prove connector mapping/publish KPI series are emitted and returned tenant-scoped for flipkart after lifecycle publish + export processing. | `commit-now` |
| `apps/api/test/integration/connector-mapping-rollback.test.cjs` | `new` | `active-new-development` | Added bounded rollback regression coverage for confirmation enforcement, one-published invariant, source compatibility preservation, and cross-tenant denial; committed in `27f612f`. | `commit-now` |
| `apps/api/src/ondc/ondc.controller.ts` | `+2/-0` | `active-new-development` | ONDC controller now requires `admin` role and remains feature-gated runtime code; validated in `d02839b` with viewer `403` and admin `200` checks. | `commit-now` |
| `apps/api/test/integration/ondc-feature-gating.test.cjs` | `new` | `active-new-development` | Targeted regression coverage for ONDC gating semantics: feature off -> `404`, feature on + viewer -> `403`, feature on + admin -> `200`. Added and committed in `d02839b`. | `commit-now` |
| `apps/api/test/integration/webhook-dedupe-scope.test.cjs` | `+8/-0` | `active-new-development` | Webhook dedupe regression now upgrades the tenant to `ENTERPRISE` before connector installation so the test reflects current entitlement rules; committed in `0ff5b02`. | `commit-now` |

## Governance and Product Docs

| File | Diff | Bucket | Evidence | Proposed action |
|---|---:|---|---|---|
| `docs/execution/E10_STORIES_EXECUTION_2026-03-03.md` | `+4/-4` | `release/governance-fix` | Canonical execution evidence now aligned to increment terminology and `run-increment-gates.cjs`; committed in `262e795`. | `commit-now` |
| `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md` | `+16/-4` | `release/governance-fix` | Canonical backlog now maps execution work to increment IDs instead of sprint/phase language; committed in `262e795`. | `commit-now` |
| `docs/execution/gates/README.md` | `+2/-2` | `release/governance-fix` | Gate runner reference now points to `npm run gate:run:increment`; committed in `262e795`. | `commit-now` |
| `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md` | `+1/-2` | `active-product-doc` | Pilot playbook terminology aligned from sprint planning to increment planning in `262e795`. | `commit-now` |
| `docs/product/PRD.md` | `+12/-12` | `active-product-doc` | PRD now consistently uses increment-based release/governance language and milestone naming in `262e795`. | `commit-now` |

## Untracked Local / Archive Paths

| File | Diff | Bucket | Evidence | Proposed action |
|---|---:|---|---|---|
| `AGENTS.md` | `untracked` | `local-workflow-governance` | Repo-local guardrails file is present and actively used in current workflow; keeping it untracked would make the guardrails non-reproducible for future repo-local sessions. | `commit-now` |
| `unused/pim1-files-20260306_145759/` | `untracked` | `generated/noise` | Already under `unused/`; contains archive snapshot material (`.runlogs`, `docs`, `tools`, `.TEJ PIM-web.log`) rather than active runtime paths. | `archive-to-unused` |
| `unused/temp/` | `untracked` | `generated/noise` | Already under `unused/`; contains temp runtime files and restore backups, including `ui_restore_backup_20260306_103845` and temp staging scripts. | `archive-to-unused` |

## Summary by Proposed Action
- `keep-open`: 0 files
- `commit-now`: 33 paths
- `archive-to-unused`: 2 paths
- `owner-review`: 0 paths
- `revert`: 0 files in this pass

## Closure Status
1. All active runtime, test, and governance/product-doc diffs in this manifest are now committed and locked, including the connector KPI metrics cluster in `5539682`.
2. The only remaining local noise was `unused/*` archive material, which is now ignored via `.gitignore` in commit `576f32e`.
3. No restore/delete action is required for `unused/*` unless explicitly requested later.
