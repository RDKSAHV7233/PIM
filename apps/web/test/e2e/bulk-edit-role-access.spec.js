/**
 * Bulk Edit Non-Writer Access — Regression Suite
 *
 * Ship gate test for the bug where a non-writer role opening
 * /operations/bulk-edit on a Growth+/Enterprise workspace was silently
 * bounced to /dashboard instead of seeing the intended read-only view.
 *
 * Root cause: the page fetched an admin/editor-only endpoint
 * (GET /bulk-edit/operations) unconditionally for every role. The 403 that
 * produced was caught by a handler written for expired sessions, which
 * redirected through /login?reason=forbidden — and since the session was
 * still valid, the login page immediately redirected on to /dashboard,
 * swallowing the reason entirely.
 *
 * This suite tests the invariant directly, not just the symptom:
 *
 *   401 / session expired      -> login redirect with a safe next path
 *   403 / authenticated but
 *     unauthorized             -> stay authenticated, render forbidden/
 *                                 read-only state, never route through login
 *   role-disallowed privileged
 *     fetch                    -> don't make the fetch in the first place
 *
 * The STARTER-tier case is included deliberately: that plan gate is what
 * hid this bug from every existing test, since local and CI workspaces
 * default to STARTER. Any test of this page that doesn't force a Growth+
 * tier is not exercising the code path where the bug lives.
 */
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { loginViaUi, setTenantPlanTier, DEFAULT_WORKSPACE } = require("./helpers/vexa-pim.cjs");

const NON_WRITER_ROLES = ["viewer", "publisher", "approver", "channel_manager", "reviewer", "connector_admin"];
const WRITER_ROLES = ["admin", "editor"];
const BULK_EDIT_PATH = "/operations/bulk-edit";

test.describe.serial("Bulk Edit Non-Writer Access", () => {
  test("regression guard: privileged operations fetch is gated behind canWrite in source", () => {
    // Fast, cause-level check: fails immediately if the fetch that produced
    // the 403 is ever made unconditional again, independent of runtime
    // plan-tier state or role seeding.
    const pagePath = path.join(__dirname, "../../src/app/operations/bulk-edit/page.tsx");
    const source = fs.readFileSync(pagePath, "utf-8");
    expect(source).toMatch(/canWrite\s*\?\s*getBulkEditOperations\(/);
  });

  test.describe("at ENTERPRISE tier", () => {
    test.beforeAll(async () => {
      await setTenantPlanTier("ENTERPRISE", { tenantKey: DEFAULT_WORKSPACE });
    });

    test.afterAll(async () => {
      // Always restore STARTER, even if an assertion above threw, so this
      // suite never leaves the shared "default" workspace on a different
      // tier for whatever runs next.
      await setTenantPlanTier("STARTER", { tenantKey: DEFAULT_WORKSPACE });
    });

    for (const role of WRITER_ROLES) {
      test(`${role}: sees the write UI and operation history`, async ({ page }) => {
        await loginViaUi(page, role);
        await page.goto(BULK_EDIT_PATH, { waitUntil: "domcontentloaded" });

        // Must never leave the page — this is the exact symptom of the bug.
        expect(new URL(page.url()).pathname).toBe(BULK_EDIT_PATH);

        await expect(page.getByRole("heading", { name: "Bulk Edit Products" })).toBeVisible();
        await expect(page.getByLabel("Category")).toBeVisible();
        await expect(page.getByText("Your role cannot run or apply bulk edits.")).toHaveCount(0);

        await expect(page.getByRole("heading", { name: "Bulk Edit History" })).toBeVisible();
        await expect(page.getByText("Bulk edit history is limited to editor and admin roles.")).toHaveCount(0);
      });
    }

    for (const role of NON_WRITER_ROLES) {
      test(`${role}: page loads read-only — never redirects through login or dashboard`, async ({ page }) => {
        await loginViaUi(page, role);
        await page.goto(BULK_EDIT_PATH, { waitUntil: "domcontentloaded" });

        const finalUrl = new URL(page.url());
        expect(finalUrl.pathname, "non-writer role must never bounce to /dashboard").not.toBe("/dashboard");
        expect(finalUrl.pathname, "non-writer role must never route through /login").not.toBe("/login");
        expect(finalUrl.pathname).toBe(BULK_EDIT_PATH);

        await expect(page.getByText("Your role cannot run or apply bulk edits.")).toBeVisible();
        await expect(page.getByText("Bulk edit history is limited to editor and admin roles.")).toBeVisible();

        // The write form and any operation rows must not render for this role.
        await expect(page.getByLabel("Category")).toHaveCount(0);
      });
    }
  });

  test("STARTER tier: existing plan-upgrade gate is unaffected by the fix", async ({ page }) => {
    await setTenantPlanTier("STARTER", { tenantKey: DEFAULT_WORKSPACE });
    await loginViaUi(page, "viewer");
    await page.goto(BULK_EDIT_PATH, { waitUntil: "domcontentloaded" });

    expect(new URL(page.url()).pathname).toBe(BULK_EDIT_PATH);
    await expect(page.getByRole("heading", { name: "Plan Upgrade Required" })).toBeVisible();
  });

  test("real expired session: unauthenticated access still redirects to login, not dashboard", async ({ page }) => {
    await loginViaUi(page, "viewer");
    await page.context().clearCookies();
    await page.goto(BULK_EDIT_PATH, { waitUntil: "domcontentloaded" });

    // With no tokens at all, middleware.ts's fail-fast auth gate redirects
    // before the page ever runs — a different, earlier path than the page's
    // own buildLoginRedirect(reason=...), which only fires when a still-valid
    // session's API call comes back 401/403. Only `next` is set here.
    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe("/login");
    expect(finalUrl.searchParams.get("next")).toBe(BULK_EDIT_PATH);
  });
});
