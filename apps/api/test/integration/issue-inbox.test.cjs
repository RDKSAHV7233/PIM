#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6500 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `issue-inbox-${runId}`;
  const workspaceSlug = `issue-${runId}`.slice(0, 24);
  const userId = `issue-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Issue Inbox" },
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
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token from login");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Issue Inbox Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = category.payload.id;

    const warningProduct = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Issue Warning Product ${runId}`,
      brand: "TEJ PIM",
      description: "warning product",
      categoryId,
      status: "draft",
      attributes: {},
      hsnCode: "62046200",
      gstRate: 7,
    });
    assertStatus(warningProduct, 201, "create warning product");

    const blockingProduct = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Issue Blocking Product ${runId}`,
      brand: "TEJ PIM",
      description: "blocking product",
      categoryId,
      status: "draft",
      attributes: {},
      gstRate: 18,
    });
    assertStatus(blockingProduct, 201, "create blocking product");

    const warningInReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${warningProduct.payload.id}`, token, {
      expectedVersion: warningProduct.payload.version,
      title: warningProduct.payload.title,
      brand: warningProduct.payload.brand,
      description: warningProduct.payload.description,
      categoryId: warningProduct.payload.categoryId,
      hsnCode: warningProduct.payload.hsnCode,
      gstRate: warningProduct.payload.gstRate,
      attributes: warningProduct.payload.attributes,
      status: "in_review",
    });
    assertStatus(warningInReview, 200, "transition warning product to in_review");

    const validateWarning = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${warningProduct.payload.id}/validate`,
      token,
      {},
    );
    assertStatus(validateWarning, 201, "validate warning product");

    const validateBlocking = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${blockingProduct.payload.id}/validate`,
      token,
      {},
    );
    assertStatus(validateBlocking, 201, "validate blocking product");

    const inbox = await apiRequest(baseUrl, "GET", "/issues/inbox?pagination=cursor&limit=25", token);
    assertStatus(inbox, 200, "list issue inbox");
    assert(Array.isArray(inbox.payload?.items), "issue inbox response must include items array");
    assert(inbox.payload.items.length >= 2, "issue inbox should return at least two issues");

    const warningIssue = inbox.payload.items.find((issue) => issue.severity === "WARNING");
    const blockingIssue = inbox.payload.items.find((issue) => issue.severity === "BLOCKING");
    assert(warningIssue, "warning issue not present in inbox");
    assert(blockingIssue, "blocking issue not present in inbox");
    assert(
      inbox.payload.items[0].severity === "BLOCKING",
      "inbox sorting should place blocking issues before warnings",
    );

    const resolve = await apiRequest(baseUrl, "POST", "/issues/inbox/resolve", token, {
      issueIds: [warningIssue.issueId, blockingIssue.issueId],
    });
    assertStatus(resolve, 201, "resolve warning issues");
    assert(resolve.payload.resolved === 1, `expected 1 resolved issue, got ${resolve.payload.resolved}`);
    assert(resolve.payload.skippedBlocked >= 1, "blocking issue should be skipped");

    const warningOnlyInbox = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=25&severity=WARNING",
      token,
    );
    assertStatus(warningOnlyInbox, 200, "list warning inbox");
    assert(
      warningOnlyInbox.payload.items.length === 0,
      `warning issues should be resolved, got ${warningOnlyInbox.payload.items.length} remaining`,
    );

    const inReviewInbox = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=25&productStatus=in_review",
      token,
    );
    assertStatus(inReviewInbox, 200, "list issue inbox filtered by in_review status");
    assert(Array.isArray(inReviewInbox.payload?.items), "in_review inbox response must include items array");
    assert(
      inReviewInbox.payload.items.every((issue) => issue.productStatus === "in_review"),
      `expected only in_review issues, got ${JSON.stringify(inReviewInbox.payload.items)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "issue_inbox_list_returns_blocking_and_warning",
            "issue_inbox_sorting_blocking_first",
            "issue_inbox_bulk_resolve_only_resolves_warning",
            "issue_inbox_accepts_in_review_product_status_filter",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    if (!apiProcess.killed) {
      apiProcess.kill("SIGTERM");
    }
    await sleep(500);
    if (!apiProcess.killed) {
      apiProcess.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error("[issue-inbox.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
