# Vexa PIM Access Policy PO Execution Plan - 2026-04-25

## PO Review Outcome

Decision: Conditionally acceptable for merge as a remediation milestone. Not approved for a full enterprise access-policy production-readiness claim.

From a Product Owner perspective, this remediation batch is acceptable because it:

- fixes the verified critical workflow-locking gap
- proves stale JWT rejection after later deactivate/lock events
- adds a minimal central policy layer instead of a broad redesign
- applies policy checks to the highest-risk write, batch, preview, and export paths
- adds centralized denial auditing with sanitized metadata
- hardens the sensitive GET endpoints that were explicitly in scope

This batch is not yet sufficient to claim full enterprise access-policy completeness because:

- non-tenant scope dimensions such as vendor, category, brand, and team are still not modeled
- full read redaction is not yet implemented everywhere
- the platform still relies on permissive default authenticated reads unless endpoints are explicitly hardened

## Validation-First Delivery Rule

The execution sequence must always run in this order:

1. Build validation
2. Authentication/session validation
3. Workflow validation
4. Policy-path validation
5. Tenant-boundary validation
6. Residual risk review
7. Release verdict

No remediation step should be accepted based on code inspection alone when an automated verification path exists.

## Scope of This Execution Batch

Included:

- authentication session revocation verification
- workflow content locking
- minimal field-level write/payload policy
- minimal scope foundation using current tenant/workspace boundaries
- connector preview/export authorization
- import/export/bulk-edit policy enforcement for restricted fields in scope
- centralized authorization denial audit logging
- sensitive GET endpoint hardening for audited high-risk reads

Explicitly excluded from this batch:

- large schema redesign for vendor/category/brand/team scopes
- broad admin UI for scope assignment
- full cross-endpoint read redaction system
- broad RBAC redesign away from the current default read model

## Acceptance Gates

| Gate | Requirement | Evidence Required | Result |
|---|---|---|---|
| G1 | API build succeeds | `npm run build --workspace @pim1/api` | Passed |
| G2 | Old JWT is rejected after later lock/deactivate | integration tests | Passed |
| G3 | Approved/archived content edits are blocked while valid transitions still work | workflow integration test | Passed |
| G4 | Restricted field writes and sensitive payload access are denied for non-admin actors | focused access-policy integration test | Passed |
| G5 | Connector entitlement still works after policy changes | connector entitlement integration test | Passed |
| G6 | Tenant/workspace isolation still holds for existing supported scope model | RLS/audit boundary tests | Passed |
| G7 | All denials produce sanitized audit evidence | focused access-policy integration test | Passed |
| G8 | Any blocked validation is explicitly documented and cannot be silently counted as passed | execution log | Passed |

## Execution Plan

### Phase 1: Validate Build and Existing Session Controls

Goal:
Confirm the codebase compiles and the JWT guard behavior is proven by automated tests, not inferred.

Execution:

- build API
- run workspace-user CRUD integration test
- run auth revocation integration test

Pass criteria:

- stale JWT rejected after later lock
- stale JWT rejected after later deactivation
- existing revoke/logout behavior preserved

### Phase 2: Validate Workflow Locking

Goal:
Ensure product workflow governance is enforced in backend behavior.

Execution:

- run workflow transition integration test

Pass criteria:

- editor cannot content-edit approved product
- admin cannot content-edit approved product through normal update path
- admin can still perform valid status-only transition
- archived product content remains locked

### Phase 3: Validate Access Policy Enforcement

Goal:
Verify the new minimal access policy layer is active on direct writes, batch operations, previews, exports, and denial audit logging.

Execution:

- run focused remediation integration test

Pass criteria:

- restricted product attribute write denied for non-admin actor
- restricted variant update denied for non-admin actor
- restricted bulk edit/import field update denied for non-admin actor
- viewer denied sensitive connector/export GETs
- connector preview denied before entitlement and again after entitlement when payload policy still blocks
- admin preview allowed
- denial audit rows exist and do not leak raw secrets/tokens

### Phase 4: Validate Supported Scope Foundation

Goal:
Confirm the currently supported scope model, tenant/workspace isolation and connector account permissions, still holds after changes.

Execution:

- run connector entitlement integration test
- run RLS isolation integration test
- run audit tenant-boundary integration test
- run bulk import tenant-boundary integration test

Pass criteria:

- tenant/workspace isolation remains intact
- connector action permission model still works
- any blocked suite is explicitly recorded

## One-Go Validation Command Set

The validation bundle for this batch is:

```powershell
npm run build --workspace @pim1/api
node apps/api/test/integration/workspace-user-crud.test.cjs
node apps/api/test/integration/auth-revocation.test.cjs
node apps/api/test/integration/product-workflow-transitions.test.cjs
node apps/api/test/integration/access-policy-remediation.test.cjs
node apps/api/test/integration/connector-access-entitlements.test.cjs
node apps/api/test/integration/rls-isolation.test.cjs
node apps/api/test/integration/audit-tenant-boundary.test.cjs
node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs
```

## Executed Validation Results

| Validation | Command | Result | Notes |
|---|---|---|---|
| Build | `npm run build --workspace @pim1/api` | Passed | API compiled successfully |
| Session revocation | `node apps/api/test/integration/workspace-user-crud.test.cjs` | Passed | Includes stale JWT after later lock/deactivation |
| JWT revoke/logout | `node apps/api/test/integration/auth-revocation.test.cjs` | Passed | Existing token revoke behavior preserved |
| Workflow lock | `node apps/api/test/integration/product-workflow-transitions.test.cjs` | Passed | Approved/archived content lock verified |
| Policy enforcement | `node apps/api/test/integration/access-policy-remediation.test.cjs` | Passed | Direct write, batch, preview/export, denial audit coverage |
| Connector entitlements | `node apps/api/test/integration/connector-access-entitlements.test.cjs` | Passed | Existing connector permission foundation preserved |
| Tenant isolation | `node apps/api/test/integration/rls-isolation.test.cjs` | Passed | Tenant scope still enforced |
| Audit tenant boundary | `node apps/api/test/integration/audit-tenant-boundary.test.cjs` | Passed | Audit explorer remains tenant scoped |
| Bulk import tenant boundary | `node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs` | Passed | Tenant-key mismatch protections validated for template create/list/get paths |

## PO Findings

Accepted in this batch:

- validation-first execution was followed
- critical workflow mutability gap is closed
- stale session risk is now verified with tests
- highest-risk field mutation and payload leakage paths are now governed
- sensitive audited GETs now require explicit roles
- authorization denials are now auditable and sanitized

Not accepted as complete:

- non-tenant scope controls for vendor/category/brand/team
- fully generalized read-redaction framework
- deny-by-default sensitive read model across all future endpoints

## Residual Product Risks

| Risk | Why It Remains | Product Impact | Required Follow-Up |
|---|---|---|---|
| Vendor/category/brand/team scope policies are unsupported | No current schema assignment model | Enterprise delegated-access use cases remain incomplete | Add scoped-assignment schema and service/query enforcement |
| Full read redaction is incomplete | This batch prioritized write/export/preview leakage first | Some read surfaces may still expose fields unless explicitly hardened | Add read-time policy/redaction layer |
| Default authenticated GET model still exists | Framework behavior remains broad when decorators are missing | Future omissions can still create exposure | Move sensitive reads toward explicit allowlists |

Required follow-up tickets:

- `ACCESS-POLICY-001`: Add vendor/category/brand/team scoped assignment model
- `ACCESS-POLICY-002`: Implement read-time field redaction layer
- `ACCESS-POLICY-003`: Move sensitive GET endpoints to explicit allowlist model

## PO Release Verdict

Verdict: Conditionally accepted for merge as a controlled access-policy remediation milestone.

This batch is accepted because it closes the verified critical workflow-locking gap, verifies stale JWT rejection after later lock/deactivation, applies a minimal central policy layer to the highest-risk mutation and payload paths, hardens audited sensitive reads, and adds sanitized denial auditing.

This batch is not approved as a full enterprise access-policy production-readiness claim.

The remediation may merge if:

- this document ships with the change set
- all passed validation results are preserved in the PR
- release notes clearly avoid claiming full vendor/category/brand/team scope support
- release notes clearly avoid claiming full cross-endpoint read redaction

Release notes must state that this batch improves critical/high-risk access-policy enforcement but does not complete enterprise delegated-access scope controls or universal read redaction.

Full production-readiness can be claimed only after:

- unsupported non-tenant scopes are either implemented or formally excluded from product policy
- read redaction is completed for sensitive fields
- sensitive GET endpoints are moved closer to an explicit allowlist model

## PR Summary

Title:
Access Policy remediation milestone: workflow locks, stale JWT validation, policy enforcement, and denial auditing

Summary:
- Verified stale JWT rejection after later user lock/deactivation
- Enforced workflow content locks for approved/archived product states
- Added minimal access-policy enforcement for restricted writes, batch paths, connector previews, and exports
- Hardened sensitive audited GET endpoints
- Added sanitized authorization-denial audit logging
- Preserved connector entitlement behavior and tenant isolation

Test Plan:
- `npm run build --workspace @pim1/api`
- `node apps/api/test/integration/workspace-user-crud.test.cjs`
- `node apps/api/test/integration/auth-revocation.test.cjs`
- `node apps/api/test/integration/product-workflow-transitions.test.cjs`
- `node apps/api/test/integration/access-policy-remediation.test.cjs`
- `node apps/api/test/integration/connector-access-entitlements.test.cjs`
- `node apps/api/test/integration/rls-isolation.test.cjs`
- `node apps/api/test/integration/audit-tenant-boundary.test.cjs`
- `node apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`

Risk Notes:
- Does not complete vendor/category/brand/team scope model
- Does not complete universal read redaction
- Does not replace permissive default authenticated GET behavior globally

Rollback Considerations:
- Revert this remediation batch if access-policy enforcement causes unexpected operational blockage.
- Preserve audit endpoint protection and stale-token rejection fixes if partial rollback is needed, because they close high-risk security gaps.
