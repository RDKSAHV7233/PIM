#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
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
  const options = { method, headers, signal: AbortSignal.timeout(15_000) };
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

async function advanceToApproved(baseUrl, token, product) {
  const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: product.version,
    title: product.title,
    description: product.description ?? "",
    brand: product.brand,
    categoryId: product.categoryId,
    hsnCode: product.hsnCode ?? undefined,
    gstRate: product.gstRate ?? undefined,
    attributes: product.attributes ?? {},
    status: "in_review",
  });
  if (toReview.status !== 200) {
    throw new Error(`advance to in_review failed: ${toReview.status} ${JSON.stringify(toReview.payload)}`);
  }
  const toApproved = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: toReview.payload.version,
    title: toReview.payload.title,
    description: toReview.payload.description ?? "",
    brand: toReview.payload.brand,
    categoryId: toReview.payload.categoryId,
    hsnCode: toReview.payload.hsnCode ?? undefined,
    gstRate: toReview.payload.gstRate ?? undefined,
    attributes: toReview.payload.attributes ?? {},
    status: "approved",
  });
  if (toApproved.status !== 200) {
    throw new Error(`advance to approved failed: ${toApproved.status} ${JSON.stringify(toApproved.payload)}`);
  }
  return toApproved.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5600 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `submission-lifecycle-tenant-${runId}`;
  const workspaceSlug = `submit-${runId}`.slice(0, 24);
  const userId = `submission-lifecycle-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Submission Lifecycle" },
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
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

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
      name: `Submission Lifecycle Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Submission Lifecycle Product ${runId}`,
      description: "Missing required channel fields to trigger issues.",
      brand: "Vexa PIM",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      sellingPrice: 299,
      mrp: 399,
      attributes: {},
    });
    assertStatus(product, 201, "create product");
    await advanceToApproved(baseUrl, token, product.payload);

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(install, 201, "install flipkart connector");

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      token,
      {
        channel: "flipkart",
        maxRetries: 1,
      },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = String(createJob.payload.id);

    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      UPDATE "MarketplaceExportJob"
      SET "status" = 'queued',
          "retryCount" = 0,
          "failureReason" = NULL,
          "dlqReason" = NULL,
          "exportPayload" = NULL
      WHERE "id" = $1 AND "tenantKey" = $2
      `,
      jobId,
      tenantId,
    );

    const processed = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/process`, token);
    assertStatus(processed, 201, "process export job");
    assert(processed.payload.status === "dead_letter", `expected dead_letter, got ${String(processed.payload.status)}`);

    const list = await apiRequest(baseUrl, "GET", "/submissions?connectorSlug=flipkart&minAttempt=1", token);
    assertStatus(list, 200, "list submissions");
    assert(Array.isArray(list.payload), "expected /submissions to return array");
    assert(list.payload.length >= 1, "expected at least one submission");
    const submission = list.payload[0];
    assert(submission.id, "missing submission id");

    const detail = await apiRequest(baseUrl, "GET", `/submissions/${submission.id}`, token);
    assertStatus(detail, 200, "get submission detail");
    assert(String(detail.payload.id) === String(submission.id), "submission detail id mismatch");

    const issues = await apiRequest(baseUrl, "GET", `/submissions/${submission.id}/issues`, token);
    assertStatus(issues, 200, "get submission issues");
    assert(Array.isArray(issues.payload), "expected issues array");
    assert(issues.payload.length >= 1, "expected at least one issue");
    assert(issues.payload[0].code, "expected normalized issue code");

    const deadLetter = await apiRequest(baseUrl, "GET", "/submissions/dead-letter", token);
    assertStatus(deadLetter, 200, "list dead-letter submissions");
    assert(Array.isArray(deadLetter.payload), "expected dead-letter array");
    assert(deadLetter.payload.some((job) => String(job.id) === jobId), "expected dead-letter job in response");

    const retry = await apiRequest(baseUrl, "POST", `/submissions/${submission.id}/retry`, token);
    assertStatus(retry, 201, "retry submission");
    assert(retry.payload?.queued === true, "expected retry endpoint to queue job");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          jobId,
          submissionId: submission.id,
          validated: [
            "submissions_list_endpoint_with_filters",
            "submission_detail_endpoint",
            "submission_issues_endpoint",
            "submission_retry_endpoint",
            "submissions_dead_letter_endpoint",
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
    console.error("Submission lifecycle integration test failed:");
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
