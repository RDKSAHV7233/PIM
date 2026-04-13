#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");

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
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
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
      // Retry.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiJson(baseUrl, method, route, token, body) {
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
  if (!response.ok) {
    throw new Error(
      `${method} ${route} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function login(baseUrl, userId, tenantId) {
  const response = await apiJson(baseUrl, "POST", "/auth/login", null, {
    userId,
    tenantId,
    role: "admin",
    password: "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  if (!response || !response.accessToken) {
    throw new Error(`Login did not return accessToken for tenant ${tenantId}`);
  }
  return response.accessToken;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 4800 + Math.floor(Math.random() * 150);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `catalog-completeness-tenant-${runId}`;
  const userId = `catalog-completeness-user-${tenantId}`;
  const authIdentityJson = JSON.stringify({
    [userId]: { tenantId, role: "admin" },
  });

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: authIdentityJson,
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProcess.stdout.on("data", (chunk) => {
    const value = String(chunk);
    stdoutBuffer.push(value);
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    const value = String(chunk);
    stderrBuffer.push(value);
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  try {
    await waitForHealth(baseUrl, 60_000);
    const token = await login(baseUrl, userId, tenantId);

    const category = await apiJson(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Completeness Category ${runId}`,
    });
    await apiJson(baseUrl, "POST", `/taxonomy/categories/${category.id}/attributes`, token, {
      key: "material",
      name: "Material",
      dataType: "text",
      required: true,
      appliesTo: "product",
      allowedValues: {},
    });

    const lowTitle = `Completeness Low ${runId}`;
    const highTitle = `Completeness High ${runId}`;

    await apiJson(baseUrl, "POST", "/catalog/products", token, {
      title: lowTitle,
      brand: "Vexa PIM",
      description: "Missing HSN/GST/material on purpose",
      categoryId: category.id,
      status: "draft",
      attributes: {},
    });
    await apiJson(baseUrl, "POST", "/catalog/products", token, {
      title: highTitle,
      brand: "Vexa PIM",
      description: "Complete product",
      categoryId: category.id,
      hsnCode: "62046200",
      gstRate: 18,
      status: "draft",
      attributes: { material: "cotton" },
    });

    const products = await apiJson(baseUrl, "GET", "/catalog/products", token);
    if (!Array.isArray(products)) {
      throw new Error("Expected /catalog/products response to be an array");
    }

    const low = products.find((product) => product && product.title === lowTitle);
    const high = products.find((product) => product && product.title === highTitle);
    if (!low || !high) {
      throw new Error("Unable to locate seeded products in /catalog/products response");
    }
    if (typeof low.completenessScore !== "number" || typeof high.completenessScore !== "number") {
      throw new Error("completenessScore missing from one or more products");
    }
    if (high.completenessScore <= low.completenessScore) {
      throw new Error(
        `Expected complete product score to be higher. low=${low.completenessScore}, high=${high.completenessScore}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          lowScore: low.completenessScore,
          highScore: high.completenessScore,
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
    console.error("Catalog completeness integration test failed:");
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
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], {
            stdio: "ignore",
          });
        } catch {
          // Ignore cleanup failures.
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



