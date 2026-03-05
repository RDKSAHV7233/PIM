#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
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
  // This scenario must force authoritative mode even if local .env sets false.
  process.env.FEATURE_REAL_SPAPI_VALIDATION = "true";
  setDefaultEnv("AMAZON_CLIENT_ID", "local-amazon-client-id");
  setDefaultEnv("AMAZON_CLIENT_SECRET", "local-amazon-client-secret");
  setDefaultEnv("FLIPKART_CLIENT_ID", "local-flipkart-client-id");
  setDefaultEnv("FLIPKART_CLIENT_SECRET", "local-flipkart-client-secret");
  setDefaultEnv("MEESHO_MERCHANT_ID", "local-meesho-merchant-id");
  setDefaultEnv("MEESHO_SECRET_KEY", "local-meesho-secret-key");
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
    password: "pim1-demo-password",
    expiresInMinutes: 30,
  });
  if (!response || !response.accessToken) {
    throw new Error(`Login did not return accessToken for tenant ${tenantId}`);
  }
  return response.accessToken;
}

function createAmazonStubServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid_json" }));
          return;
        }

        const mappedPayload = body && typeof body === "object" ? body.mappedPayload : null;
        const itemName =
          mappedPayload && typeof mappedPayload === "object" && typeof mappedPayload.item_name === "string"
            ? mappedPayload.item_name
            : "";

        if (itemName.includes("Fallback Trigger")) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "service_unavailable" }));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            missingFields: ["attributes.material"],
            issues: [
              {
                severity: "warning",
                code: "AMAZON_HINT",
                fieldPath: "attributes.material",
                message: "Material is recommended for this listing.",
              },
            ],
            warnings: ["authoritative validation active"],
          }),
        );
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to read stub server address"));
        return;
      }
      resolve({
        server,
        endpoint: `http://127.0.0.1:${address.port}/validate`,
      });
    });
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 4500 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-validation-tenant-${runId}`;
  const userId = `amazon-validation-user-${tenantId}`;

  const stub = await createAmazonStubServer();
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
    PIM_AMAZON_VALIDATION_ENDPOINT: stub.endpoint,
    PIM_AMAZON_VALIDATION_TOKEN: "local-test-token",
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
      name: `Amazon Validation Category ${runId}`,
    });

    const authoritativeProduct = await apiJson(baseUrl, "POST", "/catalog/products", token, {
      title: "Authoritative Product",
      brand: "PIM1",
      description: "Product for authoritative validation path",
      categoryId: category.id,
      status: "draft",
      attributes: { color: "blue" },
    });

    const authoritativeSimulation = await apiJson(
      baseUrl,
      "GET",
      `/marketplace/products/${authoritativeProduct.id}/simulate?channel=amazon`,
      token,
    );

    if (authoritativeSimulation.validationSource !== "amazon_sp_api") {
      throw new Error(`Expected amazon_sp_api source, got ${authoritativeSimulation.validationSource}`);
    }
    if (!Array.isArray(authoritativeSimulation.validationWarnings)) {
      throw new Error("Expected validationWarnings array on authoritative simulation");
    }
    if (!authoritativeSimulation.validationWarnings.includes("authoritative validation active")) {
      throw new Error("Expected authoritative warning marker from stub response");
    }

    const fallbackProduct = await apiJson(baseUrl, "POST", "/catalog/products", token, {
      title: "Fallback Trigger Product",
      brand: "PIM1",
      description: "Product for fallback validation path",
      categoryId: category.id,
      status: "draft",
      attributes: { color: "black" },
    });

    const fallbackSimulation = await apiJson(
      baseUrl,
      "GET",
      `/marketplace/products/${fallbackProduct.id}/simulate?channel=amazon`,
      token,
    );

    if (fallbackSimulation.validationSource !== "local_rules") {
      throw new Error(`Expected local_rules source on fallback, got ${fallbackSimulation.validationSource}`);
    }
    const warnings = Array.isArray(fallbackSimulation.validationWarnings)
      ? fallbackSimulation.validationWarnings
      : [];
    if (!warnings.some((warning) => String(warning).includes("Falling back to local rules"))) {
      throw new Error(`Expected fallback warning, got ${JSON.stringify(warnings)}`);
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          authoritativeSource: authoritativeSimulation.validationSource,
          authoritativeWarnings: authoritativeSimulation.validationWarnings ?? [],
          fallbackSource: fallbackSimulation.validationSource,
          fallbackWarnings: fallbackSimulation.validationWarnings ?? [],
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
    console.error("Amazon authoritative validation integration test failed:");
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
    await new Promise((resolve) => {
      stub.server.close(() => resolve());
    });
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



