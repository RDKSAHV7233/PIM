const { test, expect } = require("@playwright/test");
const { apiLoginPayload, apiRequest, loginViaUi, USERS, uniqueName } = require("./helpers/vexa-pim.cjs");

test("admin connector grant unlocks reconnect for editor in the browser", async ({ page }) => {
  const adminAuth = await apiLoginPayload("admin");
  const editorAuth = await apiLoginPayload("editor");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);
  test.skip(editorAuth.role !== "editor", `editor identity resolves as ${editorAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const editorToken = editorAuth.accessToken;
  const accountAlias = uniqueName("e2e-permission-alias").toLowerCase().slice(0, 32);
  const targetUserId = USERS.editor.userId;

  let installationId = null;
  let permissionId = null;

  // Skip if amazon-in connector is not configured in this environment
  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(!definitions.find((d) => d.slug === "amazon-in"), "amazon-in connector not configured in this environment");

  const installationSection = () =>
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: new RegExp(accountAlias, "i") }) })
      .first();

  try {
    const installation = await apiRequest("POST", "/connectors/amazon-in/install", adminToken, {
      accountAlias,
    });
    installationId = String(installation?.id ?? "");
    expect(installationId.length).toBeGreaterThan(5);

    const editorInstalledBefore = await apiRequest("GET", "/connectors/installed?limit=200", editorToken);
    const editorInstallationBefore = Array.isArray(editorInstalledBefore?.items)
      ? editorInstalledBefore.items.find((item) => item.id === installationId)
      : Array.isArray(editorInstalledBefore)
      ? editorInstalledBefore.find((item) => item.id === installationId)
      : null;
    expect(editorInstallationBefore).toBeTruthy();
    expect(editorInstallationBefore.actions?.reconnect?.allowed).toBe(false);

    await loginViaUi(page, "editor");
    await page.goto(`/channels/connectors?q=${encodeURIComponent(accountAlias)}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(installationSection()).toBeVisible();
    await expect(installationSection().getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expect(installationSection()).toContainText("Reconnect blocked: Action requires connector permission");

    await page.context().clearCookies();
    await loginViaUi(page, "admin");
    await page.goto("/admin/connectors", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Connector").selectOption("amazon-in");
    await page.getByLabel("Principal Type").selectOption("user");
    await page.getByLabel("User ID").fill(targetUserId);
    await page.getByLabel("Action").selectOption("reconnect");
    await page.getByLabel("Account Alias (optional)").fill(accountAlias);
    await page.getByRole("button", { name: "Grant" }).click();

    await page.waitForURL(/status=permission-granted/);
    await expect(page.getByText("Connector permission granted.")).toBeVisible();
    const permissionRow = page
      .locator("tbody tr")
      .filter({ hasText: "amazon-in" })
      .filter({ hasText: targetUserId })
      .filter({ hasText: accountAlias })
      .filter({ hasText: "reconnect" })
      .first();
    await expect(permissionRow).toBeVisible();

    const permissions = await apiRequest("GET", "/connectors/permissions", adminToken);
    const grantedPermission = permissions.find(
      (row) =>
        row.principalType === "user" &&
        row.principalId === targetUserId &&
        row.connectorSlug === "amazon-in" &&
        row.accountAlias === accountAlias &&
        row.action === "reconnect",
    );
    expect(grantedPermission).toBeTruthy();
    permissionId = String(grantedPermission.id);

    const editorInstalledAfterGrant = await apiRequest("GET", "/connectors/installed?limit=200", editorToken);
    const editorInstallationAfterGrant = Array.isArray(editorInstalledAfterGrant?.items)
      ? editorInstalledAfterGrant.items.find((item) => item.id === installationId)
      : Array.isArray(editorInstalledAfterGrant)
      ? editorInstalledAfterGrant.find((item) => item.id === installationId)
      : null;
    expect(editorInstallationAfterGrant?.actions?.reconnect?.allowed).toBe(true);

    await page.context().clearCookies();
    await loginViaUi(page, "editor");
    await page.goto(`/channels/connectors?q=${encodeURIComponent(accountAlias)}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(installationSection()).toBeVisible();
    await expect(installationSection().getByRole("button", { name: "Reconnect" })).toBeVisible();

    await Promise.all([
      page.waitForURL(/status=reconnected/),
      installationSection().getByRole("button", { name: "Reconnect" }).click(),
    ]);
    await expect(page.getByText("Connector reconnected and marked active.")).toBeVisible();
  } finally {
    if (permissionId) {
      try {
        await apiRequest("DELETE", `/connectors/permissions/${encodeURIComponent(permissionId)}`, adminToken);
      } catch {}
    }
    if (installationId) {
      try {
        await apiRequest("POST", `/connectors/${encodeURIComponent(installationId)}/uninstall`, adminToken, {});
      } catch {}
      try {
        await apiRequest("DELETE", `/connectors/amazon-in/install/${encodeURIComponent(installationId)}`, adminToken);
      } catch {}
    }
  }
});
