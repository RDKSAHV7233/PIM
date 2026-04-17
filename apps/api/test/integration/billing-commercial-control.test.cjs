#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  const databaseUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for billing commercial control integration test.");
  }

  const runId = Date.now().toString();
  const apiPort = 6100 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `billing-commercial-${runId}`;
  const workspaceSlug = `bc-${runId}`.slice(0, 24);
  const adminUser = `admin-${runId}`;
  const legacyTenantId = `billing-commercial-legacy-${runId}`;
  const legacyWorkspaceSlug = `bcl-${runId}`.slice(0, 24);
  const legacyAdminUser = `legacy-admin-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
      [legacyAdminUser]: { tenantId: legacyTenantId, role: "admin", workspaceSlug: legacyWorkspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Billing Commercial Control" },
      [legacyWorkspaceSlug]: { tenantId: legacyTenantId, displayName: "Legacy Billing Bootstrap" },
    }),
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const adminToken = String(login.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const tenantMutationBlocked = await apiRequest(baseUrl, "POST", "/billing/plan-tier", adminToken, {
      planTier: "ENTERPRISE",
    });
    assertStatus(tenantMutationBlocked, 403, "tenant billing mutation blocked");
    assert(
      String(tenantMutationBlocked.payload?.error ?? "") === "COMMERCIAL_MUTATION_INTERNAL_ONLY",
      "expected COMMERCIAL_MUTATION_INTERNAL_ONLY",
    );

    const missingToken = await apiRequest(baseUrl, "POST", "/billing/internal/plan-tier", null, {
      tenantKey: tenantId,
      planTier: "GROWTH",
    });
    assertStatus(missingToken, 401, "internal billing mutation requires token");
    assert(
      String(missingToken.payload?.error ?? "") === "COMMERCIAL_OPS_TOKEN_REQUIRED",
      "expected COMMERCIAL_OPS_TOKEN_REQUIRED",
    );

    const missingOperator = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      null,
      { tenantKey: tenantId, planTier: "GROWTH" },
      { "x-pim-commercial-ops-token": commercialToken },
    );
    assertStatus(missingOperator, 400, "internal billing mutation requires operator identity");
    assert(
      String(missingOperator.payload?.error ?? "") === "COMMERCIAL_OPERATOR_ID_REQUIRED",
      "expected COMMERCIAL_OPERATOR_ID_REQUIRED",
    );

    const internalMutation = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      null,
      { tenantKey: tenantId, planTier: "GROWTH" },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(
      internalMutation.status === 200 || internalMutation.status === 201,
      `internal billing mutation failed: expected 200/201, got ${internalMutation.status} payload=${JSON.stringify(internalMutation.payload)}`,
    );
    assert(
      String(internalMutation.payload?.planTier ?? "") === "GROWTH",
      "expected plan tier to change through internal commercial route",
    );

    const planProfile = await apiRequest(baseUrl, "GET", "/billing/plan-profile", adminToken);
    assertStatus(planProfile, 200, "plan profile after internal mutation");
    assert(String(planProfile.payload?.planTier ?? "") === "GROWTH", "expected updated plan profile");
    assert(
      String(planProfile.payload?.billingStatus ?? "") === "active_paid",
      "expected internal paid-tier update to promote billing status to active_paid",
    );
    assert(String(planProfile.payload?.accessStatus ?? "") === "active", "expected access status to remain active by default");
    assert(planProfile.payload?.trialEndsAt == null, "expected trialEndsAt to clear after paid-tier upgrade");

    const usage = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(usage, 200, "billing usage after internal mutation");
    assert(String(usage.payload?.billingStatus ?? "") === "active_paid", "expected usage summary to expose billing status");
    assert(String(usage.payload?.accessStatus ?? "") === "active", "expected usage summary to expose access status");
    assert(String(usage.payload?.profile?.billingStatus ?? "") === "active_paid", "expected usage profile to expose billing status");

    const internalBillingContactOnly = `ops-only-${runId}@example.com`;
    const contactOnlyUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        billingContactEmail: internalBillingContactOnly,
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(
      contactOnlyUpdate.status === 200 || contactOnlyUpdate.status === 201,
      `internal billing-contact-only mutation failed: status=${contactOnlyUpdate.status} payload=${JSON.stringify(contactOnlyUpdate.payload)}`,
    );
    assert(
      String(contactOnlyUpdate.payload?.billingContactEmail ?? "") === internalBillingContactOnly,
      `expected internal contact-only mutation to persist billing contact payload=${JSON.stringify(contactOnlyUpdate.payload)}`,
    );

    const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const billingContactEmail = `billing-${runId}@example.com`;
    const commercialStateUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        billingStatus: "past_due",
        graceEndsAt,
        billingContactEmail,
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(
      commercialStateUpdate.status === 200 || commercialStateUpdate.status === 201,
      `internal commercial-state mutation failed: status=${commercialStateUpdate.status} payload=${JSON.stringify(commercialStateUpdate.payload)}`,
    );
    assert(
      String(commercialStateUpdate.payload?.billingStatus ?? "") === "past_due",
      "expected billing status to update through internal commercial route",
    );
    assert(
      String(commercialStateUpdate.payload?.graceEndsAt ?? "") === graceEndsAt,
      `expected graceEndsAt to persist through internal commercial route payload=${JSON.stringify(commercialStateUpdate.payload)}`,
    );
    assert(
      String(commercialStateUpdate.payload?.billingContactEmail ?? "") === billingContactEmail,
      `expected billingContactEmail to persist through internal commercial route payload=${JSON.stringify(commercialStateUpdate.payload)}`,
    );

    const usageAfterCommercialState = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(usageAfterCommercialState, 200, "billing usage after internal commercial-state mutation");
    assert(
      String(usageAfterCommercialState.payload?.billingStatus ?? "") === "past_due",
      "expected usage summary to expose updated past_due billing status",
    );
    assert(
      String(usageAfterCommercialState.payload?.profile?.graceEndsAt ?? "") === graceEndsAt,
      `expected usage profile to expose graceEndsAt payload=${JSON.stringify(usageAfterCommercialState.payload)}`,
    );
    assert(
      String(usageAfterCommercialState.payload?.profile?.billingContactEmail ?? "") === billingContactEmail,
      `expected usage profile to expose billingContactEmail payload=${JSON.stringify(usageAfterCommercialState.payload)}`,
    );

    const selfManagedBillingContactEmail = `self-managed-${runId}@example.com`;
    const customerBillingContactUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/billing-contact",
      adminToken,
      {
        billingContactEmail: selfManagedBillingContactEmail,
      },
    );
    assertStatus(customerBillingContactUpdate, 200, "customer billing contact update");
    assert(
      String(customerBillingContactUpdate.payload?.billingContactEmail ?? "") === selfManagedBillingContactEmail,
      `expected customer billing contact update to persist payload=${JSON.stringify(customerBillingContactUpdate.payload)}`,
    );

    const usageAfterCustomerBillingContact = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(usageAfterCustomerBillingContact, 200, "billing usage after customer billing contact update");
    assert(
      String(usageAfterCustomerBillingContact.payload?.profile?.billingContactEmail ?? "") === selfManagedBillingContactEmail,
      `expected usage profile to expose self-managed billing contact payload=${JSON.stringify(usageAfterCustomerBillingContact.payload)}`,
    );

    const invalidCustomerBillingContact = await apiRequest(
      baseUrl,
      "POST",
      "/billing/billing-contact",
      adminToken,
      {
        billingContactEmail: "not-an-email",
      },
    );
    assertStatus(invalidCustomerBillingContact, 400, "customer billing contact validation");

    const clearCustomerBillingContact = await apiRequest(
      baseUrl,
      "POST",
      "/billing/billing-contact",
      adminToken,
      {
        billingContactEmail: null,
      },
    );
    assertStatus(clearCustomerBillingContact, 200, "customer billing contact clear");
    assert(clearCustomerBillingContact.payload?.billingContactEmail == null, "expected billing contact clear to fall back to admins");

    const usageAfterBillingContactClear = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(usageAfterBillingContactClear, 200, "billing usage after billing contact clear");
    assert(
      usageAfterBillingContactClear.payload?.profile?.billingContactEmail == null,
      `expected usage profile to clear billingContactEmail payload=${JSON.stringify(usageAfterBillingContactClear.payload)}`,
    );

    const legacyLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: legacyWorkspaceSlug,
      userId: legacyAdminUser,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(legacyLogin, 201, "legacy admin login");
    const legacyToken = String(legacyLogin.payload?.accessToken ?? "");
    assert(legacyToken.length > 10, "missing legacy admin token");

    const month = new Date().toISOString().slice(0, 7);
    await prisma.$executeRawUnsafe(`DELETE FROM "TenantPlanProfile" WHERE "tenantKey" = $1`, legacyTenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM "PlanUsage" WHERE "tenantKey" = $1`, legacyTenantId);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "PlanUsage"
        ("id", "tenantKey", "month", "planTier", "skuCount", "submissionCount", "storageGb", "connectorInstallationsCount", "connectorAccountsCount", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, 'ENTERPRISE', 0, 0, 0, 0, 0, NOW(), NOW())
      `,
      `planusage_${runId}`,
      legacyTenantId,
      month,
    );

    const legacyPlanProfile = await apiRequest(baseUrl, "GET", "/billing/plan-profile", legacyToken);
    assertStatus(legacyPlanProfile, 200, "legacy plan profile bootstrap");
    assert(
      String(legacyPlanProfile.payload?.planTier ?? "") === "ENTERPRISE",
      `expected legacy bootstrap plan tier to reuse latest usage row payload=${JSON.stringify(legacyPlanProfile.payload)}`,
    );
    assert(
      String(legacyPlanProfile.payload?.billingStatus ?? "") === "active_paid",
      `expected legacy bootstrap billing status to normalize paid tier payload=${JSON.stringify(legacyPlanProfile.payload)}`,
    );
    assert(
      String(legacyPlanProfile.payload?.accessStatus ?? "") === "active",
      `expected legacy bootstrap access status to remain active payload=${JSON.stringify(legacyPlanProfile.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "tenant_admin_plan_mutation_blocked",
            "internal_plan_mutation_requires_ops_token",
            "internal_plan_mutation_requires_operator_identity",
            "internal_plan_mutation_updates_target_tenant",
            "paid_tier_mutation_promotes_billing_status",
            "internal_commercial_state_accepts_billing_contact_only_mutation",
            "internal_commercial_state_mutation_persists_dates",
            "internal_commercial_state_mutation_persists_billing_contact",
            "tenant_admin_can_manage_billing_contact",
            "tenant_admin_billing_contact_validation_rejects_invalid_email",
            "tenant_admin_can_clear_billing_contact_to_admin_fallback",
            "legacy_plan_profile_bootstrap_reuses_latest_usage_tier",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Billing commercial control integration test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    process.exitCode = 1;
  } finally {
    if (apiProcess.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          apiProcess.kill("SIGTERM");
        }
      } catch {
        // ignore cleanup failures
      }
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

run();
