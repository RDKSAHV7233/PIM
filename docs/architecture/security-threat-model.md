---
title: TEJ PIM Security Threat Model
audience: internal-engineering
status: active
last_updated: 2026-03-19
owner: CTO + Backend Lead
---

## 1. System boundary

TEJ PIM runs as a browser-facing Next.js application backed by a NestJS API, PostgreSQL, Redis, and BullMQ workers. The main trust boundaries in the reviewed repo are:

```text
[ Public internet ]
       |
  [ Railway edge / TLS termination ]
       |
  [ NestJS API (Fastify) ]  <->  [ PostgreSQL ]
       |                    <->  [ Redis ]
  [ Next.js SSR ]                 |
       |                    <->  [ BullMQ workers ]
  [ Browser ]
```

### Boundary crossings

| Crossing | Protocol | Auth mechanism | Internal or external | Evidence |
|---|---|---|---|---|
| Browser -> Railway edge -> Next.js web | HTTPS | Cookie-backed session (`pim_access_token`) rendered into SSR state | External | `apps/web/src/lib/server-auth.ts`, `apps/web/src/app/layout.tsx` |
| Browser -> Railway edge -> NestJS API | HTTPS | Bearer JWT or API key for protected routes; CORS restricted by `CORS_ORIGIN` / `CORS_ORIGINS` in staging and production | External | `apps/api/src/auth/auth.controller.ts`, `apps/api/src/common/env-validation.ts` |
| Next.js SSR -> NestJS API | HTTPS to `PIM_API_BASE_URL` | SSR forwards `Authorization: Bearer <token>` from the cookie via `getServerAuthHeader()` | External in staging deployments using public Railway URLs | `apps/web/src/lib/server-auth.ts`, `apps/web/src/lib/api.ts` |
| NestJS API -> PostgreSQL | Prisma over pooled/direct DB connection strings | Database credentials from env; tenant isolation applied in service code via `prisma.tenant(tenantId)` | Internal service boundary | `packages/db/prisma/schema.prisma`, service files under `apps/api/src/` |
| NestJS API -> Redis | Redis / TLS depending on `REDIS_URL` | Redis credentials from env | Internal service boundary | `apps/api/src/auth/auth.service.ts`, `apps/api/src/queue/queue.service.ts` |
| BullMQ workers -> Redis | Redis / TLS depending on `REDIS_URL` | Redis credentials from env | Internal service boundary | `apps/api/src/queue/queue.service.ts` |
| Platform admin bootstrap client -> NestJS API | HTTPS | `x-pim-platform-admin-token` header on a public route | External, separate from workspace RBAC | `apps/api/src/platform-admin/platform-admin.controller.ts` |

## 2. Authentication controls

### IP rate limiting
- What it does: limits login attempts per client IP using a sliding window.
- Implementation: `AuthService` stores IP attempt state in Redis when available, with in-memory fallback if Redis is unavailable.
- Configuration: `PIM_AUTH_IP_ATTEMPT_LIMIT`, `PIM_AUTH_IP_WINDOW_MS`.
- Failure behavior: when the limit is exceeded, login returns `429 TOO_MANY_REQUESTS` with `error: "IP_RATE_LIMITED"` and `X-RateLimit-Retry-After`.
- Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`.

### Per-user lockout
- What it does: locks an identity after repeated failed logins and also honors admin-initiated locks persisted in the database.
- Implementation: failed-attempt counters and lock state live in Redis with in-memory fallback; admin locks are persisted in `AuthIdentity.lockedUntil`.
- Current thresholds: 5 failed attempts, 15-minute lock (`USER_ATTEMPT_LIMIT`, `ACCOUNT_LOCK_MS`).
- Failure behavior: login returns `423 LOCKED` with `error: "ACCOUNT_LOCKED"`, `unlockAt`, and a masked identifier.
- Evidence: `apps/api/src/auth/auth.service.ts`, `packages/db/prisma/schema.prisma`.

### Password hashing and legacy fallback
- What it does: supports per-user password hashes while preserving a temporary compatibility path for identities that do not yet have a stored hash.
- Implementation: `passwordHash` on `AuthIdentity`; `bcrypt.compare()` is used for hashed users with cost factor 12 when passwords are set; identities with `passwordHash = null` fall back to the shared `PIM_AUTH_PASSWORD` path using `timingSafeEqual()`.
- Failure behavior: invalid credentials return `401 INVALID_CREDENTIALS` with remaining attempts.
- Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/workspace-users/workspace-users.service.ts`, `packages/db/prisma/schema.prisma`.

### JWT session tokens and logout blocklist
- What it does: issues bearer JWTs for logged-in users and revokes them on logout.
- Implementation: JWTs are signed with `JWT_SECRET`; logout adds the token JTI to the blocklist service backed by Redis TTL.
- Failure behavior: protected routes reject missing or invalid tokens with `401`; revoked tokens are rejected after logout.
- Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/common/env-validation.ts`, `scripts/staging-postdeploy-check.cjs`.

### Step-up authentication
- What it does: issues a short-lived scoped credential for sensitive actions such as `mapping.publish` and `mapping.rollback`.
- Implementation: `issueStepUp()` re-resolves the identity, verifies the stored credential path again, and issues a step-up token with a linked `parentJti`.
- Failure behavior: invalid step-up credentials return `401 STEP_UP_INVALID_CREDENTIALS`; expired or invalid step-up tokens are rejected by downstream verification.
- Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/jwt.ts`, `apps/api/src/auth/dto/step-up.dto.ts`.

### Platform admin bootstrap
- What it does: provisions a tenant, workspace, and initial admin outside normal workspace RBAC.
- Implementation: `POST /platform/tenants` is a `@Public()` route guarded by `x-pim-platform-admin-token`.
- Failure behavior: missing or incorrect token returns `401 PLATFORM_ADMIN_TOKEN_REQUIRED`.
- Evidence: `apps/api/src/platform-admin/platform-admin.controller.ts`.

## 3. Authorization controls

### RBAC model
- Roles are `admin`, `editor`, `reviewer`, and `viewer`.
- `DEFAULT_WRITE_ROLES` are `admin` and `editor`.
- Evidence: `apps/api/src/common/rbac/roles.ts`, `apps/web/src/lib/role-capabilities.ts`.

### Route guards
- Protected routes use the `@Roles()` decorator, which stores required roles under `ROLES_KEY` metadata and is enforced by the auth guard stack.
- Evidence: `apps/api/src/common/rbac/roles.ts`, controller usage throughout `apps/api/src/`.

### Tenant isolation
- Tenant isolation is structural in service code through `prisma.tenant(tenantId)` wrappers rather than a best-effort filter convention.
- Sensitive services such as workspace user management, catalog operations, and dashboard reads are tenant scoped through that wrapper.
- Evidence: `apps/api/src/workspace-users/workspace-users.service.ts`, `apps/api/src/dashboard/dashboard.service.ts`, `apps/api/src/catalog/catalog.service.ts`.

### Admin-only surfaces
- Workspace user management is under `@Controller("admin/workspace/users")` and `@Roles("admin")`.
- Account export is currently admin-only.
- Evidence: `apps/api/src/workspace-users/workspace-users.controller.ts`, `apps/api/src/auth/auth.controller.ts`.

### Reviewer and write-role behavior
- Reviewers can make approval decisions but do not get general write access.
- Writers are `admin` and `editor`; the frontend capability helpers align with that model.
- Evidence: `apps/api/src/common/rbac/roles.ts`, `apps/web/src/lib/role-capabilities.ts`.

### Connector permissions
- Connector actions are controlled separately from workspace RBAC using connector permission records keyed by `principalId`, `principalType`, and `action`.
- This is an additional authorization layer, not a replacement for RBAC.
- Evidence: `packages/db/prisma/schema.prisma`, connector permission usage surfaced through the current API types in `apps/web/src/lib/api.ts`.

## 4. Known limitations

These are current limitations in the reviewed repo. They are real and should be treated as open security or operational constraints.

- Legacy identities with `passwordHash = null` still authenticate through the shared `PIM_AUTH_PASSWORD` env var. That path now uses `timingSafeEqual()`, but it is still shared-secret auth and should be phased out. Evidence: `apps/api/src/auth/auth.service.ts`, `packages/db/prisma/schema.prisma`.
- Password reset does not send an email. The route is intentionally honest and returns `requested: false`; the current recovery path is admin password set through `POST /admin/workspace/users/:userId/password`. Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/workspace-users/workspace-users.controller.ts`.
- Account unlock does not send an email. The resend route is intentionally honest and returns `resent: false`; the current recovery path is workspace-admin unlock. Evidence: `apps/api/src/auth/auth.service.ts`, `apps/api/src/workspace-users/workspace-users.controller.ts`.
- Meesho still uses stub `validateCredentials()` behavior. Flipkart and Amazon India now prove external credentials against their upstream marketplace flows, but Meesho does not yet validate external credentials upstream. Evidence: `apps/api/src/connectors/amazon/amazon.connector.ts`, `apps/api/src/connectors/meesho/meesho.connector.ts`, `apps/api/src/connectors/flipkart/flipkart.connector.ts`.
- Meesho's declared seller flow is not fully implemented in code: `generateExportFile()` still throws `Not implemented.` Evidence: `apps/api/src/connectors/meesho/meesho.connector.ts`.
- Connector definition discovery still has a fallback mode. It is hardened to a safe fallback set and logs warnings now, but a discovery failure still degrades the surfaced connector state and should be treated as an operational incident. Evidence: `apps/api/src/connector-framework/connector.registry.ts`.
- No WAF configuration is enforced or documented in the reviewed repo or deployment workflows. Railway provides the public edge, but a dedicated WAF control is not visible in code or repo docs. Evidence: `.github/workflows/deploy-staging.yml`, reviewed docs set.
- No secrets-scanning step is present in the reviewed GitHub Actions workflows. Evidence: `.github/workflows/deploy-staging.yml`, `.github/workflows/e2e-staging.yml`, repo-wide workflow search.
- No explicit CSRF token mechanism was found for Next.js Server Actions. The current posture relies on same-origin cookie scoping and server-side bearer forwarding. Evidence: `apps/web/src/lib/server-auth.ts`, server-action usage in the web app, and absence of a dedicated CSRF token layer in the reviewed source set.

## 5. Attack surface map

| Surface | Realistic attack | Current mitigation | Gap |
|---|---|---|---|
| Login endpoint | Brute force against one identity | IP rate limiting, per-user failed-attempt lockout, admin `lockedUntil` support | Redis fallback to in-memory weakens protection during Redis outage and only covers a single instance |
| Workspace login | Credential stuffing across workspace slugs | Workspace slug is required, per-IP throttling and per-user lockouts apply, invalid workspace returns `404 WORKSPACE_NOT_FOUND` | No cross-workspace reputation or breach-password screening is implemented |
| Bearer JWTs | Token theft or replay | Signed JWTs, logout blocklist, step-up re-auth for sensitive actions | Access tokens remain bearer tokens; repo does not show device binding or session fingerprinting |
| Tenant-scoped service calls | Missing tenant filter leaks another tenant's data | `prisma.tenant(tenantId)` pattern is used in reviewed services, RBAC limits access to admin surfaces | Raw SQL still requires discipline and comment review; tenant isolation is only as strong as service usage patterns |
| Connector credentials | Exposure of marketplace secrets in storage or logs | Credential encryption key is required by env validation; key rotation runbook exists | Meesho credential validation is still stubbed, so operational trust in stored secrets is weaker there than Flipkart or Amazon India |
| Step-up routes | Reuse of an expired or stolen step-up token | Short expiry, scoped token, linked `parentJti`, credential re-verification on issue | Step-up remains bearer-token based after issuance; a stolen unexpired token is still usable within its scope |
| Workspace user admin APIs | Editor or reviewer attempts to escalate to admin | `@Roles("admin")` on workspace user controller, service checks prevent invalid self-role changes and enforce admin-only password set | Admin compromise still gives broad control; there is no second-approver workflow |
| Next.js Server Actions and SSR admin forms | CSRF against authenticated browser sessions | Same-origin deployment model, SSR-held token, server-side auth header construction | No explicit CSRF token or double-submit mechanism is present in reviewed web code |
| Legacy shared-password fallback | Interception or reuse of one tenant-wide password | `timingSafeEqual()` replaces raw string equality, hashed path exists for migrated users | Identities without `passwordHash` still share one environment secret until migration is complete |

## 6. What is explicitly out of scope

This document does not model or guarantee:
- DDoS mitigation at the Railway edge or upstream network providers.
- Physical security of developer laptops, CI runners, or hosted infrastructure.
- General browser or client-device compromise outside the controls implemented by TEJ PIM.
- Security controls enforced by Amazon, Flipkart, Meesho, or any other third-party marketplace APIs.
