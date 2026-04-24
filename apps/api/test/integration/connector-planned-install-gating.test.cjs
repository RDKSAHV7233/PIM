#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
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
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire free TCP port")));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
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

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `connector-shopify-guided-${Date.now()}`;
  const workspaceSlug = `shopify-guided-${Date.now()}`.slice(0, 24);
  const userId = `shopify-guided-admin-${Date.now()}`;
  const commercialToken = `commercial-ops-${Date.now()}`;
  const env = {
    ...process.env,
    PORT: String(port),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Connector Shopify Guided Install" },
    }),
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
  };

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

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
      userId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const enterprisePlan = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "ENTERPRISE");
    assertStatus(enterprisePlan, 201, "set enterprise plan tier");

    const installMissingDomain = await apiRequest(baseUrl, "POST", "/connectors/shopify/install", token, {
      accountAlias: "missing-domain",
    });
    assertStatus(installMissingDomain, 400, "require Shopify shop domain");
    assert(
      String(installMissingDomain.payload?.error ?? "") === "SHOPIFY_SHOP_DOMAIN_REQUIRED",
      `expected SHOPIFY_SHOP_DOMAIN_REQUIRED, got ${JSON.stringify(installMissingDomain.payload)}`,
    );

    const install = await apiRequest(baseUrl, "POST", "/connectors/shopify/install", token, {
      accountAlias: "primary",
      shopDomain: "vishaltest112.myshopify.com",
    });
    assertStatus(install, 201, "Shopify install");
    assert(
      String(install.payload?.status ?? "") === "ACTIVE",
      `expected Shopify install to create ACTIVE account, got ${JSON.stringify(install.payload)}`,
    );

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT ci.id, ci.status, ci.external_account_ref AS "externalAccountRef", ci.metadata
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
        AND cd.slug = 'shopify'
      `,
      tenantId,
    );
    assert(Array.isArray(rows) && rows.length === 1, "Shopify install should create one connector_installations row");
    assert(String(rows[0].status) === "ACTIVE", `expected ACTIVE install row, got ${JSON.stringify(rows[0])}`);
    assert(
      String(rows[0].externalAccountRef ?? "") === "vishaltest112.myshopify.com",
      `expected externalAccountRef to default to shop domain, got ${JSON.stringify(rows[0])}`,
    );
    assert(
      rows[0].metadata?.shopDomain === "vishaltest112.myshopify.com",
      `expected Shopify metadata to record shopDomain, got ${JSON.stringify(rows[0].metadata)}`,
    );
    assert(
      rows[0].metadata?.connectionStage === "awaiting_managed_install",
      `expected Shopify metadata to record awaiting managed install stage, got ${JSON.stringify(rows[0].metadata)}`,
    );

    const credentialRows = await prisma.$queryRawUnsafe(
      `
      SELECT credential_type AS "credentialType"
      FROM connector_credentials
      WHERE tenant_key = $1
        AND installation_id = $2
      `,
      tenantId,
      String(rows[0].id),
    );
    assert(
      Array.isArray(credentialRows) && credentialRows.some((row) => row.credentialType === "shop_domain"),
      "Shopify install should persist encrypted shop_domain credential",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "shopify_live_launch_stage_is_installable",
            "shopify_install_requires_shop_domain",
            "shopify_install_creates_active_installation",
            "shopify_install_persists_shop_context",
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
    console.error("Shopify install integration test failed:");
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
          // ignore cleanup failure
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
