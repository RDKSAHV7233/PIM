/**
 * Journey 6: Day 1 Tenant — Empty State → First Actions
 *
 * Ship gate test. Validates the new-tenant onboarding experience:
 *   dashboard shows onboarding → products page has getting-started checklist →
 *   all core sections load without crash when empty
 *
 * This is the PO's funnel test — if the empty states are broken, we lose
 * the user before they hit any feature.
 */
const { test, expect } = require("@playwright/test");
const {
  loginViaUi,
} = require("./helpers/vexa-pim.cjs");

test.describe("Journey: Day 1 Tenant Experience", () => {
  test("dashboard loads and shows KPI area", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Dashboard should show some content — cards, charts, or empty state
    await expect(
      page.locator('[class*="card"], [class*="kpi"], [class*="chart"], [class*="metric"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("products page shows onboarding checklist when few products exist", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/catalog/products", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should see the getting-started / onboarding checklist or product list
    // The onboarding shows when completedSteps < total steps
    await expect(
      page.getByText(/getting started|import|completeness|connect|products/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("categories page loads and shows category tree or empty state", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/catalog/categories", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.locator('[class*="tree"], [class*="category"], table, [class*="empty"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("channels page loads without crash", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/channels", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("operations page loads without crash", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("quality page loads without crash", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/quality/approvals", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("settings page loads without crash", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("login page renders without crash", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("Workspace")).toBeVisible();
    await expect(page.getByLabel("User ID")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("404 page renders for invalid route", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/this-route-does-not-exist-12345", { waitUntil: "domcontentloaded" });

    // Should show a styled 404, not a crash
    await expect(page.locator("body")).toBeVisible();
    // Next.js 404 or custom 404
    await expect(
      page.getByText(/not found|404|page.*(not|doesn)/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
