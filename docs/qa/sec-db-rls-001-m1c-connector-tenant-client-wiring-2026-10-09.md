# SEC-DB-RLS-001 M1c: the connectors' tenant client is always injected

Date: 2026-10-09
Baseline: `origin/main` at `9635b2f2` (#1266)
Type: **test and documentation only.** No source file, credential, flag, role, policy or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

## 1. What this closes, and what it deliberately does not

Sixteen classes (eleven connectors, the WooCommerce bulk-publish and brownfield-import services, the credential-encryption service) take
`PrismaService` as an **optional** constructor parameter, and `tenantDb` falls back to the context-free direct client when it is absent
(`apps/api/src/connector-framework/tenant-db.ts`). The fallback exists so that tests which build a class by hand keep working. Under a
restricted runtime role that fallback would see no tenant's rows, so it must never be reachable in the running application.

Nest decides what to inject from the constructor's emitted parameter types. If `PrismaService` is among them, the fallback is unreachable
in production. This increment pins that fact:

- `tenant-client-wiring.spec.ts` asserts, for each of the 16 classes, that `design:paramtypes` contains `PrismaService`;
- a second test walks `apps/api/src` and fails if the number of classes with the optional parameter differs from the list, so a new
  connector copying the pattern cannot be forgotten.

**Not done, by decision:** deleting the optional parameter itself. That is a migration of about 45 hand-built test fixtures (unit specs and
admin-identity integration tests that pass only the direct service) with **no production effect**, and it would make this PR large and mix
fixture work with the guard. It stays a deferred, mechanical follow-up; the inventory text says so.

## 2. Evidence

| Check | Result |
|---|---|
| `tenant-client-wiring.spec.ts` (17 tests) and `tenant-db.spec.ts` (9) | pass |
| Mutation: retype the Shopify parameter to `PrismaService \| undefined` (a union emits `Object`, so Nest would stop injecting it) | `ShopifyConnector has PrismaService among its injected constructor parameters` **fails** (1 failed, 16 passed); source restored, `git status` shows only the new spec |
| `validate-sec-db-call-sites.cjs` | pass (28 files, all still open; wording of 15 entries updated) |

## 3. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or policy, and does not claim cutover readiness. The
restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 4. Rollback

Revert the PR. Nothing at runtime changes.
