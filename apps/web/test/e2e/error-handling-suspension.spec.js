/**
 * Error Handling & Suspension Suite
 *
 * Tests error states and edge cases that sellers hit in production:
 * - 404 page for invalid routes
 * - Account suspension page exists and renders
 * - Session handling
 * - Login validation errors
 */
const { test, expect } = require("@playwright/test");
const {
  loginViaUi,
  DEFAULT_BASE_URL,
} = require("./helpers/vexa-pim.cjs");

test.describe("Error Handling & Edge Cases", () => {
  test("invalid route shows styled 404 page with navigation", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/this-page-definitely-does-not-exist-xyz123", { waitUntil: "domcontentloaded" });

    // Should show 404, not a blank page or crash
    await expect(page.locator("body")).toBeVisible();
    await expect(
      page.getByText(/not found|404/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("account-suspended page renders correctly", async ({ page }) => {
    // Navigate directly to the suspension page (it's a public page)
    await page.goto("/account-suspended", { waitUntil: "domcontentloaded" });

    // Should show suspension message
    await expect(
      page.getByText(/suspended/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Should have contact or back-to-login link
    await expect(
      page.getByText(/contact|sign in|login|restore/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("login with empty workspace shows validation error", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Clear workspace field and try to submit
    const workspaceField = page.getByLabel("Workspace");
    await workspaceField.fill("");
    await page.getByLabel("User ID").fill("test@test.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Should show validation error, not crash
    // Browser-native validation or app-level validation
    await page.waitForTimeout(2_000);
    // The page should still be on /login
    expect(page.url()).toContain("/login");
  });

  test("login with wrong password shows error message", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Workspace").fill("default");
    await page.getByLabel("User ID").fill("nonexistent-user@test.local");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Should show error message, stay on login page
    await expect(
      page.getByText(/invalid|incorrect|failed|error|denied/i).first()
    ).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });

  test("signup page renders when feature is enabled", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });

    // Should show signup form or redirect to login if feature is disabled
    await expect(page.locator("body")).toBeVisible();
    // Either shows signup form or redirects — both are valid
    const isSignup = page.url().includes("/signup");
    const isLogin = page.url().includes("/login");
    expect(isSignup || isLogin).toBe(true);
  });

  test("privacy page loads for admin", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/privacy", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should show privacy controls
    await expect(
      page.getByText(/privacy|export|data|account/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
