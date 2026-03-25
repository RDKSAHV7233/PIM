#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6100 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `reviewer-role-tenant-${runId}`;
  const workspaceSlug = `review-${runId}`.slice(0, 24);
  const adminUserId = `reviewer-admin-${runId}`;
  const reviewerUserId = `reviewer-user-${runId}`;
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
      [workspaceSlug]: { tenantId, displayName: "Reviewer Role" },
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

    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: adminUserId,
      workspaceSlug,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");

    const reviewerLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: reviewerUserId,
      workspaceSlug,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(reviewerLogin, 201, "reviewer login");
    const reviewerToken = String(reviewerLogin.payload?.accessToken ?? "");
    assert(reviewerLogin.payload?.role === "reviewer", "reviewer login must return reviewer role");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Reviewer Role Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = category.payload.id;

    const cleanProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Reviewer Clean Product ${runId}`,
      brand: "TEJ PIM",
      description: "review decision clean path",
      categoryId,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(cleanProduct, 201, "create clean product");

    const cleanInReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${cleanProduct.payload.id}`, adminToken, {
      expectedVersion: cleanProduct.payload.version,
      title: cleanProduct.payload.title,
      description: cleanProduct.payload.description,
      brand: cleanProduct.payload.brand,
      categoryId: cleanProduct.payload.categoryId,
      hsnCode: cleanProduct.payload.hsnCode,
      gstRate: cleanProduct.payload.gstRate,
      attributes: cleanProduct.payload.attributes,
      status: "in_review",
    });
    assertStatus(cleanInReview, 200, "move clean product to in_review");

    const reviewerPatch = await apiRequest(baseUrl, "PATCH", `/catalog/products/${cleanProduct.payload.id}`, reviewerToken, {
      expectedVersion: cleanInReview.payload.version,
      title: `${cleanInReview.payload.title} - mutated`,
      description: cleanInReview.payload.description,
      brand: cleanInReview.payload.brand,
      categoryId: cleanInReview.payload.categoryId,
      hsnCode: cleanInReview.payload.hsnCode,
      gstRate: cleanInReview.payload.gstRate,
      attributes: cleanInReview.payload.attributes,
      status: "approved",
    });
    assertStatus(reviewerPatch, 403, "reviewer general product patch forbidden");

    const warningProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Reviewer Warning Product ${runId}`,
      brand: "TEJ PIM",
      description: "warning issue path",
      categoryId,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 7,
      attributes: {},
    });
    assertStatus(warningProduct, 201, "create warning product");
    const validateWarning = await apiRequest(baseUrl, "POST", `/compliance/products/${warningProduct.payload.id}/validate`, adminToken, {});
    assertStatus(validateWarning, 201, "validate warning product");
    const warningInbox = await apiRequest(baseUrl, "GET", "/issues/inbox?pagination=cursor&limit=25&severity=WARNING", adminToken);
    assertStatus(warningInbox, 200, "load warning inbox");
    const warningIssue = warningInbox.payload.items.find((issue) => issue.productId === warningProduct.payload.id);
    assert(warningIssue, "expected warning issue for reviewer resolve test");

    const reviewerResolve = await apiRequest(baseUrl, "POST", "/issues/inbox/resolve", reviewerToken, {
      issueIds: [warningIssue.issueId],
    });
    assertStatus(reviewerResolve, 403, "reviewer warning resolution forbidden");

    const approveClean = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${cleanProduct.payload.id}/review-decision`,
      reviewerToken,
      { status: "approved" },
    );
    assertStatus(approveClean, 201, "reviewer approve clean in_review product");
    assert(approveClean.payload?.status === "approved", "reviewer approval must set product status to approved");

    const blockingProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Reviewer Blocking Product ${runId}`,
      brand: "TEJ PIM",
      description: "blocking issue path",
      categoryId,
      status: "draft",
      attributes: {},
      gstRate: 18,
    });
    assertStatus(blockingProduct, 201, "create blocking product");
    const blockingInReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${blockingProduct.payload.id}`, adminToken, {
      expectedVersion: blockingProduct.payload.version,
      title: blockingProduct.payload.title,
      description: blockingProduct.payload.description,
      brand: blockingProduct.payload.brand,
      categoryId: blockingProduct.payload.categoryId,
      hsnCode: blockingProduct.payload.hsnCode,
      gstRate: blockingProduct.payload.gstRate,
      attributes: blockingProduct.payload.attributes,
      status: "in_review",
    });
    assertStatus(blockingInReview, 200, "move blocking product to in_review");

    const approveBlocked = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${blockingProduct.payload.id}/review-decision`,
      reviewerToken,
      { status: "approved" },
    );
    assertStatus(approveBlocked, 400, "reviewer approve blocked product rejected");
    assert(
      JSON.stringify(approveBlocked.payload ?? "").includes("APPROVAL_BLOCKED"),
      "blocked approval must return APPROVAL_BLOCKED payload",
    );

    const rejectBlocked = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${blockingProduct.payload.id}/review-decision`,
      reviewerToken,
      { status: "rejected", note: "Missing required catalog data" },
    );
    assertStatus(rejectBlocked, 201, "reviewer reject blocked product");
    assert(rejectBlocked.payload?.status === "rejected", "reviewer rejection must set product status to rejected");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "reviewer_login_role_claim",
            "reviewer_cannot_patch_general_product_updates",
            "reviewer_cannot_resolve_issue_inbox_warnings",
            "reviewer_can_decide_clean_in_review_products",
            "reviewer_approval_blocks_when_blocking_issues_remain",
            "reviewer_can_reject_in_review_products",
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
    console.error("Quality reviewer role integration test failed:");
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
