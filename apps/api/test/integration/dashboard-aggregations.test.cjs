#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
}

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

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
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

function getMonthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5800 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `dashboard-tenant-${runId}`;
  const workspaceSlug = `dash-${runId}`.slice(0, 24);
  const userId = `dashboard-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Dashboard" },
    }),
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
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  const prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Dashboard Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const requiredAttr = await apiRequest(baseUrl, "POST", `/taxonomy/categories/${category.payload.id}/attributes`, token, {
      key: "material",
      name: "Material",
      dataType: "text",
      required: true,
      appliesTo: "product",
    });
    assertStatus(requiredAttr, 201, "create required attribute");

    const lowProduct = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Dashboard Low ${runId}`,
      brand: "Vexa PIM",
      description: "",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(lowProduct, 201, "create low product");

    const highProduct = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Dashboard High ${runId}`,
      brand: "Vexa PIM",
      description: "Complete product",
      categoryId: category.payload.id,
      hsnCode: "62046200",
      gstRate: 18,
      status: "draft",
      attributes: { color: "black", size: "M", material: "cotton" },
    });
    assertStatus(highProduct, 201, "create high product");

    const installFlipkart = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(installFlipkart, 201, "install flipkart");

    const exportJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${highProduct.payload.id}/export-jobs`,
      token,
      { channel: "flipkart", maxRetries: 1 },
    );
    assertStatus(exportJob, 201, "create export job");

    const processJob = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${exportJob.payload.id}/process`, token);
    assertStatus(processJob, 201, "process export job");

    const readiness1 = await apiRequest(baseUrl, "GET", "/dashboard/readiness", token);
    assertStatus(readiness1, 200, "dashboard readiness first call");
    assert(Array.isArray(readiness1.payload.connectors), "readiness.connectors must be an array");
    assert(typeof readiness1.payload.asOf === "string", "readiness.asOf must be a string");
    const flipkartRow = readiness1.payload.connectors.find((connector) => connector.slug === "flipkart");
    assert(flipkartRow, "readiness must include flipkart row");
    assert(
      typeof flipkartRow.ready === "number" &&
        typeof flipkartRow.blocked === "number" &&
        typeof flipkartRow.pending === "number",
      "flipkart readiness counts must be numeric",
    );

    const readiness2 = await apiRequest(baseUrl, "GET", "/dashboard/readiness", token);
    assertStatus(readiness2, 200, "dashboard readiness second call");
    assert(
      readiness2.payload.asOf === readiness1.payload.asOf,
      "readiness second call should hit cache and keep same asOf within TTL",
    );

    const health1 = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", token);
    assertStatus(health1, 200, "catalog-health first call");
    assert(typeof health1.payload.averageCompleteness === "number", "averageCompleteness must be numeric");
    assert(typeof health1.payload.belowThreshold === "number", "belowThreshold must be numeric");
    assert(typeof health1.payload.missingMainImage === "number", "missingMainImage must be numeric");
    assert(typeof health1.payload.missingRequiredAttrs === "number", "missingRequiredAttrs must be numeric");
    assert(Array.isArray(health1.payload.distribution), "distribution must be an array");
    assert(typeof health1.payload.asOf === "string", "catalog-health asOf must be a string");
    assert(health1.payload.belowThreshold >= 1, "expected at least one below-threshold product");

    const health2 = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", token);
    assertStatus(health2, 200, "catalog-health second call");
    assert(
      health2.payload.asOf === health1.payload.asOf,
      "catalog-health second call should hit cache and keep same asOf within TTL",
    );

    const dashboardHealth = await apiRequest(baseUrl, "GET", "/dashboard/health", token);
    assertStatus(dashboardHealth, 200, "dashboard health with trend");
    assert(typeof dashboardHealth.payload.asOf === "string", "dashboard health asOf must be string");
    assert(dashboardHealth.payload.snapshot, "dashboard health must include snapshot");
    assert(Array.isArray(dashboardHealth.payload.trend), "dashboard health trend must be array");
    assert(
      typeof dashboardHealth.payload.pendingApprovals === "number",
      "dashboard health pendingApprovals must be number",
    );
    assert(
      typeof dashboardHealth.payload.snapshot.totalSkus === "number",
      "dashboard health snapshot.totalSkus must be number",
    );
    assert(
      typeof dashboardHealth.payload.snapshot.openIssuesBlocking === "number",
      "dashboard health snapshot.openIssuesBlocking must be number",
    );
    assert(
      typeof dashboardHealth.payload.snapshot.publishReadyByConnector === "object",
      "dashboard health snapshot.publishReadyByConnector must be object",
    );
    assert(dashboardHealth.payload.trend.length >= 1, "dashboard health trend must have at least one point");

    const operations1 = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", token);
    assertStatus(operations1, 200, "dashboard operations summary first call");
    assert(
      typeof operations1.payload.activeConnectors === "number",
      "dashboard operations summary activeConnectors must be number",
    );
    assert(
      typeof operations1.payload.installedConnectors === "number",
      "dashboard operations summary installedConnectors must be number",
    );
    assert(
      typeof operations1.payload.failedImportJobs === "number",
      "dashboard operations summary failedImportJobs must be number",
    );
    assert(
      typeof operations1.payload.failedSubmissionJobs === "number",
      "dashboard operations summary failedSubmissionJobs must be number",
    );
    assert(
      typeof operations1.payload.deadLetterJobs === "number",
      "dashboard operations summary deadLetterJobs must be number",
    );
    assert(
      typeof operations1.payload.jobsNeedingRetry === "number",
      "dashboard operations summary jobsNeedingRetry must be number",
    );
    assert(
      typeof operations1.payload.asOf === "string",
      "dashboard operations summary asOf must be string",
    );
    assert(
      operations1.payload.jobsNeedingRetry ===
        operations1.payload.failedSubmissionJobs + operations1.payload.deadLetterJobs,
      "dashboard operations summary jobsNeedingRetry must equal failed submissions plus dead-letter jobs",
    );
    assert(
      operations1.payload.installedConnectors >= operations1.payload.activeConnectors,
      "dashboard operations summary installed connectors must be at least active connectors",
    );

    const operations2 = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", token);
    assertStatus(operations2, 200, "dashboard operations summary second call");
    assert(
      operations2.payload.asOf === operations1.payload.asOf,
      "dashboard operations summary second call should hit cache and keep same asOf within TTL",
    );

    const usage = await apiRequest(baseUrl, "GET", "/billing/usage", token);
    assertStatus(usage, 200, "billing usage");
    assert(typeof usage.payload.planTier === "string", "billing usage must include planTier");
    assert(typeof usage.payload.month === "string", "billing usage must include month");
    assert(typeof usage.payload.skus?.current === "number", "billing usage skus.current must be number");

    const usageRows = await prisma.$queryRawUnsafe(
      `
      SELECT
        "skuCount" AS "skuCount",
        "submissionCount" AS "submissionCount"
      FROM "PlanUsage"
      WHERE "tenantKey" = $1 AND "month" = $2
      LIMIT 1
      `,
      tenantId,
      getMonthKey(),
    );
    assert(Array.isArray(usageRows) && usageRows.length === 1, "expected PlanUsage row for tenant");
    const usageRow = usageRows[0];
    assert(
      Number(usageRow.skuCount) === usage.payload.skus.current,
      "billing usage skus.current must match PlanUsage.skuCount",
    );
    assert(
      Number(usageRow.submissionCount) === usage.payload.submissions.current,
      "billing usage submissions.current must match PlanUsage.submissionCount",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "dashboard_readiness_endpoint_shape",
          "dashboard_catalog_health_endpoint_shape",
          "dashboard_health_snapshot_and_trend_endpoint_shape",
          "dashboard_operations_summary_endpoint_shape",
          "dashboard_endpoints_cache_with_bounded_ttl",
          "billing_usage_matches_plan_usage_source_of_truth",
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
    console.error("Dashboard aggregations integration test failed:");
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



