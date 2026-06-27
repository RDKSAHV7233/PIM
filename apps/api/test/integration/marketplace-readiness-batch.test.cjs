#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_START_SCRIPT = path.join(REPO_ROOT, "apps", "api", "scripts", "start-built-api.cjs");
const DEFAULT_BOOT_TIMEOUT_MS = REPO_ROOT.startsWith("/mnt/") ? 600_000 : 60_000;

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
}

function getBootTimeoutMs() {
  const raw = process.env.PIM_API_BOOT_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_BOOT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BOOT_TIMEOUT_MS;
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("NODE_COMPILE_CACHE", "/tmp/pim1-node-compile-cache");
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

function readinessMapFor(item) {
  return Object.fromEntries(
    (Array.isArray(item?.readiness) ? item.readiness : []).map((entry) => [entry.channel, entry]),
  );
}

function expectedErrorCountFromSimulation(simulation) {
  const missingFieldKeys = new Set(
    (Array.isArray(simulation?.missingFields) ? simulation.missingFields : [])
      .map((fieldPath) => String(fieldPath ?? "").trim().toLowerCase()),
  );
  const channelErrorCount = (Array.isArray(simulation?.channelIssues) ? simulation.channelIssues : []).filter((issue) => {
    if (issue?.severity !== "error") {
      return false;
    }
    const fieldPath = String(issue.fieldPath ?? "").trim().toLowerCase();
    return !(issue.code === "CHANNEL_REQUIRED_FIELD" && missingFieldKeys.has(fieldPath));
  }).length;
  return missingFieldKeys.size + Number(simulation?.complianceSummary?.errorCount ?? 0) + channelErrorCount;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_START_SCRIPT)) {
    throw new Error(`API start script not found at ${API_START_SCRIPT}.`);
  }

  const runId = Date.now().toString();
  const apiPort = 5850 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `readiness-batch-tenant-${runId}`;
  const workspaceSlug = `ready-${runId}`.slice(0, 24);
  const userId = `readiness-batch-user-${runId}`;
  const env = {
    ...process.env,
    API_BOOT_DEBUG: process.env.API_BOOT_DEBUG || "true",
    NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || "/tmp/pim1-node-compile-cache",
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Readiness Batch" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_START_SCRIPT], {
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
    try {
      await waitForHealth(baseUrl, getBootTimeoutMs());
    } catch (error) {
      const details = [];
      if (stderrBuffer.length > 0) {
        details.push(`api stderr tail:\n${stderrBuffer.slice(-40).join("")}`);
      }
      if (stdoutBuffer.length > 0) {
        details.push(`api stdout tail:\n${stdoutBuffer.slice(-40).join("")}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(details.length > 0 ? `${message}\n${details.join("\n")}` : message);
    }

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
      name: `Readiness Batch Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const productOne = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Readiness Product One ${runId}`,
      brand: "Vexa PIM",
      description: "Incomplete batch readiness product one",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(productOne, 201, "create product one");

    const productTwo = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Readiness Product Two ${runId}`,
      brand: "Vexa PIM",
      description: "Incomplete batch readiness product two",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(productTwo, 201, "create product two");

    const batch = await apiRequest(baseUrl, "POST", "/marketplace/readiness/batch", token, {
      productIds: [productOne.payload.id, productTwo.payload.id],
      channels: ["amazon", "flipkart", "shopify"],
    });
    assertStatus(batch, 200, "batch readiness");
    assert(Array.isArray(batch.payload?.items), "batch readiness must return an items array");
    assert(batch.payload.items.length === 2, "batch readiness must return one item per requested product");

    batch.payload.items.forEach((item, index) => {
      assert(typeof item.productId === "string" && item.productId.length > 0, `items[${index}] missing productId`);
      assert(Array.isArray(item.readiness), `items[${index}] readiness must be an array`);
      assert(item.readiness.length === 3, `items[${index}] readiness must contain the requested channels only`);
      item.readiness.forEach((entry, channelIndex) => {
        assert(
          entry.channel === "amazon" || entry.channel === "flipkart" || entry.channel === "shopify",
          `items[${index}].readiness[${channelIndex}] invalid channel`,
        );
        assert(
          entry.status === "ready" ||
            entry.status === "warnings" ||
            entry.status === "errors" ||
            entry.status === "unknown",
          `items[${index}].readiness[${channelIndex}] invalid status`,
        );
        assert(typeof entry.errorCount === "number", `items[${index}].readiness[${channelIndex}] missing errorCount`);
        assert(typeof entry.warningCount === "number", `items[${index}].readiness[${channelIndex}] missing warningCount`);
      });
    });

    const initialAmazonSimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=amazon`,
      token,
    );
    assertStatus(initialAmazonSimulation, 200, "initial amazon simulation");
    const initialFlipkartSimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=flipkart`,
      token,
    );
    assertStatus(initialFlipkartSimulation, 200, "initial flipkart simulation");
    const initialShopifySimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=shopify`,
      token,
    );
    assertStatus(initialShopifySimulation, 200, "initial shopify simulation");

    const productOneInitial = batch.payload.items.find((item) => item.productId === productOne.payload.id);
    assert(productOneInitial, "product one readiness summary must be present");
    const initialReadiness = readinessMapFor(productOneInitial);
    assert(
      initialReadiness.amazon?.errorCount === expectedErrorCountFromSimulation(initialAmazonSimulation.payload),
      `expected amazon batch count to match simulation truth, got ${JSON.stringify(initialReadiness.amazon)} simulation=${JSON.stringify(initialAmazonSimulation.payload)}`,
    );
    assert(
      initialReadiness.flipkart?.errorCount === expectedErrorCountFromSimulation(initialFlipkartSimulation.payload),
      `expected flipkart batch count to match simulation truth, got ${JSON.stringify(initialReadiness.flipkart)} simulation=${JSON.stringify(initialFlipkartSimulation.payload)}`,
    );
    assert(
      initialReadiness.shopify?.errorCount === expectedErrorCountFromSimulation(initialShopifySimulation.payload),
      `expected shopify batch count to match simulation truth, got ${JSON.stringify(initialReadiness.shopify)} simulation=${JSON.stringify(initialShopifySimulation.payload)}`,
    );

    const updateProductOne = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productOne.payload.id}`, token, {
      expectedVersion: productOne.payload.version,
      status: "draft",
      hsnCode: "610910",
      gstRate: 12,
      attributes: {
        color: "Blue",
        size: "M",
        material: "Cotton",
        mainImageUrl: "https://example.com/products/runtime-batch-ready.jpg",
      },
    });
    assertStatus(updateProductOne, 200, "update product one for readiness");

    const refreshedBatch = await apiRequest(baseUrl, "POST", "/marketplace/readiness/batch", token, {
      productIds: [productOne.payload.id, productTwo.payload.id],
      channels: ["amazon", "flipkart", "shopify"],
    });
    assertStatus(refreshedBatch, 200, "refreshed batch readiness");

    const updatedAmazonSimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=amazon`,
      token,
    );
    assertStatus(updatedAmazonSimulation, 200, "updated amazon simulation");
    const updatedFlipkartSimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=flipkart`,
      token,
    );
    assertStatus(updatedFlipkartSimulation, 200, "updated flipkart simulation");
    const updatedShopifySimulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${productOne.payload.id}/simulate?channel=shopify`,
      token,
    );
    assertStatus(updatedShopifySimulation, 200, "updated shopify simulation");

    const productOneUpdated = refreshedBatch.payload.items.find((item) => item.productId === productOne.payload.id);
    assert(productOneUpdated, "updated product one readiness summary must be present");
    const updatedReadiness = readinessMapFor(productOneUpdated);
    assert(
      updatedReadiness.amazon?.errorCount === expectedErrorCountFromSimulation(updatedAmazonSimulation.payload),
      `expected amazon batch count to match updated simulation truth, got ${JSON.stringify(updatedReadiness.amazon)} simulation=${JSON.stringify(updatedAmazonSimulation.payload)}`,
    );
    assert(
      updatedReadiness.flipkart?.errorCount === expectedErrorCountFromSimulation(updatedFlipkartSimulation.payload),
      `expected flipkart batch count to match updated simulation truth, got ${JSON.stringify(updatedReadiness.flipkart)} simulation=${JSON.stringify(updatedFlipkartSimulation.payload)}`,
    );
    assert(
      updatedReadiness.shopify?.errorCount === expectedErrorCountFromSimulation(updatedShopifySimulation.payload),
      `expected shopify batch count to match updated simulation truth, got ${JSON.stringify(updatedReadiness.shopify)} simulation=${JSON.stringify(updatedShopifySimulation.payload)}`,
    );
    assert(
      updatedReadiness.amazon.errorCount < initialReadiness.amazon.errorCount,
      `expected amazon errorCount to drop after update, before=${initialReadiness.amazon.errorCount} after=${updatedReadiness.amazon.errorCount}`,
    );
    assert(
      updatedReadiness.flipkart.errorCount < initialReadiness.flipkart.errorCount,
      `expected flipkart errorCount to drop after update, before=${initialReadiness.flipkart.errorCount} after=${updatedReadiness.flipkart.errorCount}`,
    );
    assert(
      updatedReadiness.shopify.errorCount < initialReadiness.shopify.errorCount,
      `expected shopify errorCount to drop after update, before=${initialReadiness.shopify.errorCount} after=${updatedReadiness.shopify.errorCount}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "marketplace_readiness_batch_contract",
            "batch_readiness_returns_grouped_product_summaries",
            "batch_readiness_honors_requested_channels",
            "batch_readiness_error_counts_do_not_double_count_missing_fields",
            "batch_readiness_updates_after_product_changes",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Marketplace readiness batch integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    if (stderrBuffer.length > 0) {
      console.error("--- api stderr tail ---");
      console.error(stderrBuffer.slice(-40).join(""));
    }
    if (stdoutBuffer.length > 0) {
      console.error("--- api stdout tail ---");
      console.error(stdoutBuffer.slice(-40).join(""));
    }
    process.exitCode = 1;
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(750);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
