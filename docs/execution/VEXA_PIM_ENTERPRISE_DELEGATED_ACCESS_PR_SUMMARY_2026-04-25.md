# PR Summary

Title:
Enterprise delegated-access milestone: tenant-safe scope assignments and scope-aware enforcement

Summary:
- Added a tenant-safe `AccessScopeAssignment` model for delegated access
- Added admin backend endpoints for listing, creating, and deleting scope assignments
- Added minimal admin UI for delegated scope visibility and management
- Enforced supported non-tenant scopes across catalog, media, bulk import, bulk edit, marketplace, and connector flows
- Corrected supported-scope combination semantics to intersect active dimensions instead of widening access with union semantics
- Preserved prior access-policy protections for workflow locking, stale JWT rejection, restricted payloads, and sanitized denial auditing
- Added automated coverage for supported delegated-access scopes and reran the regression bundle

Supported scope dimensions implemented in this batch:
- tenant/workspace
- category
- brand
- channel
- connector account

Scope dimensions explicitly not claimed as implemented:
- catalog
- vendor/owner
- supplier
- locale/market
- team
- assignee

Why this is merge-worthy:
- backend enforcement is in place for the supported scope dimensions
- direct object access outside supported scope is denied
- list/filter paths, batch paths, marketplace paths, and connector paths now respect supported scope assignments
- admin override remains valid within tenant/workspace boundaries
- scope denials are audited with sanitized metadata

Why this is not a full enterprise delegated-access completion claim:
- unsupported scope dimensions above still need schema and product-policy work
- UI support in this batch is intentionally minimal and does not replace backend enforcement
- local Prisma migration drift still needs cleanup before `prisma migrate dev` is reliable in this environment

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

Validation Result:
- All commands above passed in the final validation sequence

Risk Notes:
- This batch does not implement catalog, vendor/owner, supplier, locale/market, team, or assignee delegated-access controls
- Delegated scope enforcement is assignment-activated per tenant to preserve existing tenants with no scope setup
- Export job history filtering is only partial because the current domain model does not carry a richer delegated-access ownership layer for historical records

Release-Note Guardrails:
- Release notes must say this batch adds delegated-access enforcement for currently supported scopes: category, brand, channel, and connector account
- Release notes must not claim full enterprise delegated-access completion
- Release notes must not claim support for unsupported scope dimensions: catalog, vendor/owner, supplier, locale/market, team, or assignee
- Release notes must not imply that UI controls are the security boundary; backend enforcement is authoritative

Rollback Considerations:
- If rollback is needed, revert the delegated-access batch as a focused unit across Prisma schema/migration, access-policy service, scope-aware API enforcement, admin scope-management API, and admin scope-management UI
- Preserve previously shipped access-policy remediation protections if only the delegated-access layer is rolled back
- Remove or ignore tenant scope assignments only after confirming no active tenant depends on them

Reference Artifacts:
- [Delegated-Access Report](<C:\Users\Om Computers\PIM1\docs\execution\VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md:1>)
- [PO Execution Plan](<C:\Users\Om Computers\PIM1\docs\execution\ACCESS_POLICY_PO_EXECUTION_PLAN_2026-04-25.md:1>)
