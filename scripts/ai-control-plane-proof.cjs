#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * AI-PROV-004b control-plane production proofs. No provider, no network call, no credential, no admin bypass.
 *
 *   node scripts/ai-control-plane-proof.cjs probe             read-only: role identity, grants, RLS facts, control readability
 *   node scripts/ai-control-plane-proof.cjs dormant           read-only: the probe plus the dormant-state proof
 *   node scripts/ai-control-plane-proof.cjs drill             dry run: the dormant proof and the plan
 *   node scripts/ai-control-plane-proof.cjs drill --apply     the kill-switch drill (writes, then restores). HELD until reviewed.
 *
 * Connection (explicit, never guessed):
 *   AI_PROOF_DATABASE_URL        a full URL, or
 *   AI_PROOF_DATABASE_URL_FROM   the NAME of one environment variable to read the URL from
 *                                (DATABASE_URL_DIRECT, DATABASE_URL or DATABASE_URL_POOLED), for use under `railway run`.
 * The script connects as whatever role that URL names (the deployed application role in production) and uses the same
 * tenant-context mechanism as the application for tenant-scoped data. It never prints a URL, user, password or row payload.
 *
 * Findings are PROVEN, UNVERIFIED or FAILED (see ai-control-plane-proof-lib.cjs). A zero count that forced row level security may
 * be hiding is UNVERIFIED, never proof that a table is empty. Dormancy rests on the independent deny controls (deploy gate,
 * platform control, kill switch, effective admission), so it can be demonstrated without being able to inventory every tenant.
 *
 *   AI_PROOF_CONFIRM_HOST             required for `drill --apply`, must equal the URL host.
 *   AI_PROOF_DEPLOY_FLAG_ATTESTATION  optional text a person attaches about the deployed deploy-flag value (recorded, never trusted).
 *   AI_PROOF_OUT                      optional path for the JSON evidence.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("reflect-metadata");
require("@nestjs/common").Logger.overrideLogger(false);
const lib = require("./ai-control-plane-proof-lib.cjs");

const { PROVEN, UNVERIFIED, FAILED } = lib;
const REPO_ROOT = path.resolve(__dirname, "..");
const dist = (...parts) => require(path.join(REPO_ROOT, "apps", "api", "dist", ...parts));

const STOP_SQL = "UPDATE ai_platform_controls SET kill_switch = true, enabled = false, allowed_tenant_keys = ARRAY[]::TEXT[], updated_by = 'drill-stop', updated_at = NOW() WHERE id = 'global';";
const CAP = "product_attribute_extraction";
const PROVIDER = "drill-provider";
const MODEL = "drill-model";
const EST = 5000n;
const ALLOWED_URL_SOURCES = ["DATABASE_URL_DIRECT", "DATABASE_URL", "DATABASE_URL_POOLED"];

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error("usage: node scripts/ai-control-plane-proof.cjs probe | dormant | drill [--apply]   (needs AI_PROOF_DATABASE_URL or AI_PROOF_DATABASE_URL_FROM)");
  process.exit(2);
}

const mode = process.argv[2];
const apply = process.argv.includes("--apply");
if (!["probe", "dormant", "drill"].includes(mode)) {
  usage();
}
let url = String(process.env.AI_PROOF_DATABASE_URL || "").trim();
if (!url && process.env.AI_PROOF_DATABASE_URL_FROM) {
  const source = String(process.env.AI_PROOF_DATABASE_URL_FROM).trim();
  if (!ALLOWED_URL_SOURCES.includes(source)) {
    usage(`AI_PROOF_DATABASE_URL_FROM must be one of ${ALLOWED_URL_SOURCES.join(", ")}.`);
  }
  url = String(process.env[source] || "").trim();
}
if (!url) {
  usage("a database URL is required: the target is never guessed.");
}
let target;
try {
  const parsed = new URL(url);
  target = {
    database: parsed.pathname.replace(/^\//, ""),
    hostFingerprint: crypto.createHash("sha256").update(`${parsed.hostname}:${parsed.port}`).digest("hex").slice(0, 12),
    host: parsed.hostname,
  };
} catch {
  usage("the database URL is not valid.");
}
if (mode === "drill" && apply && process.env.AI_PROOF_CONFIRM_HOST !== target.host) {
  usage("drill --apply writes to the target. Set AI_PROOF_CONFIRM_HOST to the URL host to confirm.");
}
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(target.host);

process.env.DATABASE_URL = url;
process.env.DATABASE_URL_POOLED = url;
process.env.DATABASE_URL_DIRECT = url;
process.env.AI_RESERVATION_SWEEP_DISABLED = "true";
delete process.env.FEATURE_INTELLIGENCE_PROVIDER_ENABLED; // judged as unset in this process only

const { PrismaClient } = require("@prisma/client");
const { PrismaService } = dist("prisma", "prisma.service.js");
const { PrismaDirectService } = dist("prisma", "prisma-direct.service.js");
const { IntelligenceCapabilityRegistry } = dist("intelligence", "intelligence-capability.registry.js");
const { IntelligenceExecutionControlService } = dist("intelligence", "intelligence-execution-control.service.js");
const { IntelligenceReservationMaintenanceService } = dist("intelligence", "intelligence-reservation-maintenance.service.js");
const gates = dist("intelligence", "intelligence-execution-gates.js");

const flagState = { on: false };
class ProofControl extends IntelligenceExecutionControlService {
  // Process-local only. Unset means the real parser sees the (deleted) environment value.
  deployFlagEnabled() {
    return flagState.on ? true : gates.readDeployFlag();
  }
}

// `db` is a plain client used only for role facts and the two NON-tenant platform tables. Tenant-scoped data is read and
// written only through the application's tenant client (`prismaService.tenant(...)`), exactly as the deployed app does.
const db = new PrismaClient({ datasources: { db: { url } } });
const evidence = { proof: mode, startedAt: new Date().toISOString(), target: { database: target.database, hostFingerprint: target.hostFingerprint }, findings: [], result: "RUNNING" };
if (process.env.AI_PROOF_DEPLOY_FLAG_ATTESTATION) {
  evidence.deployFlagAttestation = String(process.env.AI_PROOF_DEPLOY_FLAG_ATTESTATION).slice(0, 200);
}

const safeJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
class DrillAbort extends Error {}

function finding(name, status, detail, options = {}) {
  const required = options.required === true;
  const shown = detail === undefined ? undefined : JSON.parse(safeJson(detail));
  evidence.findings.push({ name, status, required, ...(shown === undefined ? {} : { detail: shown }) });
  const tag = required ? "required" : "info    ";
  console.log(`${status.padEnd(10)} ${tag} ${name}${shown === undefined ? "" : `  ${typeof shown === "string" ? shown : safeJson(shown)}`}`);
  return status;
}
const must = (name, ok, detail) => finding(name, ok ? PROVEN : FAILED, detail, { required: true });
const same = (a, b) => safeJson(a) === safeJson(b);

const TABLES = ["ai_platform_controls", "ai_platform_budget_periods", "ai_provider_budget_policies", "ai_provider_budget_reservations", "ai_provider_budget_charges", "ai_tenant_policies", "ai_executions"];

async function roleFacts() {
  const [who] = await db.$queryRaw`SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls, current_setting('row_security') AS row_security FROM pg_roles r WHERE r.rolname = current_user`;
  finding("current_role", PROVEN, who.role_name);
  finding("role is superuser", PROVEN, who.rolsuper);
  finding("role has BYPASSRLS", PROVEN, who.rolbypassrls);
  finding("row_security setting", PROVEN, who.row_security);

  const grantRows = {};
  for (const table of TABLES) {
    const [g] = await db.$queryRawUnsafe(
      `SELECT has_table_privilege(current_user, '${table}', 'SELECT') AS sel, has_table_privilege(current_user, '${table}', 'INSERT') AS ins, has_table_privilege(current_user, '${table}', 'UPDATE') AS upd, has_table_privilege(current_user, '${table}', 'DELETE') AS del`,
    );
    grantRows[table] = g;
    finding(`privileges ${table}`, PROVEN, `select=${g.sel} insert=${g.ins} update=${g.upd} delete=${g.del}`);
  }
  for (const result of lib.evaluateGrants(grantRows)) {
    must(`app-role grants for ${result.table} (${result.privileges.join(", ")})`, result.ok, result.ok ? undefined : { missing: result.missing });
  }

  const rls = await db.$queryRaw`SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) = current_user AS is_owner FROM pg_class WHERE relname IN ('ai_platform_controls','ai_platform_budget_periods','ai_provider_budget_policies','ai_provider_budget_reservations','ai_provider_budget_charges','ai_tenant_policies','ai_executions') AND relkind = 'r'`;
  const rlsByTable = Object.fromEntries(rls.map((r) => [r.relname, r]));
  for (const table of TABLES) {
    const r = rlsByTable[table];
    finding(`rls ${table}`, PROVEN, r ? `enabled=${r.relrowsecurity} forced=${r.relforcerowsecurity} role_owns=${r.is_owner}` : "table not found");
  }
  const policies = await db.$queryRaw`SELECT tablename FROM pg_policies WHERE policyname LIKE 'ai_maintenance_read_%'`;
  const maintenanceTables = new Set(policies.map((p) => p.tablename));
  finding("maintenance read policies present on", PROVEN, [...maintenanceTables].sort());
  return { who, rlsByTable, maintenanceTables };
}

function visibility(facts, table, viaMaintenance) {
  const r = facts.rlsByTable[table];
  return lib.visibilityOf({
    isSuperuser: facts.who.rolsuper,
    bypassRls: facts.who.rolbypassrls,
    rlsEnabled: r ? r.relrowsecurity : true,
    hasMaintenancePolicy: facts.maintenanceTables.has(table),
    readThroughMaintenance: viaMaintenance,
  });
}

/** Counts for the dormant proof. A count is PROVEN only when the connected role can see every tenant's rows. */
async function countFacts(facts) {
  const out = {};
  const attempt = async (fn) => {
    try {
      return await fn();
    } catch {
      return null; // not readable by this role: reported as UNVERIFIED, never as zero
    }
  };
  const viaMaintenance =
    (await attempt(() =>
      db.$transaction(async (tx) => {
        // The approved maintenance path: a transaction-local marker honoured only by the SELECT-only maintenance policies (no bypass role).
        await tx.$queryRaw`SELECT set_config('app.ai_maintenance', 'on', true)`;
        return {
          ai_provider_budget_policies: await tx.aiProviderBudgetPolicy.count(),
          ai_provider_budget_reservations: await tx.aiProviderBudgetReservation.count(),
          ai_provider_budget_charges: await tx.aiProviderBudgetCharge.count(),
        };
      }),
    )) ?? { ai_provider_budget_policies: null, ai_provider_budget_reservations: null, ai_provider_budget_charges: null };
  const direct = {
    ai_platform_budget_periods: await attempt(() => db.aiPlatformBudgetPeriod.count()),
    ai_tenant_policies: await attempt(() => db.aiTenantPolicy.count()),
    ai_executions_with_provider_call: await attempt(() => db.aiExecution.count({ where: { providerCallAttempted: true } })),
  };
  const rows = [
    ["ai_platform_budget_periods", direct.ai_platform_budget_periods, visibility(facts, "ai_platform_budget_periods", false)],
    ["ai_provider_budget_policies", viaMaintenance.ai_provider_budget_policies, visibility(facts, "ai_provider_budget_policies", true)],
    ["ai_provider_budget_reservations", viaMaintenance.ai_provider_budget_reservations, visibility(facts, "ai_provider_budget_reservations", true)],
    ["ai_provider_budget_charges", viaMaintenance.ai_provider_budget_charges, visibility(facts, "ai_provider_budget_charges", true)],
    ["ai_tenant_policies", direct.ai_tenant_policies, visibility(facts, "ai_tenant_policies", false)],
    ["ai_executions_with_provider_call", direct.ai_executions_with_provider_call, visibility(facts, "ai_executions", false)],
  ];
  for (const [name, count, vis] of rows) {
    const c = count === null ? { status: UNVERIFIED, detail: { reason: "not readable by the app role" } } : lib.classifyCount(count, vis);
    out[name] = { count, status: c.status };
    finding(`global row count ${name}`, c.status, c.detail);
  }
  return out;
}

async function dormantProof(prismaService, control) {
  console.log(`target: database=${target.database} host-fingerprint=${target.hostFingerprint}`);
  const facts = await roleFacts();

  // The platform control row: read through the same client the application uses for it.
  let row = null;
  let readable = true;
  try {
    row = await db.aiPlatformControl.findUnique({ where: { id: "global" } });
  } catch (error) {
    readable = false;
  }
  must("platform control row is readable by the app role", readable && !!row);
  const c = lib.evaluateControlRow(row);
  finding("platform enabled = false", c.enabled, undefined, { required: true });
  finding("kill switch = true", c.killSwitch, undefined, { required: true });
  if (row) {
    finding("no provider or model pinned", row.allowedProvider === null && row.allowedModel === null ? PROVEN : FAILED, undefined);
    finding("tenant allow-list is empty", row.allowedTenantKeys.length === 0 ? PROVEN : FAILED, { size: row.allowedTenantKeys.length });
    finding("request cost cap is zero", row.maxRequestCostMicros === 0n ? PROVEN : FAILED);
  }
  const counts = await countFacts(facts);

  // Effective admission, through the real service and the real tenant client.
  const probeTenant = `ai-dormant-probe-${Date.now().toString(36)}`;
  const probe = { tenantKey: probeTenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${probeTenant}:1`, requestedEstimatedCostMicros: EST };
  const real = await control.admit(probe);
  finding("admission with the process's (unset) deploy flag", real.decision === "DENY" ? PROVEN : FAILED, real.denialReason, { required: true });
  flagState.on = true;
  const forced = await control.admit(probe);
  flagState.on = false;
  must("effective admission is DENY even with the deploy flag forced ON in this process", forced.decision === "DENY", forced.denialReason);
  finding("the deny is attributed to the platform kill switch (the expected seeded posture)", forced.denialReason === "platform_kill_switch" ? PROVEN : FAILED, forced.denialReason);
  must("provider dispatch possible: NO (admission DENY, and a denial reports no provider call and no canonical mutation)", forced.providerCallAttempted === false && forced.canonicalProductMutationEnabled === false && forced.decision === "DENY");
  const afterTenant = await prismaService.tenant(probeTenant).aiProviderBudgetReservation.count({ where: { tenantKey: probeTenant } });
  finding("admission attempts created no reservation (probe tenant, read through its own tenant context)", afterTenant === 0 ? PROVEN : FAILED, { count: afterTenant });
  finding("FEATURE_INTELLIGENCE_PROVIDER_ENABLED on the deployed API", UNVERIFIED, "this script cannot read the deployed API's variables; the database layer denies regardless", { required: false });
  return { facts, row, counts };
}

async function drill(prismaService, control, maintenance) {
  const { facts, row: snapshot, counts } = await dormantProof(prismaService, control);
  const clean =
    snapshot &&
    snapshot.allowedProvider === null && snapshot.allowedModel === null && snapshot.allowedTenantKeys.length === 0 && snapshot.maxRequestCostMicros === 0n &&
    counts.ai_platform_budget_periods.status === PROVEN && counts.ai_platform_budget_periods.count === 0;
  if (!clean) {
    throw new DrillAbort("the drill refuses to run: the control row is not exactly deny-all or platform budget periods exist");
  }
  const needs = (table, privilege) =>
    db.$queryRawUnsafe(`SELECT has_table_privilege(current_user, '${table}', '${privilege}') AS ok`).then(([r]) => r.ok === true);
  const writable = (await needs("ai_platform_controls", "UPDATE")) && (await needs("ai_platform_budget_periods", "INSERT")) && (await needs("ai_platform_budget_periods", "DELETE")) &&
    (await needs("ai_tenant_policies", "INSERT")) && (await needs("ai_tenant_policies", "DELETE")) && (await needs("ai_provider_budget_policies", "DELETE")) &&
    (await needs("ai_provider_budget_reservations", "DELETE")) && (await needs("ai_provider_budget_charges", "DELETE"));
  must("the app role holds every privilege the drill and its cleanup need (checked before any write)", writable);

  if (!apply) {
    console.log("\nDRY RUN: nothing was written. The drill would, in order:");
    for (const step of [
      "create a synthetic tenant policy and tiny budget rows (through the application's tenant context; platform rows through the app role) while the control row is still deny-all",
      "enable the control row for ONLY the synthetic tenant (the deployed API's flag is untouched, so the live API still denies)",
      "admit, claim and re-validate a reservation, then switch the platform kill switch ON",
      "prove the pre-dispatch re-check now denies and the claimed reservation is cancelled exactly once, with repeated attempts changing nothing",
      "prove a kill switch flipped during a call discards the result and reconciles usage exactly once",
      "restore the control row to its exact snapshot, delete every drill row, and verify the final state",
    ]) {
      console.log(` - ${step}`);
    }
    console.log(`\nIf the process is ever killed mid-drill, stop with:\n  ${STOP_SQL}`);
    return;
  }

  console.log(`\nDRILL (writes). If this process is killed hard, stop provider execution with:\n  ${STOP_SQL}\n`);
  const tenant = `ai-drill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tdb = prismaService.tenant(tenant);
  const created = { periodIds: [] };
  let windowOpen = false;
  const restore = async () => {
    // The exact snapshot first: the only step that matters for safety.
    await db.aiPlatformControl.update({
      where: { id: "global" },
      data: {
        enabled: snapshot.enabled, killSwitch: snapshot.killSwitch, allowedProvider: snapshot.allowedProvider, allowedModel: snapshot.allowedModel,
        allowedTenantKeys: snapshot.allowedTenantKeys, maxRequestCostMicros: snapshot.maxRequestCostMicros, updatedBy: snapshot.updatedBy,
      },
    });
    windowOpen = false;
    await tdb.aiProviderBudgetCharge.deleteMany({ where: { tenantKey: tenant } });
    await tdb.aiProviderBudgetReservation.deleteMany({ where: { tenantKey: tenant } });
    await tdb.aiProviderBudgetPolicy.deleteMany({ where: { tenantKey: tenant } });
    await tdb.aiTenantPolicy.deleteMany({ where: { tenantKey: tenant } });
    if (created.periodIds.length > 0) {
      await db.aiPlatformBudgetPeriod.deleteMany({ where: { id: { in: created.periodIds } } });
    }
  };
  const onSignal = (signal) => {
    console.error(`received ${signal}: restoring deny-all before exit`);
    restore().finally(() => process.exit(130));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  const step = (name, ok, detail) => {
    must(name, ok, detail);
    if (!ok) {
      throw new DrillAbort(name);
    }
  };
  try {
    const now = new Date();
    const window = { periodStartedAt: new Date(now.getTime() - 24 * 3600 * 1000), periodEndsAt: new Date(now.getTime() + 24 * 3600 * 1000) };
    const keys = [gates.dayPeriodKey(now), gates.monthPeriodKey(now)];

    await tdb.aiTenantPolicy.create({
      data: {
        tenantKey: tenant, capability: CAP, providerKey: PROVIDER, policyVersion: "drill", status: "active", intelligenceEnabled: true,
        providerExecutionEnabled: true, killSwitchEnabled: false, tenantOptOut: false, maxPayloadBytes: 1024, allowedCapabilities: [CAP],
        allowedProviderKeys: [PROVIDER], redactionPolicyVersion: "drill", classificationPolicyHash: "sha256:drill", approvedBy: "kill-switch-drill", approvedAt: now,
      },
    });
    for (const periodKey of keys) {
      await tdb.aiProviderBudgetPolicy.create({
        data: { tenantKey: tenant, capability: CAP, providerKey: PROVIDER, executionMode: "live_provider", periodKey, policyVersion: "drill", enabled: true, currency: "USD", spendLimitMicros: 100000n, requestLimit: 10, ...window },
      });
      const period = await db.aiPlatformBudgetPeriod.create({ data: { periodKey, enabled: true, currency: "USD", spendLimitMicros: 100000n, requestLimit: 10, ...window } });
      created.periodIds.push(period.id);
    }
    const nowControl = await db.aiPlatformControl.findUnique({ where: { id: "global" } });
    step("drill rows created while the control row is still deny-all", nowControl.enabled === false && nowControl.killSwitch === true);
    flagState.on = true;
    const pre = await control.admit({ tenantKey: tenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${tenant}:pre`, requestedEstimatedCostMicros: EST });
    flagState.on = false;
    step("with full tenant and budget configuration but a deny-all control row, admission is DENY", pre.denialReason === "platform_kill_switch", pre.denialReason);

    await db.aiPlatformControl.update({
      where: { id: "global" },
      data: { enabled: true, killSwitch: false, allowedProvider: PROVIDER, allowedModel: MODEL, allowedTenantKeys: [tenant], maxRequestCostMicros: 10000n, updatedBy: "kill-switch-drill" },
    });
    windowOpen = true;
    if (isLocal && process.env.AI_PROOF_INJECT_FAILURE === "after-enable") {
      throw new Error("injected failure (local rehearsal only)");
    }
    flagState.on = true;

    const input = (n) => ({ tenantKey: tenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${tenant}:${n}`, requestedEstimatedCostMicros: EST });
    const admitted = await control.admit(input("a"));
    step("under the deliberately enabled test condition, admission is ALLOW", admitted.decision === "ALLOW", admitted.denialReason ?? "reservation created");
    const other = await control.admit({ ...input("b"), tenantKey: `${tenant}-other` });
    step("a different tenant is still denied (allow-list)", other.denialReason === "tenant_not_allowlisted", other.denialReason);
    const claim = await control.claim({ tenantKey: tenant, reservationId: admitted.reservationId });
    step("the reservation is claimed", claim.claimed === true);
    const ctx = { tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken, capability: CAP, providerKey: PROVIDER, modelKey: MODEL };
    step("pre-dispatch re-validation passes while enabled", (await control.revalidateBeforeDispatch(ctx)).ok === true);

    await db.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true, updatedBy: "kill-switch-drill" } });
    const revalidated = await control.revalidateBeforeDispatch(ctx);
    step("with the kill switch ON, the pre-dispatch re-read now denies", revalidated.ok === false && revalidated.reason === "platform_kill_switch", revalidated.reason);
    const denyAfterKill = await control.admit(input("c"));
    step("with the kill switch ON, new admission is denied", denyAfterKill.denialReason === "platform_kill_switch", denyAfterKill.denialReason);
    const counterRow = () => db.aiPlatformBudgetPeriod.findMany({ where: { id: { in: created.periodIds } }, orderBy: { periodKey: "asc" }, select: { periodKey: true, reservedSpendMicros: true, spentSpendMicros: true, requestCount: true } });

    const cancelled = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "cancel", reason: "drill_kill_switch_revalidation" });
    step("the claimed reservation is cancelled exactly once", cancelled.applied === true && cancelled.status === "cancelled");
    const frozen = await counterRow();
    for (let i = 0; i < 3; i += 1) {
      const a = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "cancel", reason: "again" });
      const b = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "reconcile", actualCostMicros: 1 });
      const c = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId }, { kind: "expire_unknown_billing", reason: "again" });
      await control.sweepExpired({ tenantKey: tenant });
      step("repeated cancel, reconcile, expire and sweep attempts are all no-ops", !a.applied && !b.applied && !c.applied);
    }
    step("repeated terminal attempts changed no counter", same(frozen, await counterRow()));
    step("the cancelled reservation released its budget and request count", (await counterRow()).every((r) => r.reservedSpendMicros === 0n && r.spentSpendMicros === 0n && r.requestCount === 0));
    step("no later claim is possible", (await control.claim({ tenantKey: tenant, reservationId: admitted.reservationId })).claimed === false);

    await db.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: false, updatedBy: "kill-switch-drill" } });
    let workRan = false;
    const during = await control.runWithReservation(input("d"), async () => {
      workRan = true;
      await db.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true, updatedBy: "kill-switch-drill" } });
      return { billing: { kind: "usage", actualCostMicros: 3000 }, value: "never-returned" };
    });
    step("a kill switch flipped during a call discards the result", workRan && during.status === "result_discarded" && during.reason === "kill_switch_during_call" && !("value" in during), during.status);
    step("usage was reconciled exactly once", during.settlement.applied === true && during.settlement.status === "reconciled" && during.settlement.settledCostMicros === "3000");
    const spentRows = await counterRow();
    step("counters show the reconciled spend once", spentRows.every((r) => r.reservedSpendMicros === 0n && r.spentSpendMicros === 3000n && r.requestCount === 1), spentRows);
    const audit = await maintenance.auditCounters();
    step("the counter audit is clean", audit.length === 0, audit);
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  } finally {
    flagState.on = false;
    await restore();
    if (windowOpen) {
      throw new Error("restore did not run");
    }
  }

  const finalRow = await db.aiPlatformControl.findUnique({ where: { id: "global" } });
  const pick = (r) => ({ enabled: r.enabled, killSwitch: r.killSwitch, allowedProvider: r.allowedProvider, allowedModel: r.allowedModel, allowedTenantKeys: r.allowedTenantKeys, maxRequestCostMicros: r.maxRequestCostMicros });
  must("the control row is restored to its exact snapshot", same(pick(finalRow), pick(snapshot)));
  must("final state is deny-all with the kill switch ON", finalRow.enabled === false && finalRow.killSwitch === true);
  const leftover = {
    tenantPolicies: await tdb.aiTenantPolicy.count({ where: { tenantKey: tenant } }),
    budgetPolicies: await tdb.aiProviderBudgetPolicy.count({ where: { tenantKey: tenant } }),
    reservations: await tdb.aiProviderBudgetReservation.count({ where: { tenantKey: tenant } }),
    charges: await tdb.aiProviderBudgetCharge.count({ where: { tenantKey: tenant } }),
    platformPeriods: await db.aiPlatformBudgetPeriod.count({ where: { id: { in: created.periodIds } } }),
  };
  must("no drill row remains (read through the drill tenant's own context, and by id for platform rows)", Object.values(leftover).every((n) => n === 0), leftover);
  flagState.on = true;
  const last = await control.admit({ tenantKey: tenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${tenant}:final`, requestedEstimatedCostMicros: EST });
  flagState.on = false;
  must("final admission attempt is DENY", last.decision === "DENY" && last.denialReason === "platform_kill_switch", last.denialReason);
  must("that attempt created nothing", (await tdb.aiProviderBudgetReservation.count({ where: { tenantKey: tenant } })) === 0);
}

async function main() {
  const prismaService = new PrismaService();
  const directService = new PrismaDirectService();
  const control = new ProofControl(prismaService, new IntelligenceCapabilityRegistry());
  const maintenance = new IntelligenceReservationMaintenanceService(directService, control);
  let exitCode = 0;
  try {
    if (mode === "probe") {
      console.log(`target: database=${target.database} host-fingerprint=${target.hostFingerprint}`);
      const facts = await roleFacts();
      let readable = true;
      try {
        await db.aiPlatformControl.findUnique({ where: { id: "global" } });
      } catch {
        readable = false;
      }
      must("platform control row is readable by the app role", readable);
      void facts;
    } else if (mode === "dormant") {
      await dormantProof(prismaService, control);
    } else {
      await drill(prismaService, control, maintenance);
    }
  } catch (error) {
    exitCode = 1;
    evidence.error = evidence.error ?? (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    if (!(error instanceof DrillAbort)) {
      console.error(String(evidence.error).slice(0, 400));
    }
  } finally {
    const v = lib.verdictOf(evidence.findings);
    evidence.verdict = exitCode === 0 ? v : { verdict: "FAILED", reason: evidence.error ?? v.reason };
    if (exitCode === 0 && !evidence.verdict.verdict.startsWith("DORMANT_PROVEN") && evidence.verdict.verdict !== "PROBE_OK") {
      exitCode = 1;
    }
    if (mode === "probe" && evidence.verdict.verdict.startsWith("DORMANT_PROVEN")) {
      evidence.verdict = { verdict: "PROBE_OK", reason: "role facts established; the probe makes no dormancy claim" };
    }
    if (mode === "drill" && apply && exitCode === 0 && evidence.verdict.verdict.startsWith("DORMANT_PROVEN")) {
      evidence.verdict = { verdict: "DRILL_PASSED", reason: "every required drill check passed and deny-all was restored and verified" };
    }
    evidence.result = evidence.verdict.verdict;
    evidence.finishedAt = new Date().toISOString();
    await prismaService.onModuleDestroy().catch(() => undefined);
    await directService.onModuleDestroy().catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    const tally = evidence.findings.reduce((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
    console.log(`\nfindings: ${safeJson(tally)}`);
    console.log(`VERDICT: ${evidence.verdict.verdict}  (${evidence.verdict.reason})`);
    if (process.env.AI_PROOF_OUT) {
      try {
        fs.writeFileSync(process.env.AI_PROOF_OUT, `${JSON.stringify(evidence, null, 2)}
`);
        console.log("evidence written");
      } catch {
        console.log("evidence file could not be written (the findings above are the record)");
      }
    }
  }
  process.exit(exitCode);
}

main();
