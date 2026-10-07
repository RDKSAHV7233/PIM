# SEC-DB-RLS-001 7.8: the identity model gains `vexa_reporter` and the narrow `vexa_ops` backfill grants

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Issue: #1189. Design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 6. Identity model: #1198.
Type: **tooling and rehearsal. No production access, no application change, no role, grant, ownership, RLS or credential change.**

## 1. What changed

The I1 model had four identities. The owner decisions of 2026-10-06 and 2026-10-07 add one and widen one, both for operator workflows that today share a single credential (`STAGE3_DATABASE_URL`, environment `production`) with a general-purpose role:

| Identity | Change | Why (read from the repository) |
|---|---|---|
| `vexa_reporter` | **new.** LOGIN, NOSUPERUSER, **BYPASSRLS only because a report spans tenants**, owns nothing, no DDL, no writes. `SELECT` on `connector_submissions`, `Product`, `Variant`, `media_assets` | the audit report reads `connectorSubmission`, `product`, `variant` (`scripts/sellable-sku-variantless-audit-report.cjs`); the media-integrity report reads `mediaAsset` (`scripts/media-integrity-readonly-report.cjs`). Its credential must never be reachable by the API process |
| `vexa_ops` | **widened narrowly.** Still NOSUPERUSER, **NOBYPASSRLS**. Adds `SELECT` on `Product` and `SELECT`+`INSERT` on `Variant` (new level `select-insert`) beside the two platform control tables | the sellable-SKU backfill reads products and reads and creates variants (`scripts/sellable-sku-variantless-backfill.cjs`). Because ops does not bypass RLS, the backfill must set the tenant context for each tenant and iterate. It is not a general cross-tenant writer, and cannot update or delete anything |
| model wording | the "SELECT-only maintenance policy" is no longer named as an accepted path | owner decision on D-022: a policy opening on a session setting that the ordinary runtime can set is not a separately governed path |

Files: `packages/db/identity/identity-model.v1.json`, `scripts/db-identity/{lib,lib.test,tool,rehearse}.cjs`, `scripts/sec-db-rls-001-probe-proof.cjs`.

## 2. Evidence

- **Unit tests** (`lib.test.cjs`): the model, the role definitions, the expected privileges for the two new cases, and 17 new negative cases. Each breaks one property and must be reported by a named check: the reporter losing BYPASSRLS, being a superuser, missing, writing a report table, reaching an ordinary table or the kill switch, owning a table, creating in `public`, joining another role; ops updating products, deleting variants, losing the variant insert, or bypassing RLS; a stale or writing manifest entry.
- **Mutation check on the verifier: 10 of 10 caught** (reporter dropped from the privilege, ownership or schema-create rules; the reporter's or ops's BYPASSRLS flipped; the reporter's grants made CRUD; `select-insert` widened; stale entries or a writing reporter left undetected; the membership rule skipping the reporter). The file was restored after each.
- **Rehearsal on real PostgreSQL, 114 of 114 checks on both 16 and 18** (it was 88). Two new stages:
  - R7b, the reporter: not a superuser, bypasses RLS; sees all three tenants' products where a tenant-bound role sees one; reads variants, submissions and media across tenants; cannot INSERT, UPDATE, DELETE or TRUNCATE; cannot create tables; cannot read an ordinary table, the kill switch or `_prisma_migrations`; cannot `SET ROLE` to the migrator or the backup role; the seeded data is unchanged.
  - R8b, ops as the backfill uses it: does not bypass RLS; under tenant-b it reads only tenant-b's product; with no tenant context it sees only the default tenant (iteration is mandatory); it creates tenant-b's missing variant; a cross-tenant variant insert is rejected by RLS; it cannot update or delete products or variants, and cannot read submissions or media.
  - The seed now includes products, a variant, submissions and media, referentially valid, so the **dump taken as `vexa_backup` is restored** and its content hashes match, including the new tables.
- **The probe's live proof** (`sec-db-rls-001-probe-proof.cjs`) is updated and passes **40 of 40 on PostgreSQL 16 and 18** (it was 38): it now runs the probe *as* `vexa_reporter` (BYPASSRLS, four tables, no write, owns nothing, cannot create) and asserts the widened ops shape (4 readable, 3 insertable, 2 updatable and deletable tables).

## 3. Not changed, on purpose

`scripts/restricted-role-lane.v1.json`, lane registration and the lane's role creation, the `tenant-iteration*` code and its rename, every call-site migration, the deploy, backup and reporter wiring (7.9a-c), `.github/workflows/ci.yml`, the AI programme. Nothing here is applied to production: `vexa_app_v2` is untouched and no credential exists for the new role.

## 4. Limits

- The reporter's table list is derived from the two reports as they are today; a report that starts reading another table fails closed (the role has no privilege) until the manifest is updated by a reviewed change.
- The rehearsal proves the model on a database that reproduces the production ownership split. It does not prove production data volumes, networking or the real credentials.
- `vexa_reporter` needs a credential and a place for it to live; that is the operator wiring in 7.9c, and a human provisions it.

## 5. Rollback

Revert the PR. Nothing depends on it, and nothing in production changed.
