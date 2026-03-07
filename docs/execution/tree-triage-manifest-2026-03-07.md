# PIM1 Dirty Tree Triage Manifest (2026-03-07)

- Repo: `C:\Users\Om Computers\PIM1`
- Current HEAD: `fed86c4`
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
| `.env-templates/.env.example` | `+3/-0` | `active-new-development` | Adds active feature/config flags used by runtime: `DASHBOARD_CACHE_REDIS_DISABLED` is read in `apps/api/src/dashboard/dashboard.service.ts`; `FEATURE_ONDC_ENABLED` is consumed in `apps/api/src/app.module.ts`. | `owner-review` |
| `.env.example` | `+3/-0` | `active-new-development` | Root local env example carries the same active runtime flags as above; not safe to archive. | `owner-review` |
| `.env.staging.example` | `+3/-0` | `active-new-development` | Staging env example now aligns with runtime feature flags and dashboard cache control; this affects deploy/config posture. | `owner-review` |
| `apps/api/src/app.module.ts` | `+4/-1` | `active-new-development` | Root Nest module imports active runtime modules: `DashboardModule`, `BulkImportModule`, `BulkEditModule`, `CatalogModule`, `OndcModule`. Any cleanup here risks breaking app boot. | `keep-open` |
| `apps/api/src/bulk-edit/bulk-edit.service.ts` | `+39/-3` | `active-new-development` | Active service under `BulkEditModule`, loaded by `apps/api/src/app.module.ts`. Runtime source, not cleanup material. | `keep-open` |
| `apps/api/src/bulk-edit/dto/bulk-edit-scope.dto.ts` | `+1/-1` | `active-new-development` | DTO used by bulk-edit API surface; runtime contract file, not archive candidate. | `keep-open` |
| `apps/api/src/bulk-import/bulk-import.service.ts` | `+60/-4` | `active-new-development` | Active service under `BulkImportModule`, loaded by `apps/api/src/app.module.ts`. Large diff indicates ongoing feature work. | `keep-open` |
| `apps/api/src/catalog/catalog.controller.ts` | `+13/-2` | `active-new-development` | Controller in `CatalogModule`, loaded by `apps/api/src/app.module.ts`; API route surface should not be cleaned up by filename. | `keep-open` |
| `apps/api/src/catalog/catalog.service.ts` | `+74/-5` | `active-new-development` | Core catalog runtime service with substantial logic changes; active product domain code. | `keep-open` |
| `apps/api/src/catalog/dto/create-product.dto.ts` | `+3/-2` | `active-new-development` | DTO contract for product creation; tied to catalog controller/service behavior. | `keep-open` |
| `apps/api/src/catalog/dto/update-product.dto.ts` | `+1/-1` | `active-new-development` | DTO contract for update path; active API contract surface. | `keep-open` |
| `apps/api/src/common/audit/audit-log.interceptor.ts` | `+3/-6` | `active-new-development` | Global interceptor path, provided in the app runtime. Touching/removing without grouped validation is unsafe. | `keep-open` |
| `apps/api/src/common/env-validation.ts` | `+2/-0` | `active-new-development` | Startup env validation is a release-critical path; modifications belong to active runtime governance. | `keep-open` |
| `apps/api/src/compliance/dto/issue-inbox-query.dto.ts` | `+2/-2` | `active-new-development` | DTO used in compliance/issues query path; active API surface. | `keep-open` |
| `apps/api/src/dashboard/dashboard.service.ts` | `+297/-186` | `active-new-development` | Active runtime service under `DashboardModule`; large diff and direct dependency on new cache/env behavior make this non-cleanup work. | `keep-open` |
| `apps/api/src/ondc/ondc.controller.ts` | `+2/-0` | `active-new-development` | ONDC controller remains feature-gated runtime code, loaded when `FEATURE_ONDC_ENABLED` is true. | `keep-open` |
| `apps/api/test/integration/webhook-dedupe-scope.test.cjs` | `+8/-0` | `active-new-development` | Explicitly wired in `package.json` as `test:integration:webhook-dedupe-scope`; active regression test, not archive material. | `keep-open` |

## Governance and Product Docs

| File | Diff | Bucket | Evidence | Proposed action |
|---|---:|---|---|---|
| `docs/execution/E10_STORIES_EXECUTION_2026-03-03.md` | `+4/-4` | `release/governance-fix` | Referenced by `docs/execution/INCREMENT_STATE.json` under `INC-08` and by release-readiness tracking; canonical execution evidence. | `keep-open` |
| `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md` | `+16/-4` | `release/governance-fix` | Referenced by multiple execution records (`E1`, `E2/E4`, `E5`, `E6`, `E7`, `E8`, `E9`, `E10`) and by `docs/STRUCTURE.md`; canonical backlog source. | `keep-open` |
| `docs/execution/gates/README.md` | `+2/-2` | `release/governance-fix` | Referenced by execution evidence and documents gate artifact schema; not safe to archive. | `keep-open` |
| `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md` | `+1/-2` | `active-product-doc` | Referenced by `docs/execution/AI_TO_CODE_INCREMENT_EXECUTION_PACK.md`, `docs/product/PRD_SOURCES.md`, and enterprise doc indexes. | `keep-open` |
| `docs/product/PRD.md` | `+12/-12` | `active-product-doc` | Canonical product source referenced by `CONTROLLED_RELEASE_CHECKLIST.md`, `PRD_SOURCES.md`, enterprise documentation index, and transfer docs. | `keep-open` |

## Untracked Local / Archive Paths

| File | Diff | Bucket | Evidence | Proposed action |
|---|---:|---|---|---|
| `AGENTS.md` | `untracked` | `local-workflow-governance` | Repo-local guardrails file is present and actively used in current workflow, but not part of committed product/runtime yet. | `owner-review` |
| `unused/pim1-files-20260306_145759/` | `untracked` | `generated/noise` | Already under `unused/`; contains archive snapshot material (`.runlogs`, `docs`, `tools`, `.pim1-web.log`) rather than active runtime paths. | `archive-to-unused` |
| `unused/temp/` | `untracked` | `generated/noise` | Already under `unused/`; contains temp runtime files and restore backups, including `ui_restore_backup_20260306_103845` and temp staging scripts. | `archive-to-unused` |

## Summary by Proposed Action
- `keep-open`: 19 files
- `owner-review`: 4 paths
- `archive-to-unused`: 2 paths
- `commit-now`: 0 files in this pass
- `revert`: 0 files in this pass

## Immediate Next Step
1. Review the `owner-review` items first (`.env*` examples and `AGENTS.md`).
2. Group `keep-open` runtime files into coherent feature commits instead of tree-cleanup commits.
3. Leave `unused/*` paths in archive state; no restore/delete needed unless explicitly requested.
