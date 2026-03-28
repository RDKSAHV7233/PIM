#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const AUTH_PASSWORD = process.env.PIM_AUTH_PASSWORD || "tej-pim-demo-password";

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
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
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
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6000 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `workflow-tenant-${runId}`;
  const workspaceSlug = `wf-${runId}`.slice(0, 24);
  const userId = `workflow-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Workflow" },
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
      password: AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Workflow Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const nonDraftCreate = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Invalid Workflow Entry ${runId}`,
      brand: "TEJ PIM",
      description: "Workflow entry status enforcement",
      categoryId: category.payload.id,
      status: "approved",
    });
    assertStatus(nonDraftCreate, 400, "create product with non-draft status rejected");
    assert(
      JSON.stringify(nonDraftCreate.payload ?? "").includes("WORKFLOW_ENTRY_INVALID"),
      "expected WORKFLOW_ENTRY_INVALID code for non-draft create",
    );

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Workflow Product ${runId}`,
      brand: "TEJ PIM",
      description: "Workflow transition test",
      categoryId: category.payload.id,
      status: "draft",
    });
    assertStatus(product, 201, "create product");

    const invalidTransition = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/products/${product.payload.id}`,
      token,
      {
        expectedVersion: product.payload.version,
        title: product.payload.title,
        description: product.payload.description,
        brand: product.payload.brand,
        categoryId: product.payload.categoryId,
        hsnCode: product.payload.hsnCode,
        gstRate: product.payload.gstRate,
        attributes: product.payload.attributes,
        status: "approved",
      },
    );
    assertStatus(invalidTransition, 400, "invalid draft->approved transition");

    const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, token, {
      expectedVersion: product.payload.version,
      title: product.payload.title,
      description: product.payload.description,
      brand: product.payload.brand,
      categoryId: product.payload.categoryId,
      hsnCode: product.payload.hsnCode,
      gstRate: product.payload.gstRate,
      attributes: product.payload.attributes,
      status: "in_review",
    });
    assertStatus(toReview, 200, "draft->in_review transition");

    const statsInReview = await apiRequest(baseUrl, "GET", "/catalog/stats", token);
    assertStatus(statsInReview, 200, "catalog stats after in_review transition");
    assert(
      Number(statsInReview.payload?.pendingApprovals ?? 0) === 1,
      `expected pendingApprovals=1 after in_review, got ${JSON.stringify(statsInReview.payload)}`,
    );

    const toApproved = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, token, {
      expectedVersion: toReview.payload.version,
      title: toReview.payload.title,
      description: toReview.payload.description,
      brand: toReview.payload.brand,
      categoryId: toReview.payload.categoryId,
      hsnCode: toReview.payload.hsnCode,
      gstRate: toReview.payload.gstRate,
      attributes: toReview.payload.attributes,
      status: "approved",
    });
    assertStatus(toApproved, 200, "in_review->approved transition");

    const statsApproved = await apiRequest(baseUrl, "GET", "/catalog/stats", token);
    assertStatus(statsApproved, 200, "catalog stats after approval transition");
    assert(
      Number(statsApproved.payload?.pendingApprovals ?? 0) === 0,
      `expected pendingApprovals=0 after approval, got ${JSON.stringify(statsApproved.payload)}`,
    );

    const invalidBulkEdit = await apiRequest(baseUrl, "POST", "/bulk-edit/apply", token, {
      scope: {
        productIds: [product.payload.id],
      },
      updates: {
        status: "rejected",
      },
    });
    assert(
      invalidBulkEdit.status === 200 || invalidBulkEdit.status === 201,
      `bulk edit invalid approved->rejected transition recorded failed: expected 200/201, got ${invalidBulkEdit.status}; payload=${JSON.stringify(invalidBulkEdit.payload)}`,
    );
    assert(
      Number(invalidBulkEdit.payload?.failedCount ?? -1) === 1,
      `expected failedCount=1 for invalid bulk edit transition, got ${JSON.stringify(invalidBulkEdit.payload)}`,
    );
    assert(
      Number(invalidBulkEdit.payload?.appliedCount ?? -1) === 0,
      `expected appliedCount=0 for invalid bulk edit transition, got ${JSON.stringify(invalidBulkEdit.payload)}`,
    );
    const invalidBulkItems = Array.isArray(invalidBulkEdit.payload?.items) ? invalidBulkEdit.payload.items : [];
    assert(invalidBulkItems.length === 1, `expected one bulk edit item, got ${invalidBulkItems.length}`);
    assert(
      String(invalidBulkItems[0].status ?? "").toLowerCase() === "failed",
      `expected failed bulk edit item, got ${JSON.stringify(invalidBulkItems[0])}`,
    );
    assert(
      String(invalidBulkItems[0].errorMessage ?? "").includes("Invalid workflow transition"),
      `expected workflow transition error in bulk edit item, got ${JSON.stringify(invalidBulkItems[0])}`,
    );

    const importJob = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", token, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      rows: [
        {
          title: `Workflow Import Product ${runId}`,
          description: "Import workflow entry enforcement",
          brand: "TEJ PIM",
          status: "approved",
          hsnCode: "62046200",
          gstRate: 18,
          attributes: {},
        },
      ],
      chunkSize: 1,
      maxRetries: 1,
    });
    assertStatus(importJob, 201, "create bulk import job");

    const processedImport = await apiRequest(
      baseUrl,
      "POST",
      `/bulk-import/jobs/${importJob.payload.id}/process`,
      token,
      { chunkSize: 1 },
    );
    assert(
      processedImport.status === 200 || processedImport.status === 201,
      `process import job failed: expected 200/201, got ${processedImport.status}`,
    );

    const refreshedImport = await apiRequest(baseUrl, "GET", `/bulk-import/jobs/${importJob.payload.id}`, token);
    assertStatus(refreshedImport, 200, "get bulk import job after process");
    const importRows = Array.isArray(refreshedImport.payload?.rows) ? refreshedImport.payload.rows : [];
    assert(importRows.length === 1, "expected one import row for workflow entry test");
    assert(
      String(importRows[0].status ?? "").toLowerCase() === "failed",
      `expected import row status failed, got ${String(importRows[0].status ?? "unknown")}`,
    );
    assert(
      String(importRows[0].errorMessage ?? "").includes("WORKFLOW_ENTRY_INVALID"),
      "expected WORKFLOW_ENTRY_INVALID in import row error message",
    );
    assert(importRows[0].productId === null, "workflow-invalid import row must not create product");

    const logs = await apiRequest(baseUrl, "GET", `/audit/logs?actorId=${encodeURIComponent(userId)}&limit=100`, token);
    assertStatus(logs, 200, "audit logs");
    const rows = Array.isArray(logs.payload) ? logs.payload : logs.payload?.items ?? [];
    const statusTransitions = rows.filter((row) => row.action === "STATUS_TRANSITION" && row.resourceId === product.payload.id);
    assert(statusTransitions.length >= 2, "expected status transition audit rows for product workflow updates");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          productId: product.payload.id,
          validated: [
            "workflow_transition_invalid_direct_draft_to_approved_rejected",
            "workflow_transition_draft_to_in_review_allowed",
            "workflow_transition_in_review_to_approved_allowed",
            "catalog_stats_pending_approvals_tracks_in_review_products",
            "bulk_edit_invalid_workflow_transition_recorded_as_failed_item",
            "create_product_rejects_non_draft_workflow_entry",
            "bulk_import_rejects_non_draft_workflow_entry",
            "workflow_transition_audit_rows_recorded",
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
    console.error("Product workflow transitions integration test failed:");
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
