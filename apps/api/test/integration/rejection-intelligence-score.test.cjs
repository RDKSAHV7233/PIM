#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXwqyUAAAAASUVORK5CYII=";

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
    signal: AbortSignal.timeout(30_000),
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

async function login(baseUrl, workspaceSlug, userId) {
  const result = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password: getAuthPassword(),
    expiresInMinutes: 30,
  });
  assertStatus(result, 201, `login ${workspaceSlug}`);
  assert(typeof result.payload?.accessToken === "string" && result.payload.accessToken.length > 10, "missing access token");
  return result.payload.accessToken;
}

async function createCategory(baseUrl, token, name) {
  const result = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, { name });
  assertStatus(result, 201, "create category");
  return result.payload.id;
}

async function createProduct(baseUrl, token, categoryId, title) {
  const result = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
    title,
    brand: "Vexa PIM",
    description: "Rejection score proof product",
    categoryId,
    status: "draft",
    attributes: {},
  });
  assertStatus(result, 201, "create product");
  return result.payload.id;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5900 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `rejection-score-a-${runId}`;
  const tenantB = `rejection-score-b-${runId}`;
  const workspaceA = `rej-a-${runId}`.slice(0, 24);
  const workspaceB = `rej-b-${runId}`.slice(0, 24);
  const userA = `rejection-score-a-${runId}@example.com`;
  const userB = `rejection-score-b-${runId}@example.com`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceA]: { tenantId: tenantA, displayName: "Rejection Score A" },
      [workspaceB]: { tenantId: tenantB, displayName: "Rejection Score B" },
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

    const tokenA = await login(baseUrl, workspaceA, userA);
    const tokenB = await login(baseUrl, workspaceB, userB);

    const categoryA = await createCategory(baseUrl, tokenA, `Rejection Score Category A ${runId}`);
    const productA = await createProduct(baseUrl, tokenA, categoryA, `Rejection Score Product A ${runId}`);

    const noMediaScore = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${encodeURIComponent(productA)}/score?channel=flipkart`,
      tokenA,
    );
    assertStatus(noMediaScore, 200, "score product without media");
    assert(
      Array.isArray(noMediaScore.payload?.mediaIssues) &&
        noMediaScore.payload.mediaIssues.includes("No product media uploaded."),
      `expected missing media issue, payload=${JSON.stringify(noMediaScore.payload)}`,
    );

    const mediaUpload = await apiRequest(baseUrl, "POST", "/media/assets", tokenA, {
      productId: productA,
      fileName: `rejection-score-${runId}.png`,
      mimeType: "image/png",
      contentBase64: TINY_PNG_BASE64,
      width: 1,
      height: 1,
    });
    assertStatus(mediaUpload, 201, "upload product media");

    const withMediaScore = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${encodeURIComponent(productA)}/score?channel=flipkart`,
      tokenA,
    );
    assertStatus(withMediaScore, 200, "score product with media");
    assert(
      Array.isArray(withMediaScore.payload?.mediaIssues) &&
        !withMediaScore.payload.mediaIssues.includes("No product media uploaded."),
      `expected media issue to clear after upload, payload=${JSON.stringify(withMediaScore.payload)}`,
    );

    const crossTenantScore = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${encodeURIComponent(productA)}/score?channel=flipkart`,
      tokenB,
    );
    assertStatus(crossTenantScore, 404, "cross-tenant product score lookup");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          tenantB,
          productId: productA,
          validated: [
            "rejection_score_reports_missing_media_before_upload",
            "rejection_score_clears_media_issue_after_upload",
            "rejection_score_blocks_cross_tenant_product_access",
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
    console.error("Rejection intelligence score integration test failed:");
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
