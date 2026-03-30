#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const MARKETPLACE_ID = "A21TJRUUN4KGV";

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

function resolveAuthPassword() {
  return String(process.env.PIM_AUTH_PASSWORD || "tej-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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

function createAmazonFoundationStub() {
  const calls = {
    oauth: [],
    definitions: [],
    schemaLinks: [],
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/auth/o2/token") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
          calls.oauth.push({
            grantType: params.get("grant_type") || "",
            code: params.get("code") || "",
            refreshToken: params.get("refresh_token") || "",
            clientId: params.get("client_id") || "",
            redirectUri: params.get("redirect_uri") || "",
          });

          const grantType = params.get("grant_type");
          if (grantType === "refresh_token") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                access_token: "amazon-access-token-1",
                expires_in: 3600,
                token_type: "bearer",
              }),
            );
            return;
          }

          if (grantType === "authorization_code") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                access_token: "amazon-access-token-2",
                refresh_token: "amazon-refresh-token-2",
                expires_in: 1800,
                token_type: "bearer",
              }),
            );
            return;
          }

          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        });
        return;
      }

      const definitionsMatch =
        req.method === "GET"
          ? /^\/definitions\/2020-09-01\/productTypes\/([^?]+)(\?.*)?$/.exec(req.url || "")
          : null;
      if (definitionsMatch) {
        calls.definitions.push({
          productType: decodeURIComponent(definitionsMatch[1]),
          auth: String(req.headers.authorization || ""),
          accessToken: String(req.headers["x-amz-access-token"] || ""),
          amzDate: String(req.headers["x-amz-date"] || ""),
          userAgent: String(req.headers["user-agent"] || ""),
          url: req.url || "",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            productType: decodeURIComponent(definitionsMatch[1]),
            schemaVersion: "2026-03-31",
            schema: {
              link: {
                resource: `http://127.0.0.1:${server.address().port}/schemas/general.json`,
              },
            },
          }),
        );
        return;
      }

      if (req.method === "GET" && req.url === "/schemas/general.json") {
        calls.schemaLinks.push({
          auth: String(req.headers.authorization || ""),
          accessToken: String(req.headers["x-amz-access-token"] || ""),
          amzDate: String(req.headers["x-amz-date"] || ""),
          userAgent: String(req.headers["user-agent"] || ""),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            type: "object",
            required: ["item_name", "brand", "material_type"],
            properties: {
              item_name: { type: "string" },
              brand: { type: "string" },
              material_type: { type: "string" },
              color: { enum: ["black", "blue"] },
              size: {
                oneOf: [{ const: "S" }, { const: "M" }, { const: "L" }],
              },
            },
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Amazon foundation stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
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
  const apiPort = 7360 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-runtime-${runId}`;
  const workspaceSlug = `amz-runtime-${runId}`.slice(0, 24);
  const userId = `amazon-runtime-user-${runId}`;
  const sellerId = `seller-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const authPassword = resolveAuthPassword();
  const stub = await createAmazonFoundationStub();

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Amazon Runtime Foundation" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_AMAZON_LWA_BASE_URL: stub.baseUrl,
    PIM_AMAZON_DEFINITIONS_BASE_URL: stub.baseUrl,
    PIM_AMAZON_LISTINGS_BASE_URL: stub.baseUrl,
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

    const enterprisePlan = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      null,
      { tenantKey: tenantId, planTier: "ENTERPRISE" },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(enterprisePlan, 201, "set enterprise plan tier");

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: "primary",
      externalAccountRef: sellerId,
      clientId: "amazon-client-id",
      clientSecret: "amazon-client-secret",
      refreshToken: "amazon-refresh-token-1",
    });
    assertStatus(install, 201, "install amazon connector");
    const installationId = String(install.payload.id);

    const oauthCallback = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/oauth/callback`,
      token,
      {
        code: "amazon-auth-code-1",
        redirectUri: "https://example.com/connectors/amazon/callback",
      },
    );
    assertStatus(oauthCallback, 201 - 1, "amazon oauth callback");
    assert(String(oauthCallback.payload?.status) === "CONNECTED", "expected CONNECTED callback status");

    assert(
      stub.calls.oauth.some(
        (request) => request.grantType === "authorization_code" && request.code === "amazon-auth-code-1",
      ),
      "expected authorization_code token exchange",
    );

    const schema = await apiRequest(
      baseUrl,
      "GET",
      `/connectors/${encodeURIComponent(installationId)}/product-type-schema?productType=general`,
      token,
    );
    assertStatus(schema, 200, "amazon product type schema");
    assert(String(schema.payload?.productType) === "general", `unexpected productType ${String(schema.payload?.productType)}`);
    assert(Array.isArray(schema.payload?.requiredAttributes), "expected requiredAttributes array");
    assert(schema.payload.requiredAttributes.includes("item_name"), "expected item_name required attribute");
    assert(schema.payload.requiredAttributes.includes("material_type"), "expected material_type required attribute");
    assert(Array.isArray(schema.payload?.optionalAttributes), "expected optionalAttributes array");
    assert(schema.payload.optionalAttributes.includes("color"), "expected color optional attribute");
    assert(Array.isArray(schema.payload?.validValues?.color), "expected color enum values");
    assert(schema.payload.validValues.color.includes("black"), "expected black enum value");
    assert(Array.isArray(schema.payload?.validValues?.size), "expected size enum values");
    assert(schema.payload.validValues.size.includes("M"), "expected size oneOf extraction");

    assert(stub.calls.definitions.length === 1, `expected one definitions call, got ${stub.calls.definitions.length}`);
    const definitionsCall = stub.calls.definitions[0];
    assert(definitionsCall.productType === "general", `unexpected definitions product type ${definitionsCall.productType}`);
    assert(definitionsCall.auth === "", `unexpected definitions auth header ${definitionsCall.auth}`);
    assert(definitionsCall.accessToken === "amazon-access-token-2", `unexpected x-amz-access-token ${definitionsCall.accessToken}`);
    assert(/^\d{8}T\d{6}Z$/.test(definitionsCall.amzDate), `unexpected x-amz-date ${definitionsCall.amzDate}`);
    assert(definitionsCall.userAgent.includes("TEJPIMAmazonConnector/0.1"), `unexpected user-agent ${definitionsCall.userAgent}`);
    assert(
      definitionsCall.url.includes(`marketplaceIds=${encodeURIComponent(MARKETPLACE_ID)}`) &&
        definitionsCall.url.includes("requirements=LISTING") &&
        definitionsCall.url.includes("requirementsEnforced=ENFORCED") &&
        definitionsCall.url.includes(`locale=${encodeURIComponent("en_IN")}`),
      `unexpected product type definitions url ${definitionsCall.url}`,
    );

    assert(stub.calls.schemaLinks.length === 1, `expected one schema link fetch, got ${stub.calls.schemaLinks.length}`);
    const schemaLinkCall = stub.calls.schemaLinks[0];
    assert(schemaLinkCall.auth === "", `unexpected schema link auth ${schemaLinkCall.auth}`);
    assert(schemaLinkCall.accessToken === "amazon-access-token-2", `unexpected schema link x-amz-access-token ${schemaLinkCall.accessToken}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          validated: [
            "amazon_auth_code_exchange_persists_tokens_for_installation",
            "amazon_product_type_schema_fetch_uses_documented_definitions_query_shape",
            "amazon_product_type_schema_fetch_follows_schema_link_and_extracts_required_and_enum_fields",
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
    console.error("Amazon runtime foundation integration test failed:");
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
    await new Promise((resolve) => stub.server.close(() => resolve()));
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
  console.error("Amazon runtime foundation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
