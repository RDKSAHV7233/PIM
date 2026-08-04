const { test, expect } = require("@playwright/test");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

test("keyboard users can open and close shell navigation and global search", async ({ page, browserName }) => {
  // Role badge is hidden below the `sm` breakpoint (hidden sm:block), so log
  // in at default desktop size before switching to the mobile viewport that
  // this test's nav-drawer assertions require.
  await loginViaUi(page, "admin");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menuButton).toBeVisible();
  await menuButton.focus();
  await page.keyboard.press("Enter");

  const mobileDialog = page.getByRole("dialog", { name: "Navigation" });
  const closeNavButton = mobileDialog.getByRole("button", { name: "Close drawer" });
  await expect(mobileDialog).toBeVisible();
  await expect(closeNavButton).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(mobileDialog).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.keyboard.press(browserName === "webkit" ? "Meta+K" : "Control+K");
  const searchDialog = page.getByRole("dialog", { name: "Search" });
  await expect(searchDialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();
});
