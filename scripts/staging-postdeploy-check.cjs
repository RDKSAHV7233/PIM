#!/usr/bin/env node
/* eslint-disable no-console */

const { randomUUID } = require("node:crypto");

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

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value]),
  );
}

function headersToObject(headers) {
  if (!headers) {
    return {};
  }
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  if (typeof headers.forEach === "function") {
    const values = {};
    headers.forEach((value, key) => {
      values[key] = value;
    });
    return values;
  }
  if (typeof headers.get === "function") {
    const setCookie = headers.get("set-cookie");
    return setCookie ? { "set-cookie": setCookie } : {};
  }
  return { ...headers };
}

async function request(baseUrl, path, options = {}) {
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
      return {
        status: response.status,
        payload,
        text,
        headers: normalizeHeaders(headersToObject(response.headers)),
        setCookie:
          typeof response.headers.getSetCookie === "function"
            ? response.headers.getSetCookie()
            : response.headers.get("set-cookie")
              ? [response.headers.get("set-cookie")]
              : [],
      };
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

async function requestJson(baseUrl, path, options = {}) {
  return request(baseUrl, path, options);
}

function assertStatus(result, expected, context) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `${context} failed: expected ${expectedStatuses.join("/")}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function extractCookieHeader(setCookieHeaders) {
  const cookies = setCookieHeaders
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .map((value) => value.split(";")[0])
    .filter(Boolean);
  return cookies.join("; ");
}

function envFlagEnabled(name) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

async function runNonAdminAccessPolicyValidation(baseUrl, workspaceSlug, adminToken) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const tempPassword = `VexaTmp!${randomUUID().replace(/-/g, "").slice(0, 12)}#1a`;
  const adminHeaders = {
    authorization: `Bearer ${adminToken}`,
  };
  const adminJsonHeaders = {
    ...adminHeaders,
    "content-type": "application/json",
  };
  const tempUsers = [
    { userId: `access-policy-viewer-${suffix}@vexa-pim.local`, role: "viewer" },
    { userId: `access-policy-reviewer-${suffix}@vexa-pim.local`, role: "reviewer" },
    { userId: `access-policy-editor-${suffix}@vexa-pim.local`, role: "editor" },
  ];
  const validated = [];

  async function deactivateUser(userId) {
    await requestJson(
      baseUrl,
      `/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/deactivate`,
      {
        method: "POST",
        headers: adminHeaders,
        retries: 1,
      },
    ).catch(() => null);
  }

  try {
    for (const user of tempUsers) {
      const created = await requestJson(baseUrl, "/api/v1/admin/workspace/users", {
        method: "POST",
        headers: adminJsonHeaders,
        body: {
          userId: user.userId,
          role: user.role,
        },
        retries: 2,
      });
      assertStatus(created, 201, `create ${user.role} workspace user`);

      const passwordSet = await requestJson(
        baseUrl,
        `/api/v1/admin/workspace/users/${encodeURIComponent(user.userId)}/password`,
        {
          method: "POST",
          headers: adminJsonHeaders,
          body: {
            password: tempPassword,
          },
          retries: 2,
        },
      );
      assertStatus(passwordSet, 200, `set ${user.role} workspace user password`);
    }

    const loginResults = {};
    for (const user of tempUsers) {
      const login = await requestJson(baseUrl, "/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
          workspaceSlug,
          userId: user.userId,
          password: tempPassword,
          expiresInMinutes: 30,
        },
        retries: 2,
      });
      assertStatus(login, 201, `${user.role} login`);
      const token = String(login.payload?.accessToken ?? "");
      if (!token) {
        throw new Error(`${user.role} login response missing accessToken`);
      }
      loginResults[user.role] = { userId: user.userId, token };
    }

    for (const role of ["viewer", "reviewer", "editor"]) {
      const deniedAuditLogs = await requestJson(baseUrl, "/api/v1/audit/logs?limit=1", {
        headers: {
          authorization: `Bearer ${loginResults[role].token}`,
        },
        retries: 1,
      });
      assertStatus(deniedAuditLogs, 403, `${role} audit log denial`);
    }
    validated.push(
      "viewer_denied_audit_logs_in_staging",
      "reviewer_denied_audit_logs_in_staging",
      "editor_denied_audit_logs_in_staging",
    );

    const viewerAdminListDenied = await requestJson(baseUrl, "/api/v1/admin/workspace/users", {
      headers: {
        authorization: `Bearer ${loginResults.viewer.token}`,
      },
      retries: 1,
    });
    assertStatus(viewerAdminListDenied, 403, "viewer denied workspace user admin route");
    validated.push("viewer_denied_workspace_user_admin_route_in_staging");

    const viewerPrivacyBeforeLock = await requestJson(baseUrl, "/api/v1/auth/account/privacy-status", {
      headers: {
        authorization: `Bearer ${loginResults.viewer.token}`,
      },
      retries: 1,
    });
    assertStatus(viewerPrivacyBeforeLock, 200, "viewer privacy status before lock");

    const lockViewer = await requestJson(
      baseUrl,
      `/api/v1/admin/workspace/users/${encodeURIComponent(loginResults.viewer.userId)}/lock`,
      {
        method: "POST",
        headers: adminJsonHeaders,
        body: {
          durationMinutes: 60,
          reason: "access-policy-staging-smoke",
        },
        retries: 2,
      },
    );
    assertStatus(lockViewer, 200, "lock viewer");

    const staleViewerAfterLock = await requestJson(baseUrl, "/api/v1/auth/account/privacy-status", {
      headers: {
        authorization: `Bearer ${loginResults.viewer.token}`,
      },
      retries: 1,
    });
    assertStatus(staleViewerAfterLock, 401, "stale viewer token denied after lock");
    if (String(staleViewerAfterLock.payload?.error ?? "") !== "USER_LOCKED") {
      throw new Error(`stale viewer token after lock returned unexpected payload: ${JSON.stringify(staleViewerAfterLock.payload)}`);
    }
    validated.push("stale_viewer_token_denied_after_lock_in_staging");

    const unlockViewer = await requestJson(
      baseUrl,
      `/api/v1/admin/workspace/users/${encodeURIComponent(loginResults.viewer.userId)}/unlock`,
      {
        method: "POST",
        headers: adminHeaders,
        retries: 2,
      },
    );
    assertStatus(unlockViewer, 200, "unlock viewer");

    const viewerLoginAfterUnlock = await requestJson(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        workspaceSlug,
        userId: loginResults.viewer.userId,
        password: tempPassword,
        expiresInMinutes: 30,
      },
      retries: 2,
    });
    assertStatus(viewerLoginAfterUnlock, 201, "viewer login after unlock");
    const viewerTokenAfterUnlock = String(viewerLoginAfterUnlock.payload?.accessToken ?? "");
    if (!viewerTokenAfterUnlock) {
      throw new Error("viewer login after unlock response missing accessToken");
    }

    const deactivateViewer = await requestJson(
      baseUrl,
      `/api/v1/admin/workspace/users/${encodeURIComponent(loginResults.viewer.userId)}/deactivate`,
      {
        method: "POST",
        headers: adminHeaders,
        retries: 2,
      },
    );
    assertStatus(deactivateViewer, 200, "deactivate viewer");

    const staleViewerAfterDeactivate = await requestJson(baseUrl, "/api/v1/auth/account/privacy-status", {
      headers: {
        authorization: `Bearer ${viewerTokenAfterUnlock}`,
      },
      retries: 1,
    });
    assertStatus(staleViewerAfterDeactivate, 401, "stale viewer token denied after deactivation");
    if (String(staleViewerAfterDeactivate.payload?.error ?? "") !== "USER_INACTIVE") {
      throw new Error(
        `stale viewer token after deactivation returned unexpected payload: ${JSON.stringify(staleViewerAfterDeactivate.payload)}`,
      );
    }

    const viewerLoginAfterDeactivate = await requestJson(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        workspaceSlug,
        userId: loginResults.viewer.userId,
        password: tempPassword,
        expiresInMinutes: 30,
      },
      retries: 1,
    });
    assertStatus(viewerLoginAfterDeactivate, 401, "deactivated viewer login denied");
    if (String(viewerLoginAfterDeactivate.payload?.error ?? "") !== "INVALID_CREDENTIALS") {
      throw new Error(`deactivated viewer login returned unexpected payload: ${JSON.stringify(viewerLoginAfterDeactivate.payload)}`);
    }
    validated.push(
      "stale_viewer_token_denied_after_deactivation_in_staging",
      "deactivated_viewer_login_denied_in_staging",
    );

    return validated;
  } finally {
    for (const user of tempUsers) {
      await deactivateUser(user.userId);
    }
  }
}

async function run() {
  const baseUrl = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const webBaseUrl = requireEnv("STAGING_WEB_URL").replace(/\/+$/, "");
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

  const nonAdminValidated = envFlagEnabled("STAGING_VALIDATE_NON_ADMIN")
    ? await runNonAdminAccessPolicyValidation(baseUrl, workspaceSlug, token)
    : [];

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

  const webLogin = await request(webBaseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      workspaceSlug,
      userId: smokeUser,
      password: smokePassword,
    },
    retries: 2,
  });
  assertStatus(webLogin, [200, 201], "web login");
  if (String(webLogin.payload?.role ?? "") !== "admin") {
    throw new Error(`web login role mismatch: expected=admin got=${JSON.stringify(webLogin.payload)}`);
  }

  const cookieHeader = extractCookieHeader(webLogin.setCookie);
  if (!cookieHeader || !cookieHeader.includes("pim_access_token=")) {
    throw new Error(`web login missing pim_access_token cookie: cookies=${JSON.stringify(webLogin.setCookie)}`);
  }

  const webChannels = await request(webBaseUrl, "/channels", {
    headers: {
      cookie: cookieHeader,
    },
    retries: 2,
  });
  assertStatus(webChannels, 200, "web channels render");
  if (!String(webChannels.text).includes("Open governance")) {
    throw new Error("web channels render missing admin CTA: expected 'Open governance'");
  }
  if (String(webChannels.text).includes("Review governance rules")) {
    throw new Error("web channels render regressed to read-only governance CTA");
  }

  const webGovernance = await request(webBaseUrl, "/admin/connectors", {
    headers: {
      cookie: cookieHeader,
    },
    retries: 2,
  });
  assertStatus(webGovernance, 200, "web governance render");
  if (!String(webGovernance.text).includes("Create Governance Policy")) {
    throw new Error("web governance render missing admin policy form heading");
  }
  if (String(webGovernance.text).includes("Governance Visibility")) {
    throw new Error("web governance render regressed to read-only governance visibility state");
  }

  const webDashboard = await request(webBaseUrl, "/dashboard", {
    headers: {
      cookie: cookieHeader,
    },
    retries: 2,
  });
  assertStatus(webDashboard, 200, "web dashboard render");
  if (!String(webDashboard.text).includes("Catalog Health")) {
    throw new Error("web dashboard render missing live dashboard content heading");
  }
  if (String(webDashboard.text).includes("Dashboard data is temporarily unavailable")) {
    throw new Error("web dashboard render fell back to API-unavailable recovery state");
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
          "web_login_sets_admin_session_cookie",
          "web_channels_renders_admin_governance_cta",
          "web_governance_renders_admin_policy_form",
          "web_dashboard_renders_live_catalog_health_view",
          ...nonAdminValidated,
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
