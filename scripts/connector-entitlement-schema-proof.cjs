#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Proof for the 5.1c-2 migrations (connector_tenant_entitlements and the provider-verification columns).
 *
 * Runs against a THROWAWAY database that already has `prisma migrate deploy` applied. Never point it at a shared or
 * production database: it inserts rows, creates a non-superuser role and rolls the rollback SQL back inside a
 * transaction. It refuses to run unless the database name contains "proof".
 *
 *   docker exec pim1-postgres psql -U postgres -c "CREATE DATABASE pim1_s51c2_proof_<date>;"
 *   CHECKPOINT_DISABLE=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pim1_s51c2_proof_<date> \
 *     npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
 *   DATABASE_URL=... node scripts/connector-entitlement-schema-proof.cjs
 *   docker exec pim1-postgres psql -U postgres -c "DROP DATABASE pim1_s51c2_proof_<date>;"
 *
 * Prints one JSON document; exits non-zero if any check fails.
 */
const { PrismaClient } = require("@prisma/client");

const url = String(process.env.DATABASE_URL ?? "");
if (!/proof/i.test(url.split("/").pop() ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at a database whose name contains 'proof'.");
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const checks = [];
let seq = 0;
const id = () => `proof-${Date.now()}-${++seq}`;

function record(name, ok, detail) {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.error(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  -> ${detail}` : ""}`);
}

async function expectError(name, pattern, run) {
  try {
    await run();
    record(name, false, "expected an error, none raised");
  } catch (error) {
    const message = String(error?.message ?? error);
    record(name, pattern.test(message), pattern.test(message) ? undefined : message.slice(0, 300));
  }
}

const GRANT_COLUMNS = `"id","tenant_key","connector_slug","release_stage","approved_by","reason","source","tenant_opted_in_at","tenant_opted_in_by"`;

function insertGrant(over = {}) {
  const row = {
    id: id(),
    tenant: "tenant-a",
    slug: "zoho-inventory",
    stage: "controlled_pilot",
    approvedBy: "Product Operations",
    reason: "named pilot tenant",
    source: "product_ops",
    optInAt: null,
    optInBy: null,
    ...over,
  };
  return prisma.$executeRawUnsafe(
    `INSERT INTO connector_tenant_entitlements (${GRANT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
    row.id, row.tenant, row.slug, row.stage, row.approvedBy, row.reason, row.source, row.optInAt, row.optInBy,
  ).then(() => row.id);
}

async function main() {
  // Clean slate for a rerun (the guard trigger blocks DELETE, so drop it for the duration of cleanup only).
  await prisma.$executeRawUnsafe(`ALTER TABLE connector_tenant_entitlements DISABLE TRIGGER connector_tenant_entitlements_append_only`);
  await prisma.$executeRawUnsafe(`DELETE FROM connector_tenant_entitlements WHERE id LIKE 'proof-%'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE connector_tenant_entitlements ENABLE TRIGGER connector_tenant_entitlements_append_only`);

  // ── Shape ──────────────────────────────────────────────────────────────────────────────────────────────
  const columns = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='connector_installations' AND column_name LIKE 'last_provider_verif%' ORDER BY column_name`,
  );
  record("provider-verification columns exist", columns.length === 3, JSON.stringify(columns));
  const rls = await prisma.$queryRawUnsafe(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname='connector_tenant_entitlements'`,
  );
  record("entitlements: RLS enabled and forced", rls[0]?.enabled === true && rls[0]?.forced === true, JSON.stringify(rls));
  const policies = await prisma.$queryRawUnsafe(`SELECT policyname, cmd FROM pg_policies WHERE tablename='connector_tenant_entitlements'`);
  record("entitlements: exactly one policy, SELECT only", policies.length === 1 && policies[0].cmd === "SELECT", JSON.stringify(policies));

  // ── Entitlement constraints ────────────────────────────────────────────────────────────────────────────
  const pilot = await insertGrant();
  record("a valid controlled_pilot grant inserts", Boolean(pilot));
  const early = await insertGrant({ slug: "etsy", stage: "early_access", optInAt: "2026-10-05T00:00:00Z", optInBy: "tenant admin" });
  record("a valid early_access grant with a tenant opt-in inserts", Boolean(early));

  await expectError("live is not a cohort stage", /stage_check/, () => insertGrant({ slug: "x1", stage: "live" }));
  await expectError("slug must be lower-case and trimmed", /slug_check/, () => insertGrant({ slug: "Zoho" }));
  await expectError("approver must be named", /attribution_check/, () => insertGrant({ slug: "x2", approvedBy: "  " }));
  await expectError("reason is required", /attribution_check/, () => insertGrant({ slug: "x3", reason: "" }));
  await expectError("early_access needs the tenant's opt-in", /early_access_opt_in_check/, () => insertGrant({ slug: "x4", stage: "early_access" }));
  await expectError("opt-in time and actor come together", /opt_in_pair_check/, () => insertGrant({ slug: "x5", optInAt: "2026-10-05T00:00:00Z", optInBy: null }));
  await expectError("a window must end after it starts", /window_check/, () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO connector_tenant_entitlements (id,tenant_key,connector_slug,release_stage,valid_from,valid_until,approved_by,reason,source) VALUES ($1,'tenant-a','x6','controlled_pilot','2026-10-10','2026-10-01','PO','r','s')`,
      id(),
    ),
  );
  await expectError("a revocation needs actor and reason together", /revocation_check/, () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO connector_tenant_entitlements (id,tenant_key,connector_slug,release_stage,approved_by,reason,source,revoked_at) VALUES ($1,'tenant-a','x7','controlled_pilot','PO','r','s',NOW())`,
      id(),
    ),
  );
  await expectError("one live grant per tenant, connector and stage", /23505|already exists/i, () => insertGrant());

  // ── Append and revoke only ─────────────────────────────────────────────────────────────────────────────
  await expectError("a grant cannot be edited", /cannot be edited, only revoked/, () =>
    prisma.$executeRawUnsafe(`UPDATE connector_tenant_entitlements SET reason='changed' WHERE id=$1`, pilot),
  );
  await expectError("a grant cannot be extended", /cannot be edited, only revoked/, () =>
    prisma.$executeRawUnsafe(`UPDATE connector_tenant_entitlements SET valid_until='2030-01-01' WHERE id=$1`, pilot),
  );
  await expectError("a grant cannot be deleted", /cannot be deleted; revoke the grant instead/, () =>
    prisma.$executeRawUnsafe(`DELETE FROM connector_tenant_entitlements WHERE id=$1`, pilot),
  );
  await prisma.$executeRawUnsafe(
    `UPDATE connector_tenant_entitlements SET revoked_at=NOW(), revoked_by='Product Operations', revoke_reason='pilot ended' WHERE id=$1`,
    pilot,
  );
  record("a grant can be revoked", true);
  await expectError("a revoked grant is final", /revoked grant is final/, () =>
    prisma.$executeRawUnsafe(`UPDATE connector_tenant_entitlements SET revoke_reason='edited' WHERE id=$1`, pilot),
  );
  const replacement = await insertGrant({ reason: "renewed" });
  record("after revocation a new grant for the same tenant, connector and stage inserts", Boolean(replacement));

  // ── Row-level security, as a role that is subject to it ───────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proof_app') THEN CREATE ROLE proof_app NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$`);
  await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON connector_tenant_entitlements TO proof_app`);
  await insertGrant({ tenant: "tenant-b", slug: "odoo" });

  const asTenant = (tenant, sql, ...args) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE proof_app`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_key', '${tenant}', true)`);
      return sql(tx, ...args);
    });

  const seenByA = await asTenant("tenant-a", (tx) => tx.$queryRawUnsafe(`SELECT DISTINCT tenant_key FROM connector_tenant_entitlements`));
  record("tenant-a sees only its own grants", seenByA.length === 1 && seenByA[0].tenant_key === "tenant-a", JSON.stringify(seenByA));
  const seenByB = await asTenant("tenant-b", (tx) => tx.$queryRawUnsafe(`SELECT DISTINCT tenant_key FROM connector_tenant_entitlements`));
  record("tenant-b sees only its own grants", seenByB.length === 1 && seenByB[0].tenant_key === "tenant-b", JSON.stringify(seenByB));
  const seenByC = await asTenant("tenant-c", (tx) => tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM connector_tenant_entitlements`));
  record("a tenant with no grants sees none", seenByC[0].n === 0, JSON.stringify(seenByC));

  await expectError("a tenant cannot grant itself an entitlement", /row-level security|violates/i, () =>
    asTenant("tenant-a", (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO connector_tenant_entitlements (id,tenant_key,connector_slug,release_stage,approved_by,reason,source) VALUES ($1,'tenant-a','shopware','controlled_pilot','self','self','self')`,
        id(),
      ),
    ),
  );
  const updated = await asTenant("tenant-a", (tx) => tx.$executeRawUnsafe(`UPDATE connector_tenant_entitlements SET revoked_at=NOW(), revoked_by='x', revoke_reason='x'`));
  record("a tenant cannot revoke or change its own grants (no write policy: 0 rows)", updated === 0, `rows=${updated}`);
  const deleted = await asTenant("tenant-a", (tx) => tx.$executeRawUnsafe(`DELETE FROM connector_tenant_entitlements`));
  record("a tenant cannot delete grants (0 rows)", deleted === 0, `rows=${deleted}`);

  // ── Provider-verification columns ──────────────────────────────────────────────────────────────────────
  const installId = id();
  await prisma.$executeRawUnsafe(
    `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, installed_by) VALUES ($1,'tenant-a','cdef_flipkart',$1,'proof')`,
    installId,
  );
  const fresh = await prisma.$queryRawUnsafe(
    `SELECT last_provider_verified_at, last_provider_verification_kind, last_provider_verification_reason FROM connector_installations WHERE id=$1`,
    installId,
  );
  record("an installation row written without the new columns reads NULL (never provider-verified)", fresh[0].last_provider_verified_at === null && fresh[0].last_provider_verification_kind === null);

  await prisma.$executeRawUnsafe(
    `UPDATE connector_installations SET last_provider_verified_at=NOW(), last_provider_verification_kind='PROVIDER_AUTHENTICATED', last_provider_verification_reason='OAUTH_TOKEN_REFRESH' WHERE id=$1`,
    installId,
  );
  record("a provider-authenticated verification records", true);

  await prisma.$executeRawUnsafe(
    `UPDATE connector_installations SET last_validation_attempt_at=NOW(), last_validation_outcome='INDETERMINATE', last_validation_reason='PROVIDER_UNREACHABLE' WHERE id=$1`,
    installId,
  );
  const afterOutage = await prisma.$queryRawUnsafe(
    `SELECT last_provider_verified_at, last_provider_verification_kind, last_validation_outcome FROM connector_installations WHERE id=$1`,
    installId,
  );
  record(
    "a later INDETERMINATE attempt leaves the provider-verification fact intact",
    afterOutage[0].last_validation_outcome === "INDETERMINATE" && afterOutage[0].last_provider_verified_at !== null && afterOutage[0].last_provider_verification_kind === "PROVIDER_AUTHENTICATED",
    JSON.stringify(afterOutage),
  );

  const upd = (set) => prisma.$executeRawUnsafe(`UPDATE connector_installations SET ${set} WHERE id='${installId}'`);
  await expectError("TOKEN_ONLY can never be recorded as provider verification", /code_check/, () => upd(`last_provider_verification_kind='TOKEN_ONLY'`));
  await expectError("the kind must be an upper-case code", /code_check/, () => upd(`last_provider_verification_kind='provider authenticated'`));
  await expectError("the reason must be an upper-case code, not a message", /code_check/, () => upd(`last_provider_verification_reason='the provider said no'`));
  await expectError("a time without a kind is rejected", /pair_check/, () => upd(`last_provider_verification_kind=NULL`));
  await expectError("a kind without a time is rejected", /pair_check/, () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, installed_by, last_provider_verification_kind) VALUES ($1,'tenant-a','cdef_flipkart',$1,'proof','PROVIDER_AUTHENTICATED')`,
      id(),
    ),
  );
  await expectError("a reason without a verification is rejected", /pair_check/, () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, installed_by, last_provider_verification_reason) VALUES ($1,'tenant-a','cdef_flipkart',$1,'proof','SOMETHING')`,
      id(),
    ),
  );

  // ── Rollback SQL (inside a transaction that is itself rolled back) ─────────────────────────────────────
  class Done extends Error {}
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE connector_installations DROP CONSTRAINT IF EXISTS connector_installations_provider_verification_pair_check`);
      await tx.$executeRawUnsafe(`ALTER TABLE connector_installations DROP CONSTRAINT IF EXISTS connector_installations_provider_verification_code_check`);
      await tx.$executeRawUnsafe(`ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verification_reason`);
      await tx.$executeRawUnsafe(`ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verification_kind`);
      await tx.$executeRawUnsafe(`ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verified_at`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS connector_tenant_entitlements`);
      await tx.$executeRawUnsafe(`DROP FUNCTION IF EXISTS connector_tenant_entitlements_guard()`);
      const gone = await tx.$queryRawUnsafe(
        `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='connector_installations' AND column_name LIKE 'last_provider_verif%')::int AS cols,
                (SELECT count(*) FROM pg_class WHERE relname='connector_tenant_entitlements')::int AS tbl,
                (SELECT count(*) FROM pg_proc WHERE proname='connector_tenant_entitlements_guard')::int AS fn`,
      );
      record("the documented rollback removes every object it created", gone[0].cols === 0 && gone[0].tbl === 0 && gone[0].fn === 0, JSON.stringify(gone));
      throw new Done();
    });
  } catch (error) {
    if (!(error instanceof Done)) throw error;
  }
  const still = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM connector_tenant_entitlements`);
  record("the rollback transaction was itself rolled back (the proof database is unchanged)", still[0].n > 0);

  // Tidy the rows this run created (the append-only trigger is bypassed for cleanup only).
  await prisma.$executeRawUnsafe(`DELETE FROM connector_installations WHERE installed_by='proof'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE connector_tenant_entitlements DISABLE TRIGGER connector_tenant_entitlements_append_only`);
  await prisma.$executeRawUnsafe(`DELETE FROM connector_tenant_entitlements WHERE id LIKE 'proof-%'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE connector_tenant_entitlements ENABLE TRIGGER connector_tenant_entitlements_append_only`);
}

main()
  .catch((error) => {
    record("proof run completed without an unexpected error", false, String(error?.message ?? error).slice(0, 400));
  })
  .finally(async () => {
    await prisma.$disconnect();
    const failed = checks.filter((entry) => !entry.ok);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, failures: failed }, null, 2));
    process.exitCode = failed.length === 0 ? 0 : 1;
  });
