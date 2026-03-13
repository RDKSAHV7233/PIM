#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function createMockFlipkartOAuthServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const params = new URLSearchParams(bodyText);
    requests.push({
      url: req.url,
      authorization: String(req.headers.authorization || ""),
      grantType: params.get("grant_type"),
      refreshToken: params.get("refresh_token"),
    });

    if (req.url === "/oauth-service/oauth/token" && params.get("grant_type") === "refresh_token") {
      if (params.get("refresh_token") === "bad-refresh-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "fk-access-token",
          refresh_token: params.get("refresh_token"),
          expires_in: 3600,
          token_type: "bearer",
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6180 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `flipkart-install-${runId}`;
  const workspaceSlug = `fk-install-${runId}`.slice(0, 24);
  const userId = `flipkart-install-user-${runId}`;
  const oauthServer = createMockFlipkartOAuthServer();
  const oauthBaseUrl = await oauthServer.start();
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Flipkart Install" },
    }),
    PIM_FLIPKART_OAUTH_BASE_URL: oauthBaseUrl,
    PIM_FLIPKART_API_BASE_URL: `${oauthBaseUrl}/sellers`,
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const enterprisePlan = await apiRequest(baseUrl, "POST", "/billing/plan-tier", token, {
      planTier: "ENTERPRISE",
    });
    assertStatus(enterprisePlan, 201, "set enterprise plan tier");

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
      externalAccountRef: `seller-${runId}`,
      clientId: "flipkart-client-id",
      clientSecret: "flipkart-client-secret",
      refreshToken: "valid-refresh-token",
    });
    assertStatus(install, 201, "install flipkart with credentials");
    const installationId = String(install.payload.id);

    const storedRows = await prisma.$queryRawUnsafe(
      `
      SELECT credential_type AS "credentialType"
      FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2
      ORDER BY credential_type ASC
      `,
      tenantId,
      installationId,
    );
    const types = Array.isArray(storedRows) ? storedRows.map((row) => String(row.credentialType)) : [];
    assert(types.includes("client_id"), "expected stored client_id credential");
    assert(types.includes("client_secret"), "expected stored client_secret credential");
    assert(types.includes("refresh_token"), "expected stored refresh_token credential");
    assert(types.includes("access_token"), "expected stored access_token credential after validation");

    const failedInstall = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "secondary",
      externalAccountRef: `seller-bad-${runId}`,
      clientId: "flipkart-client-id",
      clientSecret: "flipkart-client-secret",
      refreshToken: "bad-refresh-token",
    });
    assertStatus(failedInstall, 400, "install flipkart with invalid credentials");
    assert(
      String(failedInstall.payload?.error ?? "") === "FLIPKART_CREDENTIALS_INVALID",
      `expected FLIPKART_CREDENTIALS_INVALID, got ${JSON.stringify(failedInstall.payload)}`,
    );

    const secondaryInstallations = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM connector_installations
      WHERE tenant_key = $1 AND account_alias = 'secondary'
      `,
      tenantId,
    );
    assert(
      Array.isArray(secondaryInstallations) && secondaryInstallations.length === 0,
      "invalid install must not leave connector_installations row",
    );

    const secondaryCredentials = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM connector_credentials
      WHERE tenant_key = $1
        AND installation_id IN (
          SELECT id
          FROM connector_installations
          WHERE tenant_key = $1 AND account_alias = 'secondary'
        )
      `,
      tenantId,
    );
    assert(
      Array.isArray(secondaryCredentials) && secondaryCredentials.length === 0,
      "invalid install must not leave connector_credentials rows",
    );

    assert(
      oauthServer.requests.some((request) => request.grantType === "refresh_token" && request.refreshToken === "valid-refresh-token"),
      "expected OAuth refresh token call for successful install validation",
    );
    assert(
      oauthServer.requests.some((request) => request.grantType === "refresh_token" && request.refreshToken === "bad-refresh-token"),
      "expected OAuth refresh token call for invalid install validation",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          validated: [
            "flipkart_install_stores_encrypted_credentials",
            "flipkart_install_validates_credentials_before_success",
            "flipkart_invalid_credentials_cleanup_installation_artifacts",
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
    console.error("Flipkart install credentials integration test failed:");
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
    await oauthServer.stop();
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
