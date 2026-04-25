# Vexa PIM Enterprise Delegated-Access Report

Date: 2026-04-25

## 1. Executive Summary

Status: **Partial**

Release recommendation: **Conditionally acceptable as the delegated-access implementation milestone for currently supported non-tenant scopes. Not approved for a full enterprise delegated-access completion claim.**

Implemented and verified in this phase:
- tenant/workspace-safe scope assignments
- category scope
- brand scope
- channel scope
- connector-account scope
- backend enforcement across catalog, media, bulk edit, bulk import, marketplace mapping/export, and connector preview/list paths
- admin UI visibility and management for delegated scope assignments
- sanitized denial audit evidence for scope denials

Not supported by current schema/domain and therefore not claimed as implemented:
- catalog
- vendor/owner
- supplier
- locale/market
- team
- assignee

Critical blockers:
- none for the supported scope dimensions implemented in this pass

Important residual gaps:
- unsupported non-tenant scopes above still need product/schema decisions
- UI alignment is intentionally minimal; backend is the source of truth
- scope rollout is assignment-activated per tenant, preserving legacy tenants with no delegated-access setup

## 2. Discovery Decision Matrix

| Scope Dimension | Existing Schema Support? | Existing UI Support? | Can Implement Safely Now? | Required Backend Model | Required Enforcement Points | Required Tests | Decision |
|---|---|---|---|---|---|---|---|
| tenant/workspace | Yes | Partial | Yes | Existing tenantKey + tenant middleware/RLS extension | All list/detail/write paths, audit boundaries, cross-tenant direct IDs | tenant-boundary, audit-boundary, bulk-import boundary | Implement now |
| catalog | No dedicated catalog model found | No | No | New catalog model and relation to products/assets/jobs | product/media/import/export/query filters | catalog-scope list/detail/write/export tests | Not supported by current schema |
| category | Yes (`Category`, `Product.categoryId`, template/import relations) | Partial | Yes | `AccessScopeAssignment` with `categoryId` FK | catalog, media, bulk import, marketplace template/export | category list/detail/update/media/export tests | Implement now |
| brand | Partial (`Product.brand` string field only) | Partial | Yes | `AccessScopeAssignment.scopeValue` normalized brand string | catalog, media via product scope, bulk edit/import/export | brand list/filter/direct ID/bulk edit tests | Implement now |
| vendor/owner | No owner/vendor field or model on product | No | No | product ownership/schema addition plus assignments | product/media/jobs/import/export/connectors | owner list/detail/import/export tests | Requires migration follow-up |
| supplier | No supplier field/model on governed records | No | No | supplier schema and assignment model | product/import/export/query filters | supplier scope tests | Requires migration follow-up |
| channel | Yes (`channel` on mappings/exports; connector slug/channel mapping) | Partial | Yes | `AccessScopeAssignment.scopeValue` normalized channel value | marketplace templates, export jobs, connector account/channel checks | channel template/export denial tests | Implement now |
| locale/market | No stable scope field on governed catalog objects | No | No | locale/market ownership model or localized data scope model | localized reads/writes/import/export | locale/market scope tests | Requires product decision |
| team | No team membership/ownership model | No | No | team schema and team-to-record assignment | list/detail/write/import/export | team scope tests | Requires migration follow-up |
| assignee | No assignee field on governed records | No | No | assignee field(s) and policy model | detail/write/queue/job visibility | assignee scope tests | Requires migration follow-up |
| connector account | Yes (`ConnectorInstallation`, `ConnectorPermission`) | Partial | Yes | `AccessScopeAssignment.connectorInstallationId` FK | connector list/preview/publications/schema access | connector-account list/preview denial tests | Implement now |

## 3. Scope Implementation Matrix

| Scope Dimension | Implemented? | Backend Enforced? | UI Supported? | Tests Passing? | Notes |
|---|---|---|---|---|---|
| tenant/workspace | Yes | Yes | Partial | Yes | Existing isolation preserved; delegated-access remains tenant-safe |
| catalog | No | No | No | N/A | No catalog domain model in current repo |
| category | Yes | Yes | Partial | Yes | Enforced across products, media, bulk import, marketplace templates/exports |
| brand | Yes | Yes | Partial | Yes | Enforced using normalized string scope values |
| vendor/owner | No | No | No | N/A | Unsupported by current schema |
| supplier | No | No | No | N/A | Unsupported by current schema |
| channel | Yes | Yes | Partial | Yes | Enforced for marketplace templates/exports and connector channel checks |
| locale/market | No | No | No | N/A | No safe current schema support |
| team | No | No | No | N/A | No team model |
| assignee | No | No | No | N/A | No assignee model |
| connector account | Yes | Yes | Partial | Yes | Enforced for connector account list/preview/publications/schema access |

## 3A. Scope Combination Semantics

Delegated-access scope dimensions are enforced conjunctively across active dimensions for the same resource type.

For products:
- category and brand scopes are intersected when both dimensions are active
- a product must match every active product-scope dimension assigned to the actor
- a match in one dimension does not bypass another active dimension
- user-scoped and role-scoped assignments are additive within a single dimension, but dimensions themselves are intersected

For connectors:
- connector-account and channel scopes are intersected when both dimensions are active
- channel access does not automatically grant access to all connector accounts in that channel when connector-account scoping is active
- user-scoped and role-scoped assignments are additive within a single dimension, but dimensions themselves are intersected

Legacy tenants with no delegated scope assignments preserve existing behavior. Admins retain full access within tenant/workspace boundaries.

## 4. Enforcement Matrix

| Area | List Filtering | Direct ID Protection | Write Protection | Import/Bulk Protection | Export/Connector Protection | Result |
|---|---|---|---|---|---|---|
| Products | Yes | Yes | Yes | Yes | Yes | Pass for supported scopes |
| Variants | Via parent product scope | Via parent product scope | Yes | N/A | N/A | Pass for supported scopes |
| Media/assets | Yes | Yes | Yes | N/A | N/A | Pass for supported scopes |
| Categories | N/A | Scope assignment validation | Admin assignment only | Bulk import template/job category checks | Marketplace template/export category checks | Pass for supported scopes |
| Brands | Filter through product scope | Yes via product scope | Yes via product scope | Bulk edit/import checks | Export/product payload checks | Pass for supported scopes |
| Vendors/owners | No | No | No | No | No | Unsupported |
| Import jobs | Yes | Yes | Process/repair guarded | Yes | N/A | Pass for category scope |
| Export jobs | Partial | Partial | Create guarded | N/A | Yes | Pass for supported scope-aware create path |
| Bulk edit | Scope-aware target filtering | Explicit product ID checks | Yes | Yes | N/A | Pass |
| Connector preview | N/A | Yes | N/A | N/A | Yes | Pass |
| Connector publish/export | Partial | Partial | Guarded where current paths exist | N/A | Yes | Pass for current implemented surfaces |
| Audit logs | Tenant-scoped existing controls | Yes | Admin-only existing controls | N/A | N/A | Pass |

## 5. Files Changed

| File | Change Summary | Reason |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Added delegated-access enums and `AccessScopeAssignment` model | Tenant-safe scope assignment storage |
| `packages/db/prisma/migrations/20260425140949_add_access_scope_assignments/migration.sql` | Added migration for scope assignments and indexes | Deployable schema artifact |
| `apps/api/src/prisma/extensions/tenant-scope.ts` | Added `AccessScopeAssignment` to tenant-scoped models | Preserve tenant isolation |
| `apps/api/src/common/access-policy/access-policy.service.ts` | Added assignment CRUD, scope-aware policy decisions, rollout-safe enforcement gate, and preserved field/payload policy checks | Central delegated-access enforcement |
| `apps/api/src/common/access-policy/access-policy.module.ts` | Wired Prisma into access-policy module | Enable policy DB reads |
| `apps/api/src/workspace-users/dto/create-access-scope-assignment.dto.ts` | Added validated DTO | Admin scope assignment API |
| `apps/api/src/workspace-users/workspace-access-scopes.controller.ts` | Added admin scope-assignment endpoints | Backend management surface |
| `apps/api/src/workspace-users/workspace-users.module.ts` | Registered delegated-access controller/module dependency | Expose admin endpoints |
| `apps/api/src/catalog/catalog.controller.ts` | Passed actor context consistently | Scope-aware catalog enforcement |
| `apps/api/src/catalog/catalog.service.ts` | Added category/brand scope filters and direct-access checks across product/variant flows | Product delegated access |
| `apps/api/src/media/media.controller.ts` | Passed actor context | Scope-aware media enforcement |
| `apps/api/src/media/media.service.ts` | Added media/product scope filters and direct-access checks | Asset delegated access |
| `apps/api/src/bulk-import/bulk-import.controller.ts` | Passed actor context through import endpoints | Scope-aware import enforcement |
| `apps/api/src/bulk-import/bulk-import.service.ts` | Added category scope enforcement to templates/jobs/processing | Batch delegated access |
| `apps/api/src/bulk-edit/bulk-edit.controller.ts` | Passed actor context | Scope-aware bulk edit |
| `apps/api/src/bulk-edit/bulk-edit.service.ts` | Added explicit product-scope checks and target filtering | Batch delegated access |
| `apps/api/src/marketplace/marketplace.controller.ts` | Passed actor context into mapping/export endpoints | Channel/category delegated access |
| `apps/api/src/marketplace/marketplace.service.ts` | Added scope-aware template/export checks | Export and channel enforcement |
| `apps/api/src/connector-installer/connector-installer.controller.ts` | Preserved tenant context in actor resolution | Enable connector-account scope enforcement |
| `apps/api/src/connector-installer/connector-installer.service.ts` | Added connector-account/channel scope filtering and checks | Connector delegated access |
| `apps/web/src/lib/api/core.ts` | Added access-scope types | UI typing for delegated access |
| `apps/web/src/lib/api/index.ts` | Re-exported scope types | UI integration |
| `apps/web/src/lib/api/admin.ts` | Added access-scope admin API calls | Admin UI management |
| `apps/web/src/app/admin/users/actions.ts` | Added create/delete scope assignment actions | Minimal admin UI alignment |
| `apps/web/src/app/admin/users/page.tsx` | Added delegated scope KPI, listing, creation, deletion, and banners | Minimal admin UI alignment |
| `apps/api/test/integration/delegated-access-scopes.test.cjs` | Added end-to-end delegated-access coverage | Supported-scope verification |
| `apps/web/test/integration/admin-users-route-contract.test.cjs` | Added admin UI scope-management assertions | UI alignment verification |

## 6. Tests Added/Updated

| Test File | Coverage | Result |
|---|---|---|
| `apps/api/test/integration/delegated-access-scopes.test.cjs` | Category, brand, channel, connector-account delegated access; tenant-safe assignment admin API; conjunctive scope-intersection semantics; denial auditing | Passing |
| `apps/web/test/integration/admin-users-route-contract.test.cjs` | Admin-only delegated scope management UI, visibility, banners, actions | Passing |
| `apps/api/test/integration/access-policy-remediation.test.cjs` | Regression for restricted writes/payloads and denial audit logging | Passing |
| `apps/api/test/integration/product-workflow-transitions.test.cjs` | Regression for workflow locking | Passing |
| `apps/api/test/integration/workspace-user-crud.test.cjs` | Regression for stale JWT rejection after later lock/deactivation | Passing |

## 7. Commands Run

| Command | Result | Notes |
|---|---|---|
| `npm run prisma:generate` | Passed | Prisma client regenerated after schema change |
| `npm run prisma:migrate -- --name add_access_scope_assignments` | Blocked | Existing local migration drift required reset; not executed destructively |
| Local Prisma raw SQL apply for `AccessScopeAssignment` schema | Passed | Used only to make local validation database match committed migration |
| `npm run build --workspace @pim1/api` | Passed | Final API build clean |
| `npm run build --workspace @pim1/web` | Passed | Final web build clean |
| `node apps/api/test/integration/delegated-access-scopes.test.cjs` | Passed | Supported delegated scopes verified |
| `node apps/api/test/integration/access-policy-remediation.test.cjs` | Passed | No regression in prior milestone protections |
| `node apps/api/test/integration/product-workflow-transitions.test.cjs` | Passed | Workflow lock protections preserved |
| `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Stale JWT protections preserved |
| `node apps/api/test/integration/auth-revocation.test.cjs` | Passed | JWT revocation preserved |
| `node apps/api/test/integration/connector-access-entitlements.test.cjs` | Passed | Connector entitlement behavior preserved |
| `node apps/api/test/integration/rls-isolation.test.cjs` | Passed | Tenant isolation preserved |
| `node apps/api/test/integration/audit-tenant-boundary.test.cjs` | Passed | Audit tenant boundaries preserved |
| `node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs` | Passed | Bulk import tenant boundaries preserved |
| `node apps/web/test/integration/admin-users-route-contract.test.cjs` | Passed | Admin UI delegated scope management verified |

## 8. Residual Risks

| Risk | Reason | Impact | Follow-Up |
|---|---|---|---|
| Unsupported scopes remain unimplemented | Current schema has no safe catalog/vendor/supplier/locale/team/assignee scope model | High for full enterprise delegated-access claims | Add explicit product/schema decisions and migrations |
| UI filtering is intentionally minimal | This pass prioritized backend enforcement and admin scope management | Medium | Add scoped list/detail UI contract and e2e coverage for non-admin users |
| Scope rollout is assignment-activated per tenant | Preserves existing tenants with no delegated-access setup, but means non-admins are not globally auto-restricted until assignments exist | Medium | Decide whether future tenants should default to mandatory scope setup |
| Export job list/history filtering is only partial | Current export job records do not carry full delegated scope metadata beyond product/category/channel relationships | Medium | Add richer export-job visibility model if product policy requires historical job scoping |

## 9. Follow-Up Tickets

- `ACCESS-SCOPE-001`: Add catalog scope model and enforce catalog-scoped delegated access if catalogs become a governed domain object.
- `ACCESS-SCOPE-002`: Add vendor/owner ownership model and enforce owner-scoped access across products, assets, jobs, imports, exports, and connectors.
- `ACCESS-SCOPE-003`: Add supplier model and supplier-scoped delegated access if supplier governance is required.
- `ACCESS-SCOPE-004`: Define locale/market-scoped product data model and add locale/market delegated access enforcement.
- `ACCESS-SCOPE-005`: Add team membership and assignee ownership schema for team/assignee delegated access.
- `ACCESS-SCOPE-006`: Add non-admin scoped UI/e2e coverage for in-scope product lists, out-of-scope detail navigation, and disabled action controls.
- `ACCESS-SCOPE-007`: Decide whether delegated-access should remain assignment-activated per tenant or become mandatory for selected enterprise tenants.
- `ACCESS-SCOPE-008`: Reconcile local migration drift so `prisma migrate dev` can run cleanly without manual local SQL.

## 10. PR Summary

Title:
Enterprise delegated-access milestone: tenant-safe scope assignments and scope-aware enforcement

Summary:
- added tenant-safe delegated scope assignments for category, brand, channel, and connector account
- added admin backend and minimal admin UI for delegated scope visibility and management
- extended access policy to enforce supported scopes across catalog, media, bulk import, bulk edit, marketplace, and connector paths
- preserved prior remediation protections for workflow locking, stale JWT handling, restricted payloads, and denial auditing
- verified supported scope denials with sanitized audit evidence and preserved tenant-boundary protections

Test Plan:
- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`
- `node apps/api/test/integration/delegated-access-scopes.test.cjs`
- `node apps/api/test/integration/access-policy-remediation.test.cjs`
- `node apps/api/test/integration/product-workflow-transitions.test.cjs`
- `node apps/api/test/integration/workspace-user-crud.test.cjs`
- `node apps/api/test/integration/auth-revocation.test.cjs`
- `node apps/api/test/integration/connector-access-entitlements.test.cjs`
- `node apps/api/test/integration/rls-isolation.test.cjs`
- `node apps/api/test/integration/audit-tenant-boundary.test.cjs`
- `node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`
- `node apps/web/test/integration/admin-users-route-contract.test.cjs`

Risk Notes:
- full enterprise delegated-access is still incomplete because unsupported scopes are not implemented
- backend enforcement is authoritative; UI support is intentionally minimal in this phase
- local migration drift must still be cleaned up before relying on `prisma migrate dev` in this environment

Rollback Considerations:
- revert delegated-access files as a focused batch if operational access regressions appear
- preserve prior access-policy remediation protections if partial rollback is required
- if schema rollback is needed, remove `AccessScopeAssignment` only after confirming no tenant is actively using delegated scopes
