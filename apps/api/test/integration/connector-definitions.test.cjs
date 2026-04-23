#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function resolveAuthPassword() {
  return String(process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
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

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `connector-definitions-${Date.now()}`;
  const workspaceSlug = `connector-defs-${Date.now()}`.slice(0, 24);
  const userId = `connector-definitions-admin-${Date.now()}`;
  const env = {
    ...process.env,
    PORT: String(port),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Connector Definitions Test" },
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
      password: resolveAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token from login response");

    const definitions = await apiRequest(baseUrl, "GET", "/connectors/definitions", token);
    assertStatus(definitions, 200, "list connector definitions");
    assert(Array.isArray(definitions.payload), "connector definitions payload must be an array");

    const bySlug = new Map(
      definitions.payload.map((item) => [String(item.slug ?? "").toLowerCase(), item]),
    );

    const amazon = bySlug.get("amazon-in");
    const meesho = bySlug.get("meesho");
    const flipkart = bySlug.get("flipkart");
    const shopify = bySlug.get("shopify");

    assert(amazon, "amazon-in definition missing from definitions response");
    assert(meesho, "meesho definition missing from definitions response");
    assert(flipkart, "flipkart definition missing from definitions response");
    assert(shopify, "shopify definition missing from definitions response");

    for (const item of [amazon, meesho, flipkart, shopify]) {
      assert(
        Object.prototype.hasOwnProperty.call(item, "implementationStatus"),
        `definition ${String(item.slug)} missing implementationStatus`,
      );
    }

    assert(amazon.implementationStatus === "full", `amazon-in implementationStatus expected full, got ${amazon.implementationStatus}`);
    assert(meesho.implementationStatus === "partial", `meesho implementationStatus expected partial, got ${meesho.implementationStatus}`);
    assert(flipkart.implementationStatus === "full", `flipkart implementationStatus expected full, got ${flipkart.implementationStatus}`);
    assert(shopify.implementationStatus === "partial", `shopify implementationStatus expected partial, got ${shopify.implementationStatus}`);
    assert(amazon.launchStage === "live", `amazon-in launchStage expected live, got ${amazon.launchStage}`);
    assert(shopify.launchStage === "manual", `shopify launchStage expected manual, got ${shopify.launchStage}`);
    assert(shopify.actions?.install?.allowed === true, `shopify install action should be allowed, got ${JSON.stringify(shopify.actions)}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          checked: {
            "amazon-in": amazon.implementationStatus,
            meesho: meesho.implementationStatus,
            flipkart: flipkart.implementationStatus,
            shopify: shopify.implementationStatus,
          },
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
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
  console.error("Connector definitions integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
