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
    publish: [],
    sync: [],
  };
  let submissionCount = 0;

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
      if (match && req.method === "PUT") {
        const [, sellerId, sku] = match;
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
          submissionCount += 1;
          calls.publish.push({
            sellerId,
            sku: decodeURIComponent(sku),
            auth: String(req.headers.authorization || ""),
            accessToken: String(req.headers["x-amz-access-token"] || ""),
            amzDate: String(req.headers["x-amz-date"] || ""),
            userAgent: String(req.headers["user-agent"] || ""),
            payload,
            query: req.url || "",
          });
          res.statusCode = 202;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              submissionId: `amz-submission-${submissionCount}`,
              status: "ACCEPTED",
            }),
          );
        });
        return;
      }

      if (match && req.method === "GET") {
        const [, sellerId, sku] = match;
        calls.sync.push({
          sellerId,
          sku: decodeURIComponent(sku),
          auth: String(req.headers.authorization || ""),
          accessToken: String(req.headers["x-amz-access-token"] || ""),
          query: req.url || "",
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "PROCESSING", issues: [] }));
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

async function runDirectAmazonConnector(input) {
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
    const ctx = {
      tenantId: input.tenantId,
      installationId: input.installationId,
      connectorId: "amazon-in",
      sellerId: input.sellerId,
      marketplaceId: MARKETPLACE_ID,
      getAccessToken: async () => "",
    };
    const publishResult = await connector.publishProduct(
      ctx,
      input.productPayload,
    );
    const updateResult = await connector.updateProduct(
      ctx,
      input.productPayload,
      input.externalRef,
    );
    const syncResult = await connector.syncSubmissionStatus(
      ctx,
      `${input.externalRef}::${input.productPayload.sku}`,
    );
    return {
      publishResult,
      updateResult,
      syncResult,
    };
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
  const apiPort = 7040 + Math.floor(Math.random() * 160);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-publish-${runId}`;
  const workspaceSlug = `amzp-${runId}`.slice(0, 24);
  const userId = `amazon-user-${runId}`;
  const sellerId = `seller-${runId}`;
  const authPassword = resolveAuthPassword();
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
      [workspaceSlug]: { tenantId, displayName: "Amazon Publish Test" },
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

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Amazon Publish Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Amazon Publish Product ${runId}`,
      description: "Real Amazon publish initiation test.",
      brand: "Vexa PIM",
      categoryId,
      status: "draft",
      attributes: {
        color: "black",
        material: "cotton",
        size: "M",
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
        skuCode: `AMZ-${runId}`,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 8,
        status: "draft",
      },
    );
    assertStatus(variant, 201, "create variant");

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: `publish-${runId}`,
      externalAccountRef: sellerId,
      clientId: "amazon-client-id",
      clientSecret: "amazon-client-secret",
      refreshToken: "amazon-refresh-token",
    });
    assertStatus(install, 201, "install amazon connector");
    const installationId = String(install.payload.id);

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${encodeURIComponent(productId)}/export-jobs`,
      token,
      {
        channel: "amazon",
        maxRetries: 1,
      },
    );
    assertStatus(createJob, 400, "public export job remains launch-gated");
    assert(
      String(createJob.payload?.message ?? "").includes("does not support capability 'PUBLISH'"),
      `expected capability gate, got ${JSON.stringify(createJob.payload)}`,
    );

    const direct = await runDirectAmazonConnector({
      tenantId,
      installationId,
      sellerId,
      stubBaseUrl: stub.baseUrl,
      externalRef: "amz-submission-1",
      productPayload: {
        sku: `AMZ-${runId}`,
        title: `Amazon Publish Product ${runId}`,
        description: "Real Amazon publish initiation test.",
        brand: "Vexa PIM",
        hsnCode: "62046200",
        gstRate: 12,
        mrp: 1999,
        sellingPrice: 1499,
        mainImageUrl: "https://cdn.example.com/products/p1.jpg",
        attributes: {
          color: "black",
          material: "cotton",
          size: "M",
        },
        productType: "general",
      },
    });

    assert(String(direct.publishResult.externalRef) === "amz-submission-1", `expected publish externalRef amz-submission-1, got ${String(direct.publishResult.externalRef)}`);
    assert(String(direct.publishResult.status) === "PENDING", `expected publish status PENDING, got ${String(direct.publishResult.status)}`);
    assert(direct.publishResult.isAsync === true, "expected publish path to stay async");
    assert(String(direct.updateResult.externalRef) === "amz-submission-2", `expected update externalRef amz-submission-2, got ${String(direct.updateResult.externalRef)}`);
    assert(String(direct.updateResult.status) === "PENDING", `expected update status PENDING, got ${String(direct.updateResult.status)}`);
    assert(direct.updateResult.isAsync === true, "expected update path to stay async");
    assert(String(direct.syncResult.status) === "PENDING", `expected sync status PENDING, got ${String(direct.syncResult.status)}`);

    assert(stub.calls.publish.length >= 2, `expected publish and update calls, got ${stub.calls.publish.length}`);
    const publishCall = stub.calls.publish[0];
    assert(publishCall.sellerId === sellerId, `expected sellerId ${sellerId}, got ${publishCall.sellerId}`);
    assert(publishCall.sku === `AMZ-${runId}`, `expected sku AMZ-${runId}, got ${publishCall.sku}`);
    assert(publishCall.auth === "", `unexpected auth header ${publishCall.auth}`);
    assert(publishCall.accessToken === "amazon-stub-access-token", `unexpected x-amz-access-token ${publishCall.accessToken}`);
    assert(/^\d{8}T\d{6}Z$/.test(publishCall.amzDate), `unexpected x-amz-date ${publishCall.amzDate}`);
    assert(publishCall.userAgent.includes("TEJPIMAmazonConnector/0.1"), `unexpected user-agent ${publishCall.userAgent}`);
    assert(
      publishCall.query.includes(`issueLocale=${encodeURIComponent("en_IN")}`),
      `expected issueLocale in publish query, got ${publishCall.query}`,
    );
    assert(Array.isArray(publishCall.payload?.marketplaceIds), "expected marketplaceIds array in publish payload");
    assert(String(publishCall.payload.marketplaceIds[0]) === MARKETPLACE_ID, `expected marketplace id ${MARKETPLACE_ID}`);
    assert(
      String(publishCall.payload.attributes?.item_name?.[0]?.value) === `Amazon Publish Product ${runId}`,
      "expected docs-aligned item_name payload",
    );
    assert(
      String(publishCall.payload.attributes?.brand?.[0]?.value) === "Vexa PIM",
      "expected docs-aligned brand payload",
    );
    assert(
      String(publishCall.payload.attributes?.main_product_image_locator?.[0]?.media_location) ===
        "https://cdn.example.com/products/p1.jpg",
      "expected docs-aligned image locator payload",
    );
    assert(
      Number(publishCall.payload.attributes?.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax) === 1499,
      "expected docs-aligned purchasable_offer payload",
    );
    assert(
      String(publishCall.payload.attributes?.purchasable_offer?.[0]?.currency) === "INR",
      "expected INR pricing currency",
    );
    assert(
      Number(publishCall.payload.attributes?.list_price?.[0]?.value_with_tax) === 1999,
      "expected docs-aligned list_price payload",
    );
    assert(
      String(publishCall.payload.attributes?.condition_type?.[0]?.value) === "new_new",
      "expected condition_type payload",
    );

    assert(stub.calls.sync.length >= 1, `expected at least one sync call, got ${stub.calls.sync.length}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          publishExternalRef: direct.publishResult.externalRef,
          updateExternalRef: direct.updateResult.externalRef,
          validated: [
            "amazon_public_publish_remains_launch_gated",
            "amazon_direct_publish_calls_live_connector_path",
            "amazon_publish_payload_matches_documented_listings_items_shape",
            "amazon_publish_calls_include_documented_sp_api_headers",
            "amazon_update_path_reuses_live_listing_submission",
            "amazon_sync_path_can_poll_pending_submission",
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
    console.error("Amazon publish job integration test failed:");
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
