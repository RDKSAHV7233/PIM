"use strict";

// SEC-DB-RLS-001 7.9c: how an operator script (a report, the backfill) picks its database identity and proves it before it runs.
//
// Opt-in, like 7.9a (migrator) and 7.9b (backup): while the dedicated variable (REPORTER_DATABASE_URL, OPS_DATABASE_URL) is unset or
// blank, a script keeps using DATABASE_URL exactly as before. When it is set, the script uses it AND refuses to run unless the
// connection really is the expected role, so a wrong credential stops the run instead of producing an unchecked report or write:
//
//   vexa_reporter  read-only, BYPASSRLS (reports span tenants), not a superuser
//   vexa_ops       NOBYPASSRLS (it sets the tenant context itself), not a superuser
//
// The statement is exported so the rehearsal runs this very text against the real roles.

const IDENTITY_SQL =
  "SELECT current_user AS name, r.rolsuper AS super, r.rolbypassrls AS bypassrls FROM pg_roles r WHERE r.rolname = current_user";

function normalizeText(value) {
  return String(value ?? "").trim();
}

/**
 * Which URL the script connects with. A blank dedicated value (an unset secret mapped into a workflow) is NOT the opt-in.
 * Returns { url, optIn, source } where source names the variable, never its value.
 */
function resolveOperatorDatabaseUrl(env, dedicatedVar) {
  const dedicated = normalizeText(env[dedicatedVar]);
  if (dedicated) {
    return { url: dedicated, optIn: true, source: dedicatedVar };
  }
  return { url: normalizeText(env.DATABASE_URL), optIn: false, source: "DATABASE_URL" };
}

/** Pure verdict: { ok, reason? }. `row` is { name, super, bypassrls } or null when the role could not be read. */
function evaluateOperatorIdentity(row, expectedRole, { requireBypassRls }) {
  if (!row) {
    return { ok: false, reason: "could not read the connected role, so the identity cannot be verified" };
  }
  if (row.name !== expectedRole) {
    return { ok: false, reason: `connected as ${row.name}, expected ${expectedRole}` };
  }
  if (row.super) {
    return { ok: false, reason: `${row.name} is a superuser; this identity must not be` };
  }
  if (requireBypassRls && !row.bypassrls) {
    return { ok: false, reason: `${row.name} does not bypass row level security, so the report would cover only one tenant` };
  }
  if (!requireBypassRls && row.bypassrls) {
    return { ok: false, reason: `${row.name} bypasses row level security; this identity must set the tenant context itself` };
  }
  return { ok: true };
}

/** Reads the connected role through an open Prisma client, and throws when it is not the expected identity. */
async function assertOperatorIdentity(prisma, expectedRole, { requireBypassRls }) {
  const rows = await prisma.$queryRawUnsafe(IDENTITY_SQL);
  const first = Array.isArray(rows) ? rows[0] : null;
  const row = first ? { name: String(first.name), super: first.super === true, bypassrls: first.bypassrls === true } : null;
  const verdict = evaluateOperatorIdentity(row, expectedRole, { requireBypassRls });
  if (!verdict.ok) {
    throw new Error(`operator identity check failed: ${verdict.reason}`);
  }
  return row;
}

/** The Prisma client for the chosen URL. With the default (no opt-in) the client is built exactly as before. */
function createOperatorPrisma(PrismaClient, resolved) {
  return resolved.optIn ? new PrismaClient({ datasources: { db: { url: resolved.url } } }) : new PrismaClient();
}

module.exports = {
  IDENTITY_SQL,
  resolveOperatorDatabaseUrl,
  evaluateOperatorIdentity,
  assertOperatorIdentity,
  createOperatorPrisma,
};
