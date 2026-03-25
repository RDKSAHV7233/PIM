#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_SCOPE = "mapping_high_risk";

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
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://cdn.example.com/pim1-local");
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

async function issueStepUp(baseUrl, token) {
  const result = await apiRequest(baseUrl, "POST", "/auth/step-up", token, {
    password: "pim1-demo-password",
    scope: STEP_UP_SCOPE,
  });
  assertStatus(result, 201, "issue step-up token");
  const stepUpToken = String(result.payload?.stepUpToken ?? "");
  assert(stepUpToken.length > 10, "missing step-up token");
  return stepUpToken;
}

function createFlipkartStub() {
  const calls = {
    oauth: [],
    publish: [],
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/oauth-service/oauth/token") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
          calls.oauth.push({
            grantType: params.get("grant_type") || "",
            auth: String(req.headers.authorization || ""),
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              access_token: "stub-access-token",
              expires_in: 3600,
              token_type: "bearer",
            }),
          );
        });
        return;
      }

      if (req.method === "POST" && req.url === "/sellers/listings/v3/skus/listings/update") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          let payload = {};
          try {
            payload = bodyText ? JSON.parse(bodyText) : {};
          } catch {
            payload = {};
          }
          calls.publish.push({
            auth: String(req.headers.authorization || ""),
            requestId: String(req.headers["x-flipkart-request-id"] || ""),
            payload,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              requestId: "fk-request-1",
              status: "SUCCESS",
            }),
          );
        });
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Flipkart stub address."));
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

async function seedCredentials(tenantKey, installationId) {
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
  const { ConnectorCredentialEncryptionService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connector-installer",
    "credential-encryption.service.js",
  ));

  const prismaDirect = new PrismaDirectService();
  await prismaDirect.onModuleInit();
  try {
    const logger = new LoggerService();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "client_id",
      plainValue: "flipkart-client-id",
    });
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "client_secret",
      plainValue: "flipkart-client-secret",
    });
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "refresh_token",
      plainValue: "flipkart-refresh-token",
    });
  } finally {
    await prismaDirect.onModuleDestroy();
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6900 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `flipkart-publish-${runId}`;
  const workspaceSlug = `fkp-${runId}`.slice(0, 24);
  const userId = `flipkart-user-${runId}`;
  const stub = await createFlipkartStub();

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_FLIPKART_OAUTH_BASE_URL: stub.baseUrl,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Flipkart Publish Test" },
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

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Flipkart Publish Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Flipkart Publish Product ${runId}`,
      description: "Real publish initiation test.",
      brand: "TEJ PIM",
      categoryId,
      status: "draft",
      attributes: {
        color: "black",
        size: "M",
        mainImageUrl: "https://cdn.example.com/products/p1.jpg",
        packageWeight: 600,
        packageLength: 300,
        packageBreadth: 220,
        packageHeight: 45,
      },
      hsnCode: "62046200",
      gstRate: 12,
    });
    assertStatus(product, 201, "create product");
    const productId = String(product.payload.id);

    const variant = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${encodeURIComponent(productId)}/variants`,
      token,
      {
        skuCode: `FK-${runId}`,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 8,
        status: "draft",
      },
    );
    assertStatus(variant, 201, "create variant");

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: `publish-${runId}`,
      externalAccountRef: `seller-${runId}`,
    });
    assertStatus(install, 201, "install flipkart connector");
    const installationId = String(install.payload.id);

    await seedCredentials(tenantId, installationId);

    const createDraft = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      token,
      {
        categoryScope: "*",
        mappingLevel: "tenant_connector_default",
        connectorDefinitionId: "flipkart",
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "product_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsn_code",
            gstRate: "gst_rate",
            "attributes.color": "color",
            "attributes.size": "size",
          },
        },
        fallbackPolicy: {
          enabled: false,
        },
        fallbackAckRequired: false,
      },
    );
    assertStatus(createDraft, 201, "create connector mapping draft");
    const versionId = String(createDraft.payload.id);

    const validateVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`,
      token,
      {},
    );
    assertStatus(validateVersion, 201, "validate connector mapping version");

    const stepUpToken = await issueStepUp(baseUrl, token);
    const publishVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      token,
      { confirm: true },
      { [STEP_UP_HEADER]: stepUpToken },
    );
    assertStatus(publishVersion, 201, "publish connector mapping version");

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${encodeURIComponent(productId)}/export-jobs`,
      token,
      {
        channel: "flipkart",
        maxRetries: 1,
      },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = String(createJob.payload.id);

    const processed = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/process`, token);
    assertStatus(processed, 201, "process export job");
    assert(String(processed.payload?.status) === "completed", `expected completed job, got ${String(processed.payload?.status)}`);

    const submissions = await apiRequest(baseUrl, "GET", "/submissions?connectorSlug=flipkart&status=PENDING", token);
    assertStatus(submissions, 200, "list flipkart submissions");
    assert(Array.isArray(submissions.payload) && submissions.payload.length >= 1, "expected at least one flipkart submission");
    const submission = submissions.payload[0];
    assert(String(submission.externalRef) === "fk-request-1", `expected externalRef fk-request-1, got ${String(submission.externalRef)}`);
    assert(String(submission.source) === "LIVE_API", `expected LIVE_API source, got ${String(submission.source)}`);
    assert(String(submission.status) === "PENDING", `expected PENDING submission, got ${String(submission.status)}`);

    assert(stub.calls.publish.length >= 1, `expected at least one publish call, got ${stub.calls.publish.length}`);
    const publishCall = stub.calls.publish[0];
    assert(publishCall.auth === "Bearer stub-access-token", `unexpected auth header ${publishCall.auth}`);
    assert(typeof publishCall.requestId === "string" && publishCall.requestId.length > 10, "missing X-Flipkart-Request-Id");
    assert(Array.isArray(publishCall.payload?.skuData), "expected skuData array in publish payload");
    assert(String(publishCall.payload.skuData[0]?.skuId) === `FK-${runId}`, "expected variant SKU in publish payload");
    assert(Number(publishCall.payload.skuData[0]?.sellingPrice) === 149900, "expected paise conversion in publish payload");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          jobId,
          externalRef: submission.externalRef,
          validated: [
            "flipkart_publish_job_calls_live_connector_path",
            "flipkart_submission_records_live_external_ref",
            "flipkart_publish_payload_uses_variant_pricing_and_sku",
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
    console.error("Flipkart publish job integration test failed:");
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
