/**
 * Prod-cert DEF-PC-016 regression: a session token that still looks valid locally
 * (signature + exp) but has been revoked server-side (logout in another tab, lockout,
 * password change…) must send the user to the login page. Before the fix, the dashboard
 * redirected to /login?reason=session_expired and the login page redirected straight back
 * to /dashboard (it trusted the local token), leaving a blank dashboard shell with
 * "Role: Admin" and no way to tell the session had ended.
 *
 * Auth-rate-limit note: the API allows 10 login attempts per IP per 15 minutes, and the whole
 * suite shares one IP. This spec therefore performs exactly two API logins in total (one token
 * that is revoked, one that stays valid) instead of one per test.
 */
const { test, expect } = require("@playwright/test");
const { apiRequest, DEFAULT_API_URL, DEFAULT_WORKSPACE, USERS } = require("./helpers/vexa-pim.cjs");

const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";

async function freshLogin() {
  // Fresh login (NOT the shared cached token other specs rely on).
  return apiRequest("POST", "/auth/login", null, {
    workspaceSlug: DEFAULT_WORKSPACE,
    userId: USERS.admin.userId,
    password: PASSWORD,
    expiresInMinutes: 60,
  });
}

test.describe("revoked-but-unexpired session → login (DEF-PC-016)", () => {
  let revokedToken;
  let validToken;

  test.beforeAll(async () => {
    revokedToken = (await freshLogin()).accessToken;
    await apiRequest("POST", "/auth/logout", revokedToken);
    validToken = (await freshLogin()).accessToken;

    // Confirm the API itself rejects the revoked token and accepts the other one, so the tests
    // below cannot pass for the wrong reason.
    const rejected = await fetch(`${DEFAULT_API_URL}/taxonomy/categories`, { headers: { Authorization: `Bearer ${revokedToken}` } });
    expect(rejected.status).toBe(401);
    const accepted = await fetch(`${DEFAULT_API_URL}/taxonomy/categories`, { headers: { Authorization: `Bearer ${validToken}` } });
    expect(accepted.status).toBe(200);
  });

  for (const route of ["/dashboard", "/catalog/products", "/admin/users"]) {
    test(`${route} lands on the login page with a session-expired reason, not a blank shell`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "pim_access_token", value: revokedToken, url: baseURL }]);
      await page.goto(route, { waitUntil: "domcontentloaded" });

      await expect(page).toHaveURL(/\/login\?.*reason=session_expired/, { timeout: 20_000 });
      await expect(page.locator("input[type='password']")).toBeVisible();
      // The login page tells the user why they are seeing it.
      await expect(page.getByText(/session.*(expired|ended)|sign in again/i).first()).toBeVisible();
      // Known follow-up (not asserted): RootLayout still draws the signed-in header on /login while
      // the stale cookie looks valid locally (layout.tsx keys the shell off getServerSessionClaims).
    });
  }

  test("a genuinely valid session opening /login is still forwarded to /dashboard (AC2)", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "pim_access_token", value: validToken, url: baseURL }]);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });
});
