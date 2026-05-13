#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "src", "main.ts");

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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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
    } catch {}
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API source entry not found at ${API_ENTRY}.`);
  }

  const runId = Date.now().toString();
  const apiPort = 6220 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `revision-history-${runId}`;
  const workspaceSlug = `revisions-${runId}`.slice(0, 24);
  const adminUserId = `revision-admin-${runId}`;
  const reviewerUserId = `revision-reviewer-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUserId]: { tenantId, role: "admin", workspaceSlug },
      [reviewerUserId]: { tenantId, role: "reviewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Revision History" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const tsNodeEntry = path.join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
  const apiProcess = spawn(process.execPath, [tsNodeEntry, "--project", "apps/api/tsconfig.build.json", API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => stdoutBuffer.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => stderrBuffer.push(String(chunk)));

  try {
    await waitForHealth(baseUrl, 120_000);

    const authPassword = process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: adminUserId,
      workspaceSlug,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");

    const reviewerLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: reviewerUserId,
      workspaceSlug,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(reviewerLogin, 201, "reviewer login");
    const reviewerToken = String(reviewerLogin.payload?.accessToken ?? "");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Revision Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Revision Product ${runId}`,
      brand: "Vexa PIM",
      description: "revision tracking baseline",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        color: "Blue",
      },
    });
    assertStatus(product, 201, "create product");

    const untouchedProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Untouched Revision Product ${runId}`,
      brand: "Vexa PIM",
      description: "no revision events yet",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        color: "Navy",
      },
    });
    assertStatus(untouchedProduct, 201, "create untouched product");

    const emptyHistory = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${untouchedProduct.payload.id}/revisions`,
      adminToken,
    );
    assertStatus(emptyHistory, 200, "load untouched product revision history");
    assert(Array.isArray(emptyHistory.payload), "untouched product revision history must be an array");
    assert(emptyHistory.payload.length === 0, "untouched product revision history must be empty");

    const updated = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, adminToken, {
      expectedVersion: product.payload.version,
      title: `${product.payload.title} Updated`,
      description: `${product.payload.description} with richer detail`,
      brand: product.payload.brand,
      categoryId: product.payload.categoryId,
      hsnCode: product.payload.hsnCode,
      gstRate: product.payload.gstRate,
      attributes: {
        ...product.payload.attributes,
        color: "Green",
      },
      status: "in_review",
    });
    assertStatus(updated, 200, "update product to in_review");

    const rejected = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${product.payload.id}/review-decision`,
      reviewerToken,
      {
        status: "rejected",
        note: "Missing final merchandising copy",
      },
    );
    assertStatus(rejected, 201, "reject in-review product");

    const history = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}/revisions`, adminToken);
    assertStatus(history, 200, "load product revision history");
    assert(Array.isArray(history.payload), `revision history must be an array, got ${JSON.stringify(history.payload)}`);
    assert(history.payload.length >= 2, `expected at least 2 revisions, got ${history.payload.length}`);

    const reviewRevision = history.payload.find((entry) => entry.action === "REVIEW_DECISION");
    assert(reviewRevision, "expected review decision revision");
    assert(typeof reviewRevision.actorId === "string" && reviewRevision.actorId.length > 0, "review revision must include actor id");
    assert(String(reviewRevision.actorRole ?? "").toLowerCase() === "reviewer", "review revision must preserve reviewer role");
    assert(reviewRevision.createdAt, "review revision must include createdAt timestamp");
    assert(!Number.isNaN(new Date(reviewRevision.createdAt).getTime()), "review revision createdAt must be parseable");
    assert(reviewRevision.decisionNote === "Missing final merchandising copy", "review revision must include decision note");
    assert(
      Array.isArray(reviewRevision.changedFields) &&
      reviewRevision.changedFields.some((field) => field.path === "status" && field.before === "in_review" && field.after === "rejected"),
      "review revision must include status before/after evidence",
    );

    const updateRevision = history.payload.find((entry) => entry.action === "PRODUCT_UPDATED");
    assert(updateRevision, "expected product update revision");
    assert(typeof updateRevision.actorId === "string" && updateRevision.actorId.length > 0, "update revision must include actor id");
    assert(updateRevision.createdAt, "update revision must include createdAt timestamp");
    assert(!Number.isNaN(new Date(updateRevision.createdAt).getTime()), "update revision createdAt must be parseable");
    assert(updateRevision.summary?.changedFieldCount >= 3, "update revision must summarize changed fields");
    assert(
      updateRevision.changedFields.some((field) => field.path === "title" && String(field.after).includes("Updated")),
      "update revision must include title change",
    );
    assert(
      updateRevision.changedFields.some((field) => field.path === "attributes.color" && field.before === "Blue" && field.after === "Green"),
      "update revision must include attribute diff evidence",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "product_update_revision_records_changed_fields",
            "review_decision_revision_records_status_and_note",
            "product_revision_history_returns_empty_array_for_untouched_products",
            "product_revision_history_includes_actor_and_timestamp_fields",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Product revision history integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
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
        } catch {}
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
