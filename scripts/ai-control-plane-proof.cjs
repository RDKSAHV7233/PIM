#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * AI-PROV-004b control-plane production proofs. No provider, no network call, no credential.
 *
 *   node scripts/ai-control-plane-proof.cjs dormant                 read-only dormant-state proof
 *   node scripts/ai-control-plane-proof.cjs drill                   dry run: runs the dormant proof and prints the plan
 *   node scripts/ai-control-plane-proof.cjs drill --apply           the kill-switch drill (writes, then restores)
 *
 * Environment (all explicit, nothing is guessed):
 *   AI_PROOF_DATABASE_URL     the database to prove. Required. The script prints the host and database, never the credentials.
 *   AI_PROOF_CONFIRM_HOST     required for `drill --apply`, and must equal the host in the URL.
 *   AI_PROOF_OUT              optional path for the JSON evidence file.
 *
 * Safety design for a single environment that is production:
 *   - The deploy flag FEATURE_INTELLIGENCE_PROVIDER_ENABLED is forced ON only inside THIS process. The deployed API keeps its own
 *     value, so while the drill runs the API still denies at G0 no matter what the database row says.
 *   - The drill allow-lists only a synthetic internal tenant key, so no real tenant can be admitted even in the database layer.
 *   - The drill refuses to start unless the database is exactly dormant (deny-all control row, no budget rows, no reservations,
 *     no charges, no tenant policy), so it can never overwrite real configuration.
 *   - The permissive window is a handful of statements. The control row is restored to its exact snapshot in a finally block and on
 *     SIGINT/SIGTERM, then verified. If the process is killed hard, the stop statement is printed up front.
 *   - It requires `npm run build` first and runs the services compiled in apps/api/dist, so it exercises the deployed code path.
 */
const fs = require("node:fs");
const path = require("node:path");
require("reflect-metadata");
require("@nestjs/common").Logger.overrideLogger(false);

const REPO_ROOT = path.resolve(__dirname, "..");
const dist = (...parts) => require(path.join(REPO_ROOT, "apps", "api", "dist", ...parts));

const STOP_SQL = "UPDATE ai_platform_controls SET kill_switch = true, enabled = false, allowed_tenant_keys = ARRAY[]::TEXT[], updated_by = 'drill-stop', updated_at = NOW() WHERE id = 'global';";
const CAP = "product_attribute_extraction";
const PROVIDER = "drill-provider";
const MODEL = "drill-model";
const EST = 5000n;

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error("usage: node scripts/ai-control-plane-proof.cjs dormant | drill [--apply]   (requires AI_PROOF_DATABASE_URL)");
  process.exit(2);
}

const mode = process.argv[2];
const apply = process.argv.includes("--apply");
if (mode !== "dormant" && mode !== "drill") {
  usage();
}
const url = String(process.env.AI_PROOF_DATABASE_URL || "").trim();
if (!url) {
  usage("AI_PROOF_DATABASE_URL is required: the target database is never guessed.");
}
let target;
try {
  const parsed = new URL(url);
  target = { host: parsed.hostname, port: parsed.port, database: parsed.pathname.replace(/^\//, "") };
} catch {
  usage("AI_PROOF_DATABASE_URL is not a valid URL.");
}
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(target.host);
if (mode === "drill" && apply && process.env.AI_PROOF_CONFIRM_HOST !== target.host) {
  usage(`drill --apply writes to ${target.host}. Set AI_PROOF_CONFIRM_HOST=${target.host} to confirm the target.`);
}

process.env.DATABASE_URL = url;
process.env.DATABASE_URL_POOLED = url;
process.env.DATABASE_URL_DIRECT = url;
process.env.AI_RESERVATION_SWEEP_DISABLED = "true";
delete process.env.FEATURE_INTELLIGENCE_PROVIDER_ENABLED; // the process value is judged as unset, exactly like a dormant deploy

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

const admin = new PrismaClient({ datasources: { db: { url } } });
const evidence = { proof: mode, startedAt: new Date().toISOString(), target, checks: [], notVerifiedByScript: [], result: "RUNNING" };

const safeJson = (value) => JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));

function record(name, ok, detail) {
  const shown = detail === undefined ? undefined : JSON.parse(safeJson(detail));
  evidence.checks.push({ name, ok, ...(shown === undefined ? {} : { detail: shown }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${shown === undefined ? "" : `  ${typeof shown === "string" ? shown : safeJson(shown)}`}`);
  if (!ok) {
    throw new ProofFailure(name);
  }
}
class ProofFailure extends Error {}

const same = (a, b) => JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) === JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

async function counts() {
  const [periods, policies, reservations, charges, tenantPolicies, executionsCalled] = await Promise.all([
    admin.aiPlatformBudgetPeriod.count(),
    admin.aiProviderBudgetPolicy.count(),
    admin.aiProviderBudgetReservation.count(),
    admin.aiProviderBudgetCharge.count(),
    admin.aiTenantPolicy.count(),
    admin.aiExecution.count({ where: { providerCallAttempted: true } }),
  ]);
  return { platformBudgetPeriods: periods, tenantBudgetPolicies: policies, reservations, charges, tenantPolicies, executionsWithProviderCall: executionsCalled };
}

const isDenyAll = (row) =>
  !!row && row.enabled === false && row.killSwitch === true && row.allowedProvider === null && row.allowedModel === null && row.allowedTenantKeys.length === 0 && row.maxRequestCostMicros === 0n;

async function dormantProof(prismaService, control) {
  console.log(`target: host=${target.host} port=${target.port || "default"} database=${target.database}`);
  const row = await admin.aiPlatformControl.findUnique({ where: { id: "global" } });
  record("platform control row exists", !!row);
  record("platform control is disabled", row.enabled === false);
  record("kill switch is ON", row.killSwitch === true);
  record("no provider or model pinned", row.allowedProvider === null && row.allowedModel === null);
  record("no tenant is allow-listed", row.allowedTenantKeys.length === 0, { allowedTenantKeys: row.allowedTenantKeys });
  record("request cost cap is zero", row.maxRequestCostMicros === 0n);
  const before = await counts();
  record("no budgets exist and nothing was ever reserved or called", Object.values(before).every((n) => n === 0), before);

  const probeTenant = `ai-dormant-probe-${Date.now().toString(36)}`;
  const probe = { tenantKey: probeTenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${probeTenant}:1`, requestedEstimatedCostMicros: EST };
  const processFlag = await control.admit(probe);
  record("admission with the real (unset) deploy flag is DENY", processFlag.decision === "DENY" && processFlag.denialReason === "platform_feature_disabled", processFlag.denialReason);
  flagState.on = true;
  const dbLayer = await control.admit(probe);
  flagState.on = false;
  record("admission with the flag forced ON in this process is still DENY at the database control (kill switch)", dbLayer.decision === "DENY" && dbLayer.denialReason === "platform_kill_switch", dbLayer.denialReason);
  record("a denial reports no provider call and no canonical mutation", dbLayer.providerCallAttempted === false && dbLayer.canonicalProductMutationEnabled === false);
  const after = await counts();
  record("zero reservations, charges or provider activity were produced", same(before, after), after);
  evidence.notVerifiedByScript.push(
    "The deployed API's own value of FEATURE_INTELLIGENCE_PROVIDER_ENABLED cannot be read from here. Confirm in the Railway variables that it is unset (or not exactly 'true'). The database layer above denies on its own regardless.",
  );
  return { row, before };
}

async function drill(prismaService, control, maintenance) {
  const { row: snapshot } = await dormantProof(prismaService, control);
  if (!apply) {
    console.log("\nDRY RUN: dormant proof passed. The drill would, in order:");
    for (const step of [
      "create a synthetic tenant policy and tiny budget rows (tenant and platform, day and month) while the control row is still deny-all",
      "enable the control row for ONLY the synthetic tenant (deployed API flag stays as it is, so the live API still denies)",
      "admit, claim and re-validate a reservation, then switch the platform kill switch ON",
      "prove the pre-dispatch re-check now denies and the claimed reservation is cancelled exactly once, with repeated attempts changing nothing",
      "prove a kill switch flipped during a call discards the result and reconciles usage exactly once",
      "restore the control row to its exact snapshot, delete every drill row, and verify the final state",
    ]) {
      console.log(` - ${step}`);
    }
    console.log(`\nTo apply: AI_PROOF_CONFIRM_HOST=${target.host} node scripts/ai-control-plane-proof.cjs drill --apply`);
    console.log(`If the process is ever killed mid-drill, stop with:\n  ${STOP_SQL}`);
    return;
  }

  console.log(`\nDRILL (writes). If this process is killed hard, stop provider execution with:\n  ${STOP_SQL}\n`);
  const tenant = `ai-drill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = { periodIds: [] };
  let windowOpen = false;
  const restore = async () => {
    // Restore the exact snapshot first: this is the only step that matters for safety.
    await admin.aiPlatformControl.update({
      where: { id: "global" },
      data: {
        enabled: snapshot.enabled,
        killSwitch: snapshot.killSwitch,
        allowedProvider: snapshot.allowedProvider,
        allowedModel: snapshot.allowedModel,
        allowedTenantKeys: snapshot.allowedTenantKeys,
        maxRequestCostMicros: snapshot.maxRequestCostMicros,
        updatedBy: snapshot.updatedBy,
      },
    });
    windowOpen = false;
    await admin.aiProviderBudgetCharge.deleteMany({ where: { tenantKey: tenant } });
    await admin.aiProviderBudgetReservation.deleteMany({ where: { tenantKey: tenant } });
    await admin.aiProviderBudgetPolicy.deleteMany({ where: { tenantKey: tenant } });
    await admin.aiTenantPolicy.deleteMany({ where: { tenantKey: tenant } });
    if (created.periodIds.length > 0) {
      await admin.aiPlatformBudgetPeriod.deleteMany({ where: { id: { in: created.periodIds } } });
    }
  };
  const onSignal = (signal) => {
    console.error(`received ${signal}: restoring deny-all before exit`);
    restore().finally(() => process.exit(130));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  try {
    const now = new Date();
    const window = { periodStartedAt: new Date(now.getTime() - 24 * 3600 * 1000), periodEndsAt: new Date(now.getTime() + 24 * 3600 * 1000) };
    const keys = [gates.dayPeriodKey(now), gates.monthPeriodKey(now)];

    // 1. rows first, while the control row is still deny-all
    await admin.aiTenantPolicy.create({
      data: {
        tenantKey: tenant, capability: CAP, providerKey: PROVIDER, policyVersion: "drill", status: "active", intelligenceEnabled: true,
        providerExecutionEnabled: true, killSwitchEnabled: false, tenantOptOut: false, maxPayloadBytes: 1024, allowedCapabilities: [CAP],
        allowedProviderKeys: [PROVIDER], redactionPolicyVersion: "drill", classificationPolicyHash: "sha256:drill", approvedBy: "kill-switch-drill", approvedAt: now,
      },
    });
    for (const periodKey of keys) {
      await admin.aiProviderBudgetPolicy.create({
        data: { tenantKey: tenant, capability: CAP, providerKey: PROVIDER, executionMode: "live_provider", periodKey, policyVersion: "drill", enabled: true, currency: "USD", spendLimitMicros: 100000n, requestLimit: 10, ...window },
      });
      const period = await admin.aiPlatformBudgetPeriod.create({ data: { periodKey, enabled: true, currency: "USD", spendLimitMicros: 100000n, requestLimit: 10, ...window } });
      created.periodIds.push(period.id);
    }
    record("drill rows created while the control row is still deny-all", isDenyAll(await admin.aiPlatformControl.findUnique({ where: { id: "global" } })));
    const stillDenied = await (async () => {
      flagState.on = true;
      const r = await control.admit({ tenantKey: tenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${tenant}:pre`, requestedEstimatedCostMicros: EST });
      flagState.on = false;
      return r;
    })();
    record("with full tenant and budget configuration but a deny-all control row, admission is DENY", stillDenied.denialReason === "platform_kill_switch", stillDenied.denialReason);

    // 2. the deliberately enabled test condition, for the synthetic tenant only
    await admin.aiPlatformControl.update({
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
    record("under the deliberately enabled test condition, admission is ALLOW", admitted.decision === "ALLOW", admitted.denialReason ?? admitted.reservationId);
    const other = await control.admit({ ...input("b"), tenantKey: `${tenant}-other` });
    record("a different tenant is still denied (allow-list)", other.denialReason === "tenant_not_allowlisted", other.denialReason);
    const claim = await control.claim({ tenantKey: tenant, reservationId: admitted.reservationId });
    record("the reservation is claimed", claim.claimed === true);
    const ctx = { tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken, capability: CAP, providerKey: PROVIDER, modelKey: MODEL };
    record("pre-dispatch re-validation passes while enabled", (await control.revalidateBeforeDispatch(ctx)).ok === true);

    // 3. kill switch ON, then the re-read must change the outcome
    await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true, updatedBy: "kill-switch-drill" } });
    const revalidated = await control.revalidateBeforeDispatch(ctx);
    record("with the kill switch ON, the pre-dispatch re-read now denies", revalidated.ok === false && revalidated.reason === "platform_kill_switch", revalidated.reason);
    const denyAfterKill = await control.admit(input("c"));
    record("with the kill switch ON, new admission is denied", denyAfterKill.denialReason === "platform_kill_switch", denyAfterKill.denialReason);
    const counterRow = async () => admin.aiPlatformBudgetPeriod.findMany({ where: { id: { in: created.periodIds } }, orderBy: { periodKey: "asc" }, select: { periodKey: true, reservedSpendMicros: true, spentSpendMicros: true, requestCount: true } });

    const cancelled = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "cancel", reason: "drill_kill_switch_revalidation" });
    record("the claimed reservation is cancelled exactly once", cancelled.applied === true && cancelled.status === "cancelled");
    const frozen = await counterRow();
    for (let i = 0; i < 3; i += 1) {
      const a = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "cancel", reason: "again" });
      const b = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId, claimToken: claim.claimToken }, { kind: "reconcile", actualCostMicros: 1 });
      const c = await control.settle({ tenantKey: tenant, reservationId: admitted.reservationId }, { kind: "expire_unknown_billing", reason: "again" });
      await control.sweepExpired({ tenantKey: tenant });
      if (a.applied || b.applied || c.applied) {
        record("repeated cancel, reconcile, expire and sweep attempts are all no-ops", false);
      }
    }
    record("repeated terminal attempts changed no counter", same(frozen, await counterRow()), await counterRow());
    record("the cancelled reservation released its budget and request count", (await counterRow()).every((r) => r.reservedSpendMicros === 0n && r.spentSpendMicros === 0n && r.requestCount === 0));
    record("no later claim is possible", (await control.claim({ tenantKey: tenant, reservationId: admitted.reservationId })).claimed === false);

    // 4. kill switch flipped during a call: result discarded, usage reconciled exactly once
    await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: false, updatedBy: "kill-switch-drill" } });
    let workRan = false;
    const during = await control.runWithReservation(input("d"), async () => {
      workRan = true;
      await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true, updatedBy: "kill-switch-drill" } });
      return { billing: { kind: "usage", actualCostMicros: 3000 }, value: "never-returned" };
    });
    record("a kill switch flipped during a call discards the result", workRan && during.status === "result_discarded" && during.reason === "kill_switch_during_call" && !("value" in during), during.status);
    record("usage was reconciled exactly once", during.settlement.applied === true && during.settlement.status === "reconciled" && during.settlement.settledCostMicros === "3000");
    const spentRows = await counterRow();
    record("counters show the reconciled spend once", spentRows.every((r) => r.reservedSpendMicros === 0n && r.spentSpendMicros === 3000n && r.requestCount === 1), spentRows);
    const audit = await maintenance.auditCounters();
    record("the counter audit is clean", audit.length === 0, audit);
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

  // 5. final state, from a fresh read
  const finalRow = await admin.aiPlatformControl.findUnique({ where: { id: "global" } });
  record("the control row is restored to its exact snapshot", same(
    { enabled: finalRow.enabled, killSwitch: finalRow.killSwitch, allowedProvider: finalRow.allowedProvider, allowedModel: finalRow.allowedModel, allowedTenantKeys: finalRow.allowedTenantKeys, maxRequestCostMicros: finalRow.maxRequestCostMicros },
    { enabled: snapshot.enabled, killSwitch: snapshot.killSwitch, allowedProvider: snapshot.allowedProvider, allowedModel: snapshot.allowedModel, allowedTenantKeys: snapshot.allowedTenantKeys, maxRequestCostMicros: snapshot.maxRequestCostMicros },
  ));
  record("final state is deny-all with the kill switch ON", isDenyAll(finalRow));
  const finalCounts = await counts();
  record("final state: no budgets, reservations, charges or tenant policies remain", Object.values(finalCounts).every((n) => n === 0), finalCounts);
  flagState.on = true;
  const last = await control.admit({ tenantKey: tenant, capability: CAP, providerKey: PROVIDER, modelKey: MODEL, requestFingerprint: `${tenant}:final`, requestedEstimatedCostMicros: EST });
  flagState.on = false;
  record("final admission attempt is DENY", last.decision === "DENY" && last.denialReason === "platform_kill_switch", last.denialReason);
  record("final state still has zero rows after that attempt", Object.values(await counts()).every((n) => n === 0));
}

async function main() {
  const prismaService = new PrismaService();
  const directService = new PrismaDirectService();
  const control = new ProofControl(prismaService, new IntelligenceCapabilityRegistry());
  const maintenance = new IntelligenceReservationMaintenanceService(directService, control);
  let exitCode = 0;
  try {
    if (mode === "dormant") {
      await dormantProof(prismaService, control);
    } else {
      await drill(prismaService, control, maintenance);
    }
    evidence.result = "PASS";
  } catch (error) {
    exitCode = 1;
    evidence.result = "FAIL";
    if (!(error instanceof ProofFailure)) {
      console.error(error);
      evidence.error = evidence.error ?? (error instanceof Error ? error.message : String(error));
    }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await prismaService.onModuleDestroy().catch(() => undefined);
    await directService.onModuleDestroy().catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    if (process.env.AI_PROOF_OUT) {
      fs.writeFileSync(process.env.AI_PROOF_OUT, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    for (const note of evidence.notVerifiedByScript) {
      console.log(`NOT VERIFIED BY THIS SCRIPT: ${note}`);
    }
    console.log(`\nRESULT: ${evidence.result}`);
  }
  process.exit(exitCode);
}

main();
