#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
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
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
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

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login ${userId}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, `missing access token for ${userId}`);
  return token;
}

async function createCategory(baseUrl, token, runId, label) {
  const response = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
    name: `Issue Inbox Boundary ${label} ${runId}`,
  });
  assertStatus(response, 201, `create category ${label}`);
  return response.payload;
}

async function createWarningProduct(baseUrl, token, categoryId, runId, label) {
  const response = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
    title: `Issue Inbox Boundary ${label} ${runId}`,
    brand: "Vexa PIM",
    description: "tenant boundary proof",
    categoryId,
    status: "draft",
    attributes: {},
    hsnCode: "62046200",
    gstRate: 7,
  });
  assertStatus(response, 201, `create warning product ${label}`);
  return response.payload;
}

async function validateProduct(baseUrl, token, productId, label) {
  const response = await apiRequest(baseUrl, "POST", `/compliance/products/${productId}/validate`, token, {});
  assertStatus(response, 201, `validate warning product ${label}`);
  return response.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6760 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `issue-boundary-a-${runId}`;
  const tenantB = `issue-boundary-b-${runId}`;
  const workspaceSlugA = `iba-${runId}`.slice(0, 24);
  const workspaceSlugB = `ibb-${runId}`.slice(0, 24);
  const userA = `issue-boundary-a-${runId}`;
  const userB = `issue-boundary-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Issue Boundary A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Issue Boundary B" },
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

    const tokenA = await login(baseUrl, userA, workspaceSlugA);
    const tokenB = await login(baseUrl, userB, workspaceSlugB);
    const categoryA = await createCategory(baseUrl, tokenA, runId, "A");
    const categoryB = await createCategory(baseUrl, tokenB, runId, "B");
    const productA = await createWarningProduct(baseUrl, tokenA, categoryA.id, runId, "Product A");
    const productB = await createWarningProduct(baseUrl, tokenB, categoryB.id, runId, "Product B");

    await validateProduct(baseUrl, tokenA, productA.id, "A");
    await validateProduct(baseUrl, tokenB, productB.id, "B");

    const connectorId = `connector-${runId}`;
    const installationAId = `install-a-${runId}`;
    const installationBId = `install-b-${runId}`;
    await prisma.connectorDefinition.create({
      data: {
        id: connectorId,
        slug: `issue-boundary-${runId}`,
        displayName: `Issue Boundary ${runId}`,
        authType: "api_key",
        capabilities: ["listing_create"],
        connectorVersion: "1.0.0",
        isActive: true,
      },
    });
    await prisma.connectorInstallation.createMany({
      data: [
        {
          id: installationAId,
          tenantKey: tenantA,
          connectorId,
          accountAlias: "primary",
          status: "ACTIVE",
          metadata: {},
          installedBy: userA,
        },
        {
          id: installationBId,
          tenantKey: tenantB,
          connectorId,
          accountAlias: "primary",
          status: "ACTIVE",
          metadata: {},
          installedBy: userB,
        },
      ],
    });
    await prisma.connectorSubmission.createMany({
      data: [
        {
          id: randomUUID(),
          tenantKey: tenantA,
          installationId: installationAId,
          productId: productA.id,
          idempotencyKey: `idem-a-${runId}`,
          submissionType: "publish",
          source: "issue-inbox-boundary-test",
          attemptNumber: 1,
          status: "submitted",
          payloadSnapshot: {},
        },
        {
          id: randomUUID(),
          tenantKey: tenantB,
          installationId: installationBId,
          productId: productB.id,
          idempotencyKey: `idem-b-${runId}`,
          submissionType: "publish",
          source: "issue-inbox-boundary-test",
          attemptNumber: 1,
          status: "submitted",
          payloadSnapshot: {},
        },
      ],
    });

    const listA = await apiRequest(baseUrl, "GET", "/issues/inbox?pagination=cursor&limit=25", tokenA);
    const listB = await apiRequest(baseUrl, "GET", "/issues/inbox?pagination=cursor&limit=25", tokenB);
    assertStatus(listA, 200, "tenant A issue inbox");
    assertStatus(listB, 200, "tenant B issue inbox");
    assert(
      Array.isArray(listA.payload?.items) && listA.payload.items.some((item) => item.productId === productA.id),
      `tenant A must see own issue; payload=${JSON.stringify(listA.payload)}`,
    );
    assert(
      Array.isArray(listA.payload?.items) && listA.payload.items.every((item) => item.productId !== productB.id),
      `tenant A must not see tenant B issue; payload=${JSON.stringify(listA.payload)}`,
    );
    assert(
      Array.isArray(listB.payload?.items) && listB.payload.items.some((item) => item.productId === productB.id),
      `tenant B must see own issue; payload=${JSON.stringify(listB.payload)}`,
    );
    assert(
      Array.isArray(listB.payload?.items) && listB.payload.items.every((item) => item.productId !== productA.id),
      `tenant B must not see tenant A issue; payload=${JSON.stringify(listB.payload)}`,
    );

    const filteredA = await apiRequest(
      baseUrl,
      "GET",
      `/issues/inbox?pagination=cursor&limit=25&installationId=${encodeURIComponent(installationAId)}`,
      tokenA,
    );
    const crossTenantFiltered = await apiRequest(
      baseUrl,
      "GET",
      `/issues/inbox?pagination=cursor&limit=25&installationId=${encodeURIComponent(installationAId)}`,
      tokenB,
    );
    const wrongInstallationForA = await apiRequest(
      baseUrl,
      "GET",
      `/issues/inbox?pagination=cursor&limit=25&installationId=${encodeURIComponent(installationBId)}`,
      tokenA,
    );
    assertStatus(filteredA, 200, "tenant A issue inbox filtered by own installation");
    assertStatus(crossTenantFiltered, 200, "tenant B issue inbox filtered by tenant A installation");
    assertStatus(wrongInstallationForA, 200, "tenant A issue inbox filtered by tenant B installation");
    assert(
      Array.isArray(filteredA.payload?.items) && filteredA.payload.items.length > 0,
      `tenant A installation filter should return matching issue; payload=${JSON.stringify(filteredA.payload)}`,
    );
    assert(
      Array.isArray(filteredA.payload?.items) && filteredA.payload.items.every((item) => item.productId === productA.id),
      `tenant A installation filter must stay tenant-scoped; payload=${JSON.stringify(filteredA.payload)}`,
    );
    assert(
      Array.isArray(crossTenantFiltered.payload?.items) && crossTenantFiltered.payload.items.length === 0,
      `tenant B must not see tenant A issues through installation filter; payload=${JSON.stringify(crossTenantFiltered.payload)}`,
    );
    assert(
      Array.isArray(wrongInstallationForA.payload?.items) && wrongInstallationForA.payload.items.length === 0,
      `tenant A must not see tenant B issues through installation filter; payload=${JSON.stringify(wrongInstallationForA.payload)}`,
    );

    console.log(JSON.stringify({
      status: "ok",
      tenantA,
      tenantB,
      validated: [
        "issue_inbox_list_is_tenant_scoped",
        "issue_inbox_installation_filter_is_tenant_scoped",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Issue inbox tenant boundary integration test failed:");
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
          // ignore cleanup failures
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
