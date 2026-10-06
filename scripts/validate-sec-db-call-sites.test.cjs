#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateCallSites } = require("./validate-sec-db-call-sites.cjs");

const clean = validateCallSites();
assert.equal(clean.ok, true, clean.errors.join("\n"));

const expectFail = (name, transform, extra, label) => {
  const result = validateCallSites(transform, extra);
  assert.equal(result.ok, false, `not detected: ${name}`);
  assert.ok(result.errors.some((e) => e.startsWith(label)), `"${name}" reported, but not under ${label}:\n${result.errors.join("\n")}`);
};

// a new privileged consumer
expectFail("new PrismaDirectService consumer", null, { "newthing/new.service.ts": "import { PrismaDirectService } from '../prisma/prisma-direct.service';" }, "directClient.new");
// the inventory lists a file that no longer uses it
expectFail("stale open entry", (inv) => {
  inv.directClientFiles.push({ ...inv.directClientFiles[0], file: "gone/gone.service.ts" });
  inv.totals.directClientFiles = inv.directClientFiles.length;
}, null, "directClient.stale");
// a migrated entry that still uses it
expectFail("regressed migrated entry", (inv) => {
  inv.directClientFiles[0].status = "migrated";
}, null, "directClient.regressed");
// raw SQL growth and a brand new raw SQL file
const firstRaw = Object.keys(require("../docs/qa/sec-db-rls-001-call-sites.v1.json").rawSqlSitesByFile)[0];
expectFail("raw SQL grew", (inv) => {
  inv.rawSqlSitesByFile[firstRaw] -= 1;
}, null, "rawSql.grew");
expectFail("new raw SQL file", null, { "x/new-raw.service.ts": "await prisma.$queryRaw`SELECT 1`;" }, "rawSql.new");
// tenant() with no argument running raw SQL in a new place
expectFail("new tenant() no-arg raw scan", null, { "x/scan.service.ts": "await this.prisma.tenant().$queryRaw`SELECT 1`;" }, "noArgTenant.new");
expectFail("no-arg raw scan grew", (inv) => {
  const e = inv.crossTenantRawSqlFiles.find((x) => x.noArgTenantRawSites > 0);
  e.noArgTenantRawSites -= 1;
}, null, "noArgTenant.grew");
// a new database identity
expectFail("new PrismaClient", null, { "x/own-client.ts": "const c = new PrismaClient({});" }, "prismaClient.new");
// inventory discipline: every entry needs a class, remediation, plan, and a positive-result assertion
expectFail("missing positive assertion", (inv) => {
  inv.directClientFiles[0].positiveAssertion = "";
}, null, "entry");
expectFail("bad class", (inv) => {
  inv.directClientFiles[0].class = "Z";
}, null, "entry");
expectFail("bad remediation", (inv) => {
  inv.directClientFiles[0].remediation = "grant-bypassrls";
}, null, "entry");
expectFail("totals drift", (inv) => {
  inv.totals.directClientFiles += 1;
}, null, "totals");

// a spec file is never a consumer
const spec = validateCallSites(null, {});
assert.equal(spec.ok, true);

console.log("validate-sec-db-call-sites tests passed.");
