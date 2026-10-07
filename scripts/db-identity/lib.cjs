"use strict";

/**
 * SEC-DB-RLS-001 I1: pure logic of the database identity foundation. No I/O, so every rule can be unit tested.
 *
 * Target model (nothing here is applied to production by I1):
 *   vexa_migrator  owns every object in the public schema, runs migrations; NOSUPERUSER, BYPASSRLS (see below), deploy-time only
 *   vexa_runtime   the API: table-level CRUD from an explicit manifest; owns nothing; no DDL; NOSUPERUSER, NOBYPASSRLS
 *   vexa_backup    read-only; BYPASSRLS is its only extra attribute, justified solely because pg_dump must read forced-RLS tables
 *   vexa_reporter  read-only operator reports across tenants (the sellable-SKU audit, the media-integrity report); NOSUPERUSER, BYPASSRLS
 *                  only because a report spans tenants; owns nothing, no DDL, no writes; its credential is never reachable by the API
 *   vexa_ops       operator path: the platform control tables, and the sellable-SKU backfill with explicit tenant iteration
 *                  (NOSUPERUSER, NOBYPASSRLS: it sets the tenant context itself for each tenant)
 * Why the migrator has BYPASSRLS: tables are FORCE ROW LEVEL SECURITY, so even their owner sees only the 'default' tenant unless
 * app.tenant_key is set. Data-fixing migrations already exist (for example 20260816000001_delete_orphaned_media_assets deletes from a
 * forced-RLS table); without BYPASSRLS they would silently touch only one tenant. It costs no isolation: an owner can DROP POLICY or
 * ALTER TABLE ... DISABLE ROW LEVEL SECURITY anyway, so NOBYPASSRLS on the owner is cosmetic. The runtime path never holds this credential.
 * There is deliberately NO cross-tenant maintenance role, and no policy may open on a session setting the ordinary runtime can set: the
 * cross-tenant jobs inside the API use tenant iteration (docs/qa/sec-db-rls-001-call-site-classification-2026-10-06.md section 3).
 */

const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

const ROLES = {
  migrator: { name: "vexa_migrator", login: true, bypassrls: true, createrole: false, createdb: false, superuser: false },
  runtime: { name: "vexa_runtime", login: true, bypassrls: false, createrole: false, createdb: false, superuser: false },
  backup: { name: "vexa_backup", login: true, bypassrls: true, createrole: false, createdb: false, superuser: false },
  reporter: { name: "vexa_reporter", login: true, bypassrls: true, createrole: false, createdb: false, superuser: false },
  ops: { name: "vexa_ops", login: true, bypassrls: false, createrole: false, createdb: false, superuser: false },
};

const GRANT_LEVELS = {
  crud: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  select: ["SELECT"],
  "select-update": ["SELECT", "UPDATE"],
  "select-insert": ["SELECT", "INSERT"],
  none: [],
};

/** The privileges the model expects a role to hold on a table, as a sorted array. */
function expectedPrivileges(manifest, role, table) {
  if (role === "runtime") {
    const level = manifest.runtime.tables[table];
    return level === undefined ? null : [...GRANT_LEVELS[level]].sort();
  }
  if (role === "ops") {
    const level = manifest.ops.tables[table] || "none";
    return [...GRANT_LEVELS[level]].sort();
  }
  if (role === "reporter") {
    const level = (manifest.reporter && manifest.reporter.tables[table]) || "none";
    return [...GRANT_LEVELS[level]].sort();
  }
  if (role === "backup") {
    return manifest.backup.tables === "select-all" ? ["SELECT"] : [];
  }
  return null;
}

/**
 * Ownership plan: one statement per object whose owner is not the target. Order is deterministic (tables, types, functions, by name)
 * so a plan can be reviewed and compared. `objects` come from a snapshot: [{ kind: 'table'|'type'|'function', name, args?, owner }].
 */
function buildOwnershipPlan(objects, targetOwner) {
  const order = { table: 0, type: 1, function: 2 };
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return objects
    .filter((o) => o.owner !== targetOwner)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
    .map((o) => {
      const target = quote(targetOwner);
      if (o.kind === "table") {
        return `ALTER TABLE public.${quote(o.name)} OWNER TO ${target}`;
      }
      if (o.kind === "type") {
        return `ALTER TYPE public.${quote(o.name)} OWNER TO ${target}`;
      }
      return `ALTER FUNCTION public.${quote(o.name)}(${o.args || ""}) OWNER TO ${target}`;
    });
}

/** The inverse plan: restore every object to the owner recorded in the before-snapshot. */
function buildRollbackPlan(beforeObjects, currentObjects) {
  const current = new Map(currentObjects.map((o) => [`${o.kind}:${o.name}:${o.args || ""}`, o.owner]));
  const changed = beforeObjects.filter((o) => current.has(`${o.kind}:${o.name}:${o.args || ""}`) && current.get(`${o.kind}:${o.name}:${o.args || ""}`) !== o.owner);
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const order = { table: 0, type: 1, function: 2 };
  return changed
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
    .map((o) =>
      o.kind === "table"
        ? `ALTER TABLE public.${quote(o.name)} OWNER TO ${quote(o.owner)}`
        : o.kind === "type"
          ? `ALTER TYPE public.${quote(o.name)} OWNER TO ${quote(o.owner)}`
          : `ALTER FUNCTION public.${quote(o.name)}(${o.args || ""}) OWNER TO ${quote(o.owner)}`,
    );
}

function ownerSummary(objects) {
  const out = {};
  for (const o of objects) {
    out[o.kind] = out[o.kind] || {};
    out[o.kind][o.owner] = (out[o.kind][o.owner] || 0) + 1;
  }
  return out;
}

function sameOwnership(a, b) {
  const key = (o) => `${o.kind}:${o.name}:${o.args || ""}=${o.owner}`;
  const A = a.map(key).sort();
  const B = b.map(key).sort();
  return A.length === B.length && A.every((v, i) => v === B[i]);
}

/**
 * Evaluates a database state against the target model. `state`:
 *   roles: [{ rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin }]
 *   objects: [{ kind, name, args?, owner }]           every public table, enum type and function
 *   tables: [name]                                      every public table
 *   effective: { role: { table: [privileges] } }       effective table privileges (has_table_privilege)
 *   publicTableGrants: number                           table privileges granted to PUBLIC
 *   memberships: [{ role, member }]                     for the four identities
 *   schemaCreate: { role: boolean }                     CREATE on schema public
 * Returns [{ check, ok, detail? }].
 */
function evaluateModel(state, manifest) {
  const findings = [];
  const add = (check, ok, detail) => findings.push({ check, ok, ...(detail === undefined ? {} : { detail }) });
  const byName = new Map(state.roles.map((r) => [r.rolname, r]));

  for (const [key, want] of Object.entries(ROLES)) {
    const r = byName.get(want.name);
    if (!r) {
      add(`role ${want.name} exists`, false);
      continue;
    }
    add(`role ${want.name} exists`, true);
    add(`role ${want.name} is not a superuser`, r.rolsuper === false);
    add(`role ${want.name} BYPASSRLS is ${want.bypassrls}`, r.rolbypassrls === want.bypassrls);
    add(`role ${want.name} cannot create roles or databases or replicate`, !r.rolcreaterole && !r.rolcreatedb && !r.rolreplication);
    add(`role ${want.name} can log in`, r.rolcanlogin === true);
    void key;
  }

  const migrator = ROLES.migrator.name;
  const notMigrator = state.objects.filter((o) => o.owner !== migrator);
  add("every table, enum type and function in public is owned by the migrator", notMigrator.length === 0, notMigrator.length ? { count: notMigrator.length, sample: notMigrator.slice(0, 5).map((o) => `${o.kind}:${o.name}=${o.owner}`) } : undefined);
  for (const key of ["runtime", "backup", "reporter", "ops"]) {
    const name = ROLES[key].name;
    add(`${name} owns nothing`, state.objects.every((o) => o.owner !== name));
  }

  const manifestTables = new Set([...Object.keys(manifest.runtime.tables), ...(manifest.runtime.excluded || [])]);
  const schemaTables = new Set(state.tables);
  const unlisted = [...schemaTables].filter((t) => !manifestTables.has(t));
  const stale = [...manifestTables].filter((t) => !schemaTables.has(t));
  add("every table is classified in the runtime grants manifest (a new table fails closed until listed)", unlisted.length === 0, unlisted.length ? unlisted : undefined);
  add("the manifest lists no table that does not exist", stale.length === 0, stale.length ? stale : undefined);

  const classified = (grants) => Object.keys(grants || {});
  const staleOps = classified(manifest.ops && manifest.ops.tables).filter((t) => !schemaTables.has(t));
  const staleReporter = classified(manifest.reporter && manifest.reporter.tables).filter((t) => !schemaTables.has(t));
  add("the ops and reporter grants list no table that does not exist", staleOps.length + staleReporter.length === 0, staleOps.length + staleReporter.length ? [...staleOps, ...staleReporter] : undefined);
  const reporterWrites = Object.entries((manifest.reporter && manifest.reporter.tables) || {}).filter(([, level]) => level !== "select");
  add("the reporter is read-only in the manifest (SELECT only on every table it lists)", reporterWrites.length === 0, reporterWrites.length ? reporterWrites : undefined);

  for (const key of ["runtime", "ops", "backup", "reporter"]) {
    const name = ROLES[key].name;
    const wrong = [];
    for (const table of state.tables) {
      const want = key === "runtime" && (manifest.runtime.excluded || []).includes(table) ? [] : expectedPrivileges(manifest, key, table);
      if (want === null) {
        continue;
      }
      const got = [...((state.effective[name] || {})[table] || [])].sort();
      if (got.join(",") !== want.join(",")) {
        wrong.push(`${table}: has [${got}] expected [${want}]`);
      }
    }
    add(`${name} holds exactly the manifest privileges on every table`, wrong.length === 0, wrong.length ? wrong.slice(0, 6) : undefined);
  }

  add("no table privilege is granted to PUBLIC", state.publicTableGrants === 0, state.publicTableGrants ? { count: state.publicTableGrants } : undefined);
  const roleNames = Object.values(ROLES).map((r) => r.name);
  const memberships = state.memberships.filter((m) => roleNames.includes(m.member));
  add("none of the five identities is a member of another role", memberships.length === 0, memberships.length ? memberships : undefined);
  add("only the migrator can create objects in the public schema", state.schemaCreate[migrator] === true && ["runtime", "backup", "reporter", "ops"].every((k) => state.schemaCreate[ROLES[k].name] === false));
  return findings;
}

module.exports = { PRIVILEGES, ROLES, GRANT_LEVELS, expectedPrivileges, buildOwnershipPlan, buildRollbackPlan, ownerSummary, sameOwnership, evaluateModel };
