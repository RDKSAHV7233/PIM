# SEC-DB-RLS-001 I-3a: grace-period escalation and trial-ending reminders reach every tenant

Date: 2026-10-07
Baseline: stacked on the open I-1 PR (#1204, branch `sec-db-rls-001-i1-tenant-iteration` at `d598c92f`, itself on `main` `4dc700a3`). It uses the `forEachTenant` helper from #1204, so it cannot merge before it.
Issue: #1189. Increment I-3 (first half: grace-period and reminders; outbound-webhooks and `plan-usage` follow as separate PRs, `plan-usage` alone).
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser). No production access, credential or role change, no AI provider path.

## 1. The failure this closes

Both jobs found their work with **one** raw scan through `prisma.tenant()` (no argument) over `TenantPlanProfile`, deliberately without a tenant filter:

- `GracePeriodEscalationService` suspends tenants whose grace period expired.
- `CommercialRemindersService` sends trial-ending reminders.

Under row level security that client sees only the **default** tenant. After the role cutover grace-period enforcement would have covered one tenant and every unpaid tenant would stay active forever, and trial reminders would have gone to one tenant, with the job logging a normal "complete" line and no test failing. The old specs only checked timers and "does not rethrow"; **they would have passed if the job did nothing at all.**

## 2. Change

- New `discoverAcrossTenants` in `common/tenant/tenant-iteration.ts` (on top of #1204's `forEachTenant`): per tenant, inside that tenant's own transaction, run a discovery query and collect the rows. Only **discovery** runs in the tenant transaction; the action then runs through the services the job already used (they carry their own tenant client), so no transaction is held open across other services' connections.
- **The discovery SQL also filters by the tenant it is given** (`WHERE "tenantKey" = <tenant>`), not only by the tenant context. This matters today: with a role that bypasses RLS, a per-tenant query with no filter returns every tenant's rows in every iteration, so each tenant would be suspended or emailed once per tenant. The helper drops rows that are not the iteration's tenant and counts them as an item failure, so that mistake is loud.
- Both jobs now return a result (`discovered`, `suspended`/`acted`, `failed`, `status`, the per-tenant discovery summary) so a test and an operator can see what actually happened. `runEscalation()` and `runReminders()` still never throw; `runReminders()` still resolves to `undefined`.
- **Failures are errors, not warnings.** An unpaid tenant that was not suspended, or a reminder that was not delivered, is logged at ERROR; a tenant that could not be *read* is reported (`could not check N/M tenant(s)`) and the run is `PARTIAL_FAILURE`.
- Each job has an environment variable to shorten its boot delay (`GRACE_PERIOD_ESCALATION_INITIAL_DELAY_MS`, `COMMERCIAL_REMINDERS_INITIAL_DELAY_MS`; defaults unchanged at 3 and 5 minutes; invalid values keep the default), so a real API process can run the job in a test.
- The two inventory entries are now `migrated` with 0 no-argument raw sites.

## 3. Evidence

Every test follows one rule: the fixture proves there is something to do, the job discovers it, and the job acts; a run that finds zero when the fixture says at least one exists fails.

- **Unit (26 tests, each scenario in two modes).** A small in-memory fake of `TenantPlanProfile` runs every scenario twice: **restricted** (RLS enforced; the base client sees only the default tenant) and **superuser** (RLS bypassed, as in production today). Both must give the same answer.
  - Grace-period: tenants a, b and default (all expired) are discovered (3) and each suspended **exactly once** (no per-iteration duplicate), with notification and audit; a tenant still in grace, one already suspended and one paying are untouched; a fixture with no expired tenant reports `discovered 0, SUCCESS`; a failing suspension is an ERROR, the others still get suspended, status `PARTIAL_FAILURE`; an unreadable tenant is reported and the run is `PARTIAL_FAILURE`.
  - Reminders: of five trials, 4 are inside the window, 3 are at a threshold (7 days, 1 day, 7 days) and are reminded once each with the right `daysRemaining`; the in-app notification is created only where the schedule says (7 days, not 1); a trial at 4 days and one at 20 days are not reminded; failures and unreadable tenants behave as above.
  - **Mutation A** (drop the explicit tenant filter from the SQL): 6 failures. **Mutation B** (iterate only the default tenant, the old coverage): 12 failures. The "old scan" is also executed directly: under RLS it finds only the default tenant.
- **Real PostgreSQL, restricted role, real API process** (`billing-jobs-tenant-iteration.test.cjs`, own throwaway database): two expired non-default tenants are **suspended** (`accessStatus` suspended, reason `grace_period_expired`) with **exactly one audit row each**; a non-default tenant at 7 days gets its in-app **trial-ending notification** and the tenant at 4 days gets none; the tenant still in grace and the paying tenant stay `active`; the API connected as `vexa_runtime_ci`. **Mutation on the built code** (default tenant only): the test fails because the non-default tenant stays `active`.
- 753 unit tests across `billing`, `common`, `connector-framework`, `connector-installer` pass; ratchet, raw-comment guard and type-check pass.
- **Restricted-role lane (local PostgreSQL 16, API as `vexa_runtime_ci`): 27 pass, 1 tracked expected failure (the M2 provisioning seed, closed by #1206), 0 unexpected failures, 0 unexpected passes.**

## 4. Known deviations and limits

- **Stacked on #1204.** It must merge after #1204; if #1204 is squash-merged this branch needs a rebase onto `main`.
- The new integration test is **not yet registered in the restricted-role lane** (a `scripts/` change, which would make this PR span four risk domains). It passes locally as the restricted role; registration goes with the lane-registration PR together with #1204's two integration tests.
- The e-mail leg of the reminders (`notifyTrialEnding`) is configuration-dependent and returns 0 recipients without a mail provider, so the integration test asserts the in-app notification, which does not depend on mail configuration. The unit tests assert the e-mail call per tenant.
- Orphans: a profile whose tenant is missing from `WorkspaceDirectory` is invisible to a restricted role, so the job cannot see it. The summaries report `orphanDetection: UNVERIFIED_BY_RUNTIME_ROLE`; there is no claim of zero.
- Not in this PR: `outbound-webhooks` (stuck-delivery recovery) and `plan-usage` (21 raw SQL sites, its own PR).

## 5. Next

`outbound-webhooks` stuck-delivery recovery, then `plan-usage` as its own PR, then I-4 (remaining sweepers).
