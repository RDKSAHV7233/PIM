const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  loginViaUi,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

const API_URL = String(process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1").trim();
const API_ROOT = API_URL.replace(/\/api\/v1\/?$/i, "");
const SHOP_DOMAIN = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com").trim();
const PUBLICATION_NAME = String(process.env.PLAYWRIGHT_SHOPIFY_PUBLICATION_NAME || "Online Store").trim();
const SHOP_NAME = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_NAME || "Demo Store").trim();
const SHOP_ID = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_ID || "gid://shopify/Shop/9001").trim();
const PUBLICATION_COUNT_LABEL = String(process.env.PLAYWRIGHT_SHOPIFY_PUBLICATION_COUNT_LABEL || "1 publication target").trim();

test.setTimeout(120_000);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function followCallbackRedirect(page, callbackUrl, redirectedUrlPattern) {
  const response = await fetch(callbackUrl, {
    method: "GET",
    redirect: "manual",
  });
  const location = response.headers.get("location");

  if (response.status < 300 || response.status >= 400 || !location) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Unexpected Shopify callback response ${response.status} location=${location ?? "missing"} body=${body}`,
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
    throw new Error(`Unexpected Shopify callback redirect location ${redirectedPath}`);
  }

  await page.goto(redirectedPath, { waitUntil: "domcontentloaded" });
}

test("install with an invalid shop domain is rejected with a domain validation error", async () => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  const shopifyDef = definitions.find((item) => item.slug === "shopify");
  test.skip(!shopifyDef, "shopify connector not configured in this environment");

  // Attempt install with a non-myshopify.com domain
  const response = await fetch(`${API_URL}/connectors/shopify/install`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      accountAlias: uniqueName("e2e-bad-domain").toLowerCase(),
      shopDomain: "not-a-shopify-store.com",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  expect(response.status).toBeGreaterThanOrEqual(400);
  let errorPayload = null;
  try { errorPayload = await response.json(); } catch { errorPayload = await response.text().catch(() => ""); }
  const errorText = String(
    errorPayload?.message ?? errorPayload?.error ?? errorPayload ?? "",
  ).toLowerCase();
  // Must mention domain, shopify, or invalid — not a generic 500 error
  expect(errorText).toMatch(/domain|shopify|myshopify|invalid/i);
});

test("credential state shows connected after successful OAuth callback", async ({ page }) => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(!definitions.find((item) => item.slug === "shopify"), "shopify connector not configured");

  let installation = null;

  try {
    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("e2e-cred-val").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });

    const oauthInit = await apiRequest("POST", `/connectors/${installation.id}/oauth/initiate`, adminToken);
    const callbackUrl =
      `${API_ROOT}/api/v1/connectors/shopify/oauth/callback` +
      `?state=${encodeURIComponent(oauthInit.state)}` +
      `&shop=${encodeURIComponent(SHOP_DOMAIN)}` +
      `&session_token=${encodeURIComponent(`session-${installation.id}`)}`;

    await loginViaUi(page, "admin");
    await followCallbackRedirect(
      page,
      callbackUrl,
      new RegExp(`/channels/connectors/${escapeRegExp(installation.id)}\\?status=oauth_complete$`),
    );

    // Credentials tab must show the connected shop and not show the "OAuth not yet complete" warning
    await page.goto(
      `/channels/connectors/${installation.id}?tab=credentials&status=oauth_complete`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("Shopify OAuth is not yet complete.")).toHaveCount(0);
    await expect(
      page.getByText(new RegExp(`${escapeRegExp(SHOP_NAME)} is connected`, "i")),
    ).toBeVisible();
  } finally {
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  }
});

test("admin can complete Shopify managed install and save publication targets", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const accountAlias = uniqueName("e2e-shopify-store").toLowerCase();

  let installation = null;

  try {
    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    const shopifyDefinition = definitions.find((item) => item.slug === "shopify");
    test.skip(!shopifyDefinition, "shopify connector not configured in this environment");

    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias,
      shopDomain: SHOP_DOMAIN,
    });

    await loginViaUi(page, "admin");
    await page.goto("/channels/connectors", { waitUntil: "domcontentloaded" });

    await page.getByRole("textbox", { name: /Search connection/i }).fill(accountAlias);
    await page.getByRole("button", { name: "Apply filters" }).click();

    const installationHeading = page.getByRole("heading", { name: `Shopify / ${accountAlias}` });
    const installationSection = page.locator("section").filter({ has: installationHeading }).first();
    await expect(installationSection).toBeVisible();
    await expect(installationSection).toContainText("Shopify connection context");
    await expect(installationSection).toContainText(`Store domain: ${SHOP_DOMAIN}`);
    await expect(installationSection).toContainText("targets not set");
    await installationSection.getByRole("link", { name: "Details" }).click();

    const detailPathPattern = new RegExp(`/channels/connectors/${escapeRegExp(installation.id)}(?:\\?|$)`);
    await page.waitForURL(detailPathPattern);
    await expect(page.getByRole("heading", { name: `Shopify / ${accountAlias}` })).toBeVisible();
    await expect(page.getByText("Shopify OAuth is not yet complete.")).toBeVisible();

    await page.goto(`/channels/connectors/${installation.id}?tab=credentials`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Managed Install Handoff" })).toBeVisible();
    await expect(page.getByText("Start managed install handoff")).toBeVisible();
    await expect(page.getByText("Complete managed install and token exchange")).toBeVisible();
    await expect(page.getByText("Confirm shop identity and publish controls")).toBeVisible();
    await expect(page.getByRole("link", { name: "Refresh credential state" })).toBeVisible();

    const oauthInit = await apiRequest("POST", `/connectors/${installation.id}/oauth/initiate`, adminToken);
    const callbackUrl =
      `${API_ROOT}/api/v1/connectors/shopify/oauth/callback` +
      `?state=${encodeURIComponent(oauthInit.state)}` +
      `&shop=${encodeURIComponent(SHOP_DOMAIN)}` +
      `&session_token=${encodeURIComponent(`session-${installation.id}`)}`;

    await followCallbackRedirect(
      page,
      callbackUrl,
      new RegExp(`/channels/connectors/${escapeRegExp(installation.id)}\\?status=oauth_complete$`),
    );
    await expect(page.getByText("Shopify OAuth is not yet complete.")).toHaveCount(0);
    await expect(page.getByText(SHOP_DOMAIN)).toBeVisible();

    await page.goto(`/channels/connectors/${installation.id}?tab=credentials&status=oauth_complete`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Managed Install Handoff" })).toBeVisible();
    await expect(page.getByText(new RegExp(`${escapeRegExp(SHOP_NAME)} is connected`, "i"))).toBeVisible();
    await expect(page.getByText(new RegExp(`${escapeRegExp(SHOP_NAME)}\\s*[·.]\\s*${escapeRegExp(SHOP_ID)}`))).toBeVisible();
    await expect(page.getByText(SHOP_ID)).toBeVisible();

    const publicationCheckbox = page.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(PUBLICATION_NAME)}`, "i") });
    const pointOfSaleCheckbox = page.getByRole("checkbox", { name: /^Point of Sale/i });
    await expect(publicationCheckbox).toBeVisible();
    await expect(pointOfSaleCheckbox).toBeVisible();
    await publicationCheckbox.check();
    if (await pointOfSaleCheckbox.isChecked()) {
      await pointOfSaleCheckbox.uncheck();
    }
    await Promise.all([
      page.waitForURL(/status=publication-targets-saved/),
      page.getByRole("button", { name: "Save publication targets" }).click(),
    ]);
    await page.goto(`/channels/connectors/${installation.id}?tab=credentials&status=publication-targets-saved`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Publication Targets" })).toBeVisible();
    await expect(publicationCheckbox).toBeChecked();
    await expect(pointOfSaleCheckbox).not.toBeChecked();

    await page.goto("/channels/connectors", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: /Search connection/i }).fill(accountAlias);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(installationSection).toBeVisible();
    await expect(installationSection).toContainText(SHOP_NAME);
    await expect(installationSection).toContainText(`Store domain: ${SHOP_DOMAIN}`);
    await expect(installationSection).toContainText(SHOP_ID);
    await expect(installationSection).toContainText(PUBLICATION_COUNT_LABEL);
    await expect(installationSection).toContainText(PUBLICATION_NAME);
  } finally {
    if (installation?.id) {
      try {
        await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {});
      } catch {}
      try {
        await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken);
      } catch {}
    }
  }
});
