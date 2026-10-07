# SEC-DB-RLS-001 I-5a: raw SQL that filters by tenant runs on that tenant's client

Date: 2026-10-07
Baseline: `origin/main` at `4dc700a3` (`CI` and `Deploy Staging` green)
Issue: #1189. Increment I-5a of the approved sequence (the R-class sites).
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser). No production access, credential or role change, no AI provider path. Independent of the open I-1 and I-2 PRs.

## 1. What the R class is

Six raw SQL statements in `bulk-import`, `catalog` and `connector-permission` called `this.prisma.tenant()` with **no argument**, which resolves the tenant from the request context, while filtering by a tenant held in a local variable (`WHERE "tenantKey" = ${tenantKey}`). That is correct only while the request tenant equals the filter tenant, and a raw query on a client whose tenant context is missing or different returns nothing under row level security. In the request path the two agree today, which is why nothing fails; the risk is the day any of these runs from code without the request context, or the context and the variable drift.

## 2. Change

Exactly six lines: each statement now runs on `this.prisma.tenant(<the tenant it filters by>)`.

| File | Sites | Tenant used |
|---|---|---|
| `bulk-import/bulk-import.service.ts` | `createTemplate` (version query and insert), `listTemplates`, `getTemplate` | `tenantKey` / `normalizedTenant` (already validated against the request context by `resolveRequestTenantKey`, which refuses a mismatch) |
| `catalog/catalog.service.ts` | channel-filter JOIN in `advancedSearchProducts` | `tenantKey` from `getTenantKeyFromContext()` |
| `connector-installer/connector-permission.service.ts` | `userExistsForTenant` | `tenantKey` from `getTenantKey()` |

The ORM calls elsewhere in these files keep using `tenant()` with no argument: that is the approved request-scoped pattern (the extension injects the tenant filter and the connection carries the request tenant). Only the raw statements, which bypass the extension, needed the explicit tenant.

## 3. Evidence

- **Unit, `common/tenant/explicit-tenant-raw-sql.spec.ts` (6 tests).** The stub gives `tenant(<tenant>)` a working client and gives `tenant()` with no argument a client **whose raw methods throw**, so a raw statement succeeds only if its site passed the tenant. Positive results are asserted, not just "no error": `createTemplate` reads version 3 for the tenant and writes version 3; `userExistsForTenant` returns true for an active row and false for an inactive one; the tenant appears in the bound SQL parameters (twice for the catalog JOIN, which filters both joined tables); an explicit tenant that differs from the context is refused before any query.
- **Mutation check:** putting all six sites back to `tenant()` with no argument fails 5 of the 6 (the sixth, the mismatch refusal, is unrelated); files restored from backup.
- **Static ratchet.** `scripts/validate-sec-db-call-sites.cjs` has a new rule: a raw-SQL entry marked `migrated` must have **zero** no-argument raw sites (`noArgTenant.regressed`), and an `open` entry that recorded such sites but no longer has them must be marked migrated (`noArgTenant.stale`). The three files are now `migrated` with 0 no-argument sites. Two new negative tests prove each rule fires. (My first version of the stale rule flagged an unrelated entry that never recorded no-argument sites; the unit test run caught it and the rule was narrowed.)
- 341 unit tests across `bulk-import`, `catalog`, `connector-installer`, `common/tenant` pass; type-check and the raw-SQL comment guard pass.
- **Restricted-role lane (local PostgreSQL 16, API as `vexa_runtime_ci`): 27 pass, 1 tracked expected failure (the M2 provisioning seed, closed by #1206), 0 unexpected failures, 0 unexpected passes.**

## 4. Limits

- Because the request context and the explicit tenant agree in every current caller, this change cannot be shown to alter a request's result; what it removes is the dependence on that agreement. The proof is that the raw statements cannot run on a client without the tenant, not that a production request changed.
- `listTemplates` runs its raw statement only in its non-paginated branch; the paginated branch uses the ORM and was already correct.
- `AuthIdentity` (queried by `userExistsForTenant`) has no row level security, so that site is consistency, not a functional fix.

## 5. Next

I-3 billing jobs once the tenant-iteration helper (#1204) is merged; I-4 remaining sweepers; I-6 constructor fallbacks. Pending human steps: merge #1204 and #1206.
