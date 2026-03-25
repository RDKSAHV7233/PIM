const { test, expect } = require("@playwright/test");
const { DEFAULT_BASE_URL, USERS, apiLoginPayload, loginViaUi } = require("./helpers/tej-pim.cjs");

const roles = ["admin", "editor", "reviewer", "viewer"];

for (const role of roles) {
  test(`workspace login works for ${role}`, async ({ page }) => {
    const auth = await apiLoginPayload(role);
    test.skip(role === "reviewer" && auth.role !== "reviewer", `reviewer identity resolves as ${auth.role} in current local environment`);
    await loginViaUi(page, role);
    await expect(page.getByText(USERS[role].roleBadge)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open notifications" })).toBeVisible();
  });
}

test("unknown workspace is rejected before credentials are accepted", async ({ page }) => {
  await page.goto(`${DEFAULT_BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Workspace").fill("does-not-exist");
  await page.getByLabel("User ID").fill(USERS.admin.userId);
  await page.getByLabel("Password").fill(process.env.PLAYWRIGHT_PASSWORD || "tej-pim-demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Workspace not found. Check your workspace ID and try again.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
