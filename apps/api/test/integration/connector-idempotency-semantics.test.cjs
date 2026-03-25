#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const http = require("node:http");
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
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
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

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
              requestId: `fk-request-${calls.publish.length}`,
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

async function seedCredentials(repoRoot, tenantKey, installationId) {
  const { PrismaDirectService } = require(path.join(
    repoRoot,
    "apps",
    "api",
    "dist",
    "prisma",
    "prisma-direct.service.js",
  ));
  const { LoggerService } = require(path.join(
    repoRoot,
    "apps",
    "api",
    "dist",
    "common",
    "logging",
    "logger.service.js",
  ));
  const { ConnectorCredentialEncryptionService } = require(path.join(
    repoRoot,
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
  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `idempotency-tenant-${runId}`;
  const userId = `idempotency-user-${runId}`;
  const stub = await createFlipkartStub();
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_FLIPKART_OAUTH_BASE_URL: stub.baseUrl,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin" },
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
      db: {
        url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
      },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: tenantId,
      userId,
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const accessToken = login.payload?.accessToken;
    assert(typeof accessToken === "string" && accessToken.length > 10, "missing access token from login");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", accessToken, {
      name: `Idempotency Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", accessToken, {
      title: `Idempotency Product ${runId}`,
      brand: "TEJ PIM",
      description: "Initial row intentionally missing HSN/GST/size",
      categoryId: category.payload.id,
      status: "draft",
      attributes: { color: "black" },
    });
    assertStatus(product, 201, "create product");

    const installFlipkart = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", accessToken, {
      accountAlias: "primary",
    });
    assertStatus(installFlipkart, 201, "install flipkart connector");
    await seedCredentials(REPO_ROOT, tenantId, String(installFlipkart.payload.id));

    const createVariant = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${product.payload.id}/variants`,
      accessToken,
      {
        skuCode: `FK-IDEMP-${runId}`,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 5,
        status: "draft",
      },
    );
    assertStatus(createVariant, 201, "create variant");

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      accessToken,
      {
        channel: "flipkart",
        maxRetries: 3,
      },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = createJob.payload.id;
    const stableKey = `${jobId}:PUBLISH`;
    const installationId = String(installFlipkart.payload.id);

    const processAttempt1 = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/process`, accessToken);
    assertStatus(processAttempt1, 201, "process attempt 1");
    assert(
      processAttempt1.payload.status === "retrying" || processAttempt1.payload.status === "dead_letter",
      `expected retrying/dead_letter on first attempt, got ${processAttempt1.payload.status}`,
    );

    const updateProduct = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, accessToken, {
      expectedVersion: Number(product.payload.version ?? 1),
      title: product.payload.title,
      brand: product.payload.brand,
      categoryId: product.payload.categoryId,
      status: product.payload.status,
      description: "Now export-ready",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        color: "black",
        size: "M",
        material: "cotton",
        mainImageUrl: "https://cdn.example.com/products/idempotency.jpg",
      },
    });
    assertStatus(updateProduct, 200, "update product");

    const requeue = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/requeue`, accessToken);
    assertStatus(requeue, 201, "requeue export job");

    const processAttempt2 = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/process`, accessToken);
    assertStatus(processAttempt2, 201, "process attempt 2");
    assert(processAttempt2.payload.status === "completed", `expected completed on second attempt, got ${processAttempt2.payload.status}`);

    // RLS-BYPASS: manual tenant filter
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        idempotency_key AS "idempotencyKey",
        attempt_number AS "attemptNumber"
      FROM connector_submissions
      WHERE tenant_key = $1
        AND installation_id = $2
        AND idempotency_key = $3
      `,
      tenantId,
      installationId,
      stableKey,
    );
    assert(Array.isArray(rows) && rows.length === 1, `expected 1 connector_submission row for ${stableKey}`);
    const row = rows[0];
    assert(row.idempotencyKey === stableKey, `expected stable key ${stableKey}, got ${String(row.idempotencyKey)}`);
    assert(
      Number(row.attemptNumber) >= 2,
      `expected attemptNumber to increment on retry (>=2), got ${String(row.attemptNumber)}`,
    );

    // RLS-BYPASS: manual tenant filter
    const keyRows = await prisma.$queryRawUnsafe(
      `
      SELECT idempotency_key AS "idempotencyKey"
      FROM connector_submissions
      WHERE tenant_key = $1
        AND installation_id = $2
        AND idempotency_key LIKE $3
      `,
      tenantId,
      installationId,
      `${jobId}:%`,
    );
    assert(
      Array.isArray(keyRows) && keyRows.every((entry) => entry.idempotencyKey === stableKey),
      "found non-stable idempotency keys for same job (attempt-number keyed duplicates detected)",
    );

    const otherTenantId = `${tenantId}-b`;
    const otherInstallationId = randomUUID();
    const otherSubmissionId = randomUUID();
    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id,
        tenant_key,
        connector_id,
        account_alias,
        status,
        metadata,
        installed_by
      ) VALUES ($1, $2, $3, $4, 'ACTIVE', '{}'::jsonb, $5)
      `,
      otherInstallationId,
      otherTenantId,
      "cdef_flipkart",
      "primary",
      "integration-test",
    );
    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO connector_submissions (
        id,
        tenant_key,
        installation_id,
        product_id,
        variant_id,
        idempotency_key,
        submission_type,
        source,
        attempt_number,
        status,
        external_ref,
        payload_snapshot,
        payload_snapshot_url,
        channel_errors,
        submitted_at,
        resolved_at
      ) VALUES (
        $1, $2, $3, $4, NULL, $5, 'PUBLISH', 'LOCAL_RULES', 1, 'PENDING', NULL, '{}'::jsonb, NULL, '[]'::jsonb, NOW(), NULL
      )
      `,
      otherSubmissionId,
      otherTenantId,
      otherInstallationId,
      String(product.payload.id),
      stableKey,
    );
    // RLS-BYPASS: manual tenant filter
    const crossTenantRows = await prisma.$queryRawUnsafe(
      `
      SELECT tenant_key AS "tenantKey"
      FROM connector_submissions
      WHERE idempotency_key = $1
      ORDER BY tenant_key ASC
      `,
      stableKey,
    );
    assert(
      Array.isArray(crossTenantRows) && crossTenantRows.length >= 2,
      "expected same idempotency key to be allowed across tenants",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          jobId,
          idempotencyKey: stableKey,
          validated: [
            "stable_idempotency_key_jobid_operation",
            "attempt_number_increments_separately",
            "no_duplicate_submission_rows_for_retries",
            "same_idempotency_key_allowed_across_tenants",
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
    console.error("Connector idempotency semantics integration test failed:");
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



