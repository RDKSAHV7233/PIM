const { test, expect } = require("@playwright/test");
const { apiLoginPayload, apiRequest, loginViaUi, USERS, uniqueName } = require("./helpers/vexa-pim.cjs");

async function expectAfterAction(page, urlPattern, bannerText) {
  await page.waitForURL(urlPattern, { timeout: 30_000 });
  try {
    await expect(page.getByText(bannerText)).toBeVisible({ timeout: 10_000 });
  } catch {
    await page.reload({ waitUntil: "load" });
    await expect(page.getByText(bannerText)).toBeVisible({ timeout: 10_000 });
  }
}

test("admin connector grant unlocks reconnect for editor in the browser", async ({ page }) => {
  test.setTimeout(90_000);
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

  // Skip if flipkart connector is not configured in this environment
  try {
    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    test.skip(!definitions.find((d) => d.slug === "flipkart"), "flipkart connector not configured in this environment");
  } catch {
    test.skip(true, "Connector definitions endpoint unreachable — skipping connector access effect spec.");
  }

  const installationSection = () =>
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: new RegExp(accountAlias, "i") }) })
      .first();

  try {
    const installation = await apiRequest("POST", "/connectors/flipkart/install", adminToken, {
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
    await page.goto("/admin/connectors", { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.getByLabel("Channel connector").selectOption("flipkart");
    await page.getByLabel("Who gets access").selectOption("user");
    await page.getByLabel("Specific user").fill(targetUserId);
    await page.getByLabel("Allowed action").selectOption("reconnect");
    await page.getByLabel("Which accounts").fill(accountAlias);
    await page.getByRole("button", { name: "Save policy" }).click();
    await expectAfterAction(page, /status=permission-granted/, "Connector permission granted.");
    const permissionRow = page
      .locator("tbody tr")
      .filter({ hasText: "flipkart" })
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
        row.connectorSlug === "flipkart" &&
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

    await installationSection().getByRole("button", { name: "Reconnect" }).click();
    await expectAfterAction(page, /status=reconnected/, "Connector reconnected and marked active.");
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
        await apiRequest("DELETE", `/connectors/flipkart/install/${encodeURIComponent(installationId)}`, adminToken);
      } catch {}
    }
  }
});
