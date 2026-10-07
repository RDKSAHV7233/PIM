"use strict";

// SEC-DB-RLS-001 7.9c: the backfill's opt-in ops mode (OPS_DATABASE_URL). The real roles are exercised by the database-identity
// rehearsal (stage R8c); these tests pin the mechanics with a fake client so a regression fails fast without a database.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bf = require("./sellable-sku-variantless-backfill.cjs");

/** A fake client that records, in order, every tenant context set and every read or write made after it. */
function fakeClient({ directory = [], productsByTenant = {}, failTenant = null, existingVariant = false } = {}) {
  const log = [];
  const tx = (state) => ({
    $queryRaw: async (strings, ...values) => {
      assert.match(strings.join("?"), /set_config\('app\.tenant_key', \?, true\)/);
      state.tenant = values[0];
      log.push(["context", values[0]]);
      return [];
    },
    product: {
      findMany: async () => {
        if (state.tenant === failTenant) throw new Error(`boom ${state.tenant}`);
        log.push(["read", state.tenant]);
        return productsByTenant[state.tenant] || [];
      },
    },
    variant: {
      findFirst: async () => (log.push(["recheck", state.tenant]), existingVariant ? { id: "v0" } : null),
      create: async ({ data }) => (log.push(["create", state.tenant, data.tenantKey]), { id: "v-new" }),
    },
  });
  return {
    log,
    workspaceDirectory: { findMany: async () => directory.map((tenantKey) => ({ tenantKey })) },
    $transaction: async (fn) => fn(tx({ tenant: null })),
  };
}

test("listTenantKeys: the directory plus the default tenant, de-duplicated, sorted, blanks dropped", async () => {
  const c = fakeClient({ directory: ["tenant-b", " tenant-a ", "default", "", "tenant-b"] });
  const r = await bf.listTenantKeys(c);
  assert.deepEqual(r.tenantKeys, ["default", "tenant-a", "tenant-b"]);
  assert.equal(r.directoryTenantCount, 5);
});

test("listTenantKeys: an empty directory still iterates the default tenant (zero tenants is never a silent success)", async () => {
  const r = await bf.listTenantKeys(fakeClient({ directory: [] }));
  assert.deepEqual(r.tenantKeys, ["default"]);
});

test("listTenantKeys honours PIM_DEFAULT_TENANT_KEY like the application", async () => {
  const before = process.env.PIM_DEFAULT_TENANT_KEY;
  process.env.PIM_DEFAULT_TENANT_KEY = "home";
  try {
    assert.deepEqual((await bf.listTenantKeys(fakeClient({ directory: ["a"] }))).tenantKeys, ["a", "home"]);
  } finally {
    if (before === undefined) delete process.env.PIM_DEFAULT_TENANT_KEY;
    else process.env.PIM_DEFAULT_TENANT_KEY = before;
  }
});

test("loadCandidatesByTenant sets each tenant's context BEFORE reading, in that tenant's own transaction", async () => {
  const c = fakeClient({ productsByTenant: { a: [{ id: "pa", tenantKey: "a" }], b: [{ id: "pb", tenantKey: "b" }] } });
  const r = await bf.loadCandidatesByTenant(c, ["a", "b"]);
  assert.deepEqual(c.log, [["context", "a"], ["read", "a"], ["context", "b"], ["read", "b"]]);
  assert.deepEqual(r.products.map((p) => p.id), ["pa", "pb"]);
  assert.deepEqual(r.tenants.map((t) => [t.tenantKey, t.status, t.candidateCount]), [["a", "ok", 1], ["b", "ok", 1]]);
});

test("a tenant whose read fails is recorded as failed and the others continue", async () => {
  const c = fakeClient({ failTenant: "b", productsByTenant: { a: [{ id: "pa", tenantKey: "a" }], c: [{ id: "pc", tenantKey: "c" }] } });
  const r = await bf.loadCandidatesByTenant(c, ["a", "b", "c"]);
  assert.deepEqual(r.products.map((p) => p.id), ["pa", "pc"]);
  assert.deepEqual(r.tenants.map((t) => t.status), ["ok", "failed", "ok"]);
  assert.match(r.tenants[1].error, /boom b/);
});

test("the cap is enforced across the whole run and fails closed, not per tenant only", async () => {
  const many = (tenant, n) => Array.from({ length: n }, (_, i) => ({ id: `${tenant}${i}`, tenantKey: tenant }));
  const half = Math.floor(bf.ROW_FETCH_CAP / 2) + 1;
  const c = fakeClient({ productsByTenant: { a: many("a", half), b: many("b", half) } });
  await assert.rejects(() => bf.loadCandidatesByTenant(c, ["a", "b"]), /ROW_FETCH_CAP/);
});

test("backfillProduct in ops mode sets the product's tenant context inside the write transaction, before the recheck and the create", async () => {
  const c = fakeClient();
  const r = await bf.backfillProduct(c, { id: "p1", tenantKey: "tenant-b", status: "approved", attributes: {} }, { dryRun: false, setTenantContext: true });
  assert.equal(r.outcome, "created");
  assert.deepEqual(c.log, [["context", "tenant-b"], ["recheck", "tenant-b"], ["create", "tenant-b", "tenant-b"]]);
});

test("backfillProduct without ops mode does not touch the tenant context (the original behaviour)", async () => {
  const c = fakeClient();
  await bf.backfillProduct(c, { id: "p1", tenantKey: "tenant-b", status: "approved", attributes: {} }, { dryRun: false });
  assert.deepEqual(c.log.map((e) => e[0]), ["recheck", "create"]);
});

test("a product that gained a variant is skipped, not duplicated, in ops mode too", async () => {
  const c = fakeClient({ existingVariant: true });
  const r = await bf.backfillProduct(c, { id: "p1", tenantKey: "t", status: "approved", attributes: {} }, { dryRun: false, setTenantContext: true });
  assert.equal(r.outcome, "skipped_already_has_variant");
  assert.ok(!c.log.some((e) => e[0] === "create"));
});

test("a dry run opens no transaction", async () => {
  const c = fakeClient();
  const r = await bf.backfillProduct(c, { id: "p1", tenantKey: "t", status: "approved", attributes: {} }, { dryRun: true, setTenantContext: true });
  assert.equal(r.outcome, "would_create");
  assert.deepEqual(c.log, []);
});

test("main: the identity is checked before tenants are listed or anything is read; the original single pass is the non-opt-in path", () => {
  const src = fs.readFileSync(path.join(__dirname, "sellable-sku-variantless-backfill.cjs"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const identity = main.indexOf('assertOperatorIdentity(prisma, "vexa_ops", { requireBypassRls: false })');
  const listing = main.indexOf("listTenantKeys(prisma)");
  const singlePass = main.indexOf("loadCandidatesSinglePass(prisma)");
  assert.ok(identity > 0 && listing > identity, "the identity check must come before the tenant listing");
  assert.ok(singlePass > listing, "the single pass is the else branch of tenant mode");
  assert.match(main, /if \(tenantMode\) \{/);
  assert.match(main, /setTenantContext: tenantMode/);
  assert.match(main, /resolveOperatorDatabaseUrl\(process\.env, "OPS_DATABASE_URL"\)/);
});

test("both report scripts check the reporter identity before their first read, only when opted in", () => {
  for (const file of ["sellable-sku-variantless-audit-report.cjs", "media-integrity-readonly-report.cjs"]) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(src, /resolveOperatorDatabaseUrl\(process\.env, "REPORTER_DATABASE_URL"\)/, file);
    const check = src.indexOf('assertOperatorIdentity(prisma, "vexa_reporter", { requireBypassRls: true })');
    const firstRead = src.indexOf("await load", check);
    assert.ok(check > 0, `${file}: identity check present`);
    assert.ok(firstRead > check, `${file}: first read comes after the identity check`);
    assert.match(src.slice(check - 40, check), /if \(resolvedDb\.optIn\)/, `${file}: only when opted in`);
  }
});
