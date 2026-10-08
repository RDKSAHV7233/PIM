#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib.cjs");

const dir = path.resolve(__dirname, "..", "..", "packages", "db", "identity");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "identity-model.v1.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(dir, "production-ownership-split.v1.json"), "utf8"));

const MIGRATOR = lib.ROLES.migrator.name;
const tables = [...Object.keys(manifest.runtime.tables), ...manifest.runtime.excluded].sort();

/** A state that satisfies the model exactly; each negative test mutates a clone of it. */
function goodState() {
  const roles = Object.values(lib.ROLES).map((r) => ({
    rolname: r.name,
    rolsuper: false,
    rolbypassrls: r.bypassrls,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolcanlogin: true,
  }));
  const objects = [
    ...tables.map((name) => ({ kind: "table", name, owner: MIGRATOR })),
    { kind: "type", name: "AiExecutionStatus", owner: MIGRATOR },
    { kind: "function", name: "connector_tenant_entitlements_guard", args: "", owner: MIGRATOR },
  ];
  const effective = {};
  for (const key of ["runtime", "ops", "backup", "reporter"]) {
    const name = lib.ROLES[key].name;
    effective[name] = {};
    for (const t of tables) {
      const want = key === "runtime" && manifest.runtime.excluded.includes(t) ? [] : lib.expectedPrivileges(manifest, key, t);
      if (want.length > 0) {
        effective[name][t] = [...want];
      }
    }
  }
  effective[MIGRATOR] = {};
  return {
    roles,
    objects,
    tables: [...tables],
    effective,
    publicTableGrants: 0,
    memberships: [],
    schemaCreate: { [MIGRATOR]: true, vexa_runtime: false, vexa_backup: false, vexa_reporter: false, vexa_ops: false },
  };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const failures = (state, m = manifest) => lib.evaluateModel(state, m).filter((f) => !f.ok).map((f) => f.check);

// ---- the manifest and the production fixture are internally consistent --------------------------------------------------------
assert.equal(manifest.runtime.tables._prisma_migrations, undefined, "the migrations table is never granted to the runtime");
assert.ok(manifest.runtime.excluded.includes("_prisma_migrations"));
assert.equal(Object.keys(manifest.runtime.tables).length, fixture.expectedTotals.tables, "manifest covers exactly the production table count");
assert.equal(manifest.runtime.tables.ai_platform_controls, "select", "the runtime may only read the kill switch row");
assert.equal(manifest.runtime.tables.ai_platform_budget_periods, "select-update");
assert.equal(manifest.runtime.tables.connector_definitions, "select", "8.1a: the connector catalogue is reference data the API never writes");
assert.equal(manifest.runtime.tables.connector_tenant_entitlements, "select", "8.1a: the entitlement ledger is append-only and written by operators, never by the API");
assert.equal(manifest.runtime.tables.tax_regimes, "select", "8.1b: the tax regimes are a system registry the runtime only reads; the deploy seed writes as the migrator");
assert.ok(manifest.runtime.exceptionsToCrud.connector_definitions && manifest.runtime.exceptionsToCrud.connector_tenant_entitlements && manifest.runtime.exceptionsToCrud.tax_regimes, "each narrowed table carries its reason");
assert.deepEqual(Object.keys(manifest.ops.tables).sort(), ["Product", "Variant", "WorkspaceDirectory", "ai_platform_budget_periods", "ai_platform_controls"], "ops is confined to the platform control tables, the two tables the sellable-SKU backfill uses, and the tenant directory it lists tenants from");
assert.equal(manifest.ops.tables.WorkspaceDirectory, "select", "the backfill only reads the tenant directory");
assert.equal(manifest.ops.tables.Product, "select", "the backfill reads products");
assert.equal(manifest.ops.tables.Variant, "select-insert", "the backfill reads and creates variants, and nothing more");
assert.deepEqual(Object.keys(manifest.reporter.tables).sort(), ["Product", "Variant", "connector_submissions", "media_assets"], "the reporter reads exactly the tables the two reports read");
assert.ok(Object.values(manifest.reporter.tables).every((level) => level === "select"), "the reporter never writes");
assert.equal(manifest.backup.tables, "select-all");
assert.match(manifest.noCrossTenantMaintenanceRole, /Deliberately not provisioned/);
assert.doesNotMatch(manifest.noCrossTenantMaintenanceRole, /or a SELECT-only maintenance policy/, "the maintenance-policy path is retired (D-022)");
assert.match(manifest.noCrossTenantMaintenanceRole, /no policy may open on a session setting/);
assert.equal(fixture.tables.length, fixture.expectedTotals.tablesOwnedByCurrentOwner);
assert.equal(fixture.functions.length, fixture.expectedTotals.functionsOwnedByCurrentOwner);
assert.equal(fixture.enumTypes.length, fixture.expectedTotals.enumTypesOwnedByCurrentOwner);
for (const t of fixture.tables) {
  assert.ok(tables.includes(t), `fixture table ${t} is in the manifest`);
}

// ---- the role definitions --------------------------------------------------------------------------------------------------
for (const r of Object.values(lib.ROLES)) {
  assert.equal(r.superuser, false, `${r.name} is never a superuser`);
  assert.equal(r.createrole, false);
  assert.equal(r.createdb, false);
}
assert.deepEqual(Object.values(lib.ROLES).filter((r) => r.bypassrls).map((r) => r.name).sort(), ["vexa_backup", "vexa_migrator", "vexa_reporter"], "only the deploy-time migrator, the backup role and the read-only reporter bypass RLS; the runtime and ops never do");
assert.equal(Object.keys(lib.ROLES).length, 5, "no sixth, cross-tenant maintenance, role is defined");
assert.deepEqual(Object.values(lib.ROLES).map((r) => r.name).sort(), ["vexa_backup", "vexa_migrator", "vexa_ops", "vexa_reporter", "vexa_runtime"]);

// ---- expected privileges -----------------------------------------------------------------------------------------------------
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "Product"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "ai_platform_controls"), ["SELECT"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "ai_platform_budget_periods"), ["SELECT", "UPDATE"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "connector_definitions"), ["SELECT"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "connector_tenant_entitlements"), ["SELECT"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "runtime", "tax_regimes"), ["SELECT"]);
assert.equal(lib.expectedPrivileges(manifest, "runtime", "a_table_nobody_listed"), null, "an unlisted table is unknown, not granted");
assert.deepEqual(lib.expectedPrivileges(manifest, "ops", "Product"), ["SELECT"], "the backfill reads products and cannot change them");
assert.deepEqual(lib.expectedPrivileges(manifest, "ops", "Variant"), ["INSERT", "SELECT"], "the backfill creates variants and cannot update or delete them");
assert.deepEqual(lib.expectedPrivileges(manifest, "ops", "ai_executions"), [], "ops holds nothing on ordinary tables");
assert.deepEqual(lib.expectedPrivileges(manifest, "ops", "WorkspaceDirectory"), ["SELECT"], "the backfill lists tenants from the directory and cannot change it");
assert.deepEqual(lib.expectedPrivileges(manifest, "reporter", "Product"), ["SELECT"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "reporter", "media_assets"), ["SELECT"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "reporter", "ai_executions"), [], "the reporter holds nothing beyond its report tables");
assert.deepEqual(lib.expectedPrivileges(manifest, "reporter", "ai_platform_controls"), [], "the reporter cannot read the kill switch");
assert.deepEqual(lib.expectedPrivileges(manifest, "ops", "ai_platform_controls"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
assert.deepEqual(lib.expectedPrivileges(manifest, "backup", "Product"), ["SELECT"]);

// ---- ownership plan ----------------------------------------------------------------------------------------------------------
const objs = [
  { kind: "function", name: "f1", args: "", owner: "vexa_app_v2" },
  { kind: "type", name: "T1", owner: "vexa_app_v2" },
  { kind: "table", name: "zeta", owner: "vexa_app_v2" },
  { kind: "table", name: "alpha", owner: "vexa_app_v2" },
  { kind: "table", name: "already", owner: MIGRATOR },
  { kind: "table", name: "by_postgres", owner: "postgres" },
];
const plan = lib.buildOwnershipPlan(objs, MIGRATOR);
assert.deepEqual(plan, [
  'ALTER TABLE public."alpha" OWNER TO "vexa_migrator"',
  'ALTER TABLE public."by_postgres" OWNER TO "vexa_migrator"',
  'ALTER TABLE public."zeta" OWNER TO "vexa_migrator"',
  'ALTER TYPE public."T1" OWNER TO "vexa_migrator"',
  'ALTER FUNCTION public."f1"() OWNER TO "vexa_migrator"',
], "deterministic order, tables then types then functions, objects already owned are skipped");
assert.deepEqual(lib.buildOwnershipPlan(objs.map((o) => ({ ...o, owner: MIGRATOR })), MIGRATOR), [], "a second run is a no-op (idempotent)");
assert.ok(lib.buildOwnershipPlan([{ kind: "table", name: 'we"ird', owner: "x" }], MIGRATOR)[0].includes('"we""ird"'), "identifiers are quoted");
assert.ok(lib.buildOwnershipPlan([{ kind: "function", name: "g", args: "uuid, text", owner: "x" }], MIGRATOR)[0].includes("(uuid, text)"), "function identity arguments are kept");

// ---- rollback plan -----------------------------------------------------------------------------------------------------------
const before = objs;
const after = objs.map((o) => ({ ...o, owner: MIGRATOR }));
const rollback = lib.buildRollbackPlan(before, after);
assert.equal(rollback.length, 5, "one statement per object whose owner changed");
assert.ok(rollback.includes('ALTER TABLE public."by_postgres" OWNER TO "postgres"'), "restores each object to its own recorded owner, not to one owner");
assert.ok(rollback.includes('ALTER TABLE public."alpha" OWNER TO "vexa_app_v2"'));
assert.ok(!rollback.some((s) => s.includes('"already"')), "an object that never changed is not touched");
assert.deepEqual(lib.buildRollbackPlan(before, before), [], "nothing to roll back when nothing changed");
assert.equal(lib.sameOwnership(before, before.map((o) => ({ ...o }))), true);
assert.equal(lib.sameOwnership(before, after), false);
assert.equal(lib.sameOwnership(before, before.slice(1)), false, "a missing object is a difference");
assert.deepEqual(lib.ownerSummary(objs), { function: { vexa_app_v2: 1 }, type: { vexa_app_v2: 1 }, table: { vexa_app_v2: 2, vexa_migrator: 1, postgres: 1 } });

// ---- the model evaluation: a good state passes every check, and each mutation is caught ---------------------------------------
{
  const good = lib.evaluateModel(goodState(), manifest);
  assert.ok(good.length > 20, "the evaluation is not trivially small");
  assert.deepEqual(good.filter((f) => !f.ok), [], "a state that follows the model passes every check");
}

const mutate = (name, fn, mustInclude) => {
  const s = clone(goodState());
  fn(s);
  const failed = failures(s);
  assert.ok(failed.length > 0, `not detected: ${name}`);
  assert.ok(failed.some((c) => c.includes(mustInclude)), `"${name}" detected, but not by a check containing "${mustInclude}":\n${failed.join("\n")}`);
};
const role = (s, name) => s.roles.find((r) => r.rolname === name);

mutate("runtime is a superuser", (s) => { role(s, "vexa_runtime").rolsuper = true; }, "vexa_runtime is not a superuser");
mutate("runtime bypasses RLS", (s) => { role(s, "vexa_runtime").rolbypassrls = true; }, "vexa_runtime BYPASSRLS is false");
mutate("migrator loses BYPASSRLS (data migrations would touch one tenant)", (s) => { role(s, "vexa_migrator").rolbypassrls = false; }, "vexa_migrator BYPASSRLS is true");
mutate("backup loses BYPASSRLS (pg_dump would silently dump nothing)", (s) => { role(s, "vexa_backup").rolbypassrls = false; }, "vexa_backup BYPASSRLS is true");
mutate("migrator may create roles", (s) => { role(s, "vexa_migrator").rolcreaterole = true; }, "cannot create roles");
mutate("ops may replicate", (s) => { role(s, "vexa_ops").rolreplication = true; }, "cannot create roles");
mutate("runtime cannot log in", (s) => { role(s, "vexa_runtime").rolcanlogin = false; }, "can log in");
mutate("a role is missing", (s) => { s.roles = s.roles.filter((r) => r.rolname !== "vexa_ops"); }, "vexa_ops exists");
mutate("a table is still owned by the old role", (s) => { s.objects.find((o) => o.name === "ai_executions").owner = "vexa_app_v2"; }, "owned by the migrator");
mutate("an enum type is still owned by the old role", (s) => { s.objects.find((o) => o.kind === "type").owner = "vexa_app_v2"; }, "owned by the migrator");
mutate("a function is still owned by the old role", (s) => { s.objects.find((o) => o.kind === "function").owner = "postgres"; }, "owned by the migrator");
mutate("runtime owns a table", (s) => { s.objects.find((o) => o.kind === "table").owner = "vexa_runtime"; }, "vexa_runtime owns nothing");
mutate("backup owns a table", (s) => { s.objects.find((o) => o.kind === "table").owner = "vexa_backup"; }, "vexa_backup owns nothing");
mutate("a new table is added and not classified", (s) => { s.tables.push("brand_new_table"); s.objects.push({ kind: "table", name: "brand_new_table", owner: MIGRATOR }); }, "classified in the runtime grants manifest");
mutate("the manifest lists a table that was dropped", (s) => { s.tables = s.tables.filter((t) => t !== "ai_executions"); s.objects = s.objects.filter((o) => o.name !== "ai_executions"); }, "lists no table that does not exist");
mutate("runtime can write the kill switch row", (s) => { s.effective.vexa_runtime.ai_platform_controls = ["SELECT", "UPDATE"]; }, "vexa_runtime holds exactly");
mutate("runtime can read the migrations table", (s) => { s.effective.vexa_runtime._prisma_migrations = ["SELECT"]; }, "vexa_runtime holds exactly");
mutate("runtime can TRUNCATE", (s) => { s.effective.vexa_runtime.ai_executions = ["DELETE", "INSERT", "SELECT", "TRUNCATE", "UPDATE"]; }, "vexa_runtime holds exactly");
mutate("runtime loses access to a normal table", (s) => { delete s.effective.vexa_runtime.ai_executions; }, "vexa_runtime holds exactly");
mutate("ops reaches an ordinary table", (s) => { s.effective.vexa_ops.ai_executions = ["SELECT"]; }, "vexa_ops holds exactly");
mutate("backup can write", (s) => { s.effective.vexa_backup.ai_executions = ["INSERT", "SELECT"]; }, "vexa_backup holds exactly");
mutate("the reporter loses BYPASSRLS (a report would silently cover one tenant)", (s) => { role(s, "vexa_reporter").rolbypassrls = false; }, "vexa_reporter BYPASSRLS is true");
mutate("the reporter is a superuser", (s) => { role(s, "vexa_reporter").rolsuper = true; }, "vexa_reporter is not a superuser");
mutate("the reporter is missing", (s) => { s.roles = s.roles.filter((r) => r.rolname !== "vexa_reporter"); }, "vexa_reporter exists");
mutate("the reporter can write a report table", (s) => { s.effective.vexa_reporter.Product = ["INSERT", "SELECT"]; }, "vexa_reporter holds exactly");
mutate("the reporter reaches an ordinary table", (s) => { s.effective.vexa_reporter.ai_executions = ["SELECT"]; }, "vexa_reporter holds exactly");
mutate("the reporter reads the kill switch", (s) => { s.effective.vexa_reporter.ai_platform_controls = ["SELECT"]; }, "vexa_reporter holds exactly");
mutate("the reporter loses a report table", (s) => { delete s.effective.vexa_reporter.media_assets; }, "vexa_reporter holds exactly");
mutate("the reporter owns a table", (s) => { s.objects.find((o) => o.kind === "table").owner = "vexa_reporter"; }, "vexa_reporter owns nothing");
mutate("the reporter can create objects in public", (s) => { s.schemaCreate.vexa_reporter = true; }, "only the migrator can create");
mutate("the reporter is a member of the migrator", (s) => { s.memberships.push({ role: "vexa_migrator", member: "vexa_reporter" }); }, "member of another role");
mutate("ops can update products (the backfill would be a general writer)", (s) => { s.effective.vexa_ops.Product = ["SELECT", "UPDATE"]; }, "vexa_ops holds exactly");
mutate("ops can delete variants", (s) => { s.effective.vexa_ops.Variant = ["DELETE", "INSERT", "SELECT"]; }, "vexa_ops holds exactly");
mutate("ops loses the variant insert the backfill needs", (s) => { s.effective.vexa_ops.Variant = ["SELECT"]; }, "vexa_ops holds exactly");
mutate("ops bypasses RLS (the backfill would reach every tenant at once)", (s) => { role(s, "vexa_ops").rolbypassrls = true; }, "vexa_ops BYPASSRLS is false");
mutate("a privilege is granted to PUBLIC", (s) => { s.publicTableGrants = 3; }, "PUBLIC");
mutate("runtime inherits the old owner role", (s) => { s.memberships.push({ role: "vexa_app_v2", member: "vexa_runtime" }); }, "member of another role");
mutate("runtime can create objects in public", (s) => { s.schemaCreate.vexa_runtime = true; }, "only the migrator can create");
mutate("migrator cannot create objects in public", (s) => { s.schemaCreate.vexa_migrator = false; }, "only the migrator can create");

// A manifest that lists a table the schema does not have, or lets the reporter write, is caught by the evaluation too.
{
  const staleOps = clone(manifest);
  staleOps.ops.tables.table_that_was_dropped = "select";
  assert.ok(failures(goodState(), staleOps).some((c) => c.includes("ops and reporter grants list no table that does not exist")), "a stale ops entry is detected");
  const staleReporter = clone(manifest);
  staleReporter.reporter.tables.table_that_was_dropped = "select";
  assert.ok(failures(goodState(), staleReporter).some((c) => c.includes("ops and reporter grants list no table that does not exist")), "a stale reporter entry is detected");
  const writingReporter = clone(manifest);
  writingReporter.reporter.tables.Product = "crud";
  assert.ok(failures(goodState(), writingReporter).some((c) => c.includes("the reporter is read-only in the manifest")), "a reporter that may write is detected");
}

// A membership held by a role that is not one of the five identities is not this model's concern.
{
  const s = clone(goodState());
  s.memberships.push({ role: "postgres", member: "some_other_role" });
  assert.deepEqual(failures(s), []);
}

console.log("db-identity lib tests passed.");
