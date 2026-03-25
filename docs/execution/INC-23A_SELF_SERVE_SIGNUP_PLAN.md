# TEJ PIM INC-23A Self-Serve Signup Plan

- Date: 2026-03-26
- Status: proposed
- Scope: backend foundation only
- Goal: allow a new customer to create a pending workspace signup request, verify by email, provision a first admin, and log in using the current workspace-scoped auth contract

## Why this increment exists

TEJ PIM already supports:

- workspace-scoped login using `workspaceSlug`
- platform-admin tenant provisioning through `POST /api/v1/platform/tenants`
- workspace admin user creation
- password reset by email
- tenant plan profiles with `STARTER`, `GROWTH`, and `ENTERPRISE`

TEJ PIM does not yet support:

- public self-serve workspace signup
- verification-before-provision onboarding
- public workspace slug availability checks
- signup-specific abuse controls

This increment closes the backend gap without reopening auth, billing, or existing platform bootstrap semantics.

## Locked product decisions

1. One email can belong to only one workspace in v1.
2. Workspace is not created until verification succeeds.
3. Signup requires Terms and Privacy acceptance.
4. New self-serve workspaces default to `STARTER`.
5. Public signup must be feature-flagged.
6. When the feature flag is off, signup routes return `404`.
7. Public signup must not expose the existing platform-admin token bootstrap route.
8. Public web pages are out of scope for `INC-23A`; they follow in a later slice.

## Repo-validated constraints

### Current workspace slug rules

Source of truth:

- `apps/api/src/common/tenant/tenant.constants.ts`
- `apps/api/src/auth/dto/login.dto.ts`

Rules:

- lowercase only
- allowed characters: `a-z`, `0-9`, `-`
- pattern: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- minimum length: `3`
- maximum length: `32`

### Current provisioning flow

Source of truth:

- `apps/api/src/platform-admin/platform-admin.controller.ts`
- `apps/api/src/common/tenant/tenant-directory.service.ts`

Notes:

- current bootstrap flow is `@Public()` but guarded by `x-pim-platform-admin-token`
- `provisionWorkspace()` currently creates the initial admin using `resolveInitialPasswordHash()`
- that shared/bootstrap password behavior is not acceptable for public self-serve signup

### Current auth identity rule

Source of truth:

- `packages/db/prisma/schema.prisma`

Notes:

- `AuthIdentity.userId` is globally unique
- this means one email cannot belong to multiple workspaces without a later schema/auth redesign

### Current plan behavior

Source of truth:

- `apps/api/src/billing/plan-usage.service.ts`
- `packages/db/prisma/schema.prisma`

Notes:

- `TenantPlanProfile` defaults to `STARTER`
- current lazy initialization may already be enough, but it must be verified under self-serve onboarding

### Current email behavior

Source of truth:

- `apps/api/src/auth/auth-email.service.ts`
- `apps/api/src/common/env-validation.ts`

Notes:

- local/test can use `file` or `console`
- staging requires `resend` or `console`
- production requires `resend`
- delivery must fail honestly in protected environments

## Feature flag

Add:

- `FEATURE_PUBLIC_SIGNUP_ENABLED`

Update:

- `apps/api/src/common/env-validation.ts`
- `.env.example`
- `.env.staging.example`
- `.env-templates/.env.example`

Behavior:

- default `false`
- when `false`, all public signup routes return `404`
- follow the existing pattern used by `FEATURE_ONDC_ENABLED`

## Scope

### In scope

1. feature flag plumbing
2. signup pending-request data model
3. signup backend service
4. public signup API
5. verification email sending
6. signup-specific rate limiting
7. plan-resolution validation for first login
8. integration coverage
9. OpenAPI updates

### Out of scope

1. public `/signup` web page
2. `/signup/verify` web page
3. billing checkout
4. invite teammates during signup
5. multi-workspace same-email support
6. SSO / magic-link
7. marketing funnel or trial-paywall behavior

## Data model

Add a new Prisma model, e.g. `PublicSignupRequest`.

Suggested fields:

- `id String @id`
- `displayName String`
- `workspaceSlug String`
- `adminEmail String`
- `passwordHash String`
- `verificationTokenHash String @unique`
- `status String`
- `acceptedTerms Boolean`
- `expiresAt DateTime`
- `verifiedAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Suggested status values:

- `pending`
- `verified`
- `expired`
- `cancelled`

Suggested indexes:

- `@@index([workspaceSlug])`
- `@@index([adminEmail])`
- `@@index([status, expiresAt])`

Important rule:

- do not create `WorkspaceDirectory` or `AuthIdentity` rows when the request is first submitted

## Backend API

Add a new signup module:

- `apps/api/src/signup/signup.module.ts`
- `apps/api/src/signup/signup.service.ts`
- `apps/api/src/signup/signup.controller.ts`
- DTOs under `apps/api/src/signup/dto/`

### Public routes

1. `GET /api/v1/signup/workspace/availability?workspaceSlug=...`
2. `POST /api/v1/signup/workspace`
3. `POST /api/v1/signup/verify`
4. `POST /api/v1/signup/resend-verification`

### DTO contract

#### `CheckWorkspaceAvailabilityDto`

- `workspaceSlug: string`

#### `CreatePublicSignupDto`

- `displayName: string`
- `workspaceSlug: string`
- `adminEmail: string`
- `password: string`
- `acceptedTerms: boolean`

#### `VerifyPublicSignupDto`

- `token: string`

#### `ResendPublicSignupVerificationDto`

- `adminEmail: string`

### Response shapes

#### Availability

```json
{ "available": true }
```

or

```json
{ "available": false, "reason": "WORKSPACE_SLUG_ALREADY_ASSIGNED" }
```

#### Signup request accepted

```json
{ "ok": true, "status": "pending_verification" }
```

#### Verification success

```json
{
  "ok": true,
  "status": "verified",
  "workspaceSlug": "my-store",
  "userId": "owner@example.com"
}
```

#### Resend success

```json
{ "ok": true, "resent": true }
```

### Stable error codes

Use explicit, stable error payloads for:

- `FEATURE_DISABLED`
- `WORKSPACE_SLUG_INVALID`
- `WORKSPACE_SLUG_ALREADY_ASSIGNED`
- `ADMIN_EMAIL_ALREADY_REGISTERED`
- `PASSWORD_TOO_SHORT`
- `TERMS_ACCEPTANCE_REQUIRED`
- `SIGNUP_VERIFICATION_TOKEN_INVALID`
- `SIGNUP_RATE_LIMITED`

## Service behavior

### A. Check availability

The service must:

1. normalize slug to lowercase
2. validate slug against current repo rules
3. reject invalid slug
4. check slug in `WorkspaceDirectory`
5. check slug in active/pending `PublicSignupRequest`

### B. Create pending signup

The service must:

1. validate all fields
2. reject if `acceptedTerms !== true`
3. reject duplicate email in `AuthIdentity`
4. reject duplicate email in active/pending `PublicSignupRequest`
5. hash chosen password with bcrypt cost `12`
6. create secure raw verification token
7. store only the token hash
8. create pending signup request with expiry
9. send verification email

### C. Verify signup

The service must:

1. hash incoming token and look up the pending signup request
2. reject missing, expired, or already-used token
3. provision workspace only now
4. create initial admin using the stored password hash
5. ensure tenant plan profile resolves to `STARTER`
6. mark signup request `verified`
7. make verification single-use

## Provisioning refactor

Refactor `TenantDirectoryService` carefully.

Current risk:

- `provisionWorkspace()` uses `resolveInitialPasswordHash()`
- that path is suitable for bootstrap/local behavior, not public signup

Required outcome:

- keep platform-admin bootstrap behavior unchanged
- add a safe internal provisioning seam for public signup that accepts a precomputed password hash

Do not:

- expose platform-admin token flow publicly
- route public signup through shared bootstrap password behavior

## Email delivery

Reuse the existing email delivery infrastructure.

Verification email must include:

- workspace slug
- verification link
- expiry note

Local/test:

- `console` or `file` is acceptable

Staging/production:

- existing fail-closed provider rules must remain intact

## Signup abuse controls

Add signup-specific rate limiting using the same Redis/in-memory fallback style already used in auth.

Suggested limits:

- per IP: `5` signup attempts / `15 minutes`
- per email: `3` signup attempts / `15 minutes`

Requirements:

- return `429`
- set `X-RateLimit-Retry-After`
- avoid duplicate pending signup creation under retry pressure

## Validation scenarios

### Workspace slug

Scenarios:

1. uppercase or spaces normalize to lowercase/hyphenated input on the caller side, but server still validates canonical slug shape
2. invalid slug returns `WORKSPACE_SLUG_INVALID`
3. already-assigned slug returns unavailable or `WORKSPACE_SLUG_ALREADY_ASSIGNED`

### Admin email

Scenarios:

1. invalid email rejected
2. existing `AuthIdentity.userId` rejected
3. pending signup for same email rejected or routed to resend flow

### Password

Scenarios:

1. fewer than `8` chars rejected
2. accepted password hashes to bcrypt `12`

### Terms

Scenario:

1. unchecked terms rejected with `TERMS_ACCEPTANCE_REQUIRED`

### Verification token

Scenarios:

1. valid token provisions workspace + admin
2. expired token rejected
3. reused token rejected
4. malformed token rejected

### Login after verification

Must pass through the current real login path:

- `POST /api/v1/auth/login`
- with:
  - `workspaceSlug`
  - `userId`
  - chosen password

### Plan profile

Scenario:

1. first authenticated billing/usage read resolves `STARTER` without missing-profile errors

## Integration test plan

Add one or more new integration tests under `apps/api/test/integration/`, for example:

- `public-signup.test.cjs`

Required scenarios:

1. feature flag off -> signup routes return `404`
2. availability endpoint works
3. valid signup request -> `pending_verification`
4. invalid slug rejected
5. duplicate slug rejected
6. duplicate email rejected
7. short password rejected
8. terms missing rejected
9. verify provisions workspace + admin
10. verified admin can log in with workspace slug + chosen password
11. expired token rejected
12. resend verification works
13. signup rate limiting returns `429`

Existing related tests that must stay green:

- `apps/api/test/integration/platform-tenant-provisioning.test.cjs`
- `apps/api/test/integration/auth-password-reset.test.cjs`
- `apps/api/test/integration/auth-per-user-password.test.cjs`

## OpenAPI

Update OpenAPI generation so signup routes and DTOs appear in:

- `docs/openapi.yaml`
- `docs/openapi.json` if regenerated in repo flow

## Implementation order

1. feature flag plumbing
2. Prisma model + migration
3. internal provisioning seam
4. signup module/controller/service skeleton
5. availability endpoint
6. create pending signup request
7. verification email sending
8. verify endpoint
9. resend verification endpoint
10. signup rate limiting
11. plan profile validation
12. integration tests
13. OpenAPI update

## Validation commands

```bash
npx tsc -p apps/api/tsconfig.build.json --noEmit
npm run build --workspace @pim1/api

# existing related tests
node apps/api/test/integration/platform-tenant-provisioning.test.cjs
node apps/api/test/integration/auth-password-reset.test.cjs
node apps/api/test/integration/auth-per-user-password.test.cjs

# new signup tests
node apps/api/test/integration/public-signup.test.cjs

# optional if OpenAPI generation is part of repo flow
npm run openapi:generate
```

## Final signoff checklist

- feature flag defaults off
- signup routes return `404` when flag is off
- signup request creates only a pending verification record
- verification provisions a real workspace and first admin
- first admin can log in with chosen password
- self-serve tenant resolves to `STARTER`
- signup is rate-limited
- integration tests and API build are green
- platform-admin bootstrap behavior is unchanged

## Follow-on increment

After `INC-23A` is complete, the next slice should be:

- public signup pages
- verification UX pages
- resend verification UI
- support docs for public onboarding

That work should be tracked separately as `INC-23B`.
