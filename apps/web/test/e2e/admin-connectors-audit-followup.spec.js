const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { apiLoginPayload, apiRequest, loginViaUi, USERS, uniqueName } = require("./helpers/tej-pim.cjs");

test("admin can follow connector permission changes into audit history", async ({ page }) => {
  const adminAuth = await apiLoginPayload("admin");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const targetUserId = USERS.viewer.userId;
  const accountAlias = uniqueName("e2e-audit-alias").slice(0, 32);
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-connector-audit-"));
  let permissionId = null;

  try {
    const definitions = await apiRequest("GET", "/connectors/definitions", adminToken);
    const selectedConnector =
      definitions.find((row) => row.slug === "flipkart") ||
      definitions.find((row) => row.slug === "amazon-in") ||
      definitions[0];
    expect(selectedConnector?.slug).toBeTruthy();

    const permissionRow = () =>
      page
        .locator("tbody tr")
        .filter({ hasText: targetUserId })
        .filter({ hasText: selectedConnector.slug })
        .filter({ hasText: accountAlias })
        .filter({ hasText: "install" })
        .first();

    await loginViaUi(page, "admin");
    await page.goto("/admin/connectors", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Connector").selectOption(selectedConnector.slug);
    await page.getByLabel("Principal Type").selectOption("user");
    await page.getByLabel("User ID").fill(targetUserId);
    await page.getByLabel("Action").selectOption("install");
    await page.getByLabel("Account Alias (optional)").fill(accountAlias);
    await page.getByRole("button", { name: "Grant" }).click();

    await page.waitForURL(/status=permission-granted/);
    await expect(page.getByText("Connector permission granted.")).toBeVisible();
    await expect(permissionRow()).toBeVisible();
    await expect(permissionRow()).toContainText("user");
    await expect(permissionRow()).toContainText(accountAlias);

    const permissionsAfterGrant = await apiRequest("GET", "/connectors/permissions", adminToken);
    const grantedPermission = permissionsAfterGrant.find(
      (row) =>
        row.principalType === "user" &&
        row.principalId === targetUserId &&
        row.connectorSlug === selectedConnector.slug &&
        row.action === "install" &&
        row.accountAlias === accountAlias,
    );
    expect(grantedPermission).toBeTruthy();
    permissionId = String(grantedPermission.id);

    await permissionRow().getByRole("button", { name: "Revoke" }).click();
    await page.waitForURL(/status=permission-revoked/);
    await expect(page.getByText("Connector permission revoked.")).toBeVisible();
    await expect(permissionRow()).toHaveCount(0);

    const permissionsAfterRevoke = await apiRequest("GET", "/connectors/permissions", adminToken);
    expect(permissionsAfterRevoke.some((row) => row.id === permissionId)).toBe(false);

    await page.goto(`/admin/audit?entityType=connector&resourceId=${encodeURIComponent(permissionId)}&limit=25`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
    await expect(page.locator('input[name="resourceId"]')).toHaveValue(permissionId);
    await expect(page.locator('select[name="entityType"]')).toHaveValue("connector");
    await expect(page.getByRole("cell", { name: "CONNECTOR_PERMISSION_GRANT" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "CONNECTOR_PERMISSION_REVOKE" })).toBeVisible();
    await expect(page.getByText(permissionId, { exact: false }).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("tej-pim-audit-events-");

    const downloadPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(downloadPath);

    const csv = fs.readFileSync(downloadPath, "utf8");
    expect(csv).toContain(permissionId);
    expect(csv).toContain("CONNECTOR_PERMISSION_GRANT");
    expect(csv).toContain("CONNECTOR_PERMISSION_REVOKE");
    expect(csv).toContain(targetUserId);
    expect(csv).toContain(selectedConnector.slug);
  } finally {
    if (fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    }
    if (permissionId) {
      try {
        await apiRequest("DELETE", `/connectors/permissions/${encodeURIComponent(permissionId)}`, adminToken);
      } catch {}
    }
  }
});
