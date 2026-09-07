#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("AUTH_MODE", "db");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
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

function listEmailFiles(outboxDir) {
  if (!fs.existsSync(outboxDir)) {
    return [];
  }
  return fs
    .readdirSync(outboxDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(outboxDir, file));
}

async function waitForEmailCount(outboxDir, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = listEmailFiles(outboxDir);
    if (files.length >= expectedCount) {
      return files;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expectedCount} outbox files in ${outboxDir}`);
}

function readEmails(outboxDir) {
  return listEmailFiles(outboxDir).map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  const databaseUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for billing upgrade request integration test.");
  }

  const runId = Date.now().toString();
  const apiPort = 6660 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const platformToken = `platform-upgrade-${runId}`;
  const commercialToken = `commercial-upgrade-${runId}`;
  const tenantId = `upgrade-tenant-${runId}`;
  const workspaceSlug = `upgrade-${runId}`.slice(0, 24);
  const displayName = `Upgrade Workspace ${runId}`;
  const adminUser = `upgrade-admin-${runId}@example.com`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-upgrade-request-email-"));
  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_COMMERCIAL_CONTACT_EMAIL: "commercial@tej.example",
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
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

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      {
        tenantKey: tenantId,
        workspaceSlug,
        displayName,
        initialAdminUserId: adminUser,
        initialAdminPassword: process.env.PIM_AUTH_PASSWORD,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const adminToken = String(login.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const planMetadata = await apiRequest(baseUrl, "GET", "/billing/plans", adminToken);
    assertStatus(planMetadata, 200, "billing plan metadata");
    assert(
      Array.isArray(planMetadata.payload?.items) &&
        planMetadata.payload.items.some((plan) => String(plan?.tier ?? "") === "GROWTH") &&
        planMetadata.payload.items.some((plan) => String(plan?.tier ?? "") === "BUSINESS"),
      `expected API-backed plan metadata payload=${JSON.stringify(planMetadata.payload)}`,
    );

    const initialLookup = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", adminToken);
    assertStatus(initialLookup, 200, "initial upgrade request lookup");
    assert(initialLookup.payload?.item === null, `expected no open upgrade request payload=${JSON.stringify(initialLookup.payload)}`);

    const initialOverview = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(initialOverview, 200, "initial commercial overview");
    const baseRequestOverview = initialOverview.payload?.requestOverview;
    const baseTenantOverview = initialOverview.payload?.tenantOverview;
    assert(baseRequestOverview, `expected request overview payload=${JSON.stringify(initialOverview.payload)}`);
    assert(baseTenantOverview, `expected tenant overview payload=${JSON.stringify(initialOverview.payload)}`);
    assert(
      Number.isFinite(Number(baseRequestOverview.staleOpenRequests ?? Number.NaN)) &&
        Number.isFinite(Number(baseRequestOverview.staleAcknowledgedRequests ?? Number.NaN)) &&
        Number.isFinite(Number(baseRequestOverview.attentionRequiredRequests ?? Number.NaN)),
      `expected queue SLA metrics on overview payload=${JSON.stringify(initialOverview.payload)}`,
    );

    const createRequest = await apiRequest(baseUrl, "POST", "/billing/upgrade-request", adminToken, {
      requestedPlanTier: "GROWTH",
      notes: "We need more users and a paid-plan review before trial end.",
      source: "admin_plan",
    });
    assertStatus(createRequest, 200, "create upgrade request");
    assert(createRequest.payload?.created === true, `expected created=true payload=${JSON.stringify(createRequest.payload)}`);
    const requestId = String(createRequest.payload?.item?.id ?? "");
    assert(requestId.length > 5, `expected request id payload=${JSON.stringify(createRequest.payload)}`);
    assert(
      String(createRequest.payload?.item?.tenantKey ?? "") === tenantId &&
        String(createRequest.payload?.item?.workspaceSlug ?? "") === workspaceSlug,
      `expected tenant/workspace context payload=${JSON.stringify(createRequest.payload)}`,
    );
    assert(
      String(createRequest.payload?.item?.requestedBy ?? "") === adminUser &&
        String(createRequest.payload?.item?.requesterRole ?? "") === "admin",
      `expected requester context payload=${JSON.stringify(createRequest.payload)}`,
    );
    assert(
      String(createRequest.payload?.item?.currentPlanTier ?? "") === "STARTER" &&
        String(createRequest.payload?.item?.requestedPlanTier ?? "") === "GROWTH" &&
        String(createRequest.payload?.item?.currentBillingStatus ?? "") === "trial" &&
        String(createRequest.payload?.item?.currentAccessStatus ?? "") === "active",
      `expected current and requested commercial state snapshot payload=${JSON.stringify(createRequest.payload)}`,
    );
    assert(
      String(createRequest.payload?.item?.usageSnapshot?.planTier ?? "") === "STARTER" &&
        String(createRequest.payload?.item?.usageSnapshot?.billingStatus ?? "") === "trial" &&
        String(createRequest.payload?.item?.usageSnapshot?.accessStatus ?? "") === "active" &&
        String(createRequest.payload?.item?.usageSnapshot?.capturedAt ?? "").length > 10 &&
        Number.isFinite(Number(createRequest.payload?.item?.usageSnapshot?.resources?.skus?.limit)),
      `expected usage snapshot to persist payload=${JSON.stringify(createRequest.payload)}`,
    );
    assert(
      String(createRequest.payload?.item?.notes ?? "") === "We need more users and a paid-plan review before trial end.",
      `expected notes to persist payload=${JSON.stringify(createRequest.payload)}`,
    );

    const overviewAfterCreate = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(overviewAfterCreate, 200, "commercial overview after create");
    assert(
      Number(overviewAfterCreate.payload?.tenantOverview?.totalTenants ?? 0) >= Number(baseTenantOverview.totalTenants ?? 0),
      `expected tenant count to remain stable payload=${JSON.stringify(overviewAfterCreate.payload)}`,
    );
    assert(
      Number(overviewAfterCreate.payload?.requestOverview?.totalRequests ?? 0) === Number(baseRequestOverview.totalRequests ?? 0) + 1 &&
        Number(overviewAfterCreate.payload?.requestOverview?.openRequests ?? 0) === Number(baseRequestOverview.openRequests ?? 0) + 1 &&
        Number(overviewAfterCreate.payload?.requestOverview?.activeRequests ?? 0) === Number(baseRequestOverview.activeRequests ?? 0) + 1 &&
        Number(overviewAfterCreate.payload?.requestOverview?.recentRequests ?? 0) === Number(baseRequestOverview.recentRequests ?? 0) + 1 &&
        Number(overviewAfterCreate.payload?.requestOverview?.staleOpenRequests ?? 0) === Number(baseRequestOverview.staleOpenRequests ?? 0) &&
        Number(overviewAfterCreate.payload?.requestOverview?.staleAcknowledgedRequests ?? 0) === Number(baseRequestOverview.staleAcknowledgedRequests ?? 0) &&
        Number(overviewAfterCreate.payload?.requestOverview?.attentionRequiredRequests ?? 0) === Number(baseRequestOverview.attentionRequiredRequests ?? 0),
      `expected overview to reflect new open request payload=${JSON.stringify(overviewAfterCreate.payload)}`,
    );
    assert(
      String(overviewAfterCreate.payload?.requestOverview?.oldestActiveRequestCreatedAt ?? "").length > 10,
      `expected oldest active request timestamp after create payload=${JSON.stringify(overviewAfterCreate.payload)}`,
    );

    const secondRequest = await apiRequest(baseUrl, "POST", "/billing/upgrade-request", adminToken, {
      notes: "Please expedite.",
      source: "admin_plan",
    });
    assertStatus(secondRequest, 200, "reuse open upgrade request");
    assert(secondRequest.payload?.created === false, `expected created=false payload=${JSON.stringify(secondRequest.payload)}`);
    assert(
      String(secondRequest.payload?.item?.id ?? "") === requestId,
      `expected open request reuse payload=${JSON.stringify(secondRequest.payload)}`,
    );
    assert(
      String(secondRequest.payload?.item?.notes ?? "") === "We need more users and a paid-plan review before trial end.",
      `expected original notes to remain on reused request payload=${JSON.stringify(secondRequest.payload)}`,
    );

    const lookupAfterCreate = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", adminToken);
    assertStatus(lookupAfterCreate, 200, "lookup open upgrade request");
    assert(
      String(lookupAfterCreate.payload?.item?.id ?? "") === requestId,
      `expected lookup to return open request payload=${JSON.stringify(lookupAfterCreate.payload)}`,
    );

    const internalList = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests?tenantKey=${encodeURIComponent(tenantId)}&status=open&limit=10`,
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(internalList, 200, "internal upgrade request listing");
    assert(Number(internalList.payload?.count ?? 0) === 1, `expected one open request payload=${JSON.stringify(internalList.payload)}`);
    assert(
      String(internalList.payload?.items?.[0]?.id ?? "") === requestId,
      `expected listed request to match created request payload=${JSON.stringify(internalList.payload)}`,
    );
    assert(
      String(internalList.payload?.items?.[0]?.requestedPlanTier ?? "") === "GROWTH" &&
        String(internalList.payload?.items?.[0]?.usageSnapshot?.planTier ?? "") === "STARTER",
      `expected listed request to include requested plan and usage snapshot payload=${JSON.stringify(internalList.payload)}`,
    );

    const exportResult = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests/export?tenantKey=${encodeURIComponent(tenantId)}&status=open&limit=10`,
      null,
      undefined,
      {
        Accept: "text/csv",
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(exportResult, 200, "internal upgrade request export");
    const exportCsv = String(exportResult.payload ?? "");
    assert(
      exportCsv.includes("id,tenantKey,workspaceSlug,displayName,status,requestedBy,requesterRole,currentPlanTier,requestedPlanTier") &&
        exportCsv.includes("usageSnapshot"),
      `expected csv header row payload=${exportCsv}`,
    );
    assert(
      exportCsv.includes(`"${requestId}"`) &&
        exportCsv.includes(`"${tenantId}"`) &&
        exportCsv.includes(`"${workspaceSlug}"`) &&
        exportCsv.includes('"GROWTH"') &&
        exportCsv.includes('"open"'),
      `expected created open request in csv export payload=${exportCsv}`,
    );

    const acknowledge = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/upgrade-requests/status",
      null,
      {
        requestId,
        status: "acknowledged",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(acknowledge, 200, "acknowledge upgrade request");
    assert(
      String(acknowledge.payload?.item?.status ?? "") === "acknowledged",
      `expected acknowledged status payload=${JSON.stringify(acknowledge.payload)}`,
    );

    const overviewAfterAcknowledge = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(overviewAfterAcknowledge, 200, "commercial overview after acknowledge");
    assert(
      Number(overviewAfterAcknowledge.payload?.requestOverview?.openRequests ?? 0) === Number(baseRequestOverview.openRequests ?? 0) &&
        Number(overviewAfterAcknowledge.payload?.requestOverview?.acknowledgedRequests ?? 0) === Number(baseRequestOverview.acknowledgedRequests ?? 0) + 1 &&
        Number(overviewAfterAcknowledge.payload?.requestOverview?.activeRequests ?? 0) === Number(baseRequestOverview.activeRequests ?? 0) + 1 &&
        Number(overviewAfterAcknowledge.payload?.requestOverview?.staleOpenRequests ?? 0) === Number(baseRequestOverview.staleOpenRequests ?? 0) &&
        Number(overviewAfterAcknowledge.payload?.requestOverview?.staleAcknowledgedRequests ?? 0) === Number(baseRequestOverview.staleAcknowledgedRequests ?? 0) &&
        Number(overviewAfterAcknowledge.payload?.requestOverview?.attentionRequiredRequests ?? 0) === Number(baseRequestOverview.attentionRequiredRequests ?? 0),
      `expected overview to reflect acknowledged request payload=${JSON.stringify(overviewAfterAcknowledge.payload)}`,
    );
    assert(
      String(overviewAfterAcknowledge.payload?.requestOverview?.oldestActiveRequestCreatedAt ?? "").length > 10,
      `expected oldest active request timestamp after acknowledge payload=${JSON.stringify(overviewAfterAcknowledge.payload)}`,
    );

    const lookupAfterAcknowledge = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", adminToken);
    assertStatus(lookupAfterAcknowledge, 200, "lookup acknowledged upgrade request");
    assert(
      String(lookupAfterAcknowledge.payload?.item?.id ?? "") === requestId &&
        String(lookupAfterAcknowledge.payload?.item?.status ?? "") === "acknowledged",
      `expected customer lookup to preserve acknowledged request payload=${JSON.stringify(lookupAfterAcknowledge.payload)}`,
    );

    const requestAuditTrail = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&resourceId=${encodeURIComponent(requestId)}&limit=25`,
      adminToken,
    );
    assertStatus(requestAuditTrail, 200, "request audit explorer query");
    const requestAuditActions = Array.isArray(requestAuditTrail.payload?.items)
      ? requestAuditTrail.payload.items.map((row) => String(row?.action ?? ""))
      : [];
    assert(
      requestAuditActions.includes("COMMERCIAL_UPGRADE_REQUEST_CREATED") &&
        requestAuditActions.includes("COMMERCIAL_UPGRADE_REQUEST_STATUS_UPDATED"),
      `expected created and status-updated audit rows for request ${requestId}, got ${JSON.stringify(requestAuditTrail.payload)}`,
    );

    const requestAuditExport = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events/export?entityType=plan&resourceId=${encodeURIComponent(requestId)}&limit=25`,
      adminToken,
      undefined,
      {
        Accept: "text/csv",
      },
    );
    assertStatus(requestAuditExport, 200, "request audit export");
    const requestAuditCsv = String(requestAuditExport.payload ?? "");
    assert(
      requestAuditCsv.includes(requestId) &&
        requestAuditCsv.includes("COMMERCIAL_UPGRADE_REQUEST_CREATED") &&
        requestAuditCsv.includes("COMMERCIAL_UPGRADE_REQUEST_STATUS_UPDATED"),
      `expected request audit export rows payload=${requestAuditCsv}`,
    );

    const thirdRequest = await apiRequest(baseUrl, "POST", "/billing/upgrade-request", adminToken, {
      notes: "Third request should reuse the acknowledged request.",
      source: "admin_plan",
    });
    assertStatus(thirdRequest, 200, "reuse acknowledged upgrade request");
    assert(thirdRequest.payload?.created === false, `expected created=false for acknowledged request payload=${JSON.stringify(thirdRequest.payload)}`);
    assert(
      String(thirdRequest.payload?.item?.id ?? "") === requestId &&
        String(thirdRequest.payload?.item?.status ?? "") === "acknowledged",
      `expected acknowledged request reuse payload=${JSON.stringify(thirdRequest.payload)}`,
    );

    const resolved = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/upgrade-requests/status",
      null,
      {
        requestId,
        status: "resolved",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(resolved, 200, "resolve upgrade request");
    assert(
      String(resolved.payload?.item?.status ?? "") === "resolved" &&
        String(resolved.payload?.item?.resolvedBy ?? "") === "ops-commercial" &&
        String(resolved.payload?.item?.resolvedAt ?? "").length > 10,
      `expected resolved request metadata payload=${JSON.stringify(resolved.payload)}`,
    );

    const overviewAfterResolved = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(overviewAfterResolved, 200, "commercial overview after resolve");
    assert(
      Number(overviewAfterResolved.payload?.requestOverview?.activeRequests ?? 0) === Number(baseRequestOverview.activeRequests ?? 0) &&
        Number(overviewAfterResolved.payload?.requestOverview?.resolvedRequests ?? 0) === Number(baseRequestOverview.resolvedRequests ?? 0) + 1 &&
        Number(overviewAfterResolved.payload?.requestOverview?.recentResolvedRequests ?? 0) ===
          Number(baseRequestOverview.recentResolvedRequests ?? 0) + 1 &&
        Number(overviewAfterResolved.payload?.requestOverview?.attentionRequiredRequests ?? 0) === Number(baseRequestOverview.attentionRequiredRequests ?? 0),
      `expected overview to reflect resolved request payload=${JSON.stringify(overviewAfterResolved.payload)}`,
    );

    const lookupAfterResolved = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", adminToken);
    assertStatus(lookupAfterResolved, 200, "lookup after resolved request");
    assert(
      lookupAfterResolved.payload?.item === null,
      `expected no active customer request after resolve payload=${JSON.stringify(lookupAfterResolved.payload)}`,
    );

    const createAfterResolve = await apiRequest(baseUrl, "POST", "/billing/upgrade-request", adminToken, {
      notes: "We still need review after the first request was resolved.",
      source: "admin_plan",
    });
    assertStatus(createAfterResolve, 200, "create upgrade request after resolution");
    assert(
      createAfterResolve.payload?.created === true &&
        String(createAfterResolve.payload?.item?.id ?? "") !== requestId,
      `expected new request after resolution payload=${JSON.stringify(createAfterResolve.payload)}`,
    );

    const overviewAfterReopen = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(overviewAfterReopen, 200, "commercial overview after follow-up request");
    assert(
      Number(overviewAfterReopen.payload?.requestOverview?.totalRequests ?? 0) === Number(baseRequestOverview.totalRequests ?? 0) + 2 &&
        Number(overviewAfterReopen.payload?.requestOverview?.openRequests ?? 0) === Number(baseRequestOverview.openRequests ?? 0) + 1 &&
        Number(overviewAfterReopen.payload?.requestOverview?.activeRequests ?? 0) === Number(baseRequestOverview.activeRequests ?? 0) + 1 &&
        Number(overviewAfterReopen.payload?.requestOverview?.resolvedRequests ?? 0) === Number(baseRequestOverview.resolvedRequests ?? 0) + 1 &&
        Number(overviewAfterReopen.payload?.requestOverview?.staleOpenRequests ?? 0) === Number(baseRequestOverview.staleOpenRequests ?? 0) &&
        Number(overviewAfterReopen.payload?.requestOverview?.staleAcknowledgedRequests ?? 0) === Number(baseRequestOverview.staleAcknowledgedRequests ?? 0) &&
        Number(overviewAfterReopen.payload?.requestOverview?.attentionRequiredRequests ?? 0) === Number(baseRequestOverview.attentionRequiredRequests ?? 0),
      `expected overview to reflect follow-up open request payload=${JSON.stringify(overviewAfterReopen.payload)}`,
    );
    assert(
      String(overviewAfterReopen.payload?.requestOverview?.oldestActiveRequestCreatedAt ?? "").length > 10,
      `expected oldest active request timestamp after follow-up request payload=${JSON.stringify(overviewAfterReopen.payload)}`,
    );

    await waitForEmailCount(outboxDir, 4, 10_000);
    const emails = readEmails(outboxDir);
    assert(emails.length === 4, `expected four upgrade-request related emails payload=${JSON.stringify(emails)}`);
    const requestEmails = emails.filter((entry) => String(entry.category ?? "") === "commercial_upgrade_request");
    assert(requestEmails.length === 2, `expected two commercial ops request emails payload=${JSON.stringify(emails)}`);
    const firstRequestEmail = requestEmails[0];
    assert(String(firstRequestEmail.to ?? "") === "commercial@tej.example", `expected commercial contact recipient payload=${JSON.stringify(firstRequestEmail)}`);
    assert(String(firstRequestEmail.category ?? "") === "commercial_upgrade_request", `expected commercial_upgrade_request category payload=${JSON.stringify(firstRequestEmail)}`);
    assert(
      String(firstRequestEmail.subject ?? "").includes(`Upgrade request: ${displayName}`),
      `expected upgrade request subject payload=${JSON.stringify(firstRequestEmail)}`,
    );
    assert(
      String(firstRequestEmail.text ?? "").includes(`Tenant key: ${tenantId}`) &&
        String(firstRequestEmail.text ?? "").includes(`Workspace slug: ${workspaceSlug}`) &&
        String(firstRequestEmail.text ?? "").includes("Current plan tier: STARTER") &&
        String(firstRequestEmail.text ?? "").includes("We need more users and a paid-plan review before trial end."),
      `expected upgrade request email details payload=${JSON.stringify(firstRequestEmail)}`,
    );
    const statusEmails = emails.filter((entry) => String(entry.category ?? "") === "commercial_status_notice");
    assert(statusEmails.length === 2, `expected two customer-facing status emails payload=${JSON.stringify(emails)}`);
    assert(
      statusEmails.some((entry) => String(entry.subject ?? "").includes(`Upgrade request acknowledged: ${displayName}`)),
      `expected acknowledged status email payload=${JSON.stringify(statusEmails)}`,
    );
    assert(
      statusEmails.some((entry) => String(entry.subject ?? "").includes(`Upgrade request resolved: ${displayName}`)),
      `expected resolved status email payload=${JSON.stringify(statusEmails)}`,
    );

    const followUpRequestId = String(createAfterResolve.payload?.item?.id ?? "");
    assert(followUpRequestId.length > 5, `expected follow-up request id payload=${JSON.stringify(createAfterResolve.payload)}`);
    await prisma.$executeRaw`
      UPDATE "tenant_commercial_requests"
      SET "created_at" = NOW() - INTERVAL '2 days',
          "updated_at" = NOW()
      WHERE "id" = ${followUpRequestId}
    `;

    const attentionList = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests?tenantKey=${encodeURIComponent(tenantId)}&sla=attention&limit=10`,
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(attentionList, 200, "attention-filtered upgrade request listing");
    assert(
      Number(attentionList.payload?.count ?? 0) === 1 &&
        String(attentionList.payload?.items?.[0]?.id ?? "") === followUpRequestId,
      `expected only aged active request in attention listing payload=${JSON.stringify(attentionList.payload)}`,
    );

    const attentionExport = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/upgrade-requests/export?tenantKey=${encodeURIComponent(tenantId)}&sla=attention&limit=10`,
      null,
      undefined,
      {
        Accept: "text/csv",
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(attentionExport, 200, "attention-filtered upgrade request export");
    const attentionCsv = String(attentionExport.payload ?? "");
    assert(
      attentionCsv.includes(`"${followUpRequestId}"`) && !attentionCsv.includes(`"${requestId}"`),
      `expected only aged active request in attention export payload=${attentionCsv}`,
    );

    const overviewAfterAging = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/overview",
      null,
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(overviewAfterAging, 200, "commercial overview after aging request");
    assert(
      Number(overviewAfterAging.payload?.requestOverview?.staleOpenRequests ?? 0) === Number(baseRequestOverview.staleOpenRequests ?? 0) + 1 &&
        Number(overviewAfterAging.payload?.requestOverview?.attentionRequiredRequests ?? 0) === Number(baseRequestOverview.attentionRequiredRequests ?? 0) + 1,
      `expected overview to reflect attention queue request payload=${JSON.stringify(overviewAfterAging.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "tenant_admin_can_create_upgrade_request",
            "open_upgrade_request_lookup_is_exposed_to_customer_admins",
            "duplicate_open_upgrade_requests_are_reused",
            "acknowledged_requests_remain_visible_to_customer_admins",
            "internal_ops_can_update_upgrade_request_status",
            "workspace_admin_can_view_request_audit_followup_after_status_change",
            "resolved_requests_clear_customer_pending_state",
            "internal_ops_can_list_upgrade_requests",
            "internal_ops_can_export_upgrade_requests_as_csv",
            "internal_ops_overview_reflects_request_lifecycle",
            "internal_ops_can_filter_attention_queue_requests",
            "attention_queue_export_only_includes_stale_requests",
            "upgrade_request_notifies_commercial_contact_email",
            "upgrade_request_status_changes_notify_customer_recipients",
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
    console.error("Billing upgrade request integration test failed:");
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
    fs.rmSync(outboxDir, { recursive: true, force: true });
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => apiProcess.once("exit", resolve));
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error("Billing upgrade request integration test failed before startup:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
