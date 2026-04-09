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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
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

async function commercialPlanRequest(baseUrl, commercialToken, tenantKey, planTier) {
  return apiRequest(
    baseUrl,
    "POST",
    "/billing/internal/plan-tier",
    null,
    { tenantKey, planTier },
    {
      "x-pim-commercial-ops-token": commercialToken,
      "x-pim-operator-id": "ops-commercial",
      "x-pim-operator-role": "commercial_ops",
    },
  );
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

  const runId = Date.now().toString();
  const apiPort = 6000 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `connector-access-${runId}`;
  const workspaceSlug = `ca-${runId}`;
  const adminUser = `admin-${runId}`;
  const editorUser = `editor-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
      [editorUser]: { tenantId, role: "editor", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Connector Access" },
    }),
    PIM_AUTH_PASSWORD: "tej-pim-demo-password",
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

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const loginAdmin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginAdmin, 201, "admin login");
    const adminToken = String(loginAdmin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const loginEditor = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: editorUser,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginEditor, 201, "editor login");
    const editorToken = String(loginEditor.payload?.accessToken ?? "");
    assert(editorToken.length > 10, "missing editor token");

    const definitionsWarmup = await Promise.all(
      Array.from({ length: 4 }, () => apiRequest(baseUrl, "GET", "/connectors/definitions", adminToken)),
    );
    for (const [index, result] of definitionsWarmup.entries()) {
      assertStatus(result, 200, `definitions warmup ${index + 1}`);
    }

    const tenantPlanMutationBlocked = await apiRequest(baseUrl, "POST", "/billing/plan-tier", adminToken, {
      planTier: "STARTER",
    });
    assertStatus(tenantPlanMutationBlocked, 403, "tenant admin plan mutation blocked");
    assert(
      String(tenantPlanMutationBlocked.payload?.error ?? "") === "COMMERCIAL_MUTATION_INTERNAL_ONLY",
      "expected COMMERCIAL_MUTATION_INTERNAL_ONLY payload",
    );

    const setStarter = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "STARTER");
    assert(
      setStarter.status === 200 || setStarter.status === 201,
      `set starter plan failed: expected 200/201, got ${setStarter.status} payload=${JSON.stringify(setStarter.payload)}`,
    );

    const installAmazon = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installAmazon, 201, "install amazon");

    const installFlipkart = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installFlipkart, 201, "install flipkart");

    const installMeeshoLimited = await apiRequest(baseUrl, "POST", "/connectors/meesho/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installMeeshoLimited, 402, "meesho install blocked by starter plan");
    assert(
      String(installMeeshoLimited.payload?.error ?? "") === "PLAN_LIMIT_EXCEEDED",
      "expected PLAN_LIMIT_EXCEEDED payload",
    );

    const disableFlipkart = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(String(installFlipkart.payload.id))}/uninstall`,
      adminToken,
      {},
    );
    assertStatus(disableFlipkart, 201, "disable flipkart");

    const usageAfterDisable = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(usageAfterDisable, 200, "billing usage after disable");
    assert(
      Number(usageAfterDisable.payload?.connectorsInstallations?.current ?? -1) === 1,
      "expected active connector installation count to drop after disable",
    );

    const installMeeshoAfterDisable = await apiRequest(baseUrl, "POST", "/connectors/meesho/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installMeeshoAfterDisable, 201, "meesho install after disabling flipkart on starter");

    const editorDeleteDenied = await apiRequest(
      baseUrl,
      "DELETE",
      `/connectors/flipkart/install/${encodeURIComponent(String(installFlipkart.payload.id))}`,
      editorToken,
    );
    assertStatus(editorDeleteDenied, 403, "editor delete denied");

    const deleteSlugMismatch = await apiRequest(
      baseUrl,
      "DELETE",
      `/connectors/meesho/install/${encodeURIComponent(String(installFlipkart.payload.id))}`,
      adminToken,
    );
    assertStatus(deleteSlugMismatch, 400, "admin delete rejected on slug mismatch");
    assert(
      String(deleteSlugMismatch.payload?.error ?? "") === "CONNECTOR_SLUG_MISMATCH",
      "expected CONNECTOR_SLUG_MISMATCH for delete slug mismatch",
    );

    const deleteFlipkart = await apiRequest(
      baseUrl,
      "DELETE",
      `/connectors/flipkart/install/${encodeURIComponent(String(installFlipkart.payload.id))}`,
      adminToken,
    );
    assertStatus(deleteFlipkart, 200, "admin delete disabled flipkart record");

    const editorReconnectDenied = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(String(installAmazon.payload.id))}/reconnect`,
      editorToken,
      {},
    );
    assertStatus(editorReconnectDenied, 403, "editor reconnect denied before permission grant");
    assert(
      String(editorReconnectDenied.payload?.error ?? "") === "CONNECTOR_PERMISSION_DENIED",
      "expected CONNECTOR_PERMISSION_DENIED for editor",
    );

    const grantEditorReconnect = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "role",
      principalId: "editor",
      connectorSlug: "amazon-in",
      accountAlias: "primary",
      action: "reconnect",
    });
    assertStatus(grantEditorReconnect, 201, "grant editor reconnect permission");

    const editorReconnectAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(String(installAmazon.payload.id))}/reconnect`,
      editorToken,
      {},
    );
    assertStatus(editorReconnectAllowed, 201, "editor reconnect allowed after grant");

    const editorInstalled = await apiRequest(baseUrl, "GET", "/connectors/installed?limit=50", editorToken);
    assertStatus(editorInstalled, 200, "editor installed connectors list");
    const installedItems = Array.isArray(editorInstalled.payload?.items)
      ? editorInstalled.payload.items
      : Array.isArray(editorInstalled.payload)
      ? editorInstalled.payload
      : [];
    const amazonItem = installedItems.find((item) => item.slug === "amazon-in");
    assert(amazonItem, "expected amazon installation in list");
    assert(amazonItem.actions?.reconnect?.allowed === true, "expected reconnect allowed in action matrix for editor");

    const definitionsBeforeUpgrade = await apiRequest(baseUrl, "GET", "/connectors/definitions", adminToken);
    assertStatus(definitionsBeforeUpgrade, 200, "definitions before upgrade");
    const meeshoBefore = Array.isArray(definitionsBeforeUpgrade.payload)
      ? definitionsBeforeUpgrade.payload.find((item) => item.slug === "meesho")
      : null;
    assert(meeshoBefore, "expected meesho definition before upgrade");
    assert(meeshoBefore.actions?.install?.allowed === false, "meesho install should be blocked before plan upgrade");

    const setEnterprise = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "ENTERPRISE");
    assert(
      setEnterprise.status === 200 || setEnterprise.status === 201,
      `set enterprise plan failed: expected 200/201, got ${setEnterprise.status} payload=${JSON.stringify(setEnterprise.payload)}`,
    );

    const definitionsAfterUpgrade = await apiRequest(baseUrl, "GET", "/connectors/definitions", adminToken);
    assertStatus(definitionsAfterUpgrade, 200, "definitions after upgrade");
    const meeshoAfter = Array.isArray(definitionsAfterUpgrade.payload)
      ? definitionsAfterUpgrade.payload.find((item) => item.slug === "meesho")
      : null;
    assert(meeshoAfter, "expected meesho definition after upgrade");
    assert(meeshoAfter.actions?.install?.allowed === true, "meesho install should be allowed after plan upgrade");

    const installMeeshoAfterUpgrade = await apiRequest(baseUrl, "POST", "/connectors/meesho/install", adminToken, {
      accountAlias: "secondary",
    });
    assertStatus(installMeeshoAfterUpgrade, 201, "meesho secondary account install after enterprise upgrade");

    const foreignTenantKey = `foreign-tenant-${runId}`;
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "TenantPlanProfile" ("id", "tenantKey", "planTier", "effectiveFrom", "createdAt", "updatedAt")
      VALUES ($1, $2, 'STARTER', NOW(), NOW(), NOW())
      ON CONFLICT ("tenantKey") DO UPDATE SET "planTier" = 'STARTER', "updatedAt" = NOW()
      `,
      `tpp_${foreignTenantKey}`,
      foreignTenantKey,
    );

    const tenantOverrideAttempt = await commercialPlanRequest(baseUrl, commercialToken, foreignTenantKey, "GROWTH");
    assert(
      tenantOverrideAttempt.status === 200 || tenantOverrideAttempt.status === 201,
      `internal plan tier target failed: expected 200/201, got ${tenantOverrideAttempt.status} payload=${JSON.stringify(tenantOverrideAttempt.payload)}`,
    );

    const foreignPlanRows = await prisma.$queryRawUnsafe(
      `
      SELECT "planTier" AS "planTier"
      FROM "TenantPlanProfile"
      WHERE "tenantKey" = $1
      LIMIT 1
      `,
      foreignTenantKey,
    );
    const foreignPlanTier = Array.isArray(foreignPlanRows) ? String(foreignPlanRows[0]?.planTier ?? "") : "";
    assert(foreignPlanTier === "GROWTH", "internal commercial path must mutate explicitly targeted tenant plan profile");

    const auditRows = await prisma.$queryRawUnsafe(
      `
      SELECT action
      FROM audit_logs
      WHERE tenant_key = $1
        AND action IN ('PLAN_TIER_CHANGE', 'CONNECTOR_PERMISSION_GRANT', 'CONNECTOR_INSTALL_ATTEMPT')
      `,
      tenantId,
    );
    const actions = Array.isArray(auditRows) ? auditRows.map((row) => String(row.action ?? "")) : [];
    assert(actions.includes("PLAN_TIER_CHANGE"), "expected PLAN_TIER_CHANGE audit row");
    assert(actions.includes("CONNECTOR_PERMISSION_GRANT"), "expected CONNECTOR_PERMISSION_GRANT audit row");
    assert(actions.includes("CONNECTOR_INSTALL_ATTEMPT"), "expected CONNECTOR_INSTALL_ATTEMPT audit row");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "plan_limit_blocks_connector_install_402",
            "disabled_connectors_excluded_from_usage_counts",
            "starter_can_install_after_disable_frees_active_slot",
            "delete_endpoint_rejects_non_admin",
            "delete_endpoint_rejects_slug_mismatch",
            "delete_endpoint_allows_admin_for_matching_slug",
            "editor_permission_denied_then_allowed_after_grant",
            "action_matrix_reflects_backend_permissions",
            "tenant_plan_profile_change_updates_enforcement",
            "tenant_admin_plan_tier_mutation_blocked",
            "internal_plan_tier_endpoint_targets_requested_tenant",
            "audit_rows_for_plan_permission_install",
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
    console.error("Connector access entitlement integration test failed:");
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
    await prisma.$disconnect();
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
