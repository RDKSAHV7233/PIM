#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const MARKETPLACE_ID = "A21TJRUUN4KGV";

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

function resolveAuthPassword() {
  return String(process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password");
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
  setDefaultEnv("R2_PUBLIC_URL", "https://cdn.example.com/vexa-pim-local");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function createAmazonStub() {
  const calls = {
    oauth: [],
    sync: [],
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/auth/o2/token") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
          calls.oauth.push({
            grantType: params.get("grant_type") || "",
            clientId: params.get("client_id") || "",
            refreshToken: params.get("refresh_token") || "",
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              access_token: "amazon-stub-access-token",
              expires_in: 3600,
              token_type: "bearer",
            }),
          );
        });
        return;
      }

      const match = /^\/listings\/2021-08-01\/items\/([^/]+)\/([^?]+)(\?.*)?$/.exec(req.url || "");
      if (match && req.method === "GET") {
        const [, sellerId, sku] = match;
        calls.sync.push({
          sellerId,
          sku: decodeURIComponent(sku),
          auth: String(req.headers.authorization || ""),
          accessToken: String(req.headers["x-amz-access-token"] || ""),
          amzDate: String(req.headers["x-amz-date"] || ""),
          userAgent: String(req.headers["user-agent"] || ""),
          url: req.url || "",
        });
        res.statusCode = 422;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "INVALID",
            issues: [
              {
                code: "MISSING_REQUIRED_ATTRIBUTE",
                message: "Color is required for Amazon.",
                fieldPath: "attributes.color",
                severity: "ERROR",
              },
            ],
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Amazon stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
      });
    });
  });
}

async function runDirectAmazonStatusSync(input) {
  const { PrismaDirectService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "prisma",
    "prisma-direct.service.js",
  ));
  const { LoggerService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "common",
    "logging",
    "logger.service.js",
  ));
  const { AmazonConnector } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connectors",
    "amazon",
    "amazon.connector.js",
  ));

  const previousLwaBaseUrl = process.env.PIM_AMAZON_LWA_BASE_URL;
  const previousListingsBaseUrl = process.env.PIM_AMAZON_LISTINGS_BASE_URL;
  process.env.PIM_AMAZON_LWA_BASE_URL = input.stubBaseUrl;
  process.env.PIM_AMAZON_LISTINGS_BASE_URL = input.stubBaseUrl;

  const prismaDirect = new PrismaDirectService();
  await prismaDirect.onModuleInit();
  try {
    const logger = new LoggerService();
    const connector = new AmazonConnector(prismaDirect, logger);
    return await connector.syncSubmissionStatus(
      {
        tenantId: input.tenantId,
        installationId: input.installationId,
        connectorId: "amazon-in",
        sellerId: input.sellerId,
        marketplaceId: MARKETPLACE_ID,
        getAccessToken: async () => "",
      },
      `${input.externalRef}::${input.sku}`,
    );
  } finally {
    await prismaDirect.onModuleDestroy();
    if (previousLwaBaseUrl === undefined) {
      delete process.env.PIM_AMAZON_LWA_BASE_URL;
    } else {
      process.env.PIM_AMAZON_LWA_BASE_URL = previousLwaBaseUrl;
    }
    if (previousListingsBaseUrl === undefined) {
      delete process.env.PIM_AMAZON_LISTINGS_BASE_URL;
    } else {
      process.env.PIM_AMAZON_LISTINGS_BASE_URL = previousListingsBaseUrl;
    }
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7180 + Math.floor(Math.random() * 160);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-sync-${runId}`;
  const workspaceSlug = `amzs-${runId}`.slice(0, 24);
  const userId = `amazon-sync-user-${runId}`;
  const sellerId = `seller-${runId}`;
  const authPassword = resolveAuthPassword();
  const sku = `AMZS-${runId}`;
  const stub = await createAmazonStub();

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AMAZON_LWA_BASE_URL: stub.baseUrl,
    PIM_AMAZON_LISTINGS_BASE_URL: stub.baseUrl,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Amazon Status Sync Test" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
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

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: `sync-${runId}`,
      externalAccountRef: sellerId,
      clientId: "amazon-client-id",
      clientSecret: "amazon-client-secret",
      refreshToken: "amazon-refresh-token",
    });
    assertStatus(install, 201, "install amazon connector");
    const installationId = String(install.payload.id);

    const syncResult = await runDirectAmazonStatusSync({
      tenantId,
      installationId,
      sellerId,
      stubBaseUrl: stub.baseUrl,
      externalRef: "amz-status-submission-1",
      sku,
    });

    assert(String(syncResult.externalRef) === "amz-status-submission-1", `expected externalRef amz-status-submission-1, got ${String(syncResult.externalRef)}`);
    assert(String(syncResult.status) === "REJECTED", `expected REJECTED status, got ${String(syncResult.status)}`);
    assert(syncResult.resolvedAt instanceof Date, "expected resolvedAt for rejected Amazon sync");
    assert(Array.isArray(syncResult.channelErrors) && syncResult.channelErrors.length === 1, `expected one Amazon sync issue, got ${JSON.stringify(syncResult.channelErrors)}`);
    const issue = syncResult.channelErrors[0];
    assert(String(issue.code) === "MISSING_REQUIRED_ATTRIBUTE", `expected MISSING_REQUIRED_ATTRIBUTE, got ${String(issue.code)}`);
    assert(String(issue.fieldPath) === "attributes.color", `expected attributes.color field path, got ${String(issue.fieldPath)}`);
    assert(String(issue.sellerMessage) === "Color is required for Amazon.", `unexpected seller message ${String(issue.sellerMessage)}`);
    assert(String(issue.severity) === "error", `expected error severity, got ${String(issue.severity)}`);

    assert(stub.calls.oauth.length >= 1, "expected Amazon token exchange during status sync");
    assert(stub.calls.sync.length === 1, `expected one Amazon sync call, got ${stub.calls.sync.length}`);
    const syncCall = stub.calls.sync[0];
    assert(syncCall.sellerId === sellerId, `expected sellerId ${sellerId}, got ${syncCall.sellerId}`);
    assert(syncCall.sku === sku, `expected sku ${sku}, got ${syncCall.sku}`);
    assert(syncCall.auth === "", `unexpected auth header ${syncCall.auth}`);
    assert(syncCall.accessToken === "amazon-stub-access-token", `unexpected x-amz-access-token ${syncCall.accessToken}`);
    assert(/^\d{8}T\d{6}Z$/.test(syncCall.amzDate), `unexpected x-amz-date ${syncCall.amzDate}`);
    assert(syncCall.userAgent.includes("TEJPIMAmazonConnector/0.1"), `unexpected user-agent ${syncCall.userAgent}`);
    assert(
      syncCall.url.includes(
        `/${encodeURIComponent(sku)}?marketplaceIds=${encodeURIComponent(MARKETPLACE_ID)}&issueLocale=${encodeURIComponent("en_IN")}`,
      ),
      `expected SKU, marketplace ID, and issueLocale in sync URL, got ${syncCall.url}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          validated: [
            "amazon_status_sync_maps_provider_invalid_to_rejected",
            "amazon_status_sync_normalizes_provider_issues",
            "amazon_status_sync_uses_submission_sku_lookup",
            "amazon_status_sync_includes_documented_sp_api_headers",
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
    console.error("Amazon status sync integration test failed:");
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
    await new Promise((resolve) => stub.server.close(() => resolve()));
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
