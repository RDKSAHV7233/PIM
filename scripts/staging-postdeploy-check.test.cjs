#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

async function main() {
  let loginBody = null;
  let usageAuthorized = false;
  let connectorsAuthorized = false;
  let logoutAuthorized = false;
  let revokedUsageAuthorized = false;
  let tokenRevoked = false;
  let webLoginBody = null;
  let webCookieIssued = false;
  let webChannelsAuthorized = false;
  let webGovernanceAuthorized = false;
  let webDashboardAuthorized = false;
  const users = new Map();
  const passwords = new Map();
  const tokens = new Map([["test-token", { userId: "admin@vexa-pim.local", role: "admin" }]]);
  const lockedUsers = new Set();
  const inactiveUsers = new Set();
  const purgedUsers = new Set();
  const auditLogDeniedRoles = new Set();
  let viewerCreateConflictExercised = false;
  let viewerAdminListDenied = false;
  let staleViewerLockedRejected = false;
  let staleViewerInactiveRejected = false;
  let deactivatedViewerLoginRejected = false;
  let viewerLoginRateLimitExercised = false;

  const validCookie = "pim_access_token=web-session-token";

  function hasValidCookie(req) {
    return String(req.headers.cookie ?? "").includes(validCookie);
  }

  function bearerToken(req) {
    return String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  }

  function currentActor(req) {
    return tokens.get(bearerToken(req)) ?? null;
  }

  function routeUserId(url) {
    return decodeURIComponent(url.pathname.split("/")[6] || "");
  }

  const apiServer = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          env: "development",
          queueRuntime: {
            backend: "bullmq",
            workerEnabled: true,
          },
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/catalog/products") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/auth/login") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const parsedBody = JSON.parse(raw || "{}");
        if (parsedBody.userId === "admin@vexa-pim.local") {
          loginBody = parsedBody;
        }
        if (parsedBody.workspaceSlug !== "default") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "WORKSPACE_NOT_FOUND" }));
          return;
        }
        if (parsedBody.userId === "admin@vexa-pim.local" && parsedBody.password === "vexa-pim-demo-password") {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ accessToken: "test-token" }));
          return;
        }
        const role = users.get(parsedBody.userId);
        const expectedPassword = passwords.get(parsedBody.userId);
        if (role === "viewer" && !viewerLoginRateLimitExercised) {
          viewerLoginRateLimitExercised = true;
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "IP_RATE_LIMITED" }));
          return;
        }
        if (inactiveUsers.has(parsedBody.userId)) {
          deactivatedViewerLoginRejected = true;
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INVALID_CREDENTIALS" }));
          return;
        }
        if (lockedUsers.has(parsedBody.userId)) {
          res.writeHead(423, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "ACCOUNT_LOCKED" }));
          return;
        }
        if (!role || !expectedPassword || parsedBody.password !== expectedPassword) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INVALID_CREDENTIALS" }));
          return;
        }
        const issuedToken = `token-${parsedBody.userId}`;
        tokens.set(issuedToken, { userId: parsedBody.userId, role });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ accessToken: issuedToken }));
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/billing/usage") {
      const isAuthorized = req.headers.authorization === "Bearer test-token";
      if (tokenRevoked && isAuthorized) {
        revokedUsageAuthorized = true;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "TOKEN_REVOKED" }));
        return;
      }
      usageAuthorized = isAuthorized;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ plan: "starter" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/connectors/installed") {
      connectorsAuthorized = req.headers.authorization === "Bearer test-token";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/auth/logout") {
      logoutAuthorized = req.headers.authorization === "Bearer test-token";
      tokenRevoked = logoutAuthorized;
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/admin/workspace/users") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const actor = currentActor(req);
        if (!actor || actor.role !== "admin") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "FORBIDDEN" }));
          return;
        }
        const body = JSON.parse(raw || "{}");
        if (body.role === "viewer" && !viewerCreateConflictExercised) {
          viewerCreateConflictExercised = true;
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "USER_ALREADY_EXISTS" }));
          return;
        }
        users.set(body.userId, body.role);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ userId: body.userId, role: body.role }));
      });
      return;
    }

    if (req.method === "POST" && /^\/api\/v1\/admin\/workspace\/users\/.+\/password$/.test(url.pathname)) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const actor = currentActor(req);
        if (!actor || actor.role !== "admin") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "FORBIDDEN" }));
          return;
        }
        const body = JSON.parse(raw || "{}");
        passwords.set(routeUserId(url), body.password);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ userId: routeUserId(url) }));
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/audit/logs") {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        if (actor?.role) {
          auditLogDeniedRoles.add(actor.role);
        }
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/admin/workspace/users") {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        if (actor?.role === "viewer") {
          viewerAdminListDenied = true;
        }
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/auth/account/privacy-status") {
      const actor = currentActor(req);
      if (!actor) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
        return;
      }
      if (lockedUsers.has(actor.userId)) {
        staleViewerLockedRejected = true;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "USER_LOCKED" }));
        return;
      }
      if (inactiveUsers.has(actor.userId)) {
        staleViewerInactiveRejected = true;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "USER_INACTIVE" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && /^\/api\/v1\/admin\/workspace\/users\/.+\/lock$/.test(url.pathname)) {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      lockedUsers.add(routeUserId(url));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ userId: routeUserId(url), isLocked: true, lockedUntil: "2030-01-01T00:00:00.000Z" }));
      return;
    }

    if (req.method === "POST" && /^\/api\/v1\/admin\/workspace\/users\/.+\/unlock$/.test(url.pathname)) {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      lockedUsers.delete(routeUserId(url));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ userId: routeUserId(url), lockedUntil: null }));
      return;
    }

    if (req.method === "POST" && /^\/api\/v1\/admin\/workspace\/users\/.+\/deactivate$/.test(url.pathname)) {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      inactiveUsers.add(routeUserId(url));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ userId: routeUserId(url), isActive: false }));
      return;
    }

    if (req.method === "DELETE" && /^\/api\/v1\/admin\/workspace\/users\/.+\/purge$/.test(url.pathname)) {
      const actor = currentActor(req);
      if (!actor || actor.role !== "admin") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "FORBIDDEN" }));
        return;
      }
      const targetUserId = routeUserId(url);
      if (!inactiveUsers.has(targetUserId)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "USER_MUST_BE_DEACTIVATED_BEFORE_PURGE" }));
        return;
      }
      purgedUsers.add(targetUserId);
      users.delete(targetUserId);
      inactiveUsers.delete(targetUserId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", path: url.pathname }));
  });

  const webServer = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        webLoginBody = JSON.parse(raw || "{}");
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            `${validCookie}; Path=/; HttpOnly`,
            "pim_csrf_token=web-csrf-token; Path=/; SameSite=Lax",
          ],
        });
        res.end(JSON.stringify({ userId: "admin@vexa-pim.local", tenantId: "default", role: "admin" }));
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/channels") {
      webChannelsAuthorized = hasValidCookie(req);
      if (webChannelsAuthorized) {
        webCookieIssued = true;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Connections</h1><a>Open governance</a></body></html>");
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/connectors") {
      webGovernanceAuthorized = hasValidCookie(req);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Connector Access</h1><h2>Create Governance Policy</h2></body></html>");
      return;
    }

    if (req.method === "GET" && url.pathname === "/dashboard") {
      webDashboardAuthorized = hasValidCookie(req);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Dashboard</h1><h2>Catalog Health</h2></body></html>");
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", path: url.pathname }));
  });

  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => webServer.listen(0, "127.0.0.1", resolve));
  const apiAddress = apiServer.address();
  const webAddress = webServer.address();
  const baseUrl = `http://127.0.0.1:${apiAddress.port}`;
  const webBaseUrl = `http://127.0.0.1:${webAddress.port}`;

  const child = spawn(process.execPath, [path.join(__dirname, "staging-postdeploy-check.cjs")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      STAGING_BASE_URL: baseUrl,
      STAGING_WEB_URL: webBaseUrl,
      STAGING_SMOKE_WORKSPACE: "default",
      STAGING_SMOKE_USER: "admin@vexa-pim.local",
      STAGING_SMOKE_PASSWORD: "vexa-pim-demo-password",
      STAGING_EXPECTED_ENV: "development",
      STAGING_VALIDATE_NON_ADMIN: "true",
      STAGING_POSTDEPLOY_RETRY_BASE_MS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  await new Promise((resolve) => apiServer.close(resolve));
  await new Promise((resolve) => webServer.close(resolve));

  assert.equal(exitCode, 0, `staging smoke script failed: ${stderr || stdout}`);
  assert.deepEqual(
    loginBody,
    {
      workspaceSlug: "default",
      userId: "admin@vexa-pim.local",
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    },
    "smoke login payload must include workspaceSlug",
  );
  assert.deepEqual(
    webLoginBody,
    {
      workspaceSlug: "default",
      userId: "admin@vexa-pim.local",
      password: "vexa-pim-demo-password",
    },
    "web smoke login payload must include workspaceSlug and credentials",
  );
  assert.equal(usageAuthorized, true, "billing usage must reuse bearer token from login");
  assert.equal(connectorsAuthorized, true, "connectors installed must reuse bearer token from login");
  assert.equal(logoutAuthorized, true, "logout must reuse bearer token from login");
  assert.equal(revokedUsageAuthorized, true, "revoked token check must reuse the logged-out bearer token");
  assert.equal(webCookieIssued, true, "web smoke login must issue a session cookie");
  assert.equal(webChannelsAuthorized, true, "web channels render must reuse the session cookie");
  assert.equal(webGovernanceAuthorized, true, "web governance render must reuse the session cookie");
  assert.equal(webDashboardAuthorized, true, "web dashboard render must reuse the session cookie");
  assert.deepEqual(
    [...auditLogDeniedRoles].sort(),
    ["editor", "reviewer", "viewer"],
    "non-admin staging smoke must deny audit logs for viewer/reviewer/editor",
  );
  assert.equal(viewerCreateConflictExercised, true, "staging smoke must retry duplicate temporary viewer ids");
  assert.equal(viewerLoginRateLimitExercised, true, "staging smoke must retry viewer login rate limits");
  assert.equal(viewerAdminListDenied, true, "viewer must be denied workspace user admin route");
  assert.equal(staleViewerLockedRejected, true, "viewer stale token must be rejected after lock");
  assert.equal(staleViewerInactiveRejected, true, "viewer stale token must be rejected after deactivation");
  assert.equal(deactivatedViewerLoginRejected, true, "deactivated viewer login must be rejected");
  assert.equal(purgedUsers.size, 3, "all three temp access-policy users must be purged, not just deactivated, after the run");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "staging_smoke_login_includes_workspace_slug",
          "staging_smoke_reuses_bearer_token_for_authenticated_checks",
          "staging_smoke_proves_logout_revokes_token",
          "staging_smoke_proves_web_role_render_for_admin_session",
          "staging_smoke_proves_web_dashboard_live_render_after_login",
          "staging_smoke_proves_non_admin_audit_log_denials",
          "staging_smoke_proves_stale_token_rejection_after_lock_and_deactivation",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
