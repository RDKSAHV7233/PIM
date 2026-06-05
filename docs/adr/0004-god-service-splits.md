# ADR-0004: Split God Services — Plan & Rationale

**Status**: Proposed  
**Date**: 2026-06-04  
**Author**: CTO optimization session  

---

## Context

Several API services have grown to ≥ 2,000 lines and ≥ 20 public methods, making them:

- Hard to navigate and reason about locally
- Risky to change (one PR touches concerns across multiple domains)
- Slow to compile for incremental builds (TS has to process the whole file)
- Unscalable as team grows (merge conflicts, ownership ambiguity)

### Affected files

| Service | Lines | Public methods | Priority |
|---------|-------|---------------|----------|
| `marketplace/marketplace.service.ts` | ~3,600 | ~40 | **P0** |
| `auth/auth.service.ts` | ~2,430 | ~14 | P1 |
| `common/access-policy/access-policy.service.ts` | ~2,225 | ~20 | P1 |
| `catalog/catalog.service.ts` | ~1,982 | ~18 | P2 |
| `billing/plan-usage.service.ts` | ~1,730 | ~12 | P2 |

---

## Decision: Split `MarketplaceService` first (P0)

### Proposed sub-services

| New service | Responsibility | Methods extracted |
|------------|---------------|------------------|
| `MarketplaceMappingService` | Template CRUD + channel mapping | `getChannelMapping`, `listTemplates`, `createTemplate`, `getTemplate`, `updateTemplate`, `deleteTemplate`, `cloneTemplate` |
| `MarketplaceExportService` | Job creation, submission lifecycle, DLQ, readiness | `createExportJob`, `listExportJobs`, `listSubmissions`, `listDeadLetterSubmissions`, `getSubmission`, `getSubmissionIssues`, `syncSubmissionStatus`, `retrySubmission`, `getExportJob`, `processExportJob`, `requeueExportJob`, `simulateProduct`, `getBatchReadiness` |
| `MarketplaceRecoveryService` | Error family grouping + retry | `getRecoveryGroups`, `retryRecoveryGroup` |
| `MarketplaceSyncService` | Delta sync state + schedule | `getDeltaSyncStatus`, `getDeltaSyncCandidates`, `queueDeltaSync`, `upsertSyncState`, `getSyncStates`, `getSchedule`, `upsertSchedule`, `deleteSchedule` |
| `MarketplaceCatalogLinkService` | Catalog link scanning + confirmation | `scanCatalogLinks`, `confirmCatalogLinks`, `getProductLinks` |
| `MarketplacePublishService` | Bulk publish + connector export | `triggerBulkPublish`, `triggerConnectorExport` |
| `ShopifyMarketplaceService` | Shopify-specific: preview, config import | `previewProductChanges`, `importShopifyConfig`, `getShopifyConfig` |

`MarketplaceService` remains as a thin facade that imports all sub-services and re-exports them to the controller (zero breaking change to `MarketplaceController`).

### Migration approach

1. Create each sub-service class under `apps/api/src/marketplace/`
2. Move methods — no logic changes, just relocation
3. Inject sub-services into `MarketplaceService`; delegate each method with `return this.subService.method(...args)`
4. Wire sub-services in `marketplace.module.ts`
5. Test: existing integration test suite covers all these paths — CI green = safe

---

## `AuthService` split plan (P1)

| New service | Responsibility |
|------------|---------------|
| `AuthSessionService` | `login`, `refresh`, `logout`, `verifyLoginMfa`, `issueStepUp` |
| `AuthPasswordService` | `requestPasswordReset`, `confirmPasswordReset`, `resendUnlock` |
| `AuthPrivacyService` | `recordConsent`, `requestAccountExport`, `getAccountPrivacyStatus`, `downloadAccountExport`, `deleteAccount` |

---

## `AccessPolicyService` split plan (P1)

Split into:
- `AccessPolicyAssertionService` — `assert*` guards (called in request path)
- `AccessPolicyScopeService` — `buildProductScopeWhere`, `filterByScope*` helpers (query builders)
- `AccessPolicyAdminService` — `createScope`, `listScopes`, `updateScope`, `deleteScope` (admin management)

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Circular injection | All sub-services are siblings under the same module; no cycles expected |
| Integration test coverage gap | All current E2E + seam tests exercise via controller — no changes there |
| NestJS circular module | Add sub-service providers to `marketplace.module.ts` providers array; import `MarketplaceModule` once |
| Merge conflict with open PRs | Do splits after current PR train merges; use feature flag if needed |

---

## Timeline estimate

- `MarketplaceService` split: 2 engineering days (mostly mechanical movement)
- `AuthService` split: 1 day
- `AccessPolicyService` split: 1.5 days

Total: ~4.5 engineering days for all P0+P1.
