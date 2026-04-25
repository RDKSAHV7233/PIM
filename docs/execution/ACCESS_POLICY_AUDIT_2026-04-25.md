# Vexa PIM Access Policy Audit

Review date: 2026-04-25  
Auditor role: Senior PIM Architect, Security Auditor, QA Engineer  
Source of truth: current repository at audit time  
Runtime verification: static code review plus selected UI contract tests; live staging/API penetration tests were not executed.

## 1. Executive Summary

Overall result: **⚠️ Partial, not production-ready for strict enterprise access policy**

Vexa PIM has a real authentication and coarse RBAC foundation: global JWT/API-key auth, global role guard, tenant context, tenant-scoped Prisma extension, admin-only workspace user/API key management, connector entitlements, credential encryption, and audit logging for successful mutations.

However, the current system is **not a complete access policy system**. Verified gaps include missing field-level security, missing vendor/category/brand ownership scopes, incomplete workflow locking, broad default read access, incomplete permission-violation auditing, and at least two high-risk API authorization gaps:

| Finding | Status | Evidence | Risk |
|---|---|---|---|
| Global auth and RBAC are registered | ✅ Working | `apps/api/src/app.module.ts`, `JwtAuthGuard`, `RbacGuard` | Baseline control exists |
| Viewer/reviewer read access is broad by default | ⚠️ Partial | `RbacGuard` allows all authenticated `GET`, `HEAD`, `OPTIONS` when no `@Roles` exists | Sensitive read paths require explicit role decorators |
| `GET /api/v1/audit/logs` is readable by any authenticated role | 🔴 Security risk | `apps/api/src/audit/audit.controller.ts` has no `@Roles` on `listLogs`; default `GET` allows all roles | Audit/event metadata exposure |
| Deactivated users can likely keep using existing JWTs until expiry | 🔴 Security risk | `WorkspaceUsersService.deactivateUser` sets `isActive=false`; `JwtAuthGuard` checks token blocklist and tenant suspension, not current user activity | Suspended user session persistence |
| Approved/archived products are not content-locked | 🔴 Security risk | `CatalogService.updateProduct` updates product content when current and next status are equal, including `approved` and `archived` | Unauthorized post-approval changes by writer role |
| Field-level security is not implemented | ❌ Missing | No field policy model/service found; product/variant fields are updated as full DTOs | Restricted price/cost/status fields can be read/changed by allowed writers |
| Vendor/category/brand ownership scopes are not implemented | ❌ Missing | Roles are `admin`, `editor`, `reviewer`, `viewer`; product schema has `brand` but no owner/vendor scope field | Vendor isolation and category manager policies cannot be enforced |
| Connector install/reconnect/uninstall permissions exist | ✅ Working | `ConnectorPermission` model and `ConnectorPermissionService.assertActionAllowed` | Connector lane actions can be delegated |
| Connector payload preview lacks connector entitlement check | ⚠️ Partial | `ConnectorInstallerService.previewPayload` does not receive actor or call `assertActionAllowed` | Product export preview may bypass connector-specific permission rules |
| Audit logging exists but does not cover denied RBAC globally | ⚠️ Partial | `AuditLogInterceptor` logs successful non-read requests; specific step-up denials logged separately | Permission abuse investigations incomplete |

## 2. Audit Scope

Reviewed:

- API guards, decorators, controllers, services, middleware, interceptors.
- Prisma schema, migrations, tenant scoping extension.
- Role assignment and workspace user management.
- API key management.
- Product workflow and review behavior.
- Connector permission, installation, credential, webhook, and mapping controls.
- UI permission helpers and selected UI route contract tests.
- Authorization-related integration tests present in the repository.

Not verified:

- Live staging behavior.
- Browser screenshots for access policy pages.
- Real API requests against a running local/staging service for every role/scenario.
- Production environment variables, secrets, external SSO, or real customer data.

## 3. Evidence Sources Reviewed

| Area | Evidence |
|---|---|
| Global auth/RBAC | `apps/api/src/app.module.ts`, `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/common/rbac/rbac.guard.ts`, `apps/api/src/common/rbac/roles.ts` |
| Tenant isolation | `apps/api/src/common/tenant/tenant-context.middleware.ts`, `apps/api/src/prisma/extensions/tenant-scope.ts`, `packages/db/prisma/schema.prisma` |
| Role/user model | `packages/db/prisma/schema.prisma`, `apps/api/src/workspace-users/workspace-users.controller.ts`, `apps/api/src/workspace-users/workspace-users.service.ts` |
| Login/deactivation | `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/workspace-users/workspace-users.service.ts` |
| API keys | `apps/api/src/api-keys/api-keys.controller.ts`, `apps/api/src/api-keys/api-keys.service.ts` |
| Product workflow | `apps/api/src/catalog/catalog.controller.ts`, `apps/api/src/catalog/catalog.service.ts`, `packages/db/prisma/migrations/20260305222000_workflow_status_states/migration.sql` |
| Connectors | `apps/api/src/connector-installer/connector-installer.controller.ts`, `apps/api/src/connector-installer/connector-installer.service.ts`, `apps/api/src/connector-installer/connector-permission.service.ts`, `apps/api/src/connector-installer/credential-encryption.service.ts` |
| Webhooks | `apps/api/src/connector-framework/connector-webhook-relay.controller.ts`, `apps/api/src/connector-framework/connector-webhook-processing.service.ts` |
| Audit logs | `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/common/audit/audit-log.interceptor.ts` |
| UI permission behavior | `apps/web/src/lib/role-capabilities.ts`, admin/product/mapping route contract tests |
| Tests executed | `node apps/web/test/integration/quality-reviewer-role-ui.test.cjs`, `node apps/web/test/integration/admin-api-keys-route-contract.test.cjs`, `node apps/web/test/integration/connector-access-admin-form.test.cjs` |

## 4. Current State Analysis

### 4.1 User and Role Model

Current state:

- Roles are statically defined as `admin`, `editor`, `reviewer`, and `viewer`.
- A workspace user has one role stored on `AuthIdentity.role`.
- API keys also have a single role on `ApiAccessKey.role`; service code prevents admin API keys.
- Workspace user management is admin-only.
- Login checks inactive/locked users through identity resolution.
- Existing user JWTs are not revalidated against `AuthIdentity.isActive` on every request.
- No SSO, group mapping, multi-role, role priority, vendor role, category manager role, or supplier role was verified in code.

| Role | Source/Evidence | Assignment Method | Multi-role Support | Current Status | Notes |
|---|---|---|---|---|---|
| admin | `APP_ROLES`, `AuthIdentity.role`, workspace users controller | Public signup first admin, workspace admin CRUD, seeded/local identities | ❌ No | ✅ Working | Can manage users, API keys, settings-style admin routes |
| editor | `APP_ROLES`, `DEFAULT_WRITE_ROLES` | Workspace admin CRUD or seeded/local identities | ❌ No | ✅ Working | Default write role for unannotated non-read endpoints |
| reviewer | `APP_ROLES`, `CatalogController.review-decision`, UI capability helper | Workspace admin CRUD or seeded/local identities | ❌ No | ⚠️ Partial | Can approve/reject products, but read-only elsewhere in UI tests |
| viewer | `APP_ROLES`, default role utilities | Workspace admin CRUD, API key default, env default | ❌ No | ✅ Working | Broad authenticated read access |
| vendor | No role/model found | Not implemented | ❌ No | ❌ Missing | Vendor-specific access is not currently enforceable |
| category manager | No role/model found | Not implemented | ❌ No | ❌ Missing | Category-scoped access is not currently enforceable |

### 4.2 Permission Matrix

Current backend behavior uses:

- Explicit `@Roles(...)` where present.
- Default read access for authenticated users.
- Default write access for `admin` and `editor` where `@Roles(...)` is absent.

| Role | View | Create | Edit | Delete | Approve | Publish | Import | Export | Admin Settings | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| admin | ✅ Enforced broadly | ✅ Enforced | ✅ Enforced | ✅ Enforced | ✅ Enforced | ✅ Enforced | ✅ Enforced | ✅ Enforced | ✅ Enforced | `RbacGuard`, controller `@Roles("admin")` |
| editor | ✅ Enforced broadly | ✅ Enforced for many writes | ✅ Enforced for many writes | ⚠️ Partially enforced | ✅ Enforced for product review currently | ✅ Enforced for mapping publish/export jobs where allowed | ✅ Enforced by default write rule | ✅ Enforced by default write rule | ❌ Denied on admin routes | `DEFAULT_WRITE_ROLES`, `CatalogController`, `MarketplaceController` |
| reviewer | ✅ Enforced broadly | ❌ Denied by default | ❌ Denied by default | ❌ Denied by default | ✅ Enforced for product review | ❌ Denied by default or explicit roles | ❌ Denied by default | ✅ Can read export job lists where GET | ❌ Denied | `CatalogController.review-decision`, UI tests |
| viewer | ✅ Enforced broadly | ❌ Denied by default | ❌ Denied by default | ❌ Denied by default | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Can read export job lists where GET | ❌ Denied | `RbacGuard` |

Expected state:

- Admin, editor, reviewer, viewer should be defined by a policy matrix, not only controller decorators.
- Approval should support segregation-of-duties rules if required by product policy.
- Sensitive read endpoints must opt into stricter roles.
- Import/export should use field and object policy checks.

### 4.3 Scope-Control Matrix

| Scope Type | UI Enforced? | API Enforced? | DB/Query Enforced? | Evidence | Status | Risk |
|---|---|---|---|---|---|---|
| Tenant/account | ❓ Not fully verified in UI | ⚠️ Partial | ✅ Mostly | `TenantContextMiddleware`, `Prisma tenant-scope`, tenant indexes | ⚠️ Partial | Raw SQL/direct Prisma paths need continuous test coverage |
| Catalog | ❌ No distinct model found | ❌ Missing | ❌ Missing | No catalog scope model found | ❌ Missing | Cannot restrict by catalog |
| Category | ❌ No scoped role UI found | ❌ Missing | ❌ Missing | Product has `categoryId`; no category assignment policy found | ❌ Missing | Category manager access impossible |
| Product family/type | ❌ Missing | ❌ Missing | ❌ Missing | No family/type policy model found | ❌ Missing | Product-family governance unavailable |
| Channel | ⚠️ Mapping UI has channel selection | ⚠️ Partial | ⚠️ Partial | Marketplace mapping endpoints are channel-aware, not user-scoped | ⚠️ Partial | Users with write access can operate broadly |
| Locale/market | ❓ Not verified | ❓ Not verified | ❓ Not verified | No access policy evidence found | ❓ Not verified | Locale-specific access unknown |
| Brand | ❌ Missing | ❌ Missing | ❌ Missing | Product has `brand`, no brand-scope policy | ❌ Missing | Brand owner restrictions impossible |
| Supplier/vendor | ❌ Missing | ❌ Missing | ❌ Missing | No vendor ownership field/role found | ❌ Missing | Vendor isolation not enforceable |
| Organization/team | ❌ Missing | ❌ Missing | ❌ Missing | No team policy model found | ❌ Missing | Team-scoped permissions unavailable |
| Connector account alias | ⚠️ Admin form exists | ✅ Enforced for install/reconnect/uninstall/publication targets | ✅ `ConnectorPermission` tenant/account fields | `ConnectorPermissionService.assertActionAllowed` | ✅ Working for connector actions | Payload preview gap remains |

### 4.4 Field-Level Security Matrix

No centralized field-level policy service, field permission table, read redaction layer, import/export redaction layer, or DTO-level restricted field enforcement was found.

| Field/Attribute | Restricted For | UI Read | UI Write | API Read | API Write | Import/Export | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| Price / selling price / MRP | Not defined | ❓ Not verified | ❓ Not verified | ❌ Not restricted | ❌ Not restricted for writers | ❌ Not restricted | ❌ Not implemented | `Variant` has `mrp`, `sellingPrice`; no field policy service found |
| SKU | Not defined | ❓ Not verified | ❓ Not verified | ❌ Not restricted | ❌ Not restricted for writers | ❌ Not restricted | ❌ Not implemented | `Variant.skuCode`, full DTO update paths |
| Inventory | Not defined | ❓ Not verified | ❓ Not verified | ❌ Not restricted | ❌ Not restricted for writers | ❌ Not restricted | ❌ Not implemented | `Variant.inventoryQty` |
| Supplier/vendor data | Not applicable to current schema | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Not implemented | No supplier/vendor fields found |
| Channel-specific fields | Not defined | ⚠️ Partial | ⚠️ Partial | ❌ Not restricted | ❌ Not restricted for writers | ❌ Not restricted | ⚠️ Partial | Mapping templates are channel-aware, not user field-policy-aware |
| SEO fields | Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | No explicit access policy evidence found |
| Media/assets | Not defined | ✅ Tenant scoped | ✅ Default writer role | ✅ Tenant scoped | ✅ Default writer role | ❌ No field redaction | ⚠️ Partial | `MediaController`, tenant scope |
| Approval status | Reviewer/editor/admin | ✅ UI partial | ✅ UI partial | ✅ Endpoint role protected | ⚠️ Editor can approve | ❓ Not verified | ⚠️ Partial | `CatalogController.review-decision` includes editor |
| Published status | Not fully modeled for product | ❓ Not verified | ❓ Not verified | ⚠️ Mapping publish roles | ⚠️ Mapping publish roles | ⚠️ Export jobs writer-gated | ⚠️ Partial | Marketplace mapping/export controllers |

### 4.5 Workflow Access Matrix

Current product workflow statuses: `draft`, `in_review`, `approved`, `rejected`, `archived`; `active` is canonicalized to `approved`.

| Workflow Stage | Editable By | Approvable By | Publishable By | API Enforcement | UI Enforcement | Status | Evidence |
|---|---|---|---|---|---|---|---|
| Draft | admin/editor | Not applicable until review | Not verified as product publish | ✅ Role + transition validation | ⚠️ UI writer gating | ✅ Working | `CatalogController`, `CatalogService.assertDraftWorkflowEntry` |
| In review | admin/editor can update; admin/editor/reviewer can decide | admin/editor/reviewer | Not verified | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial | `review-decision` roles include editor |
| Approved | admin/editor can content-edit if status remains approved | Not applicable | Marketplace publish separate | 🔴 Content lock missing | ❓ Not verified | 🔴 Security risk | `updateProduct` updates content when transition is same status |
| Rejected | admin/editor can update/transition | Not applicable | Not verified | ⚠️ Partial | ❓ Not verified | ⚠️ Partial | `WORKFLOW_TRANSITIONS` |
| Archived | admin/editor can content-edit if status remains archived | Not applicable | Not applicable | 🔴 Content lock missing | ❓ Not verified | 🔴 Security risk | `updateProduct` same-status updates |
| Locked | No dedicated lock state found | Not applicable | Not applicable | ❌ Missing | ❌ Missing | ❌ Missing | No lock model/service found |

Expected state:

- Approved, published, archived, and locked records should reject content updates unless a controlled reopen/unlock transition is authorized and audited.
- Approval should be separated from editing if segregation of duties is required.
- API enforcement must be the source of truth.

## 5. API Security Test Results

These results are based on static code verification unless marked otherwise. Live request/response validation is **NOT VERIFIED** for scenarios not executed against a running API.

| Test | Role/User | Endpoint | Request Summary | Expected Response | Actual Response | Status Code | Result | Evidence |
|---|---|---|---|---|---|---|---|---|
| Unauthenticated protected access | None | Any non-public endpoint | No Bearer/API key | 401 | `JwtAuthGuard` throws unauthorized | 401 by code | PASS static | `JwtAuthGuard.canActivate` |
| Legacy header bypass | Header-only actor | Any protected endpoint | `x-pim-role` or tenant header | 403 | Guard rejects legacy headers | 403 by code | PASS static | `JwtAuthGuard` |
| Viewer create product | viewer | `POST /catalog/products` | Create product | 403 | Explicit `@Roles("admin","editor")` | 403 by code | PASS static | `CatalogController` |
| Viewer update product | viewer | `PATCH /catalog/products/:id` | Update product | 403 | Explicit `@Roles("admin","editor")` | 403 by code | PASS static | `CatalogController` |
| Editor approve product | editor | `POST /catalog/products/:id/review-decision` | Approve | Expected depends on policy; for strict SoD, deny | Current code allows editor | 201/200 by code | FAIL vs strict expected | `@Roles("admin","editor","reviewer")` |
| Edit approved product | editor | `PATCH /catalog/products/:id` | Change title, keep `status=approved` | 403 or workflow lock denial | Current service allows same-status update | 200 by code | FAIL static | `CatalogService.updateProduct` |
| Deactivated user token | deactivated user | Any protected endpoint | Use already-issued JWT after deactivation | 401/403 | Guard does not query `AuthIdentity.isActive` | 200 likely until token expiry | FAIL static | `WorkspaceUsersService.deactivateUser`, `JwtAuthGuard` |
| Audit log read | viewer/reviewer | `GET /audit/logs` | Read logs | 403 admin-only | No `@Roles`; default GET allowed | 200 by code | FAIL static | `AuditController.listLogs`, `RbacGuard` |
| Cross-tenant direct object access | authenticated tenant A | Product/category/media ID from tenant B | Read/update direct ID | 404/403 | Tenant-scope extension injects tenant for scoped models | Not live-tested | NOT VERIFIED | `tenant-scope.ts`; tests exist but not run |
| Restricted field edit | vendor/restricted user | Product/variant update | Update price/status | 403 | Vendor role and field policy not implemented | Blocked | BLOCKED | No vendor/field policy found |
| Bulk update bypass | restricted user | `POST /bulk-edit/apply` | Restricted update | 403/field denial | Default write roles only; no field policy | Not live-tested | NOT VERIFIED | `BulkEditController`, `RbacGuard` |
| Import bypass | restricted user | `POST /bulk-import/jobs/:id/process` | Restricted field import | 403/validation error | Default write roles only; no field policy | Not live-tested | NOT VERIFIED | `BulkImportController`, `RbacGuard` |
| Export restricted data | restricted user | Export/list endpoints | Export restricted fields | Redacted or denied | No field redaction policy found | Not live-tested | NOT VERIFIED | Marketplace/export paths |

## 6. UI Security Test Results

Selected UI contract tests were executed successfully on 2026-04-25:

- `node apps/web/test/integration/quality-reviewer-role-ui.test.cjs`
- `node apps/web/test/integration/admin-api-keys-route-contract.test.cjs`
- `node apps/web/test/integration/connector-access-admin-form.test.cjs`

| UI Area | Role | Expected Behavior | Actual Behavior | Backend Also Enforced? | Status | Evidence |
|---|---|---|---|---|---|---|
| Approval queue | reviewer | Decision actions available, non-review edits restricted | Contract test passed | ⚠️ Backend allows reviewer on review endpoint | ✅ Working | `quality-reviewer-role-ui.test.cjs` |
| General workspace edit surfaces | reviewer/viewer | Read-only outside approval decisions | Contract test passed for reviewer role helper coverage | ✅ Default write denies reviewer/viewer | ✅ Working for tested paths | `role-capabilities.ts`, UI test |
| Admin API keys page | non-admin | Mutations admin-only | Contract test passed | ✅ `ApiKeysController @Roles("admin")` | ✅ Working | `admin-api-keys-route-contract.test.cjs` |
| Connector access admin form | admin | Role/user grants visible and failure mapping surfaced | Contract test passed | ✅ Permission endpoints admin-only | ✅ Working | `connector-access-admin-form.test.cjs` |
| Product approved-state lock | editor | Approved product read-only or unlock required | ❓ Not verified in UI | 🔴 Backend lock missing | 🔴 Security risk | Backend evidence |
| Audit log page/API | viewer/reviewer | Logs admin-only | ❓ UI not verified | 🔴 `/audit/logs` backend broad read | 🔴 Security risk | Backend evidence |
| Sensitive data in client state | all | No secret leakage | ❓ Not verified | ❓ Not verified | ❓ Not verified | Requires browser/network inspection |

## 7. Connector and Integration Access Review

| Connector/Integration | Access-Controlled? | Restricted Fields Protected? | Credentials Protected? | Audit Logged? | Status | Evidence |
|---|---|---|---|---|---|---|
| Connector install | ✅ Yes | ❌ No field policy | ✅ Encrypted | ✅ Permission grants/install audit evidence | ✅ Working | `ConnectorPermissionService.assertActionAllowed`, `CredentialEncryptionService` |
| Connector reconnect/uninstall | ✅ Yes | ❌ No field policy | ✅ Encrypted | ✅ Partial | ✅ Working | `ConnectorInstallerService.reconnect/uninstall` |
| OAuth callback/publication targets | ✅ Yes | ❌ No field policy | ✅ Encrypted | ⚠️ Partial | ✅ Working | `handleOAuthCallback`, `updatePublicationTargets` call permission service |
| Product type schema/publications | ✅ Uses reconnect permission | Not applicable | Not applicable | ⚠️ Partial | ⚠️ Partial | `fetchProductTypeSchema`, `listPublications` |
| Payload preview | ⚠️ Default writer role only | ❌ No redaction | Not applicable | ❓ Not verified | 🔴 Security risk | `previewPayload` has no actor permission check |
| Connector webhook relay | ✅ Shared relay token | Not applicable | Token via env | ⚠️ Processing logs, not full user audit | ⚠️ Partial | `ConnectorWebhookRelayController` is public but token-gated |
| File imports | ⚠️ Default writer role | ❌ No field policy | Not applicable | ⚠️ Partial | ⚠️ Partial | `BulkImportController`, no field access policy |
| File exports/marketplace exports | ⚠️ Default writer/read role depending endpoint | ❌ No field policy | Not applicable | ⚠️ Partial | ⚠️ Partial | Marketplace export endpoints |
| Scheduled jobs/background syncs | ❓ Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | ❓ Not verified | Requires queue/job audit |

## 8. Audit Logging Review

| Event Type | Logged? | Log Location | Required Fields Present? | Status | Evidence |
|---|---|---|---|---|---|
| Successful non-read HTTP mutations | ✅ Yes | `AuditLog` table | actor, role, action/resource/path, status metadata | ✅ Working | `AuditLogInterceptor` |
| Product workflow transitions | ✅ Yes | `AuditLog` table | actor, role, from/to status | ✅ Working | `CatalogService.updateProduct`, `decideProductReview` |
| Workspace user changes | ✅ Yes | `AuditLog` table | actor, target user | ✅ Working | `WorkspaceUsersService` |
| API key create/revoke | ✅ Yes | `AuditLog` table | actor, key id/label | ✅ Working | `ApiKeysService` |
| Connector permission grant/revoke | ✅ Yes | `AuditLog` table | actor, connector/action | ✅ Working | `ConnectorPermissionService` |
| Permission violations | ⚠️ Partial | Step-up denial only verified | Not global | ⚠️ Partial | `StepUpGuard` audits denials; `RbacGuard` does not |
| Audit log access | ⚠️ Logged only if read logging exists elsewhere | `GET /audit/logs` is broadly readable | Not enough | 🔴 Security risk | `AuditController.listLogs` |
| Secret redaction in logs | ✅ Partial | Audit metadata sanitizer | Redacts key/token/secret-like values | ✅ Working | `AuditService.sanitizeMetadata` |

## 9. Gap Analysis

| Module | Current State | Expected State | Gap | Risk Level | Evidence | Required Action |
|---|---|---|---|---|---|---|
| Auth session validity | JWT validates signature, revocation, tenant suspension | Deactivated/locked user tokens denied immediately | No per-request active user check or revoke-on-deactivate evidence | Critical | `JwtAuthGuard`, `WorkspaceUsersService.deactivateUser` | Revalidate user status or revoke all active user tokens on deactivate/lock |
| Audit logs | `/audit/events` admin-only; `/audit/logs` not admin-only | All audit reads admin/security-only | Sensitive audit endpoint inherits broad GET access | High | `AuditController` | Add `@Roles("admin")`, test viewer denial |
| Workflow locking | Status transitions enforced | Approved/published/archived content locked | Same-status update bypasses lock | Critical | `CatalogService.updateProduct` | Add workflow lock guard for content updates |
| Field-level policy | No field policy | Field read/write/import/export enforcement | Restricted fields cannot be protected | High | Schema/service inspection | Add field policy service/redaction/write guard |
| Scope policy | Tenant scope only plus connector action scope | Category/catalog/brand/vendor/team scopes | Object-level ownership scopes missing | High | Role/schema inspection | Add scope assignments and query filters |
| Connector payload preview | Default writer RBAC only | Connector entitlement checked for preview/export | Preview bypasses connector-specific permissions | High | `ConnectorInstallerService.previewPayload` | Pass actor and check permission |
| Bulk import/export | Coarse role controls | Field/object policies applied | Can bypass missing field/scope controls | High | `BulkImportController`, marketplace controllers | Apply policy service to import/export jobs |
| RBAC default reads | Any authenticated role can GET unannotated endpoint | Sensitive reads explicitly annotated | Data exposure depends on route omissions | Medium | `RbacGuard` | Require explicit read roles or route allowlist |
| Denied access auditing | Some specific denials logged | All authz denials logged with actor/target/result | Rbac denials not globally audited | Medium | `RbacGuard`, `AuditLogInterceptor` | Add denial audit in guards/filter |
| Vendor isolation | No vendor role/owner model | Vendor users see only own products/assets/jobs | Missing product/vendor ownership model | High | `Product` schema | Add vendor ownership model and tests |

## 10. Required Enhancements

| Enhancement | Reason | Priority | Security Impact | Product Impact | Affected Files/Modules |
|---|---|---|---|---|---|
| Central policy service | Replace scattered/coarse role checks with one decision point | High | High | Consistent behavior | `common/access-policy`, guards, services |
| Active-user JWT revalidation or token revocation | Prevent deactivated users retaining access | High | Critical | Safer admin operations | `JwtAuthGuard`, `WorkspaceUsersService`, token store |
| Audit endpoint hardening | Protect audit data | High | High | Admin-only audit explorer | `AuditController`, tests |
| Workflow content lock | Protect approved/published records | High | Critical | Trustworthy approvals | `CatalogService`, DTOs, UI |
| Field-level read/write policy | Protect price, inventory, status, vendor data | High | High | Enterprise access readiness | Product/variant/media/import/export services |
| Scope assignments | Category/brand/vendor/catalog/team access | High | High | Enterprise PIM governance | Prisma schema, auth/user admin UI |
| Connector preview authorization | Prevent connector permission bypass | High | High | Safer channel operations | `ConnectorInstallerController/Service` |
| Import/export policy filters | Stop batch bypasses | High | High | Safer operations | Bulk import/edit/export modules |
| Denial audit logging | Security investigations | Medium | Medium | Better admin observability | Guards, exception filters, audit service |
| Explicit read-role annotations | Avoid accidental broad reads | Medium | Medium | Clearer API contracts | Controllers |

## 11. Final Fix Plan

### Issue 1: Deactivated users can likely keep active JWT access

Current state: Login blocks inactive users, but request-time JWT auth does not check `AuthIdentity.isActive`. Deactivation sets `isActive=false` only.

Expected state: Deactivated or locked users are denied immediately, including already-issued JWTs.

Root cause: JWT validation trusts token claims after signature/revocation checks.

Fix:

- Add request-time user status validation for user JWTs, cached briefly if performance is a concern.
- Or add per-user token version/session table and revoke all active sessions when lock/deactivate occurs.
- Add integration tests for deactivate-then-use-old-token and lock-then-use-old-token.

Files/modules to change:

- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/workspace-users/workspace-users.service.ts`
- `apps/api/src/auth/jwt-blocklist.service.ts` or new session table/service
- API auth tests

Acceptance criteria:

- Active JWT for deactivated user returns 401/403.
- Active JWT for locked user returns 401/403.
- Reactivated/unlocked behavior is explicit and tested.
- Denial is audited without exposing secrets.

### Issue 2: Audit logs endpoint is not admin-only

Current state: `GET /audit/logs` lacks `@Roles("admin")`, so all authenticated roles can read it by default.

Expected state: Audit logs and exports are admin/security-only.

Root cause: Broad default GET rule plus missing decorator.

Fix:

- Add `@Roles("admin")` to `listLogs`.
- Add tests for viewer/reviewer/editor denial unless editor access is explicitly desired.
- Consider consolidating `/audit/logs` and `/audit/events` to one canonical admin endpoint.

Files/modules:

- `apps/api/src/audit/audit.controller.ts`
- `apps/api/test/integration/audit-explorer-api.test.cjs`
- `apps/web` audit/admin route tests if present

Acceptance criteria:

- Viewer/reviewer/editor cannot access `/api/v1/audit/logs`.
- Admin can access logs.
- Failed attempts are audited or visible in security logs.

### Issue 3: Approved and archived products are editable

Current state: `CatalogService.updateProduct` allows content updates if the requested status equals current status.

Expected state: Approved, published, archived, or locked products reject content edits unless reopened/unlocked through an authorized workflow action.

Root cause: Workflow validation only checks status transitions, not content mutability by stage.

Fix:

- Add workflow mutability guard before applying content updates.
- Allow status-only transitions according to policy.
- Add an explicit reopen/unlock endpoint if needed.
- Add UI read-only state backed by API policy response.

Files/modules:

- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/web/src/components/product/CreateProductForm.tsx` or product edit pages
- Product workflow tests

Acceptance criteria:

- Editor cannot edit content of approved/archived products.
- Authorized admin workflow transition is audited.
- API and UI agree on read-only state.

### Issue 4: Field-level security is missing

Current state: No field policy model/service or import/export redaction layer was found.

Expected state: Field read/write restrictions are enforced in API, UI, import, export, bulk edit, and connector payload generation.

Root cause: Access model is role/controller based only.

Fix:

- Add `AccessPolicyService` with field permission decisions.
- Define restricted fields and role/scope rules.
- Apply read redaction and write validation on product, variant, media, import, export, connector preview/publish paths.
- Add regression tests for direct API, import, export, bulk edit, and connector payloads.

### Issue 5: Vendor/category/brand scope control is missing

Current state: Only tenant scope and connector account action scope are implemented.

Expected state: Policies can restrict by catalog, category, brand, vendor, channel, locale, and assigned team where required.

Root cause: Schema lacks ownership/scope assignment models, and services do not apply scope filters.

Fix:

- Add role-scope assignment tables.
- Add product/vendor ownership fields if vendor access is a roadmap requirement.
- Apply query filters centrally.
- Add IDOR tests for out-of-scope direct IDs.

### Issue 6: Connector payload preview bypasses connector entitlement checks

Current state: Controller does not pass actor to `previewPayload`, and service does not call connector permission service.

Expected state: Preview/export/publish-like connector operations require connector-specific permission and field redaction.

Root cause: Preview path is implemented as data retrieval, not as a governed connector action.

Fix:

- Pass actor from controller to service.
- Add `preview` or `publish` action to connector permission model, or reuse a clearly documented action.
- Apply field redaction before returning preview.

## 12. Verification Test Cases

### A. API Tests

| Test ID | Role | Endpoint | Action | Expected Result | Actual Result | Status Code | PASS/FAIL | Evidence |
|---|---|---|---|---|---|---|---|---|
| API-001 | None | `/api/v1/catalog/products` | GET without auth | 401 Unauthorized | Not live-tested | Not verified | NOT VERIFIED | Add integration test |
| API-002 | viewer | `/api/v1/catalog/products` | POST create | 403 Forbidden | Static pass | 403 by code | PASS static | `@Roles("admin","editor")` |
| API-003 | viewer | `/api/v1/catalog/products/:id` | PATCH edit | 403 Forbidden | Static pass | 403 by code | PASS static | `@Roles("admin","editor")` |
| API-004 | editor | `/api/v1/catalog/products/:id/review-decision` | Approve product | Denied if SoD required | Current code allows | 200/201 by code | FAIL vs strict SoD | `@Roles("admin","editor","reviewer")` |
| API-005 | editor | `/api/v1/catalog/products/:id` | Edit approved product | Denied | Current code allows same-status content update | 200 by code | FAIL static | `CatalogService.updateProduct` |
| API-006 | viewer | `/api/v1/audit/logs` | Read audit logs | 403 Forbidden | Current code allows authenticated GET | 200 by code | FAIL static | `AuditController` |
| API-007 | deactivated user | Any protected endpoint | Use pre-existing JWT | 401/403 | Current guard does not check active user | 200 likely until expiry | FAIL static | `JwtAuthGuard` |
| API-008 | vendor | Product update | Update price/status | 403 Forbidden | Vendor role not implemented | Blocked | BLOCKED | No vendor role |
| API-009 | category manager | Product outside assigned category | Edit | 403 Forbidden | Category manager not implemented | Blocked | BLOCKED | No scope assignment model |
| API-010 | restricted user | Bulk import | Import restricted fields | Denied/error | Not live-tested; field policy missing | Not verified | NOT VERIFIED | Add test |
| API-011 | restricted user | Export/connector preview | Export restricted fields | Redacted/denied | Not live-tested; field policy missing | Not verified | NOT VERIFIED | Add test |
| API-012 | tenant A user | Tenant B product direct ID | GET/PATCH | 404/403 | Tenant extension suggests scoped | Not live-tested | NOT VERIFIED | Run RLS/IDOR tests |

### B. UI Tests

| Test ID | Role | UI Area | Expected Result | Actual Result | PASS/FAIL | Evidence |
|---|---|---|---|---|---|---|
| UI-001 | reviewer | Approval queue | Reviewer can decide, cannot edit workspace broadly | Passed contract test | PASS | `quality-reviewer-role-ui.test.cjs` |
| UI-002 | viewer | Product edit buttons | No edit/delete/publish buttons | Not live-tested | NOT VERIFIED | Add Playwright/browser test |
| UI-003 | editor | Approved product page | Fields read-only or unlock required | Backend fails lock | FAIL | Backend evidence |
| UI-004 | category manager | Product list | Only assigned category visible | Blocked | BLOCKED | Role/scope missing |
| UI-005 | vendor | Product/media access | Only vendor-owned records visible | Blocked | BLOCKED | Vendor role/scope missing |
| UI-006 | non-admin | Admin API keys page | Inaccessible or redirects | Passed route contract test | PASS | `admin-api-keys-route-contract.test.cjs` |
| UI-007 | non-admin | Audit logs page/API | Inaccessible | Backend endpoint not protected | FAIL | `AuditController.listLogs` |

### C. Database and Query Tests

Required:

- Direct product/category/media IDOR tests across tenants.
- Raw SQL/direct Prisma tenant boundary tests for modules outside `TENANT_SCOPED_MODELS`.
- Role-scope assignment query tests after scope model is added.
- Archived/deleted/soft-deleted product access tests.
- Connector installation and permission tenant-boundary tests.

Existing test files found but not executed in this audit include:

- `apps/api/test/integration/rls-isolation.test.cjs`
- `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`
- `apps/api/test/integration/dashboard-tenant-boundary.test.cjs`
- `apps/api/test/integration/media-tenant-boundary.test.cjs`
- `apps/api/test/integration/audit-tenant-boundary.test.cjs`
- `apps/api/test/integration/connector-access-entitlements.test.cjs`
- `apps/api/test/integration/auth-revocation.test.cjs`

### D. Regression Tests Required

- Role-based API denial for every mutation route.
- Explicit read-role tests for sensitive endpoints.
- Deactivated/locked user token invalidation.
- Field-level read/write denial.
- Workflow lock denial for approved/published/archived records.
- Import/export/bulk edit field-policy enforcement.
- Connector preview/publish entitlement enforcement.
- Vendor/category/brand scope IDOR denial after scope model is added.
- Audit logging for denied authorization.

## 13. Production Readiness Verdict

| Question | Answer | Evidence |
|---|---|---|
| Is the access policy system secure? | Partial | Global auth/RBAC exists, but field/scope/workflow gaps remain |
| Are there critical vulnerabilities? | Yes | Deactivated JWT persistence risk; approved record edit risk |
| Is API-level authorization enforced? | Partial | `JwtAuthGuard` and `RbacGuard` enforce coarse roles, not full field/object policy |
| Is UI-only enforcement used anywhere? | Yes/Partial | UI role helpers exist; backend enforces coarse role checks, but workflow/field policy gaps remain |
| Is vendor isolation secure? | No | Vendor role/ownership model not implemented |
| Is field-level security enforced? | No | No field policy model/service found |
| Is workflow locking enforced? | No/Partial | Transitions validated, content lock missing |
| Is it ready for production? | No for strict access policy requirements | High and critical gaps require remediation and retest |

Approval conditions:

1. Fix active-token invalidation for deactivated/locked users.
2. Restrict audit log read endpoints to admin/security roles.
3. Enforce workflow content locks for approved/published/archived states.
4. Implement field-level and object-scope policy service or explicitly document these as unsupported.
5. Apply access policy checks to import/export/bulk edit/connector preview and publish paths.
6. Run API, UI, DB, connector, and regression tests with evidence.

## 14. Jira-Ready Epics and Tasks

### Epic: Harden Authentication Session Revocation

Description: Ensure locked or deactivated users lose API access immediately.

Business Impact: Prevents former or suspended users from continuing to operate in the workspace.

Security Impact: Critical reduction in stale-session risk.

Acceptance Criteria:

- Existing JWTs for deactivated users are rejected.
- Existing JWTs for locked users are rejected.
- API keys remain governed by revoke/expiry logic.
- Denials are logged.

Tasks:

- Add active-user validation or token-version/session revocation to `JwtAuthGuard`.
- Revoke or invalidate active sessions in workspace user lock/deactivate flows.
- Add integration tests for deactivate/lock then reuse token.
- Add audit log coverage for denied inactive-user requests.

Priority: High

### Epic: Protect Audit Logs and Sensitive Read Endpoints

Description: Make audit/event logs admin-only and remove accidental broad-read exposure.

Business Impact: Prevents operational/security metadata leakage.

Security Impact: High.

Acceptance Criteria:

- `/api/v1/audit/logs`, `/api/v1/audit/events`, and exports are admin-only.
- Viewer/reviewer/editor tests return 403.
- Admin access still works.

Tasks:

- Add `@Roles("admin")` to `AuditController.listLogs`.
- Inventory sensitive GET endpoints and add explicit roles.
- Add API integration tests for audit endpoint denial.
- Add UI route tests for audit/admin pages.

Priority: High

### Epic: Enforce Workflow Content Locks

Description: Prevent unauthorized content updates after approval, publication, archive, or lock.

Business Impact: Preserves review and publishing integrity.

Security Impact: Critical for governed product data.

Acceptance Criteria:

- Approved/archived products reject content edits through API.
- Reopen/unlock flow is explicit, authorized, and audited.
- UI shows read-only state based on backend policy.

Tasks:

- Add workflow mutability guard in `CatalogService.updateProduct`.
- Add separate status-transition endpoint if needed.
- Add tests for editor/admin/reviewer workflow permissions.
- Add UI tests for locked product form state.

Priority: High

### Epic: Implement Central Access Policy Service

Description: Add a centralized policy service for role, scope, field, workflow, and connector decisions.

Business Impact: Enables enterprise PIM governance and repeatable QA.

Security Impact: High.

Acceptance Criteria:

- Policy service returns explicit allow/deny decisions with reason codes.
- Controllers/services call policy service for protected actions.
- UI can consume policy summaries without becoming the source of truth.

Tasks:

- Create `AccessPolicyService`.
- Define action constants: view, create, edit, delete, approve, reject, publish, import, export, manage connectors, manage settings.
- Add decision tests for all roles.
- Replace ad hoc checks incrementally.

Priority: High

### Epic: Add Field-Level Security Across Product Operations

Description: Restrict sensitive fields for read, write, import, export, bulk edit, and connectors.

Business Impact: Supports secure vendor and marketplace operations.

Security Impact: High.

Acceptance Criteria:

- Restricted fields are redacted from read/export paths for restricted roles.
- Restricted writes are rejected with 403 and clear errors.
- Import/bulk edit cannot bypass field restrictions.
- Connector preview/publish respects field policy.

Tasks:

- Define restricted field policy schema/config.
- Add read redaction layer.
- Add write validation to product/variant/media update paths.
- Add import/export/bulk edit enforcement.
- Add connector payload redaction tests.

Priority: High

### Epic: Add Scope-Based Access Control

Description: Enforce category, catalog, brand, vendor, channel, locale, and team scopes where product requires them.

Business Impact: Enables multi-team/vendor PIM operations.

Security Impact: High.

Acceptance Criteria:

- Users can be assigned scopes.
- Queries filter by assigned scopes.
- Direct ID access outside scope returns 403/404.
- Vendor users cannot access other vendors' products/assets/jobs.

Tasks:

- Add role-scope assignment schema/migrations.
- Add vendor/product ownership model if vendor access is required.
- Apply policy filters to product/media/import/export/connector paths.
- Add cross-scope IDOR tests.

Priority: High

### Epic: Govern Connector Preview, Export, and Background Actions

Description: Ensure connector operations cannot bypass role, field, scope, or workflow policies.

Business Impact: Safer marketplace/channel publishing.

Security Impact: High.

Acceptance Criteria:

- Preview/publish/export require connector entitlement.
- Restricted fields are removed or denied.
- Connector credentials/logs remain protected.
- Connector actions are audited.

Tasks:

- Pass actor into `previewPayload`.
- Add connector permission action for preview/export/publish.
- Apply policy service to connector payload generation.
- Add tests for unauthorized connector preview and restricted field export.

Priority: High

### Epic: Expand Access Policy Test Suite

Description: Build a complete regression suite for role, scope, field, workflow, connector, and audit controls.

Business Impact: Prevents access regressions before release.

Security Impact: High.

Acceptance Criteria:

- API tests cover all denial paths.
- UI tests prove controls are visible/read-only where expected.
- DB/query tests prove tenant and object scopes.
- Connector/import/export bypass tests are automated.

Tasks:

- Add API tests listed in Section 12.
- Add Playwright UI tests for role-specific pages.
- Add tenant/object IDOR tests.
- Add import/export/bulk/connector bypass tests.
- Add CI job for the access policy suite.

Priority: High
