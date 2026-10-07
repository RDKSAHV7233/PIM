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
// a migrated raw-SQL file regresses to tenant() with no argument (the extra source replaces the file's text in the scan)
expectFail("migrated raw-SQL file regresses", null, { "catalog/catalog.service.ts": "await this.prisma.tenant().$queryRaw`SELECT 1`;" }, "noArgTenant.regressed");
// an open raw-SQL entry whose no-argument sites are gone must be marked migrated
expectFail("stale open raw-SQL entry", (inv) => {
  const entry = inv.crossTenantRawSqlFiles.find((x) => x.file === "catalog/catalog.service.ts");
  entry.status = "open";
  entry.noArgTenantRawSites = 1; // recorded as still having one no-argument site, but the code has none
}, null, "noArgTenant.stale");
// the I-5a files are recorded as migrated with zero no-argument sites
for (const file of ["bulk-import/bulk-import.service.ts", "catalog/catalog.service.ts", "connector-installer/connector-permission.service.ts"]) {
  const entry = require("../docs/qa/sec-db-rls-001-call-sites.v1.json").crossTenantRawSqlFiles.find((x) => x.file === file);
  assert.ok(entry && entry.status === "migrated" && entry.noArgTenantRawSites === 0, `${file} must be recorded as migrated with 0 no-argument raw sites`);
}

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
