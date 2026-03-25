#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
  const apiPort = 6600 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `mapping-manager-${runId}`;
  const userId = `mapping-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin" },
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
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token from login");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Mapping Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = category.payload.id;

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Mapping Product ${runId}`,
      brand: "TEJ PIM",
      description: "mapping test",
      categoryId,
      status: "draft",
      attributes: { color: "black", material: "cotton" },
      hsnCode: "62046200",
      gstRate: 12,
    });
    assertStatus(product, 201, "create product");

    const install = await apiRequest(baseUrl, "POST", "/connectors/meesho/install", token, {
      accountAlias: `qa-${runId}`,
      externalAccountRef: `merchant-${runId}`,
    });
    assertStatus(install, 201, "install meesho connector");
    const installationId = install.payload.id;

    const createTemplate = await apiRequest(baseUrl, "POST", `/marketplace/categories/${categoryId}/templates`, token, {
      name: `Template ${runId}`,
      channel: "meesho",
      requiredFields: ["title", "brand", "hsnCode"],
      fieldMap: {
        title: "product_name",
        brand: "brand",
        hsnCode: "hsn",
      },
      isDefault: true,
    });
    assertStatus(createTemplate, 201, "create mapping template");
    const templateId = createTemplate.payload.id;

    const getTemplate = await apiRequest(baseUrl, "GET", `/marketplace/templates/${templateId}`, token);
    assertStatus(getTemplate, 200, "get mapping template");

    const updateTemplate = await apiRequest(baseUrl, "PATCH", `/marketplace/templates/${templateId}`, token, {
      name: `Template Updated ${runId}`,
      requiredFields: ["title", "brand", "hsnCode", "gstRate"],
      version: getTemplate.payload.version,
    });
    assertStatus(updateTemplate, 200, "update mapping template");
    assert(updateTemplate.payload.version > getTemplate.payload.version, "template version did not increment");

    const cloneTemplate = await apiRequest(baseUrl, "POST", `/marketplace/templates/${templateId}/clone`, token, {
      isDefault: false,
    });
    assertStatus(cloneTemplate, 201, "clone mapping template");
    assert(cloneTemplate.payload.parentTemplateId === templateId, "clone must retain parentTemplateId");

    const preview = await apiRequest(baseUrl, "POST", `/connectors/${installationId}/payload-preview`, token, {
      productId: product.payload.id,
      templateId,
    });
    assertStatus(preview, 201, "connector payload preview");
    assert(preview.payload.connectorSlug === "meesho", "payload preview connector slug mismatch");
    assert(preview.payload.channel === "meesho", "payload preview channel mismatch");
    assert(preview.payload.mappedPayload && typeof preview.payload.mappedPayload === "object", "payload preview must include mappedPayload");

    const deleteTemplate = await apiRequest(baseUrl, "DELETE", `/marketplace/templates/${cloneTemplate.payload.id}`, token);
    assertStatus(deleteTemplate, 200, "delete mapping template");

    const deletedFetch = await apiRequest(baseUrl, "GET", `/marketplace/templates/${cloneTemplate.payload.id}`, token);
    assertStatus(deletedFetch, 404, "deleted template lookup");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "mapping_template_get_update_clone_delete",
            "connector_payload_preview_endpoint",
            "template_version_increment",
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
  console.error("[mapping-manager.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});

