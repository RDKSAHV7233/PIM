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
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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
  let payload = null;
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login ${userId}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, `missing access token for ${userId}`);
  return token;
}

async function createCategory(baseUrl, token, label) {
  const response = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
    name: label,
  });
  assertStatus(response, 201, `create category ${label}`);
  return response.payload;
}

async function advanceToApproved(baseUrl, token, product) {
  const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: product.version,
    title: product.title,
    description: product.description ?? "",
    brand: product.brand,
    categoryId: product.categoryId,
    hsnCode: product.hsnCode ?? undefined,
    gstRate: product.gstRate ?? undefined,
    attributes: product.attributes ?? {},
    status: "in_review",
  });
  if (toReview.status !== 200) {
    throw new Error(`advance to in_review failed: ${toReview.status} ${JSON.stringify(toReview.payload)}`);
  }
  const toApproved = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: toReview.payload.version,
    title: toReview.payload.title,
    description: toReview.payload.description ?? "",
    brand: toReview.payload.brand,
    categoryId: toReview.payload.categoryId,
    hsnCode: toReview.payload.hsnCode ?? undefined,
    gstRate: toReview.payload.gstRate ?? undefined,
    attributes: toReview.payload.attributes ?? {},
    status: "approved",
  });
  if (toApproved.status !== 200) {
    throw new Error(`advance to approved failed: ${toApproved.status} ${JSON.stringify(toApproved.payload)}`);
  }
  return toApproved.payload;
}

async function createProduct(baseUrl, token, categoryId, title) {
  const response = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
    title,
    brand: "Vexa PIM",
    description: "dashboard tenant boundary proof",
    categoryId,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: { material: "cotton" },
  });
  assertStatus(response, 201, `create product ${title}`);
  await advanceToApproved(baseUrl, token, response.payload);
  return response.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5860 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `dashboard-boundary-a-${runId}`;
  const tenantB = `dashboard-boundary-b-${runId}`;
  const workspaceSlugA = `dba-${runId}`.slice(0, 24);
  const workspaceSlugB = `dbb-${runId}`.slice(0, 24);
  const userA = `dashboard-boundary-a-${runId}`;
  const userB = `dashboard-boundary-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Dashboard Boundary A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Dashboard Boundary B" },
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

  try {
    await waitForHealth(baseUrl, 60_000);

    const tokenA = await login(baseUrl, userA, workspaceSlugA);
    const tokenB = await login(baseUrl, userB, workspaceSlugB);

    const categoryA = await createCategory(baseUrl, tokenA, `Dashboard Boundary A ${runId}`);
    const categoryB = await createCategory(baseUrl, tokenB, `Dashboard Boundary B ${runId}`);

    const productA1 = await createProduct(baseUrl, tokenA, categoryA.id, `Dashboard Boundary A1 ${runId}`);
    await createProduct(baseUrl, tokenA, categoryA.id, `Dashboard Boundary A2 ${runId}`);
    await createProduct(baseUrl, tokenB, categoryB.id, `Dashboard Boundary B1 ${runId}`);

    const installA = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", tokenA, {
      accountAlias: "primary",
    });
    assertStatus(installA, 201, "install flipkart for tenant A");

    const exportJobA = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${productA1.id}/export-jobs`,
      tokenA,
      { channel: "flipkart", maxRetries: 1 },
    );
    assertStatus(exportJobA, 201, "create export job for tenant A");

    const processA = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/export-jobs/${exportJobA.payload.id}/process`,
      tokenA,
    );
    assertStatus(processA, 201, "process export job for tenant A");

    const readinessA = await apiRequest(baseUrl, "GET", "/dashboard/readiness", tokenA);
    const readinessB = await apiRequest(baseUrl, "GET", "/dashboard/readiness", tokenB);
    assertStatus(readinessA, 200, "dashboard readiness tenant A");
    assertStatus(readinessB, 200, "dashboard readiness tenant B");

    const flipkartA = Array.isArray(readinessA.payload?.connectors)
      ? readinessA.payload.connectors.find((connector) => connector.slug === "flipkart")
      : null;
    const flipkartB = Array.isArray(readinessB.payload?.connectors)
      ? readinessB.payload.connectors.find((connector) => connector.slug === "flipkart")
      : null;
    assert(flipkartA, `tenant A readiness must include flipkart; payload=${JSON.stringify(readinessA.payload)}`);
    assert(flipkartB, `tenant B readiness must include flipkart; payload=${JSON.stringify(readinessB.payload)}`);
    assert(flipkartA.notConnected !== true, `tenant A flipkart row must reflect its installation; payload=${JSON.stringify(flipkartA)}`);
    assert(flipkartB.notConnected === true, `tenant B flipkart row must remain disconnected; payload=${JSON.stringify(flipkartB)}`);

    const operationsA = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", tokenA);
    const operationsB = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", tokenB);
    assertStatus(operationsA, 200, "dashboard operations summary tenant A");
    assertStatus(operationsB, 200, "dashboard operations summary tenant B");
    assert(
      Number(operationsA.payload?.installedConnectors ?? 0) >= 1,
      `tenant A must see its installed connector count; payload=${JSON.stringify(operationsA.payload)}`,
    );
    assert(
      Number(operationsB.payload?.installedConnectors ?? 0) === 0,
      `tenant B must not see tenant A installed connectors; payload=${JSON.stringify(operationsB.payload)}`,
    );

    const healthA = await apiRequest(baseUrl, "GET", "/dashboard/health", tokenA);
    const healthB = await apiRequest(baseUrl, "GET", "/dashboard/health", tokenB);
    assertStatus(healthA, 200, "dashboard health tenant A");
    assertStatus(healthB, 200, "dashboard health tenant B");
    assert(
      Number(healthA.payload?.snapshot?.totalSkus ?? 0) === 2,
      `tenant A dashboard health must count only tenant A products; payload=${JSON.stringify(healthA.payload)}`,
    );
    assert(
      Number(healthB.payload?.snapshot?.totalSkus ?? 0) === 1,
      `tenant B dashboard health must count only tenant B products; payload=${JSON.stringify(healthB.payload)}`,
    );

    console.log(JSON.stringify({
      status: "ok",
      tenantA,
      tenantB,
      validated: [
        "dashboard_readiness_is_tenant_scoped",
        "dashboard_operations_summary_is_tenant_scoped",
        "dashboard_health_snapshot_is_tenant_scoped",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Dashboard tenant boundary integration test failed:");
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
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore cleanup failures
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
