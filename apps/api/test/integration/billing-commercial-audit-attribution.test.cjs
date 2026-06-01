#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("AUTH_MODE", "db");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("QUEUE_BACKEND", "memory");
  setDefaultEnv("QUEUE_WORKER_ENABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
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

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function commercialHeaders(token) {
  return {
    "x-pim-commercial-ops-token": token,
    "x-pim-operator-id": "ops-commercial",
    "x-pim-operator-role": "commercial_ops",
  };
}

function platformHeaders(token) {
  return { "x-pim-platform-admin-token": token };
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

function collectActions(items, resourceId) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .filter((row) => row && String(row.resourceId ?? "") === resourceId)
      .map((row) => String(row.action ?? "")),
  );
}

async function login(baseUrl, workspaceSlug, userId, password) {
  const result = await apiRequest(baseUrl, "POST", "/auth/login", {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
  assertStatus(result, 201, `login ${userId}`);
  const accessToken = String(result.payload?.accessToken ?? "");
  assert(accessToken.length > 10, `missing access token for ${userId}`);
  return accessToken;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6550 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const platformToken = `platform-audit-${runId}`;
  const commercialToken = `commercial-audit-${runId}`;
  const opsTenantKey = `ops-audit-${runId}`;
  const opsWorkspaceSlug = `opsaudit-${runId}`.slice(0, 24);
  const opsAdminUser = `ops-audit-admin-${runId}@example.com`;
  const targetTenantKey = `tenant-audit-${runId}`;
  const targetWorkspaceSlug = `taudit-${runId}`.slice(0, 24);
  const targetAdminUser = `tenant-audit-admin-${runId}@example.com`;
  const password = process.env.PIM_AUTH_PASSWORD;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_DEFAULT_TENANT_KEY: opsTenantKey,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    PIM_AUTH_PASSWORD: password,
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

    const provisionOps = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      {
        tenantKey: opsTenantKey,
        workspaceSlug: opsWorkspaceSlug,
        displayName: "Ops Audit Workspace",
        initialAdminUserId: opsAdminUser,
      },
      platformHeaders(platformToken),
    );
    assertStatus(provisionOps, 201, "provision ops tenant");

    const provisionTarget = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      {
        tenantKey: targetTenantKey,
        workspaceSlug: targetWorkspaceSlug,
        displayName: "Target Audit Workspace",
        initialAdminUserId: targetAdminUser,
      },
      platformHeaders(platformToken),
    );
    assertStatus(provisionTarget, 201, "provision target tenant");

    const opsAdminToken = await login(baseUrl, opsWorkspaceSlug, opsAdminUser, password);
    const targetAdminToken = await login(baseUrl, targetWorkspaceSlug, targetAdminUser, password);

    const createRequest = await apiRequest(
      baseUrl,
      "POST",
      "/billing/upgrade-request",
      {
        notes: "Need higher limits for audit attribution validation",
        source: "self_serve",
      },
      authHeaders(targetAdminToken),
    );
    assertStatus(createRequest, 200, "create upgrade request");

    const listRequests = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests?tenantKey=${encodeURIComponent(targetTenantKey)}&limit=10`,
      undefined,
      commercialHeaders(commercialToken),
    );
    assertStatus(listRequests, 200, "list upgrade requests for target tenant");
    assert(Number(listRequests.payload?.count ?? 0) >= 1, `expected at least one request payload=${JSON.stringify(listRequests.payload)}`);

    const exportRequests = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests/export?tenantKey=${encodeURIComponent(targetTenantKey)}&limit=10`,
      undefined,
      {
        Accept: "text/csv",
        ...commercialHeaders(commercialToken),
      },
    );
    assertStatus(exportRequests, 200, "export upgrade requests for target tenant");
    assert(
      String(exportRequests.payload ?? "").includes(targetTenantKey),
      `expected target tenant in export payload=${String(exportRequests.payload ?? "")}`,
    );

    const planTierUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      {
        tenantKey: targetTenantKey,
        planTier: "GROWTH",
      },
      commercialHeaders(commercialToken),
    );
    assert(
      planTierUpdate.status === 200 || planTierUpdate.status === 201,
      `plan tier update failed payload=${JSON.stringify(planTierUpdate.payload)}`,
    );

    const commercialStateUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      {
        tenantKey: targetTenantKey,
        billingStatus: "past_due",
      },
      commercialHeaders(commercialToken),
    );
    assert(
      commercialStateUpdate.status === 200 || commercialStateUpdate.status === 201,
      `commercial state update failed payload=${JSON.stringify(commercialStateUpdate.payload)}`,
    );

    const commercialOverview = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      undefined,
      commercialHeaders(commercialToken),
    );
    assertStatus(commercialOverview, 200, "commercial overview");

    const targetPlanEvents = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&resourceId=${encodeURIComponent(targetTenantKey)}&limit=50`,
      undefined,
      authHeaders(targetAdminToken),
    );
    assertStatus(targetPlanEvents, 200, "target tenant plan audit explorer");
    const targetActions = collectActions(targetPlanEvents.payload?.items, targetTenantKey);
    assert(targetActions.has("COMMERCIAL_UPGRADE_REQUEST_LISTED"), `expected list audit in target tenant payload=${JSON.stringify(targetPlanEvents.payload)}`);
    assert(targetActions.has("COMMERCIAL_UPGRADE_REQUEST_EXPORTED"), `expected export audit in target tenant payload=${JSON.stringify(targetPlanEvents.payload)}`);
    assert(targetActions.has("PLAN_TIER_CHANGE"), `expected plan tier audit in target tenant payload=${JSON.stringify(targetPlanEvents.payload)}`);
    assert(targetActions.has("TENANT_BILLING_STATUS_SET"), `expected billing status audit in target tenant payload=${JSON.stringify(targetPlanEvents.payload)}`);

    const opsTenantTargetEvents = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&resourceId=${encodeURIComponent(targetTenantKey)}&limit=50`,
      undefined,
      authHeaders(opsAdminToken),
    );
    assertStatus(opsTenantTargetEvents, 200, "ops tenant should not see target tenant audit rows");
    assert(
      Array.isArray(opsTenantTargetEvents.payload?.items) &&
        opsTenantTargetEvents.payload.items.length === 0,
      `ops tenant must not receive target tenant audit rows payload=${JSON.stringify(opsTenantTargetEvents.payload)}`,
    );

    const targetOverviewEvents = await apiRequest(
      baseUrl,
      "GET",
      "/audit/events?entityType=plan&action=COMMERCIAL_OVERVIEW_VIEWED&limit=25",
      undefined,
      authHeaders(targetAdminToken),
    );
    assertStatus(targetOverviewEvents, 200, "target tenant overview audit query");
    assert(
      Array.isArray(targetOverviewEvents.payload?.items) &&
        targetOverviewEvents.payload.items.length === 0,
      `target tenant must not see cross-tenant overview audit row payload=${JSON.stringify(targetOverviewEvents.payload)}`,
    );

    const opsOverviewEvents = await apiRequest(
      baseUrl,
      "GET",
      "/audit/events?entityType=plan&action=COMMERCIAL_OVERVIEW_VIEWED&limit=25",
      undefined,
      authHeaders(opsAdminToken),
    );
    assertStatus(opsOverviewEvents, 200, "ops tenant overview audit query");
    assert(
      Array.isArray(opsOverviewEvents.payload?.items) &&
        opsOverviewEvents.payload.items.some((row) => row && String(row.action ?? "") === "COMMERCIAL_OVERVIEW_VIEWED"),
      `expected overview audit row in ops/default tenant payload=${JSON.stringify(opsOverviewEvents.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          opsTenantKey,
          targetTenantKey,
          validated: [
            "tenant_specific_internal_billing_audit_rows_land_in_target_tenant",
            "default_ops_tenant_does_not_receive_target_tenant_internal_billing_audit_rows",
            "cross_tenant_overview_audit_row_stays_in_ops_default_tenant",
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
    console.error("Billing commercial audit attribution integration test failed:");
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
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
