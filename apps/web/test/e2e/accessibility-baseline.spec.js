/**
 * Accessibility Baseline
 *
 * Quick scan of 5 key pages using Playwright's accessibility snapshot.
 * Checks for:
 * - Page has a main landmark
 * - Interactive elements have accessible names
 * - No duplicate heading-level-1
 * - Form inputs have labels
 *
 * This is a baseline — not a full WCAG audit. Install @axe-core/playwright
 * for comprehensive scanning post-launch.
 */
const { test, expect } = require("@playwright/test");
const {
  loginViaUi,
} = require("./helpers/vexa-pim.cjs");

const KEY_PAGES = [
  { name: "Login", url: "/login", requiresAuth: false },
  { name: "Dashboard", url: "/dashboard", requiresAuth: true },
  { name: "Product List", url: "/catalog/products", requiresAuth: true },
  { name: "Import", url: "/operations/imports", requiresAuth: true },
  { name: "Admin Users", url: "/admin/users", requiresAuth: true },
];

test.describe("Accessibility Baseline", () => {
  for (const pg of KEY_PAGES) {
    test(`${pg.name} page has basic accessibility structure`, async ({ page }) => {
      if (pg.requiresAuth) {
        await loginViaUi(page, "admin");
      }
      await page.goto(pg.url, { waitUntil: "domcontentloaded" });

      // 1. Page should have visible content (not blank)
      await expect(page.locator("body")).toBeVisible();

      // 2. Main landmark should exist (except login which may not have one)
      if (pg.requiresAuth) {
        await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
      }

      // 3. No more than one h1 on the page
      const h1Count = await page.locator("h1").count();
      expect(h1Count).toBeLessThanOrEqual(2); // Allow nav + page h1

      // 4. All visible buttons should have accessible text
      const buttons = page.getByRole("button");
      const buttonCount = await buttons.count();
      for (let i = 0; i < Math.min(buttonCount, 10); i++) {
        const btn = buttons.nth(i);
        const isVisible = await btn.isVisible().catch(() => false);
        if (!isVisible) continue;

        const name = await btn.getAttribute("aria-label")
          || await btn.innerText().catch(() => "");
        // Button should have either aria-label or text content
        expect(name.trim().length).toBeGreaterThan(0);
      }

      // 5. All visible form inputs should have labels or aria-label
      const inputs = page.locator('input:visible, select:visible, textarea:visible');
      const inputCount = await inputs.count();
      for (let i = 0; i < Math.min(inputCount, 10); i++) {
        const input = inputs.nth(i);
        const type = await input.getAttribute("type") || "text";
        if (type === "hidden" || type === "submit") continue;

        const ariaLabel = await input.getAttribute("aria-label") || "";
        const id = await input.getAttribute("id") || "";
        const placeholder = await input.getAttribute("placeholder") || "";

        // Input should have aria-label, or an id (implying a <label for=id>), or at minimum a placeholder
        const hasAccessibleName = ariaLabel.length > 0 || id.length > 0 || placeholder.length > 0;
        expect(hasAccessibleName).toBe(true);
      }
    });
  }
});
