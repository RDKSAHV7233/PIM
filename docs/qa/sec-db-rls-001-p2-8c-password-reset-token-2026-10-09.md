# SEC-DB-RLS-001 P2.8c: password reset works for every tenant's recovery token under the restricted role

Date: 2026-10-09
Baseline: `origin/main` at `0fdc2b5d` (#1270)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role, policy or configuration is changed. **No schema change, no new policy, no change to the token format, expiry, single-use rule or API contract.**

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Third slice of the "class C" items (`auth.service.ts`, inventory remediation "review"). Security-adjacent, so it is stated precisely what changes and what does not.

## 1. What was reviewed

`auth.service.ts` has two uses of the context-free direct client:

| Site | Table | Row level security | Verdict |
|---|---|---|---|
| `requestPasswordReset`: find the identity by e-mail | `AuthIdentity` | **none** (checked on a migrated database; `userId` is globally unique) | works for every tenant under a restricted role; pre-tenant by nature; **left unchanged** |
| `confirmPasswordReset`: find the recovery token by hash, then update the identity and the token | `AuthRecoveryToken` (forced RLS), `AuthIdentity` | token table **forced** | **defect, fixed here** |

Everything else in the file already uses `prisma.tenant(<tenant>)`, including creating the token (`createRecoveryToken`).

## 2. The defect

The reset link carries only the token (`POST /auth/password-reset/confirm { token, password }`), so the tenant is unknown until the token is found. The lookup and both writes went through the direct client with no tenant context. Under a restricted role that sees the default tenant's tokens only, so **every other tenant's reset link read as `PASSWORD_RESET_TOKEN_INVALID`** and nobody outside the default tenant could recover a forgotten password or an automatic lock (`lockedUntil` is cleared by this path). The requests would succeed and the e-mails would be sent (creating the token already used the tenant client), which would make the failure look like a user error.

## 3. Change (`apps/api/src/auth/auth.service.ts`)

- New private `findRecoveryTokenAcrossTenants(tokenHash)`: the token hash (SHA-256 of 32 random bytes, unique) is looked up per tenant through the existing `forEachTenant` (one short transaction per tenant, tenant context set inside it, 3 second timeout), the query also filtered by that tenant. A row of another tenant fails that tenant's read.
- Once the token is found its tenant is known: the identity lookup, the password update (`lockedUntil` cleared) and marking the token used now run on `prisma.tenant(<token tenant>)` in one transaction, as before but in the right tenant context.
- **A token found in a readable tenant works even if another tenant could not be read.** **No match while a tenant was unreadable** returns `503 PASSWORD_RESET_TEMPORARILY_UNAVAILABLE` (the same link can be retried; the log names tenants and stable codes only, the response carries no detail), never an invalid-link answer. **No match with every tenant readable** is `PASSWORD_RESET_TOKEN_INVALID`, as before.
- Unchanged: token generation and hashing, expiry (and the expired / used checks), single use, password length rules, blocklist revocation, failure-counter clearing, audit record, response shape, controller, DTOs, OpenAPI.
- Enumeration / timing: an unknown token is now looked up in every tenant, so its response takes longer than a hit. The token is 256 bits of randomness, so this reveals nothing guessable.
- Orphan limit (stated): a tenant with a token but no directory row is not covered by the iteration.

## 4. Evidence

| Check | Result |
|---|---|
| `auth-password-reset-tenant.spec.ts` (9 new) on an RLS-faithful fake (a query sees only the iteration's tenant; any query without a tenant filter throws) | pass: a non-default tenant's token resets in that tenant's own client (identity update clears the lock, token marked used, credentials revoked for that tenant); the default tenant's token still works; unknown, expired and used tokens are invalid; a token whose identity is gone is invalid and nothing is written; an unreadable tenant with no match is 503 and carries no detail; a token in a readable tenant survives another's failure; a short password is rejected before any database access |
| Mutation: iterate the default tenant only | 4 of 9 fail |
| Real-database test `password-reset-token-restricted-role.test.cjs`: isolated migrated DB, the real `AuthService` in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); a live token and an identity on two non-default directory tenants and the default tenant, plus an expired and a used token | pass: **the former context-free lookup finds the default tenant's token only**; all three resets succeed, the password is replaced, the lock cleared and the token consumed in each tenant; garbage, expired, used and already-consumed tokens are all still `PASSWORD_RESET_TOKEN_INVALID` |
| Mutation: default tenant only, in the built service | the real-database test **fails** (`the reset for <tenant A> must succeed`); dist restored byte-identical |
| Lane | `scripts/restricted-role-lane.v1.json` registers it; config test passes |
| `validate-sec-db-call-sites.cjs`; `tsc -p tsconfig.build.json --noEmit`; `jest src/auth` | pass; clean; 15 suites / 172 tests pass |
| `auth-password-reset.test.cjs` (older, admin-role, spawns the full API; run by `scripts/run-increment-gates.cjs`, not by CI) | **not verified here**: it did not reach the API's health check on this machine, whose local `pim1` development database is behind the migrations (the API logs Prisma `P2022` missing-column errors for it on start); the API itself starts fine, and the new tests above ran on freshly migrated databases. Not caused by this change; to be run where the schema is current |

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant, role or policy, and does not claim cutover readiness. It does not decide whether `AuthIdentity` should become row-level-secured: today it is not, which is why login and the e-mail lookup work for every tenant, and making it secured would need a different design (an explicit product/security decision, recorded as an open item). The `media.service` unsigned branch still waits on `MEDIA_URL_SIGNING_KEY` (human gate). The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The single context-free lookup returns, which is correct only for the current superuser runtime.
