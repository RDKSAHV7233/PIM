# Vexa PIM Tenant Login and Signup Spec

Status: Locked and implemented
Implementation commit: `32538a9`
Execution lock commit: `d9a6912`
Date: 2026-03-10

## 1. Purpose

This document locks the tenant routing, login model, and the current public-signup extension for Vexa PIM.

It is grounded in the shipped workspace-scoped login implementation and records the decisions that must remain stable unless a new increment explicitly changes them.

## 2. Current Baseline

Vexa PIM is backend multi-tenant and session single-workspace-per-session.

Already built before this slice:
- `tenantId` in JWT/session claims
- tenant-scoped Prisma access
- tenant context middleware/interceptor
- user-to-tenant identity resolution in auth

What this slice added:
- workspace slug on login
- tenant directory persistence
- platform provisioning API
- workspace-scoped lockout and unlock flows

## 3. Locked Decisions

### 3.1 Tenant resolution source

V1 uses a `Workspace` field on the login form.

- no subdomain routing
- no path-slug routing
- no separate workspace switcher

### 3.2 Slug resolution model

Workspace slug resolution happens server-side inside `POST /auth/login`.

- client submits `workspaceSlug`
- client never submits trusted `tenantId`
- server resolves `workspaceSlug -> tenantId`
- unknown workspace fails before credentials are checked

### 3.3 User membership model

V1 is one user, one tenant.

- no multi-tenant membership
- no workspace switcher
- no session re-issuance across workspaces

### 3.4 Session model

JWT/session shape stays unchanged.

- `tenantId` remains in claims
- cookie names stay unchanged
- downstream middleware/interceptor stay unchanged
- downstream connector/catalog/admin tenant-scoped queries stay unchanged

### 3.5 Platform admin surface

V1 platform admin is API-only.

- no platform admin UI in the tenant shell
- provisioning creates tenant + workspace slug + initial admin binding

### 3.6 Public signup extension

The current repo also supports a public self-serve signup flow behind feature flags.

- `FEATURE_PUBLIC_SIGNUP_ENABLED`
- `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED`

Locked current behavior:
- signup collects `Workspace name`, `Workspace ID`, first admin email, password, and terms acceptance
- workspace creation happens only after email verification succeeds
- verification happens through `/signup/verify`
- verified first admin signs in through the normal `/login` workspace-scoped flow
- v1 keeps one email = one workspace account

## 4. Login UX Contract

### 4.1 Field order

The login form order is:
1. `Workspace`
2. `User ID`
3. `Password`

### 4.2 Workspace field rules

- required
- lowercase letters, numbers, and hyphens only
- normalized to lowercase on submit
- trimmed before submit

### 4.3 Error handling

- empty workspace -> field-level required error
- invalid format -> field-level format error
- unknown workspace -> `WORKSPACE_NOT_FOUND`
- valid workspace + wrong credentials -> normal invalid credential behavior
- lockout and rate-limit behavior remain in place

## 5. Blocking Requirements

These are mandatory and not optional.

### 5.1 Lockout scoping

Lockout keys must be scoped by:

`workspaceSlug + userId`

If this is missed, lock state leaks across tenants.

### 5.2 Local/dev workspace directory

Local development must have a workspace directory source before login changes ship.

Without it, local auth breaks immediately once login requires `workspaceSlug`.

## 6. Provisioning Contract

Minimum v1 provisioning surface:

- protected platform API
- create tenant
- assign unique workspace slug
- assign display name
- create or bind initial admin identity

Current extension:
- tenant-facing self-serve signup is implemented behind feature flags
- the existing platform-admin provisioning API remains intact

## 7. Files That Must Change

Implementation-bound files:

- `apps/web/src/components/auth/login-page-client.tsx`
- `apps/web/src/components/auth/auth-copy.ts`
- `apps/web/src/app/api/auth/login/route.ts`
- `apps/api/src/auth/dto/login.dto.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.controller.ts`

Supporting files added by implementation:

- `apps/api/src/common/tenant/tenant-directory.module.ts`
- `apps/api/src/common/tenant/tenant-directory.service.ts`
- `apps/api/src/platform-admin/**`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260310193000_workspace_directory_v1/migration.sql`

## 8. Files That Must Stay Stable

These were intentionally left unchanged by the slice:

- `apps/web/src/lib/server-session.ts`
- `apps/api/src/common/tenant/tenant-context.middleware.ts`
- `apps/api/src/common/tenant/tenant-context.interceptor.ts`
- downstream connector/catalog/admin tenant-scoped query logic
- existing cookie names
- JWT claim shape

## 9. Locked Implementation Order

This implementation order is binding for any rework of the slice:

1. Tenant directory persistence + provisioning API
2. Local/dev workspace directory source
3. Extend API login DTO + service + controller
4. Extend web login route
5. Extend login UI + auth copy
6. Validate lockout scoped by `workspaceSlug + userId`

## 10. Acceptance Criteria

1. Login requires `Workspace`, `User ID`, and `Password`
2. Unknown workspace returns a workspace-specific error
3. Successful login issues the same JWT/session shape as before, with server-resolved `tenantId`
4. Downstream tenant-scoped behavior works unchanged after login
5. Lockout and resend-unlock flows are scoped by `workspaceSlug + userId`
6. Platform admin can provision tenant workspace slugs through an API-only surface
7. Public signup can create a pending request, verify by email, provision the workspace, and preserve the same login contract
8. No workspace switcher is introduced

## 11. Shipped Evidence

Validated by:

- `npm run prisma:generate`
- `npm run prisma:migrate:deploy`
- `npx tsc -p apps/api/tsconfig.build.json --noEmit`
- `npm run build --workspace @pim1/api`
- `node apps/api/test/integration/auth-login-lockout.test.cjs`
- `node apps/api/test/integration/platform-tenant-provisioning.test.cjs`
- `node apps/web/test/integration/auth-shell-ui.test.cjs`
- `node apps/web/test/integration/auth-cookie-csrf.test.cjs`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/web`
