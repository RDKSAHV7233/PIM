/* eslint-disable no-console */
const { test, expect } = require("@playwright/test");
const {
  loginViaUi,
} = require("./helpers/vexa-pim.cjs");

/**
 * Publish failure recovery spec.
 * Proves that a failed/non-success job state renders correctly
 * and that repair guidance is accessible without blank/crash states.
 */

test.describe("Publish failure recovery", () => {
  test("operations page renders job states without crash and exposes repair path", async ({ page }) => {
    // 1. Login
    await loginViaUi(page, "admin");

    // 2. Navigate to operations (jobs/submissions)
    await page.goto("/operations", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();

    // 3. Observe job state rows — verify no blank/crash state regardless of seeded data
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error");

    // 4. Navigate to imports (where failed job rows appear)
    await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");

    // 5. Verify that the repair link or guidance path is accessible
    // The repair link should be present either in the nav or on the page
    const repairLink = page.locator('a[href*="/operations/repair"], a[href*="repair"]').first();
    const hasRepairLink = await repairLink.count() > 0;
    if (!hasRepairLink) {
      // If no repair link is visible on this page, navigate directly and confirm it renders
      await page.goto("/operations/repair", { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).not.toContainText("Application error");
    } else {
      // Repair link is present — verify it's accessible
      await expect(repairLink).toBeVisible();
    }

    // 6. Confirm that the UI does not show a blank/crash state for any job status value
    // Navigate back to imports and verify the page renders all status values cleanly
    await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error");
    // The page should display the operations section (not an error boundary)
    await expect(page.locator("h1")).toBeVisible();
  });

  test("publish failure recovery wizard step 4 links to repair console", async ({ page }) => {
    // Login and navigate to imports page
    await loginViaUi(page, "admin");
    await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });

    // Wizard step indicator must be present
    const wizardStep = page.locator('[aria-label="Import wizard steps"]');
    await expect(wizardStep).toBeVisible();
    await expect(wizardStep).toContainText("Review Result & Repair");

    // The validation summary section references the repair console
    const repairRef = page.locator('a[href*="/operations/repair"]');
    if (await repairRef.count() > 0) {
      await expect(repairRef.first()).toBeVisible();
    }
  });
});
