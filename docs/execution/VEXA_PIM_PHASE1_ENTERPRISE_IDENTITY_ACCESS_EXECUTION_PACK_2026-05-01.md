---
title: Vexa PIM Phase 1 Enterprise Identity And Access Execution Pack
status: proposed
owner: Product + CTO + Security/Auth Lead
last_updated: 2026-05-01
---

# Vexa PIM Phase 1 Enterprise Identity And Access Execution Pack - 2026-05-01

## 1. Purpose

Turn Phase 1 of the enterprise approval plan into an execution-ready pack grounded in the current repo.

This pack is intentionally narrow:

- tenant auth policy
- MFA foundation
- OIDC foundation
- delegated-access expansion for publish, credential, and admin boundaries

This is not a full enterprise-auth rewrite.

## 2. Current Repo Foundations

The current repo already provides the seams needed to implement Phase 1 without redesign.

### Existing identity foundations

- login, password reset, privacy, account export, and step-up live in `apps/api/src/auth/auth.service.ts`
- high-risk mapping actions already use step-up protection
- JWT claims already carry normalized `assignedRoles`
- admin workspace-user management already persists bounded assigned-role state

Key repo anchors:

- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/step-up.guard.ts`
- `apps/api/src/auth/jwt.ts`
- `apps/api/src/workspace-users/workspace-users.service.ts`

### Existing access-control foundations

- delegated access already supports category, brand, channel, and connector-account scopes
- scope evaluation is centralized in the access-policy service
- admin user UI already exposes delegated-scope management

Key repo anchors:

- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/web/src/app/admin/users/page.tsx`

### Existing schema foundations

- `AuthIdentity.assignedRoles` already exists
- access-scope enums already include enterprise-adjacent scope dimensions

Key repo anchor:

- `packages/db/prisma/schema.prisma`

## 3. Non-Negotiable Product Rules

These rules must remain true during Phase 1:

1. Do not remove or weaken step-up protection for high-risk actions.
2. Do not market step-up as MFA.
3. OIDC is the required enterprise federation path in Phase 1.
4. SAML is follow-up work only if target accounts actually require it.
5. SCIM is not in Phase 1 scope.
6. Delegated-access expansion must not pretend locale/market/team/assignee are fully supported before their domain models exist.
7. Existing workspace-user and assigned-role behavior must remain backward compatible unless a regression is proven.

## 4. Phase 1 Exit Gate

Phase 1 is complete only when all of the following are true:

- tenant auth policy exists and is enforceable
- MFA enrollment and MFA enforcement work
- at least one real OIDC provider flow is test-confirmed
- delegated access can separately control edit, publish, connector-admin, and audit-sensitive operations
- all policy and identity changes are audited

Safe claim after Phase 1:

> Vexa supports enterprise identity baseline controls including OIDC SSO, MFA enforcement, and fine-grained delegated access.

## 5. Workstream A - Tenant Auth Policy

### Goal

Create a tenant-scoped policy object that becomes the runtime source of truth for enterprise auth behavior.

### Phase 1 decision

The auth-policy object should own:

- `externalIdentityMode`
- `mfaRequired`
- `mfaGracePeriodDays`
- `sessionTimeoutMinutes`
- optional `allowedAuthMethods`

### File scope

- `packages/db/prisma/schema.prisma`
- `apps/api/src/auth/*`
- `apps/api/src/audit/*`
- `apps/web/src/app/admin/*`

### New entities or records

- `TenantAuthPolicy`

### Acceptance criteria

- per-tenant auth policy can be created, read, updated
- default tenants remain backward compatible
- policy changes are audited
- runtime login path can read policy without changing current login behavior when policy is absent

### Suggested stories

#### P1-A1

- Title: Add `TenantAuthPolicy` schema and migration
- Owner: Security/Auth Lead
- Priority: P1

#### P1-A2

- Title: Add auth-policy service and admin API
- Owner: Security/Auth Lead
- Priority: P1

#### P1-A3

- Title: Add admin auth-policy settings page
- Owner: Web Lead
- Priority: P2

#### P1-A4

- Title: Audit auth-policy changes
- Owner: Platform Governance Lead
- Priority: P1

## 6. Workstream B - MFA Foundation

### Goal

Add a real MFA layer without breaking current step-up behavior.

### Phase 1 decision

Use TOTP/app-authenticator as the initial MFA method.

Do not start with:

- SMS OTP
- email OTP as the primary enterprise MFA factor
- full WebAuthn/passkey rollout

Those can come later.

### File scope

- `packages/db/prisma/schema.prisma`
- `apps/api/src/auth/*`
- `apps/web/src/app/login*`
- `apps/web/src/components/auth/*`

### New entities or records

- `UserMfaEnrollment`
- `UserMfaBackupCode`

### Acceptance criteria

- user can enroll in MFA
- user can verify MFA during login
- tenant policy can force MFA enrollment
- backup recovery codes exist
- MFA enrollment and recovery actions are audited

### Suggested stories

#### P1-B1

- Title: Add MFA enrollment schema and secret storage
- Owner: Security/Auth Lead
- Priority: P1

#### P1-B2

- Title: Add TOTP enrollment and verification endpoints
- Owner: Security/Auth Lead
- Priority: P1

#### P1-B3

- Title: Add MFA enforcement based on tenant auth policy
- Owner: Security/Auth Lead
- Priority: P1

#### P1-B4

- Title: Add backup code recovery path
- Owner: Security/Auth Lead
- Priority: P2

#### P1-B5

- Title: Add MFA UI for enrollment, challenge, and recovery
- Owner: Web Lead
- Priority: P1

## 7. Workstream C - OIDC External Identity

### Goal

Add the first true enterprise SSO path.

### Phase 1 decision

Phase 1 federation target is OIDC only.

Supported examples:

- Microsoft Entra ID
- Okta
- Google Workspace

SAML should remain a later extension layer if demanded by target accounts.

### File scope

- `packages/db/prisma/schema.prisma`
- `apps/api/src/auth/*`
- `apps/web/src/app/login*`
- `apps/web/src/components/auth/*`
- admin settings surfaces for identity provider configuration

### New entities or records

- `OidcProviderConfig`
- optional `AuthIdentity.externalSubject`

### Acceptance criteria

- tenant can configure one OIDC provider
- login can succeed via external identity
- external identity mode can coexist with current password login during transition
- auth audit records show the method used

### Suggested stories

#### P1-C1

- Title: Add OIDC provider configuration schema and admin API
- Owner: Identity Platform Lead
- Priority: P1

#### P1-C2

- Title: Add OIDC login callback and token-validation flow
- Owner: Identity Platform Lead
- Priority: P1

#### P1-C3

- Title: Add web login UX for OIDC provider selection
- Owner: Web Lead
- Priority: P2

#### P1-C4

- Title: Audit external-identity login path
- Owner: Platform Governance Lead
- Priority: P1

## 8. Workstream D - Delegated-Access Expansion

### Goal

Make current access policy enterprise-usable for governance-sensitive operations.

### Important scope limit

This workstream expands permission boundaries on top of current supported scope dimensions:

- category
- brand
- channel
- connector_account

It does not claim full support yet for:

- locale
- market
- team
- assignee
- vendor/owner
- supplier

Those require later domain-model work.

### File scope

- `apps/api/src/common/access-policy/*`
- `apps/api/src/workspace-users/*`
- `apps/api/src/marketplace/*`
- `apps/api/src/connector-installer/*`
- `apps/web/src/app/admin/users/*`

### Acceptance criteria

- publish can be granted separately from edit
- connector credential access can be granted separately from general connector setup
- admin operations can be split by governance area
- denied actions remain audited with clear reason codes

### Suggested stories

#### P1-D1

- Title: Add publish-specific delegated-access enforcement
- Owner: Identity Platform Lead
- Priority: P1

#### P1-D2

- Title: Add connector-credential governance boundary
- Owner: Identity Platform Lead
- Priority: P1

#### P1-D3

- Title: Split admin-boundary capabilities for audit, user, connector, and security governance
- Owner: Identity Platform Lead
- Priority: P1

#### P1-D4

- Title: Expand admin users UI to surface the new permission model
- Owner: Web Lead
- Priority: P2

## 9. Proposed Delivery Order

Recommended implementation order:

1. P1-A1 through P1-A4
2. P1-B1 through P1-B5
3. P1-C1 through P1-C4
4. P1-D1 through P1-D4

Reason:

- auth policy is the runtime control plane
- MFA depends on policy
- OIDC should integrate into that policy, not bypass it
- delegated-access expansion should land after identity semantics are clear

## 10. Validation Bundle

At minimum, the Phase 1 execution bundle should include:

- existing:
  - `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
  - `node apps/api/test/integration/workspace-user-crud.test.cjs`
  - `node apps/api/test/integration/delegated-access-scopes.test.cjs`
- new:
  - `node apps/api/test/integration/auth-policy.test.cjs`
  - `node apps/api/test/integration/mfa-enrollment.test.cjs`
  - `node apps/api/test/integration/mfa-enforcement.test.cjs`
  - `node apps/api/test/integration/oidc-login.test.cjs`
  - `node apps/api/test/integration/delegated-access-publish-boundary.test.cjs`
  - `node apps/api/test/integration/delegated-access-credential-boundary.test.cjs`
  - `node apps/web/test/integration/auth-policy-ui.test.cjs`
  - `node apps/web/test/integration/mfa-ui.test.cjs`
  - `node apps/web/test/integration/oidc-login-ui.test.cjs`
  - `node apps/web/test/integration/admin-users-enterprise-access-ui.test.cjs`

Plus repo-wide checks where applicable:

- `npm run lint --workspace @pim1/api`
- `npm run build --workspace @pim1/api`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/web`

## 11. Risks To Watch

### Risk 1 - Step-up vs MFA confusion

Mitigation:

- keep step-up terminology explicit in code, docs, and UI
- do not rename current step-up endpoints to MFA

### Risk 2 - Backward compatibility drift

Mitigation:

- default auth-policy behavior must preserve current tenants
- transition mode should allow OIDC plus password login until cutover is intentional

### Risk 3 - Overshooting delegated-access scope

Mitigation:

- do not claim locale/market/team/assignee enforcement in Phase 1
- constrain Phase 1 to supported scope dimensions and permission boundaries

### Risk 4 - Runtime auth regression

Mitigation:

- keep existing step-up, workspace-user, and delegated-access suites green throughout

## 12. Immediate Next Implementation Slice

The recommended first code slice after this pack is:

### Slice P1-01

- add `TenantAuthPolicy` schema
- add auth-policy read/write service
- add audit events for auth-policy change
- do not add MFA or OIDC yet in the same slice

Reason:

- it creates the control plane for the rest of Phase 1
- it is the lowest-risk enterprise identity entry point

## 13. References

- `docs/execution/VEXA_PIM_ENTERPRISE_APPROVAL_SSOT_2026-05-01.md`
- `docs/execution/VEXA_PIM_ENGINEERING_DELIVERY_PLAN_2026-05-01.md`
- `docs/execution/VEXA_PIM_ENTERPRISE_DELEGATED_ACCESS_REPORT_2026-04-25.md`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/common/access-policy/access-policy.service.ts`
- `apps/api/src/workspace-users/workspace-users.service.ts`
- `apps/web/src/app/admin/users/page.tsx`
- `packages/db/prisma/schema.prisma`
