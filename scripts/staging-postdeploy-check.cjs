#!/usr/bin/env node
/* eslint-disable no-console */

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(baseUrl, path, options = {}) {
  const retries = Number(options.retries ?? 0);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        await wait(1_000 * (attempt + 1));
        continue;
      }
      return { status: response.status, payload };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await wait(750 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("request failed");
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function run() {
  const baseUrl = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const smokeUser = requireEnv("STAGING_SMOKE_USER");
  const smokePassword = requireEnv("STAGING_SMOKE_PASSWORD");
  const expectedEnv = String(process.env.STAGING_EXPECTED_ENV ?? "staging").trim();

  const health = await requestJson(baseUrl, "/api/v1/health", { retries: 3 });
  assertStatus(health, 200, "health");
  if (!health.payload || health.payload.status !== "ok") {
    throw new Error(`health payload invalid: ${JSON.stringify(health.payload)}`);
  }
  if (String(health.payload.env ?? "") !== expectedEnv) {
    throw new Error(`health env mismatch: expected=${expectedEnv} got=${String(health.payload.env ?? "")}`);
  }
  if (String(health.payload.queueRuntime?.backend ?? "") !== "bullmq") {
    throw new Error(
      `health queue backend mismatch: expected=bullmq got=${String(health.payload.queueRuntime?.backend ?? "")}`,
    );
  }
  if (health.payload.queueRuntime?.workerEnabled !== true) {
    throw new Error(`health queue worker not enabled: payload=${JSON.stringify(health.payload.queueRuntime ?? null)}`);
  }

  const legacyHeaderProbe = await requestJson(baseUrl, "/api/v1/catalog/products", {
    headers: {
      "x-pim-role": "admin",
      "x-pim-tenant": "forged-tenant",
    },
    retries: 2,
  });
  if (![401, 403].includes(legacyHeaderProbe.status)) {
    throw new Error(
      `legacy header probe failed: expected 401/403, got ${legacyHeaderProbe.status}; payload=${JSON.stringify(legacyHeaderProbe.payload)}`,
    );
  }

  const login = await requestJson(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      workspaceSlug,
      userId: smokeUser,
      password: smokePassword,
      expiresInMinutes: 30,
    },
    retries: 2,
  });
  assertStatus(login, 201, "login");
  const token = String(login.payload?.accessToken ?? "");
  if (!token) {
    throw new Error("login response missing accessToken");
  }

  const usage = await requestJson(baseUrl, "/api/v1/billing/usage", {
    headers: {
      authorization: `Bearer ${token}`,
    },
    retries: 2,
  });
  assertStatus(usage, 200, "billing usage");

  const connectors = await requestJson(baseUrl, "/api/v1/connectors/installed", {
    headers: {
      authorization: `Bearer ${token}`,
    },
    retries: 2,
  });
  assertStatus(connectors, 200, "connectors installed");

  const logout = await requestJson(baseUrl, "/api/v1/auth/logout", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    retries: 2,
  });
  assertStatus(logout, 204, "logout");

  const revokedUsage = await requestJson(baseUrl, "/api/v1/billing/usage", {
    headers: {
      authorization: `Bearer ${token}`,
    },
    retries: 2,
  });
  if (revokedUsage.status !== 401) {
    throw new Error(
      `revoked token probe failed: expected 401, got ${revokedUsage.status}; payload=${JSON.stringify(revokedUsage.payload)}`,
    );
  }
  if (String(revokedUsage.payload?.error ?? "") !== "TOKEN_REVOKED") {
    throw new Error(`revoked token payload invalid: ${JSON.stringify(revokedUsage.payload)}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "health_status_ok",
          "health_env_matches_staging",
          "health_queue_backend_uses_bullmq",
          "health_queue_worker_enabled",
          "legacy_headers_not_authoritative",
          "auth_login_uses_workspace_scoped_credentials",
          "auth_login_works_for_smoke_user",
          "billing_usage_authenticated",
          "connectors_installed_authenticated",
          "logout_revokes_smoke_token",
          "revoked_token_returns_401",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
