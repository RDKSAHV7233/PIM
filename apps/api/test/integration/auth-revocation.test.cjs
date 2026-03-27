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
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format returned by login.");
  }
  const payload = parts[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
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
  return {
    status: response.status,
    payload,
  };
}

function assertOk(result, message) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${message}. status=${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 4900 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `auth-revoke-tenant-${runId}`;
  const workspaceSuffix = runId.slice(-8);
  const userId = `auth-revoke-user-${runId}`;
  const viewerTenant = `${tenantId}-viewer`;
  const adminTenant = `${tenantId}-admin`;
  const viewerWorkspaceSlug = `vw-${workspaceSuffix}`;
  const adminWorkspaceSlug = `ad-${workspaceSuffix}`;
  const viewerUserId = `${userId}-viewer-default`;
  const adminUserId = userId;
  const forgedUserId = `${userId}-forged`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "viewer",
    PIM_AUTH_PASSWORD: "tej-pim-demo-password",
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [viewerUserId]: { tenantId: viewerTenant, role: "viewer", workspaceSlug: viewerWorkspaceSlug },
      [adminUserId]: { tenantId: adminTenant, role: "admin", workspaceSlug: adminWorkspaceSlug },
      [forgedUserId]: { tenantId: viewerTenant, role: "viewer", workspaceSlug: viewerWorkspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [viewerWorkspaceSlug]: { tenantId: viewerTenant, displayName: "Viewer workspace" },
      [adminWorkspaceSlug]: { tenantId: adminTenant, displayName: "Admin workspace" },
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

    const legacyHeaderAuth = await fetch(`${baseUrl}/taxonomy/categories`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-pim-tenant": tenantId,
        "x-pim-role": "admin",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const legacyPayload = await legacyHeaderAuth.json().catch(() => ({}));
    if (legacyHeaderAuth.status !== 403) {
      throw new Error(
        `Expected legacy header auth to fail with 403, got ${legacyHeaderAuth.status}. payload=${JSON.stringify(legacyPayload)}`,
      );
    }

    const defaultRoleLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: viewerWorkspaceSlug,
      userId: viewerUserId,
      password: "tej-pim-demo-password",
      expiresInMinutes: 15,
    });
    assertOk(defaultRoleLogin, "Default-role login failed");
    if (defaultRoleLogin.payload?.role !== "viewer") {
      throw new Error(
        `Expected default login role=viewer, got payload=${JSON.stringify(defaultRoleLogin.payload)}`,
      );
    }
    const defaultRoleClaims = decodeJwtPayload(defaultRoleLogin.payload.accessToken);
    if (defaultRoleClaims.role !== "viewer") {
      throw new Error(`Expected JWT role=viewer for default login, got ${JSON.stringify(defaultRoleClaims)}`);
    }
    if (defaultRoleClaims.tenantId !== viewerTenant) {
      throw new Error(
        `Expected JWT tenantId=${viewerTenant} from login payload, got ${JSON.stringify(defaultRoleClaims)}`,
      );
    }

    const loginResult = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: adminWorkspaceSlug,
      userId: adminUserId,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertOk(loginResult, "Login failed");
    const accessToken = loginResult.payload?.accessToken;
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Login did not return a valid accessToken.");
    }
    if (loginResult.payload?.role !== "admin") {
      throw new Error(`Expected login role=admin, got payload=${JSON.stringify(loginResult.payload)}`);
    }
    if (loginResult.payload?.tenantId !== adminTenant) {
      throw new Error(
        `Expected login tenantId=${adminTenant}, got payload=${JSON.stringify(loginResult.payload)}`,
      );
    }

    const decoded = decodeJwtPayload(accessToken);
    if (!decoded || typeof decoded.jti !== "string" || decoded.jti.trim().length === 0) {
      throw new Error("JWT payload does not include a non-empty jti claim.");
    }
    if (decoded.role !== "admin" || decoded.tenantId !== adminTenant) {
      throw new Error(`Expected JWT claims to match login role/tenant. payload=${JSON.stringify(decoded)}`);
    }

    const forgedIdentityLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: viewerWorkspaceSlug,
      userId: forgedUserId,
      tenantId: `${tenantId}-forged-admin`,
      role: "admin",
      password: "tej-pim-demo-password",
      expiresInMinutes: 15,
    });
    assertOk(forgedIdentityLogin, "Forged identity login failed");
    if (forgedIdentityLogin.payload?.role !== "viewer" || forgedIdentityLogin.payload?.tenantId !== viewerTenant) {
      throw new Error(
        `Expected client-supplied role/tenant to be ignored, got payload=${JSON.stringify(forgedIdentityLogin.payload)}`,
      );
    }
    const forgedClaims = decodeJwtPayload(forgedIdentityLogin.payload.accessToken);
    if (forgedClaims.role !== "viewer" || forgedClaims.tenantId !== viewerTenant) {
      throw new Error(
        `Expected forged JWT claims to remain server-derived, got payload=${JSON.stringify(forgedClaims)}`,
      );
    }

    const preLogout = await apiRequest(baseUrl, "GET", "/taxonomy/categories", accessToken);
    assertOk(preLogout, "Pre-logout authenticated request failed");

    const logoutResult = await apiRequest(baseUrl, "POST", "/auth/logout", accessToken);
    if (logoutResult.status !== 204) {
      throw new Error(`Logout failed. status=${logoutResult.status} payload=${JSON.stringify(logoutResult.payload)}`);
    }

    const postLogout = await apiRequest(baseUrl, "GET", "/taxonomy/categories", accessToken);
    if (postLogout.status !== 401) {
      throw new Error(
        `Expected revoked token request to return 401, got ${postLogout.status}. payload=${JSON.stringify(postLogout.payload)}`,
      );
    }
    if (postLogout.payload?.error !== "TOKEN_REVOKED") {
      throw new Error(
        `Expected error=TOKEN_REVOKED after logout, got payload=${JSON.stringify(postLogout.payload)}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          userId,
          validated: [
          "legacy_header_auth_blocked",
          "default_login_role_is_viewer",
          "login_role_and_tenant_match_claims",
          "client_cannot_forge_role_or_tenant_on_login",
          "jwt_has_jti",
          "logout_revokes_token",
          "revoked_token_returns_401",
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
    console.error("Auth revocation integration test failed:");
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



