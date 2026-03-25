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

  const server = http.createServer((req, res) => {
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
        loginBody = JSON.parse(raw || "{}");
        if (loginBody.workspaceSlug !== "default") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "WORKSPACE_NOT_FOUND" }));
          return;
        }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ accessToken: "test-token" }));
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

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", path: url.pathname }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const child = spawn(process.execPath, [path.join(__dirname, "staging-postdeploy-check.cjs")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      STAGING_BASE_URL: baseUrl,
      STAGING_SMOKE_WORKSPACE: "default",
      STAGING_SMOKE_USER: "admin@tej-pim.local",
      STAGING_SMOKE_PASSWORD: "tej-pim-demo-password",
      STAGING_EXPECTED_ENV: "development",
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
  await new Promise((resolve) => server.close(resolve));

  assert.equal(exitCode, 0, `staging smoke script failed: ${stderr || stdout}`);
  assert.deepEqual(
    loginBody,
    {
      workspaceSlug: "default",
      userId: "admin@tej-pim.local",
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    },
    "smoke login payload must include workspaceSlug",
  );
  assert.equal(usageAuthorized, true, "billing usage must reuse bearer token from login");
  assert.equal(connectorsAuthorized, true, "connectors installed must reuse bearer token from login");
  assert.equal(logoutAuthorized, true, "logout must reuse bearer token from login");
  assert.equal(revokedUsageAuthorized, true, "revoked token check must reuse the logged-out bearer token");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "staging_smoke_login_includes_workspace_slug",
          "staging_smoke_reuses_bearer_token_for_authenticated_checks",
          "staging_smoke_proves_logout_revokes_token",
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
