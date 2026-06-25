const { test, expect } = require("@playwright/test");
const { apiLogin, apiRequest, loginViaUi, uniqueName } = require("./helpers/vexa-pim.cjs");

const API_URL = String(process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1").trim();
const API_ROOT = API_URL.replace(/\/api\/v1\/?$/i, "");
const SHOP_DOMAIN = String(
  process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com",
).trim();
const PUBLICATION_NAME = String(
  process.env.PLAYWRIGHT_SHOPIFY_PUBLICATION_NAME || "Online Store",
).trim();
const SHOP_NAME = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_NAME || "Demo Store").trim();

test.setTimeout(120_000);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function followCallbackRedirect(page, callbackUrl, redirectedUrlPattern) {
  const response = await fetch(callbackUrl, { method: "GET", redirect: "manual" });
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(
      `Unexpected Shopify callback response ${response.status} location=${location ?? "missing"}`,
    );
  }
  const redirectedPath = (() => {
    try {
      const url = new URL(location);
      return `${url.pathname}${url.search}`;
    } catch {
      return location;
    }
  })();
  if (!redirectedUrlPattern.test(redirectedPath)) {
    throw new Error(`Unexpected callback redirect location: ${redirectedPath}`);
  }
  await page.goto(location, { waitUntil: "domcontentloaded" });
}

async function installAndCompleteOAuth(adminToken, page, accountAlias) {
  const installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
    accountAlias,
    shopDomain: SHOP_DOMAIN,
  });

  const callbackUrl =
    `${API_ROOT}/api/v1/connectors/shopify/oauth/callback` +
    `?state=${encodeURIComponent(installation.id)}` +
    `&shop=${encodeURIComponent(SHOP_DOMAIN)}` +
    `&session_token=${encodeURIComponent(`session-${installation.id}`)}`;

  await followCallbackRedirect(
    page,
    callbackUrl,
    new RegExp(`/channels/connectors/${escapeRegExp(installation.id)}\\?status=oauth_complete$`),
  );
  return installation;
}

test("publication targets persist after save and page reload", async ({ page }) => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((d) => d.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  let installation = null;

  try {
    await loginViaUi(page, "admin");
    installation = await installAndCompleteOAuth(
      adminToken,
      page,
      uniqueName("e2e-pubtgt").toLowerCase(),
    );

    await page.goto(
      `/channels/connectors/${installation.id}?tab=credentials&status=oauth_complete`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: "Publication Targets" })).toBeVisible();

    const onlineStoreCheckbox = page.getByRole("checkbox", {
      name: new RegExp(`^${escapeRegExp(PUBLICATION_NAME)}`, "i"),
    });
    const posCheckbox = page.getByRole("checkbox", { name: /^Point of Sale/i });
    await expect(onlineStoreCheckbox).toBeVisible();

    await onlineStoreCheckbox.check();
    if (await posCheckbox.isVisible() && await posCheckbox.isChecked()) {
      await posCheckbox.uncheck();
    }
    await Promise.all([
      page.waitForURL(/status=publication-targets-saved/),
      page.getByRole("button", { name: "Save publication targets" }).click(),
    ]);

    // Reload — targets must still be checked
    await page.goto(
      `/channels/connectors/${installation.id}?tab=credentials`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: "Publication Targets" })).toBeVisible();
    await expect(onlineStoreCheckbox).toBeChecked();
    if (await posCheckbox.isVisible()) {
      await expect(posCheckbox).not.toBeChecked();
    }

    // API must reflect the saved targets
    const details = await apiRequest("GET", `/connectors/${installation.id}`, adminToken);
    const targetIds = details?.metadata?.publicationTargetIds ?? [];
    expect(Array.isArray(targetIds)).toBe(true);
    expect(targetIds.length).toBeGreaterThanOrEqual(1);
  } finally {
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  }
});

test("connector listing shows publication target count label after targets are saved", async ({
  page,
}) => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((d) => d.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  let installation = null;
  const accountAlias = uniqueName("e2e-pubtgt2").toLowerCase();

  try {
    await loginViaUi(page, "admin");
    installation = await installAndCompleteOAuth(adminToken, page, accountAlias);

    await page.goto(
      `/channels/connectors/${installation.id}?tab=credentials&status=oauth_complete`,
      { waitUntil: "domcontentloaded" },
    );

    const onlineStoreCheckbox = page.getByRole("checkbox", {
      name: new RegExp(`^${escapeRegExp(PUBLICATION_NAME)}`, "i"),
    });
    await expect(onlineStoreCheckbox).toBeVisible();
    await onlineStoreCheckbox.check();
    await Promise.all([
      page.waitForURL(/status=publication-targets-saved/),
      page.getByRole("button", { name: "Save publication targets" }).click(),
    ]);

    // Connector listing must reflect the publication count
    await page.goto("/channels/connectors", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: /Search connection/i }).fill(accountAlias);
    await page.getByRole("button", { name: "Apply filters" }).click();

    const installationHeading = page.getByRole("heading", {
      name: `Shopify / ${accountAlias}`,
    });
    const installationSection = page
      .locator("section")
      .filter({ has: installationHeading })
      .first();
    await expect(installationSection).toBeVisible();
    await expect(installationSection).toContainText(SHOP_NAME);
    await expect(installationSection).toContainText(/publication target/i);
  } finally {
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  }
});
