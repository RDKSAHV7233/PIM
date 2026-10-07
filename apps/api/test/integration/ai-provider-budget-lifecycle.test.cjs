#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * AI-PROV-004b-i: provider execution control plane against a REAL PostgreSQL.
 *
 * Proves what mocks cannot: atomic multi-counter reservation under concurrency, exactly-once settlement,
 * claim arbitration, lease expiry, BIGINT money and counter integrity. No provider SDK, credential or network
 * call is involved: the "work" callback is a test stub. Requires `npm run build` (reads apps/api/dist).
 */
const path = require("node:path");
require("reflect-metadata");
require("@nestjs/common").Logger.overrideLogger(false);

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const dist = (...parts) => require(path.join(REPO_ROOT, "apps", "api", "dist", ...parts));

function prepareEnv() {
  const local = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const url = String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim();
  if (!url || /HOST:5432/i.test(url)) {
    process.env.DATABASE_URL = local;
  }
  process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  process.env.AI_RESERVATION_SWEEP_DISABLED = "true";
}
prepareEnv();

// The admin connection (superuser in CI) does setup, cleanup and inspection only. Every service under test runs as a
// restricted role that is subject to forced row level security, so no result below can depend on owner or BYPASSRLS behaviour.
const ADMIN_URL = String(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL);
const APP_ROLE = "ai_rls_probe";
function roleUrl() {
  const url = new URL(ADMIN_URL);
  url.username = APP_ROLE;
  url.password = APP_ROLE;
  return url.toString();
}

const { PrismaService } = dist("prisma", "prisma.service.js");
const { PrismaDirectService } = dist("prisma", "prisma-direct.service.js");
const { IntelligenceCapabilityRegistry } = dist("intelligence", "intelligence-capability.registry.js");
const { IntelligenceExecutionControlService } = dist("intelligence", "intelligence-execution-control.service.js");
const { IntelligenceReservationMaintenanceService } = dist("intelligence", "intelligence-reservation-maintenance.service.js");
const gates = dist("intelligence", "intelligence-execution-gates.js");

const CAP = "product_attribute_extraction";
const PROVIDER = "anthropic";
const MODEL = "model-x";
const E = 1_000_000n; // USD 1.00 estimate
const RUN = `${process.pid}${Date.now().toString(36)}`;
const PREFIX = "it-lc-";
const clock = { offsetMs: 0 };
const state = { flag: true };

class TestControl extends IntelligenceExecutionControlService {
  now() {
    return new Date(Date.now() + clock.offsetMs);
  }
  deployFlagEnabled() {
    return state.flag;
  }
}

const { PrismaClient } = require("@prisma/client");
const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
let prisma;
let directService;
let control;
let maintenance;
let roleDirect;
const tenants = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function show(value) {
  return typeof value === "bigint" ? value.toString() : JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}
function eq(actual, expected, message) {
  if (show(actual) !== show(expected)) {
    throw new Error(`${message}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

function periodKeys() {
  const base = Date.now() + clock.offsetMs;
  const keys = new Set();
  for (const t of [base, base + 3 * 3600 * 1000, base + 24 * 3600 * 1000, base - 3600 * 1000]) {
    const d = new Date(t);
    keys.add(gates.dayPeriodKey(d));
    keys.add(gates.monthPeriodKey(d));
  }
  return [...keys];
}
const windowFor = () => ({
  periodStartedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
  periodEndsAt: new Date(Date.now() + 40 * 24 * 3600 * 1000),
});

async function cleanup() {
  await admin.$executeRawUnsafe(
    `DELETE FROM ai_provider_budget_charges WHERE tenant_key LIKE '${PREFIX}%'`,
  );
  await admin.$executeRawUnsafe(`DELETE FROM ai_provider_budget_reservations WHERE tenant_key LIKE '${PREFIX}%'`);
  await admin.$executeRawUnsafe(`DELETE FROM ai_provider_budget_policies WHERE tenant_key LIKE '${PREFIX}%'`);
  await admin.$executeRawUnsafe(`DELETE FROM ai_tenant_policies WHERE tenant_key LIKE '${PREFIX}%'`);
  await admin.workspaceDirectory.deleteMany({ where: { tenantKey: { startsWith: PREFIX } } });
}

async function fullReset() {
  await cleanup();
  for (const periodKey of periodKeys()) {
    await admin.aiPlatformBudgetPeriod.deleteMany({ where: { periodKey } });
  }
  await admin.aiPlatformControl.update({
    where: { id: "global" },
    data: { enabled: false, killSwitch: true, allowedProvider: null, allowedModel: null, allowedTenantKeys: [], maxRequestCostMicros: 0n },
  });
}

async function resetControl(over = {}) {
  await admin.aiPlatformControl.update({
    where: { id: "global" },
    data: {
      enabled: true,
      killSwitch: false,
      allowedProvider: PROVIDER,
      allowedModel: MODEL,
      allowedTenantKeys: tenants,
      maxRequestCostMicros: 250_000_000n,
      ...over,
    },
  });
}

/** Platform counters: limit = what is already used plus the headroom for this scenario. */
async function provisionPlatform(headroomMicros, headroomRequests) {
  for (const periodKey of periodKeys()) {
    const existing = await admin.aiPlatformBudgetPeriod.findUnique({ where: { periodKey } });
    const used = existing ? existing.reservedSpendMicros + existing.spentSpendMicros : 0n;
    const requests = existing ? existing.requestCount : 0;
    const data = {
      enabled: true,
      currency: "USD",
      spendLimitMicros: used + headroomMicros,
      requestLimit: requests + headroomRequests,
      ...windowFor(),
    };
    if (existing) {
      await admin.aiPlatformBudgetPeriod.update({ where: { periodKey }, data });
    } else {
      await admin.aiPlatformBudgetPeriod.create({ data: { periodKey, ...data } });
    }
  }
}

async function provisionTenant(tenantKey, opts = {}) {
  if (!tenants.includes(tenantKey)) {
    tenants.push(tenantKey);
  }
  // The sweeper and the audit reach tenants through the workspace directory (explicit tenant iteration), as they do for a
  // provisioned tenant in production. A tenant that is not in the directory is not visited.
  await admin.workspaceDirectory.upsert({
    where: { tenantKey },
    update: { isActive: true },
    create: { tenantKey, workspaceSlug: tenantKey.toLowerCase(), displayName: tenantKey },
  });
  const policyVersion = "v1";
  const existingPolicy = await admin.aiTenantPolicy.findFirst({ where: { tenantKey, capability: CAP, providerKey: PROVIDER, policyVersion } });
  const policyData = {
    status: "active",
    intelligenceEnabled: true,
    providerExecutionEnabled: true,
    killSwitchEnabled: false,
    tenantOptOut: false,
    maxPayloadBytes: 4096,
    allowedCapabilities: [CAP],
    allowedProviderKeys: [PROVIDER],
    redactionPolicyVersion: "r1",
    classificationPolicyHash: "sha256:test",
    approvedBy: "integration-test",
    approvedAt: new Date(),
    ...(opts.policy ?? {}),
  };
  if (existingPolicy) {
    await admin.aiTenantPolicy.update({ where: { id: existingPolicy.id }, data: policyData });
  } else {
    await admin.aiTenantPolicy.create({ data: { tenantKey, capability: CAP, providerKey: PROVIDER, policyVersion, ...policyData } });
  }
  for (const periodKey of periodKeys()) {
    const found = await admin.aiProviderBudgetPolicy.findFirst({
      where: { tenantKey, capability: CAP, providerKey: PROVIDER, executionMode: "live_provider", periodKey, policyVersion: "b1" },
    });
    const data = {
      enabled: true,
      currency: "USD",
      spendLimitMicros: opts.spendLimitMicros ?? 100n * E,
      requestLimit: opts.requestLimit ?? 1000,
      ...windowFor(),
    };
    if (found) {
      await admin.aiProviderBudgetPolicy.update({ where: { id: found.id }, data });
    } else {
      await admin.aiProviderBudgetPolicy.create({
        data: { tenantKey, capability: CAP, providerKey: PROVIDER, executionMode: "live_provider", periodKey, policyVersion: "b1", ...data },
      });
    }
  }
}

const input = (tenantKey, fingerprint, over = {}) => ({
  tenantKey,
  capability: CAP,
  providerKey: PROVIDER,
  modelKey: MODEL,
  requestFingerprint: `${RUN}:${fingerprint}`,
  requestedEstimatedCostMicros: E,
  ...over,
});

async function counterRows(tenantKey) {
  const d = control.now();
  const [tm, td, pm, pd] = await Promise.all([
    admin.aiProviderBudgetPolicy.findFirst({ where: { tenantKey, periodKey: gates.monthPeriodKey(d) } }),
    admin.aiProviderBudgetPolicy.findFirst({ where: { tenantKey, periodKey: gates.dayPeriodKey(d) } }),
    admin.aiPlatformBudgetPeriod.findUnique({ where: { periodKey: gates.monthPeriodKey(d) } }),
    admin.aiPlatformBudgetPeriod.findUnique({ where: { periodKey: gates.dayPeriodKey(d) } }),
  ]);
  return { tm, td, pm, pd };
}
const reservationCount = (tenantKey) => admin.aiProviderBudgetReservation.count({ where: { tenantKey } });
const statusOf = async (id) => (await admin.aiProviderBudgetReservation.findUnique({ where: { id } })).status;

/** Moves every non-terminal reservation of the run to a terminal state through the expiry path. */
async function drain() {
  const before = clock.offsetMs;
  clock.offsetMs = before + 3 * 3600 * 1000;
  for (const tenantKey of tenants) {
    await control.sweepExpired({ tenantKey, limit: 500 });
  }
  clock.offsetMs = before;
}

async function freshTenant(name, opts) {
  const tenantKey = `${PREFIX}${RUN}-${name}`;
  await provisionTenant(tenantKey, opts);
  await resetControl();
  return tenantKey;
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// ---------------------------------------------------------------------------------------------------------------
scenario("gates: every default denies, each gate fails alone, healthy request is allowed and charges four counters", async () => {
  const t = await freshTenant("gates");
  await provisionPlatform(50n * E, 100);

  state.flag = false;
  let r = await control.admit(input(t, "g-flag"));
  eq(r.denialReason, "platform_feature_disabled", "G0 off");
  state.flag = true;
  eq(await reservationCount(t), 0, "no reservation row from a G0 denial");

  await admin.aiPlatformControl.update({ where: { id: "global" }, data: { enabled: false, killSwitch: true, allowedProvider: null, allowedModel: null, allowedTenantKeys: [], maxRequestCostMicros: 0n } });
  r = await control.admit(input(t, "g-seeded"));
  eq(r.denialReason, "platform_kill_switch", "seeded default row denies");

  await resetControl({ enabled: false });
  eq((await control.admit(input(t, "g-disabled"))).denialReason, "platform_feature_disabled", "G1 disabled");
  await resetControl({ allowedTenantKeys: [] });
  eq((await control.admit(input(t, "g-allowlist"))).denialReason, "tenant_not_allowlisted", "G1 allowlist");
  await resetControl({ allowedModel: "other-model" });
  eq((await control.admit(input(t, "g-pin"))).denialReason, "provider_pin_mismatch", "G1 pin");
  await resetControl({ maxRequestCostMicros: E - 1n });
  eq((await control.admit(input(t, "g-cap"))).denialReason, "request_cost_exceeded", "G1 request cap");
  await resetControl();

  eq((await control.admit(input(t, "g-cap2", { capability: "product_specification_extraction" }))).denialReason, "capability_disallowed", "G3 live allow-list");
  eq((await control.admit(input(t, "g-mode", { executionMode: "fixture" }))).denialReason, "execution_mode_disabled", "mode");
  eq((await control.admit(input(t, "g-cur", { currency: "EUR" }))).denialReason, "invalid_request", "currency");
  eq((await control.admit(input(t, "g-zero", { requestedEstimatedCostMicros: 0 }))).denialReason, "invalid_request", "zero estimate");
  eq((await control.admit(input(t, "g-neg", { requestedEstimatedCostMicros: -5 }))).denialReason, "invalid_request", "negative estimate");
  eq((await control.admit(input(t, "g-att", { attemptNumber: 0 }))).denialReason, "invalid_request", "attempt 0");
  eq((await control.admit({ tenantKey: t })).denialReason, "invalid_request", "missing fields");

  await provisionTenant(t, { policy: { killSwitchEnabled: true } });
  eq((await control.admit(input(t, "g-tkill"))).denialReason, "tenant_provider_disabled", "G2 kill switch");
  await provisionTenant(t, { policy: { tenantOptOut: true } });
  eq((await control.admit(input(t, "g-opt"))).denialReason, "tenant_provider_disabled", "G2 opt-out");
  await provisionTenant(t, { policy: { approvedBy: null } });
  eq((await control.admit(input(t, "g-appr"))).denialReason, "invalid_tenant_policy", "G2 unapproved");
  await provisionTenant(t);

  await admin.aiProviderBudgetPolicy.updateMany({ where: { tenantKey: t, periodKey: { startsWith: "D:" } }, data: { enabled: false } });
  eq((await control.admit(input(t, "g-nobud"))).denialReason, "missing_budget_policy", "G4 tenant day row missing/disabled");
  await provisionTenant(t);

  const platformMonth = gates.monthPeriodKey(control.now());
  await admin.aiPlatformBudgetPeriod.update({ where: { periodKey: platformMonth }, data: { enabled: false } });
  eq((await control.admit(input(t, "g-plat"))).denialReason, "invalid_budget_policy", "G4 platform month disabled");
  await provisionPlatform(50n * E, 100);

  const unreadable = new (class extends TestControl {
    async loadPlatformControl() {
      throw new Error("db unreachable");
    }
  })(prisma, new IntelligenceCapabilityRegistry());
  eq((await unreadable.admit(input(t, "g-unread"))).denialReason, "control_unreadable", "unreadable control is DENY");

  eq(await reservationCount(t), 0, "no denial above created a reservation");
  const ok = await control.admit(input(t, "g-ok"));
  eq(ok.decision, "ALLOW", "healthy ALLOW");
  eq(ok.reservationStatus, "reserved", "status");
  eq(ok.reservedCostMicros, E.toString(), "reserved cost is a decimal string");
  const rows = await counterRows(t);
  for (const key of ["tm", "td", "pm", "pd"]) {
    eq(rows[key].reservedSpendMicros >= E, true, `${key} reserved`);
  }
  eq(rows.tm.reservedSpendMicros, E, "tenant month reserved");
  eq(rows.td.requestCount, 1, "tenant day request count");
  eq(await admin.aiProviderBudgetCharge.count({ where: { reservationId: ok.reservationId } }), 4, "four charges recorded");
  assert(typeof JSON.stringify(ok) === "string", "admission result is JSON serialisable");
});

scenario("money: limits and costs above 2^31 are stored and settled exactly as BIGINT", async () => {
  const big = 5_000_000_000n; // USD 5,000
  const t = await freshTenant("money", { spendLimitMicros: big * 2n });
  await resetControl({ maxRequestCostMicros: big });
  await provisionPlatform(big * 4n, 100);
  const a = await control.admit(input(t, "m-1", { requestedEstimatedCostMicros: (big - 7n).toString() }));
  eq(a.decision, "ALLOW", "admit above 2^31");
  const rows = await counterRows(t);
  eq(rows.tm.reservedSpendMicros, big - 7n, "reserved above 2^31");
  assert(rows.tm.reservedSpendMicros > 2147483647n, "value really exceeds a 32-bit integer");
  const claim = await control.claim({ tenantKey: t, reservationId: a.reservationId });
  const settled = await control.settle({ tenantKey: t, reservationId: a.reservationId, claimToken: claim.claimToken }, { kind: "reconcile", actualCostMicros: (big - 9n).toString() });
  eq(settled.settledCostMicros, (big - 9n).toString(), "settled is a string");
  eq((await counterRows(t)).tm.spentSpendMicros, big - 9n, "spent above 2^31");
  let threw = false;
  try {
    await admin.aiProviderBudgetPolicy.updateMany({ where: { tenantKey: t }, data: { spendLimitMicros: 1_000_000_000_001n } });
  } catch {
    threw = true;
  }
  assert(threw, "the database rejects a limit above the sanity ceiling");
  const exec = await admin.aiExecution.create({
    data: {
      tenantKey: t, capability: CAP, entityType: "product", entityId: "p", sourceVersion: 1, sourceHash: "h", requestFingerprint: "f", promptVersion: "p", schemaVersion: "s",
      idempotencyFingerprint: `${RUN}-exec-big`, estimatedCostMicros: 9_000_000_000n, actualCostMicros: 8_000_000_000n,
    },
  });
  eq((await admin.aiExecution.findUnique({ where: { id: exec.id } })).estimatedCostMicros, 9_000_000_000n, "ai_executions BIGINT round trip");
  await admin.aiExecution.delete({ where: { id: exec.id } });
});

scenario("atomicity: concurrent admissions never exceed a counter (spend, request limit, platform), at exact boundaries", async () => {
  // spend boundary: fits exactly K
  const K = 4;
  const N = 14;
  let t = await freshTenant("atomic-spend", { spendLimitMicros: BigInt(K) * E });
  await provisionPlatform(1000n * E, 1000);
  let results = await Promise.all(Array.from({ length: N }, (_, i) => control.admit(input(t, `a-spend-${i}`))));
  eq(results.filter((r) => r.allowed).length, K, "exactly K admitted under concurrency");
  eq(results.filter((r) => r.denialReason === "budget_exhausted").length, N - K, "the rest denied as budget_exhausted");
  let rows = await counterRows(t);
  eq(rows.tm.reservedSpendMicros, BigInt(K) * E, "tenant month reserved equals K x estimate");
  eq(rows.td.reservedSpendMicros, BigInt(K) * E, "tenant day reserved equals K x estimate");
  eq(rows.tm.requestCount, K, "request count equals K");
  eq(await admin.aiProviderBudgetReservation.count({ where: { tenantKey: t, status: "budget_blocked" } }), N - K, "blocked attempts are recorded");
  eq(await admin.aiProviderBudgetCharge.count({ where: { tenantKey: t } }), K * 4, "no charge rows leaked from rolled-back admissions");

  // one micro below the boundary fits K-1
  t = await freshTenant("atomic-minus-one", { spendLimitMicros: BigInt(K) * E - 1n });
  results = await Promise.all(Array.from({ length: N }, (_, i) => control.admit(input(t, `a-minus-${i}`))));
  eq(results.filter((r) => r.allowed).length, K - 1, "one micro under the boundary fits K-1");

  // request-count boundary
  t = await freshTenant("atomic-requests", { requestLimit: 3 });
  results = await Promise.all(Array.from({ length: 9 }, (_, i) => control.admit(input(t, `a-req-${i}`, { requestedEstimatedCostMicros: 1 }))));
  eq(results.filter((r) => r.allowed).length, 3, "request_limit boundary");

  // platform boundary across two tenants, with tenant budgets that would otherwise fit everything
  const a = await freshTenant("atomic-plat-a");
  const b = await freshTenant("atomic-plat-b");
  await provisionPlatform(3n * E, 1000);
  const before = { a: await counterRows(a), b: await counterRows(b) };
  results = await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => control.admit(input(a, `a-plat-a-${i}`))),
    ...Array.from({ length: 5 }, (_, i) => control.admit(input(b, `a-plat-b-${i}`))),
  ]);
  eq(results.filter((r) => r.allowed).length, 3, "platform ceiling is exact across tenants");
  const after = { a: await counterRows(a), b: await counterRows(b) };
  const allowedA = results.slice(0, 5).filter((r) => r.allowed).length;
  const allowedB = results.slice(5).filter((r) => r.allowed).length;
  eq(after.a.tm.reservedSpendMicros - before.a.tm.reservedSpendMicros, BigInt(allowedA) * E, "tenant A counter matches what was admitted (rollback leaked nothing)");
  eq(after.b.tm.reservedSpendMicros - before.b.tm.reservedSpendMicros, BigInt(allowedB) * E, "tenant B counter matches what was admitted");
  await drain();
});

scenario("idempotency and claim: duplicate admission shares one reservation, and exactly one claimant wins", async () => {
  const t = await freshTenant("claim");
  await provisionPlatform(100n * E, 1000);
  const same = await Promise.all(Array.from({ length: 6 }, () => control.admit(input(t, "c-same"))));
  assert(same.every((r) => r.allowed), "duplicate admissions are all ALLOW while unclaimed");
  eq(new Set(same.map((r) => r.reservationId)).size, 1, "one reservation id");
  eq(await reservationCount(t), 1, "one reservation row");
  eq((await counterRows(t)).tm.reservedSpendMicros, E, "charged once");

  const claims = await Promise.all(Array.from({ length: 8 }, () => control.claim({ tenantKey: t, reservationId: same[0].reservationId })));
  eq(claims.filter((c) => c.claimed).length, 1, "exactly one claim wins");
  assert(claims.filter((c) => !c.claimed).every((c) => c.reason === "duplicate_in_flight"), "losers report duplicate_in_flight");

  const again = await control.admit(input(t, "c-same"));
  eq(again.denialReason, "reservation_in_flight", "admission after a claim is not a second ALLOW");

  // attempts are separate reservations; a settled attempt is not reusable
  const winner = claims.find((c) => c.claimed);
  await control.settle({ tenantKey: t, reservationId: same[0].reservationId, claimToken: winner.claimToken }, { kind: "reconcile", actualCostMicros: 1 });
  eq((await control.admit(input(t, "c-same"))).denialReason, "reservation_settled", "settled attempt is not re-admitted");
  const next = await control.admit(input(t, "c-same", { attemptNumber: 2 }));
  eq(next.decision, "ALLOW", "a new attempt gets its own reservation");
  assert(next.reservationId !== same[0].reservationId, "different reservation");
  await drain();
});

scenario("lifecycle: every transition has the exact counter effect and settles exactly once", async () => {
  const t = await freshTenant("life");
  await provisionPlatform(100n * E, 1000);
  const snap = async () => {
    const r = await counterRows(t);
    return { res: r.tm.reservedSpendMicros, spent: r.tm.spentSpendMicros, req: r.tm.requestCount, pres: r.pm.reservedSpendMicros, pspent: r.pm.spentSpendMicros };
  };
  const start = await snap();
  const admitClaim = async (fp) => {
    const a = await control.admit(input(t, fp));
    assert(a.allowed, `admit ${fp}`);
    const c = await control.claim({ tenantKey: t, reservationId: a.reservationId });
    return { a, c, ref: { tenantKey: t, reservationId: a.reservationId, claimToken: c.claimToken } };
  };

  // reconcile below the estimate
  let x = await admitClaim("l-rec");
  let s = await control.settle(x.ref, { kind: "reconcile", actualCostMicros: 400_000 });
  eq(s.applied, true, "reconcile applied");
  eq(s.overrun, false, "no overrun");
  let now = await snap();
  eq(now.res - start.res, 0n, "reservation released");
  eq(now.spent - start.spent, 400_000n, "spent equals actual");
  eq(now.req - start.req, 1, "request stays counted after a call");
  eq(now.pspent - start.pspent, 400_000n, "platform counter settled the same");
  // duplicate reconcile is a no-op; a different actual is flagged, never applied
  s = await control.settle(x.ref, { kind: "reconcile", actualCostMicros: 400_000 });
  eq(s.applied, false, "duplicate reconcile is a no-op");
  eq(s.reconcileConflict, false, "same actual is not a conflict");
  s = await control.settle(x.ref, { kind: "reconcile", actualCostMicros: 999_999 });
  eq(s.reconcileConflict, true, "a different actual is flagged");
  eq((await snap()).spent - start.spent, 400_000n, "conflict never changed counters");

  // overrun is recorded in full
  x = await admitClaim("l-over");
  s = await control.settle(x.ref, { kind: "reconcile", actualCostMicros: 1_500_000 });
  eq(s.overrun, true, "overrun flagged");
  eq((await snap()).spent - start.spent, 400_000n + 1_500_000n, "overrun is real spend and is recorded in full");

  // cancel after dispatch (confirmed non-billable) releases the request count too
  let before = await snap();
  x = await admitClaim("l-cancel-dispatched");
  s = await control.settle(x.ref, { kind: "cancel", reason: "confirmed_non_billable" });
  eq(s.status, "cancelled", "cancelled");
  let after = await snap();
  eq(after.res, before.res, "released");
  eq(after.spent, before.spent, "no spend");
  eq(after.req, before.req, "request count released");

  // cancel before dispatch (unclaimed)
  const a = await control.admit(input(t, "l-cancel-unclaimed"));
  s = await control.settle({ tenantKey: t, reservationId: a.reservationId }, { kind: "cancel", reason: "operator" });
  eq(s.applied, true, "unclaimed cancel by the system path");
  eq((await snap()).res, before.res, "released");

  // unknown billing settles at the estimate
  before = await snap();
  x = await admitClaim("l-expire");
  s = await control.settle(x.ref, { kind: "expire_unknown_billing", reason: "timeout" });
  eq(s.status, "expired", "expired");
  after = await snap();
  eq(after.spent - before.spent, E, "settled at the estimate");
  eq(after.res, before.res, "released");
  eq(after.req - before.req, 1, "counted");

  // wrong claim token cannot settle
  x = await admitClaim("l-token");
  s = await control.settle({ ...x.ref, claimToken: "not-the-token" }, { kind: "reconcile", actualCostMicros: 1 });
  eq(s.applied, false, "stale or wrong token refused");
  s = await control.settle({ tenantKey: t, reservationId: x.a.reservationId }, { kind: "reconcile", actualCostMicros: 1 });
  eq(s.applied, false, "missing token refused for a dispatching reservation");
  eq(await statusOf(x.a.reservationId), "dispatching", "still dispatching");
  await control.settle(x.ref, { kind: "cancel", reason: "cleanup" });

  // forbidden transitions: nothing leaves a terminal state or skips the claim
  const reconciled = (await admitClaim("l-forbid"));
  await control.settle(reconciled.ref, { kind: "reconcile", actualCostMicros: 10 });
  const frozen = await snap();
  eq((await control.settle(reconciled.ref, { kind: "cancel", reason: "x" })).applied, false, "reconciled -> cancelled forbidden");
  eq((await control.settle(reconciled.ref, { kind: "expire_unknown_billing", reason: "x" })).applied, false, "reconciled -> expired forbidden");
  eq((await control.claim({ tenantKey: t, reservationId: reconciled.a.reservationId })).claimed, false, "reconciled -> dispatching forbidden");
  const cancelled = await control.admit(input(t, "l-forbid2"));
  await control.settle({ tenantKey: t, reservationId: cancelled.reservationId }, { kind: "cancel", reason: "x" });
  eq((await control.claim({ tenantKey: t, reservationId: cancelled.reservationId })).claimed, false, "cancelled -> dispatching forbidden");
  eq((await control.settle({ tenantKey: t, reservationId: cancelled.reservationId, claimToken: "t" }, { kind: "reconcile", actualCostMicros: 1 })).applied, false, "cancelled -> reconciled forbidden");
  const neverClaimed = await control.admit(input(t, "l-forbid3"));
  eq((await control.settle({ tenantKey: t, reservationId: neverClaimed.reservationId, claimToken: "t" }, { kind: "reconcile", actualCostMicros: 1 })).applied, false, "reserved -> reconciled (no claim) forbidden");
  eq((await control.settle({ tenantKey: t, reservationId: neverClaimed.reservationId }, { kind: "expire_unknown_billing", reason: "x" })).applied, false, "reserved -> expired forbidden");
  eq(await statusOf(neverClaimed.reservationId), "reserved", "still reserved");
  await control.settle({ tenantKey: t, reservationId: neverClaimed.reservationId }, { kind: "cancel", reason: "cleanup" });
  const after2 = await snap();
  eq(after2.spent, frozen.spent, "forbidden transitions changed no spend");

  // concurrent settlement is exactly once
  x = await admitClaim("l-concurrent");
  before = await snap();
  const settles = await Promise.all(Array.from({ length: 8 }, () => control.settle(x.ref, { kind: "reconcile", actualCostMicros: 250_000 })));
  eq(settles.filter((r) => r.applied).length, 1, "exactly one concurrent settle applies");
  after = await snap();
  eq(after.spent - before.spent, 250_000n, "spent applied once");
  eq(after.res - before.res, -E, "released once");
  await drain();
});

scenario("recovery: leases expire, sweepers are idempotent and concurrent-safe, late results are discarded", async () => {
  const t = await freshTenant("recover", { spendLimitMicros: 2n * E });
  await provisionPlatform(100n * E, 1000);

  // unclaimed TTL: cancelled and released, and the freed budget is usable by the next admission (sweep on admit)
  const a1 = await control.admit(input(t, "r-1"));
  const a2 = await control.admit(input(t, "r-2"));
  assert(a1.allowed && a2.allowed, "two fit");
  eq((await control.admit(input(t, "r-3"))).denialReason, "budget_exhausted", "third does not fit");
  clock.offsetMs += gates.UNCLAIMED_RESERVATION_TTL_MS + 1000;
  await provisionTenant(t, { spendLimitMicros: 2n * E });
  await provisionPlatform(100n * E, 1000);
  const afterTtl = await control.admit(input(t, "r-4"));
  eq(afterTtl.decision, "ALLOW", "admission sweeps expired reservations first, freeing budget");
  eq(await statusOf(a1.reservationId), "cancelled", "unclaimed reservation cancelled by TTL");
  eq(await statusOf(a2.reservationId), "cancelled", "second one too");
  eq((await counterRows(t)).tm.requestCount, 1, "request counts released for never-dispatched reservations");

  // dispatching lease: expired and settled at the estimate
  const d = await control.admit(input(t, "r-5"));
  const claim = await control.claim({ tenantKey: t, reservationId: d.reservationId });
  assert(claim.claimed, "claimed");
  const spentBefore = (await counterRows(t)).tm.spentSpendMicros;
  clock.offsetMs += gates.DISPATCH_LEASE_MS + 1000;
  const sweeps = await Promise.all(Array.from({ length: 5 }, () => control.sweepExpired({ tenantKey: t })));
  eq(sweeps.reduce((n, s) => n + s.expiredDispatching, 0), 1, "five concurrent sweepers expire it exactly once");
  eq(await statusOf(d.reservationId), "expired", "expired");
  eq((await counterRows(t)).tm.spentSpendMicros - spentBefore, E, "settled at the estimate");
  const late = await control.settle({ tenantKey: t, reservationId: d.reservationId, claimToken: claim.claimToken }, { kind: "reconcile", actualCostMicros: 1 });
  eq(late.applied, false, "a late result cannot settle an expired reservation");
  eq(late.status, "expired", "state stays expired");

  // a sweeper over everything is idempotent
  const again = await control.sweepExpired({ tenantKey: t });
  eq(again.cancelledUnclaimed + again.expiredDispatching, 0, "second sweep finds nothing");

  // the scheduled maintenance service finds work across tenants
  const t2 = await freshTenant("recover-b");
  await provisionPlatform(100n * E, 1000);
  const m = await control.admit(input(t2, "r-m"));
  assert(m.allowed, "admitted");
  clock.offsetMs += gates.UNCLAIMED_RESERVATION_TTL_MS + 1000;
  const summary = await maintenance.runSweep({ now: control.now() });
  assert(summary.tenants >= 1 && summary.cancelledUnclaimed >= 1, "maintenance sweep processed the tenant");
  eq(await statusOf(m.reservationId), "cancelled", "cancelled by the scheduled sweeper");
  clock.offsetMs = 0;
  await drain();
});

scenario("pre-dispatch re-validation and the guarded run: every mutable control is re-read, nothing is trusted from admission", async () => {
  const t = await freshTenant("reval");
  await provisionPlatform(100n * E, 1000);
  const claimed = async (fp) => {
    const a = await control.admit(input(t, fp));
    const c = await control.claim({ tenantKey: t, reservationId: a.reservationId });
    return { a, c, ctx: { tenantKey: t, reservationId: a.reservationId, claimToken: c.claimToken, capability: CAP, providerKey: PROVIDER, modelKey: MODEL } };
  };
  const release = (x) => control.settle({ tenantKey: t, reservationId: x.a.reservationId, claimToken: x.c.claimToken }, { kind: "cancel", reason: "test" });

  let x = await claimed("v-ok");
  eq((await control.revalidateBeforeDispatch(x.ctx)).ok, true, "healthy re-validation passes");
  await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true } });
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "platform_kill_switch", "platform kill switch seen");
  await resetControl({ allowedModel: "swapped-model" });
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "provider_pin_mismatch", "provider/model pin re-checked");
  await resetControl({ allowedTenantKeys: [] });
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "tenant_not_allowlisted", "allowlist re-checked");
  await resetControl();
  await provisionTenant(t, { policy: { killSwitchEnabled: true } });
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "tenant_provider_disabled", "tenant enablement re-checked");
  await provisionTenant(t);
  await admin.aiProviderBudgetPolicy.updateMany({ where: { tenantKey: t }, data: { enabled: false } });
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "invalid_budget_policy", "budget policy re-checked");
  await provisionTenant(t);
  eq((await control.revalidateBeforeDispatch({ ...x.ctx, claimToken: "other" })).reason, "reservation_in_flight", "claim token re-checked");
  state.flag = false;
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "platform_feature_disabled", "deploy flag re-checked");
  state.flag = true;
  clock.offsetMs += gates.DISPATCH_LEASE_MS - gates.PROVIDER_TIMEOUT_MS + 5000;
  eq((await control.revalidateBeforeDispatch(x.ctx)).reason, "reservation_in_flight", "a lease too short for the timeout is refused");
  clock.offsetMs = 0;
  await release(x);

  // guarded run: kill between admission and dispatch cancels and releases, and the work never runs
  const flipAfterClaim = new (class extends TestControl {
    async claim(ref) {
      const result = await super.claim(ref);
      await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true } });
      return result;
    }
  })(prisma, new IntelligenceCapabilityRegistry());
  let workRan = false;
  let before = await counterRows(t);
  let r = await flipAfterClaim.runWithReservation(input(t, "v-kill-before"), async () => {
    workRan = true;
    return { billing: { kind: "unknown" } };
  });
  eq(r.status, "provider_disabled", "kill before dispatch");
  eq(workRan, false, "work did not run");
  eq((await counterRows(t)).tm.reservedSpendMicros, before.tm.reservedSpendMicros, "reservation released");
  const killed = await admin.aiProviderBudgetReservation.findFirst({ where: { tenantKey: t, requestFingerprint: `${RUN}:v-kill-before` } });
  eq(killed.status, "cancelled", "the failed re-check leaves the reservation cancelled, never dispatching");
  await resetControl();
  eq((await control.claim({ tenantKey: t, reservationId: killed.id })).claimed, false, "no later claim is possible, so no future dispatch is possible");
  eq((await control.admit(input(t, "v-kill-before"))).denialReason, "reservation_settled", "the same attempt cannot be admitted again");
  const frozenKilled = await counterRows(t);
  for (let i = 0; i < 3; i += 1) {
    await control.settle({ tenantKey: t, reservationId: killed.id }, { kind: "cancel", reason: "again" });
    await control.settle({ tenantKey: t, reservationId: killed.id, claimToken: killed.claimToken ?? "x" }, { kind: "reconcile", actualCostMicros: 1 });
    await control.sweepExpired({ tenantKey: t });
  }
  const afterRepeat = await counterRows(t);
  for (const key of ["tm", "td", "pm", "pd"]) {
    eq(
      [afterRepeat[key].reservedSpendMicros, afterRepeat[key].spentSpendMicros, afterRepeat[key].requestCount],
      [frozenKilled[key].reservedSpendMicros, frozenKilled[key].spentSpendMicros, frozenKilled[key].requestCount],
      `repeated settle and sweep attempts changed ${key} counters`,
    );
  }

  // even if the cancel itself fails after a failed re-check, the work never runs, nothing else can claim the
  // reservation, and the lease expiry settles it conservatively at the estimate
  const failingCancel = new (class extends TestControl {
    async claim(ref) {
      const result = await super.claim(ref);
      await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true } });
      return result;
    }
    async settle(ref, settlement) {
      if (settlement.kind === "cancel" && String(settlement.reason).startsWith("revalidation_")) {
        throw new Error("database unavailable");
      }
      return super.settle(ref, settlement);
    }
  })(prisma, new IntelligenceCapabilityRegistry());
  let ranAgain = false;
  const spentBeforeStuck = (await counterRows(t)).tm.spentSpendMicros;
  let threw = false;
  try {
    await failingCancel.runWithReservation(input(t, "v-kill-stuck"), async () => {
      ranAgain = true;
      return { billing: { kind: "unknown" } };
    });
  } catch {
    threw = true;
  }
  assert(threw, "a failed cancel surfaces instead of being swallowed");
  eq(ranAgain, false, "the work did not run");
  const stuck = await admin.aiProviderBudgetReservation.findFirst({ where: { tenantKey: t, requestFingerprint: `${RUN}:v-kill-stuck` } });
  eq(stuck.status, "dispatching", "left claimed, so nothing else can dispatch it");
  await resetControl();
  eq((await control.claim({ tenantKey: t, reservationId: stuck.id })).reason, "duplicate_in_flight", "no second dispatcher");
  clock.offsetMs += gates.DISPATCH_LEASE_MS + 1000;
  await control.sweepExpired({ tenantKey: t });
  eq(await statusOf(stuck.id), "expired", "the lease expiry settles it");
  eq((await counterRows(t)).tm.spentSpendMicros - spentBeforeStuck, E, "conservatively, at the estimate");
  clock.offsetMs = 0;
  await provisionTenant(t);
  await provisionPlatform(100n * E, 1000);
  await resetControl();

  // guarded run: kill during the call discards the result and reconciles actual usage
  before = await counterRows(t);
  r = await control.runWithReservation(input(t, "v-kill-during"), async () => {
    await admin.aiPlatformControl.update({ where: { id: "global" }, data: { killSwitch: true } });
    return { billing: { kind: "usage", actualCostMicros: 300_000 }, value: "output" };
  });
  eq(r.status, "result_discarded", "kill during the call");
  eq(r.reason, "kill_switch_during_call", "reason");
  assert(!("value" in r), "the result value is not returned");
  eq((await counterRows(t)).tm.spentSpendMicros - before.tm.spentSpendMicros, 300_000n, "actual usage still reconciled");
  await resetControl();

  // guarded run outcomes by billing
  r = await control.runWithReservation(input(t, "v-usage"), async () => ({ billing: { kind: "usage", actualCostMicros: 123 }, value: 42 }));
  eq(r.status, "completed", "completed");
  eq(r.value, 42, "value passed through");
  eq(r.settlement.status, "reconciled", "usage reconciles");
  r = await control.runWithReservation(input(t, "v-nonbill"), async () => ({ billing: { kind: "confirmed_non_billable" } }));
  eq(r.settlement.status, "cancelled", "confirmed non-billable releases");
  r = await control.runWithReservation(input(t, "v-unknown"), async () => ({ billing: { kind: "unknown" } }));
  eq(r.settlement.status, "expired", "unknown billing settles conservatively");
  eq(r.settlement.settledCostMicros, E.toString(), "at the estimate");
  r = await control.runWithReservation(input(t, "v-throw"), async () => {
    throw new Error("secret provider detail that must not leak");
  });
  eq(r.status, "work_threw", "work threw");
  eq(r.settlement.status, "expired", "a throw settles conservatively");
  assert(!JSON.stringify(r).includes("secret provider detail"), "no raw error text leaves the run");
  r = await control.runWithReservation(input(t, "v-late"), async () => {
    clock.offsetMs += gates.DISPATCH_LEASE_MS + 5000;
    await control.sweepExpired({ tenantKey: t });
    return { billing: { kind: "usage", actualCostMicros: 1 }, value: "late" };
  });
  eq(r.status, "result_discarded", "late result");
  eq(r.reason, "late_result", "late reason");
  clock.offsetMs = 0;
  await provisionTenant(t);
  await provisionPlatform(100n * E, 1000);
  r = await control.runWithReservation(input(t, "v-denied"), async () => ({ billing: { kind: "unknown" } }));
  assert(r.status === "completed", "healthy run after the control state is restored");
  state.flag = false;
  r = await control.runWithReservation(input(t, "v-flag"), async () => {
    throw new Error("must not run");
  });
  eq(r.status, "denied", "flag off denies the run");
  state.flag = true;
  await drain();
});

scenario("isolation: another tenant cannot claim, settle or affect a reservation", async () => {
  const a = await freshTenant("iso-a");
  const b = await freshTenant("iso-b");
  await provisionPlatform(100n * E, 1000);
  const r = await control.admit(input(a, "i-1"));
  eq((await control.claim({ tenantKey: b, reservationId: r.reservationId })).reason, "not_found", "B cannot claim A's reservation");
  eq((await control.settle({ tenantKey: b, reservationId: r.reservationId }, { kind: "cancel", reason: "x" })).status, "not_found", "B cannot settle A's reservation");
  eq(await statusOf(r.reservationId), "reserved", "A's reservation untouched");
  eq((await counterRows(b)).tm.reservedSpendMicros, 0n, "B's counters untouched");
  await control.settle({ tenantKey: a, reservationId: r.reservationId }, { kind: "cancel", reason: "cleanup" });
});

scenario("rls: the services run as a role subject to forced RLS, and the sweeper and the audit reach every tenant by explicit tenant iteration", async () => {
  const [flags] = await prisma.tenant("default").$queryRaw`SELECT rolsuper, rolbypassrls, current_user AS name FROM pg_roles WHERE rolname = current_user`;
  eq([flags.rolsuper, flags.rolbypassrls, flags.name], [false, false, APP_ROLE], "the application role is neither superuser nor BYPASSRLS");
  const [owner] = await admin.$queryRaw`SELECT tableowner FROM pg_tables WHERE tablename = 'ai_provider_budget_reservations'`;
  assert(owner.tableowner !== APP_ROLE, "the application role does not own the table");
  const [forced] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'ai_provider_budget_reservations'`;
  eq([forced.relrowsecurity, forced.relforcerowsecurity], [true, true], "RLS is enabled and forced on reservations");

  const a = await freshTenant("rls-a");
  const b = await freshTenant("rls-b");
  await provisionPlatform(100n * E, 1000);
  const ra = await control.admit(input(a, "rls-1"));
  const rb = await control.admit(input(b, "rls-2"));
  assert(ra.allowed && rb.allowed, "both tenants admitted under the restricted role");
  clock.offsetMs += gates.UNCLAIMED_RESERVATION_TTL_MS + 1000;

  // A role with no tenant context cannot see another tenant's reservations at all; this is why a global scan is silent.
  eq(await roleDirect.aiProviderBudgetReservation.count({ where: { tenantKey: { startsWith: PREFIX } } }), 0, "with no tenant context, no tenant's reservations are visible");

  // The scheduled sweeper reaches every tenant by explicit tenant iteration and settles each tenant's work through that
  // tenant's own scoped client. A non-default tenant must produce a non-empty result: a sweeper that visited only the
  // default tenant would report no error and sweep nothing.
  const summary = await maintenance.runSweep({ now: control.now() });
  assert(summary.tenants >= 2 && summary.cancelledUnclaimed >= 2, `the scheduled sweeper processed both tenants under RLS (${JSON.stringify(summary)})`);
  eq(summary.tenantsFailed, 0, "no tenant failed to be read or swept");
  assert(summary.tenantsEvaluated >= 3, `every directory tenant plus the default tenant was evaluated (${JSON.stringify(summary)})`);
  eq(await statusOf(ra.reservationId), "cancelled", "tenant A swept");
  eq(await statusOf(rb.reservationId), "cancelled", "tenant B swept");
  eq(await maintenance.auditCounters(), [], "the audit works under RLS and is clean");
  clock.offsetMs = 0;
  await drain();
});

scenario("integrity: the counter audit is clean after a randomised concurrent workload, and detects injected drift", async () => {
  const names = ["fuzz-a", "fuzz-b", "fuzz-c"];
  const ts = [];
  for (const n of names) {
    ts.push(await freshTenant(n, { spendLimitMicros: 12n * E }));
  }
  await provisionPlatform(30n * E, 1000);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const worker = async (id) => {
    for (let i = 0; i < 14; i += 1) {
      const t = ts[Math.floor(rand() * ts.length)];
      const a = await control.admit(input(t, `f-${id}-${i}`, { requestedEstimatedCostMicros: 200_000 + Math.floor(rand() * 800_000) }));
      if (!a.allowed) {
        continue;
      }
      const roll = rand();
      if (roll < 0.15) {
        continue; // abandoned: left for the TTL sweep
      }
      const c = await control.claim({ tenantKey: t, reservationId: a.reservationId });
      if (!c.claimed) {
        continue;
      }
      const ref = { tenantKey: t, reservationId: a.reservationId, claimToken: c.claimToken };
      if (roll < 0.55) {
        await control.settle(ref, { kind: "reconcile", actualCostMicros: Math.floor(rand() * 1_100_000) });
      } else if (roll < 0.7) {
        await control.settle(ref, { kind: "cancel", reason: "fuzz" });
      } else if (roll < 0.85) {
        await control.settle(ref, { kind: "expire_unknown_billing", reason: "fuzz" });
      } // else left dispatching for the lease sweep
    }
  };
  await Promise.all(Array.from({ length: 6 }, (_, i) => worker(i)));
  eq(await maintenance.auditCounters(), [], "audit is clean mid-run, with reservations still in flight");
  await drain();
  eq(await maintenance.auditCounters(), [], "audit is clean after everything is settled");
  const t = ts[ts.length - 1];
  const rows = await counterRows(t);
  await admin.aiProviderBudgetPolicy.update({ where: { id: rows.tm.id }, data: { reservedSpendMicros: { increment: 7 } } });
  const drift = await maintenance.auditCounters();
  assert(drift.some((d) => d.counterRowId === rows.tm.id && d.field === "reserved" && d.recorded !== d.expected), "injected drift is reported");
  await admin.aiProviderBudgetPolicy.update({ where: { id: rows.tm.id }, data: { reservedSpendMicros: { decrement: 7 } } });
  eq(await maintenance.auditCounters(), [], "clean again after the fix");

  // A platform counter is the sum of EVERY tenant's charges, so the audit adds each tenant's share. Drift on the platform
  // counter must be reported, and so must a platform counter that is correct for one tenant but not for the sum.
  await admin.aiPlatformBudgetPeriod.update({ where: { id: rows.pm.id }, data: { reservedSpendMicros: { increment: 11 } } });
  const platformDrift = await maintenance.auditCounters();
  assert(
    platformDrift.some((d) => d.counterRowId === rows.pm.id && d.field === "reserved" && d.recorded !== d.expected),
    "injected platform counter drift is reported",
  );
  await admin.aiPlatformBudgetPeriod.update({ where: { id: rows.pm.id }, data: { reservedSpendMicros: { decrement: 11 } } });
  eq(await maintenance.auditCounters(), [], "clean again after the platform fix");
});

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const [productsBefore, suggestionsBefore] = await Promise.all([admin.product.count(), admin.aiSuggestion.count()]);
  // CI starts from a freshly migrated database, so the seeded state is asserted strictly. A developer machine may hold
  // leftovers from an interrupted run: there the state is reset and the seeded-state checks are skipped.
  const strict = String(process.env.CI ?? "").toLowerCase() === "true";
  const leftovers = await admin.aiProviderBudgetReservation.count({ where: { tenantKey: { startsWith: PREFIX } } });
  const savedControl = await admin.aiPlatformControl.findUnique({ where: { id: "global" } });
  assert(savedControl, "seeded platform control row exists");
  const seededDeny =
    savedControl.enabled === false && savedControl.killSwitch === true && savedControl.allowedTenantKeys.length === 0 && savedControl.maxRequestCostMicros === 0n;
  const periodRows = await admin.aiPlatformBudgetPeriod.count();
  if (strict || (leftovers === 0 && seededDeny && periodRows === 0)) {
    assert(seededDeny, "the seeded platform control row is deny-all: disabled, kill switch on, no tenant, request cap zero");
    eq(periodRows, 0, "no platform budget rows are seeded");
  } else {
    console.log("dirty local database from an interrupted run: resetting, seeded-state checks skipped");
    await fullReset();
  }
  await admin.$executeRawUnsafe(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$`,
  );
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ai_provider_budget_policies, ai_provider_budget_reservations, ai_provider_budget_charges, ai_tenant_policies, ai_platform_controls, ai_platform_budget_periods TO ${APP_ROLE}`,
  );
  // Tenant iteration lists tenants from the workspace directory; the production runtime role holds this table in the I1 manifest.
  await admin.$executeRawUnsafe(`GRANT SELECT ON "WorkspaceDirectory" TO ${APP_ROLE}`);
  process.env.DATABASE_URL_POOLED = roleUrl();
  process.env.DATABASE_URL_DIRECT = roleUrl();
  prisma = new PrismaService();
  directService = new PrismaDirectService();
  roleDirect = new PrismaClient({ datasources: { db: { url: roleUrl() } } });
  control = new TestControl(prisma, new IntelligenceCapabilityRegistry());
  maintenance = new IntelligenceReservationMaintenanceService(directService, control);
  let failed = 0;
  for (const { name, fn } of scenarios) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}\n  ${error && error.stack ? error.stack : error}`);
    }
  }
  try {
    await drain();
    const finalAudit = await maintenance.auditCounters();
    if (finalAudit.length > 0) {
      failed += 1;
      console.error("FAIL final counter audit reported drift", finalAudit);
    } else {
      console.log("PASS final counter audit is clean");
    }
    const [productsAfter, suggestionsAfter] = await Promise.all([admin.product.count(), admin.aiSuggestion.count()]);
    if (productsAfter !== productsBefore || suggestionsAfter !== suggestionsBefore) {
      failed += 1;
      console.error("FAIL control plane changed Product or AiSuggestion rows");
    } else {
      console.log("PASS zero Product and AiSuggestion writes");
    }
  } finally {
    await fullReset();
    await prisma.onModuleDestroy();
    await directService.onModuleDestroy();
    await roleDirect.$disconnect();
    await admin.$executeRawUnsafe(`DROP OWNED BY ${APP_ROLE}`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP_ROLE}`);
    await admin.$disconnect();
  }
  if (failed > 0) {
    console.error(`${failed} AI provider budget lifecycle check(s) failed.`);
    process.exit(1);
  }
  console.log("AI provider budget lifecycle integration test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
