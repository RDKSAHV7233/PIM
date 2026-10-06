"use strict";

/**
 * Pure classification rules for scripts/ai-control-plane-proof.cjs. No I/O, so they can be tested without a database.
 *
 * Every finding is one of three classes:
 *   PROVEN      the connected role can directly establish the fact
 *   UNVERIFIED  forced row level security (or missing maintenance access) prevents a global assertion
 *   FAILED      a required deny control is absent, unreadable, malformed or permissive
 *
 * The rule that matters most: a count of zero that row level security may be hiding is NEVER proof that a table is empty.
 */

const PROVEN = "PROVEN";
const UNVERIFIED = "UNVERIFIED";
const FAILED = "FAILED";

/** Tables for which the migration adds an explicit SELECT-only maintenance policy (`app.ai_maintenance`). */
const MAINTENANCE_READABLE = new Set(["ai_provider_budget_policies", "ai_provider_budget_reservations", "ai_provider_budget_charges"]);

/**
 * Whether a count taken by the connected role is global.
 * - superuser or BYPASSRLS sees every row;
 * - a table without row level security shows every row to anyone with SELECT;
 * - a table with a maintenance policy is global when the count is taken inside the maintenance transaction;
 * - otherwise forced RLS may hide other tenants' rows.
 */
function visibilityOf({ isSuperuser, bypassRls, rlsEnabled, hasMaintenancePolicy, readThroughMaintenance }) {
  if (isSuperuser || bypassRls) {
    return "global";
  }
  if (rlsEnabled === false) {
    return "global";
  }
  if (hasMaintenancePolicy && readThroughMaintenance) {
    return "global";
  }
  return "hidden";
}

/** A count is PROVEN only when it is global. A hidden zero is UNVERIFIED, never a proof of emptiness. */
function classifyCount(count, visibility) {
  if (visibility !== "global") {
    return { status: UNVERIFIED, detail: { visibleCount: count, reason: "forced row level security may hide other tenants' rows" } };
  }
  return { status: PROVEN, detail: { count } };
}

/**
 * Overall verdict. FAILED when any required finding failed. Otherwise the system is demonstrated dormant; if anything
 * was UNVERIFIED the verdict says so and never claims more than was established.
 */
function verdictOf(findings) {
  if (!findings.some((x) => x.required)) {
    return { verdict: "INCONCLUSIVE", reason: "no required finding was recorded, so nothing was proven" };
  }
  const requiredFailed = findings.filter((f) => f.required && f.status === FAILED);
  if (requiredFailed.length > 0) {
    return { verdict: "FAILED", reason: `${requiredFailed.length} required deny control(s) failed`, requiredFailed: requiredFailed.map((f) => f.name) };
  }
  const requiredUnverified = findings.filter((f) => f.required && f.status === UNVERIFIED);
  if (requiredUnverified.length > 0) {
    return { verdict: "INCONCLUSIVE", reason: `${requiredUnverified.length} required fact(s) could not be established`, requiredUnverified: requiredUnverified.map((f) => f.name) };
  }
  const anyUnverified = findings.some((f) => f.status === UNVERIFIED);
  const anyFailed = findings.some((f) => f.status === FAILED);
  if (anyFailed) {
    return { verdict: "DORMANT_PROVEN_WITH_FINDINGS", reason: "every required deny control holds; non-required findings failed" };
  }
  return { verdict: anyUnverified ? "DORMANT_PROVEN_WITH_UNVERIFIED" : "DORMANT_PROVEN", reason: "every required deny control holds" };
}

/** Privileges the control plane needs on each table. A missing one fails the corresponding finding. */
const REQUIRED_GRANTS = [
  { table: "ai_platform_controls", privileges: ["SELECT"] },
  { table: "ai_platform_budget_periods", privileges: ["SELECT"] },
  { table: "ai_provider_budget_policies", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { table: "ai_provider_budget_reservations", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { table: "ai_provider_budget_charges", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { table: "ai_tenant_policies", privileges: ["SELECT"] },
];

/** Evaluates the has_table_privilege rows (one object per table, with sel/ins/upd/del booleans) against REQUIRED_GRANTS. */
function evaluateGrants(rowsByTable) {
  const map = { SELECT: "sel", INSERT: "ins", UPDATE: "upd", DELETE: "del" };
  return REQUIRED_GRANTS.map(({ table, privileges }) => {
    const row = rowsByTable[table];
    const missing = !row ? privileges : privileges.filter((p) => row[map[p]] !== true);
    return { table, privileges, missing, ok: missing.length === 0 };
  });
}

/** The platform control row must be disabled and killed. Anything else, including an unreadable or malformed row, fails. */
function evaluateControlRow(row) {
  if (!row) {
    return { enabled: FAILED, killSwitch: FAILED, reason: "row missing or unreadable" };
  }
  if (typeof row.enabled !== "boolean" || typeof row.killSwitch !== "boolean") {
    return { enabled: FAILED, killSwitch: FAILED, reason: "malformed row" };
  }
  return { enabled: row.enabled === false ? PROVEN : FAILED, killSwitch: row.killSwitch === true ? PROVEN : FAILED };
}

module.exports = { PROVEN, UNVERIFIED, FAILED, MAINTENANCE_READABLE, visibilityOf, classifyCount, verdictOf, REQUIRED_GRANTS, evaluateGrants, evaluateControlRow };
