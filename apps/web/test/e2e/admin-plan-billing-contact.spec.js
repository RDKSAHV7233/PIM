const { test, expect } = require("@playwright/test");
const { apiLogin, apiRequest, loginViaUi, DEFAULT_API_URL } = require("./helpers/vexa-pim.cjs");

test("admin can set and clear billing contact from the plan page", async ({ page }) => {
  test.setTimeout(90_000);

  const adminToken = await apiLogin("admin");
  const initialUsage = await apiRequest("GET", "/billing/usage", adminToken);
  const originalBillingContact = initialUsage.profile?.billingContactEmail ?? null;
  const nextBillingContact = `billing-${Date.now()}@example.com`;

  try {
    await loginViaUi(page, "admin");
    await page.goto("/admin/plan", { waitUntil: "domcontentloaded" });

    const billingContactInput = page.getByLabel("Billing contact email");
    await expect(billingContactInput).toBeVisible();
    await billingContactInput.fill(nextBillingContact);
    await page.getByRole("button", { name: "Save billing contact" }).click();

    await page.waitForURL(/billingContactStatus=saved/);
    await expect(page.getByRole("heading", { name: "Plan & Usage" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Billing contact updated")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(`Commercial notices will now go to ${nextBillingContact}.`),
    ).toBeVisible();
    await expect(billingContactInput).toHaveValue(nextBillingContact);

    const savedUsage = await apiRequest("GET", "/billing/usage", adminToken, undefined, DEFAULT_API_URL);
    expect(savedUsage.profile?.billingContactEmail).toBe(nextBillingContact);

    await page.getByRole("button", { name: "Use admin fallback" }).click();
    await page.waitForURL(/billingContactStatus=cleared/);
    await expect(page.getByRole("heading", { name: "Plan & Usage" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Billing contact cleared")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Commercial notices will now fall back to active workspace admins."),
    ).toBeVisible();
    await expect(page.getByLabel("Billing contact email")).toHaveValue("");

    const clearedUsage = await apiRequest("GET", "/billing/usage", adminToken, undefined, DEFAULT_API_URL);
    expect(clearedUsage.profile?.billingContactEmail ?? null).toBeNull();
  } finally {
    await apiRequest("POST", "/billing/billing-contact", adminToken, {
      billingContactEmail: originalBillingContact,
    });
  }
});
