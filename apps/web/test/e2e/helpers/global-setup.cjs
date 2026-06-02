/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

async function assertReachable(url, expectedStatus, context) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${context} failed: expected ${expectedStatus}, got ${response.status}; body=${body.slice(0, 300)}`);
  }
}

module.exports = async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
  const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
  const workspace = process.env.PLAYWRIGHT_WORKSPACE || "default";

  if (!workspace || workspace.trim().length === 0) {
    throw new Error("PLAYWRIGHT_WORKSPACE is required for Vexa PIM E2E.");
  }

  await assertReachable(`${baseURL}/login`, 200, "web login reachability");
  await assertReachable(`${apiURL}/health`, 200, "api health reachability");

  // ── Phase 9 pre-condition: public signup feature gate check ───────────────
  // If PLAYWRIGHT_SIGNUP_OUTBOX_DIR is set, the caller intends to run Phase 9
  // (public signup) specs. Check whether the signup feature is actually enabled.
  // If not, set PLAYWRIGHT_SIGNUP_DISABLED=true so individual specs can skip
  // gracefully instead of failing mid-run with cryptic errors.
  if (process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR) {
    let signupDisabled = false;
    try {
      const signupCheckUrl = `${apiURL}/signup/check-availability?slug=playwright-preflight-probe`;
      const signupRes = await fetch(signupCheckUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (signupRes.status !== 200) {
        // Only HTTP 200 confirms the feature is live. 404 = disabled, 400/500/429 = misconfigured.
        signupDisabled = true;
      }
    } catch {
      signupDisabled = true;
    }
    if (signupDisabled) {
      process.env.PLAYWRIGHT_SIGNUP_DISABLED = "true";
      console.warn(
        "[global-setup] Public signup feature is disabled or unreachable. " +
          "Phase 9 specs will be skipped automatically. " +
          "To enable: set FEATURE_PUBLIC_SIGNUP_ENABLED=true and AUTH_MODE=db, then restart both servers.",
      );
    } else {
      process.env.PLAYWRIGHT_SIGNUP_DISABLED = "false";
      console.log("[global-setup] Public signup feature is reachable — Phase 9 specs will run.");
    }
  }

  // ── Pre-authenticate all roles and persist tokens to disk ─────────────────
  // Playwright resets module state between spec files even with workers=1, so
  // the in-memory LOGIN_CACHE in vexa-pim.cjs is empty at the start of each
  // file. Saving tokens here means every file loads a warm cache from disk and
  // never touches the auth endpoint at test time — keeping us well within the
  // 10-login-per-15-minute IP rate limit.
  const STORAGE_STATE_DIR = path.join(__dirname, "../../../../../.runlogs/storage-state");
  const API_TOKEN_CACHE_FILE = path.join(STORAGE_STATE_DIR, "api-tokens.json");
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });

  const password = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";
  const roleUsers = {
    admin:           process.env.PLAYWRIGHT_ADMIN_USER           || "admin@vexa-pim.local",
    editor:          process.env.PLAYWRIGHT_EDITOR_USER          || "editor@vexa-pim.local",
    publisher:       process.env.PLAYWRIGHT_PUBLISHER_USER       || "publisher@vexa-pim.local",
    approver:        process.env.PLAYWRIGHT_APPROVER_USER        || "approver@vexa-pim.local",
    channel_manager: process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local",
    connector_admin: process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local",
    reviewer:        process.env.PLAYWRIGHT_REVIEWER_USER        || "reviewer@vexa-pim.local",
    viewer:          process.env.PLAYWRIGHT_VIEWER_USER          || "viewer@vexa-pim.local",
  };

  const tokenCache = {};
  for (const [role, userId] of Object.entries(roleUsers)) {
    try {
      const loginRes = await fetch(`${apiURL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: workspace, userId, password, expiresInMinutes: 240 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (loginRes.ok) {
        const payload = await loginRes.json();
        const cacheKey = `${apiURL}|${workspace}|${role}`;
        tokenCache[cacheKey] = payload;
      } else {
        console.warn(`[global-setup] Pre-auth for role "${role}" (${userId}) returned ${loginRes.status} — tests needing this role will skip.`);
      }
    } catch (err) {
      console.warn(`[global-setup] Pre-auth for role "${role}" failed: ${err.message} — tests needing this role will skip.`);
    }
  }

  fs.writeFileSync(API_TOKEN_CACHE_FILE, JSON.stringify(tokenCache, null, 2));
  console.log(
    `[global-setup] Pre-authenticated ${Object.keys(tokenCache).length}/${Object.keys(roleUsers).length} roles; ` +
      `tokens cached at ${path.relative(process.cwd(), API_TOKEN_CACHE_FILE)}`,
  );


  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "playwright-e2e",
        baseURL,
        apiURL,
        workspace,
        signupEnabled: process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR
          ? process.env.PLAYWRIGHT_SIGNUP_DISABLED !== "true"
          : "not-requested",
      },
      null,
      2,
    ),
  );
};
