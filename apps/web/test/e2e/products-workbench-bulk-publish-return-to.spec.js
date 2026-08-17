const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  reviewProduct,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

// Regression for the PIM#595 bulk-publish line of work: two separate bugs found by live
// browser testing against production, both causing the same customer-visible symptom —
// submitting bulk publish from the Products workbench while a facet filter (e.g.
// status=approved) is active silently drops that filter after landing on the redirected page.
//
// BUG 1 (fixed by PIM#596 follow-up #1, "returnTo stops reading window.location during
// render"): `returnTo` in products-tab.tsx used to read `window.location.search` directly
// during React's render phase instead of the reactive `searchParams` value useSearchParams()
// already handed it. After a router.push() that changes only the search params, Next.js
// updates its reactive searchParams context — triggering the re-render — *before* it finishes
// mutating window.location to match, so reading window.location.search during render captured
// a one-render-stale snapshot that then stuck permanently (nothing forced a second re-render).
//
// BUG 2 (fixed here): even with BUG 1 fixed, live re-verification found the *actual* submit ->
// confirm -> land flow still broken, confirmed with network-level evidence: the server action's
// own redirect correctly targeted `?status=approved&bulkPublishStatus=...`, but a *second*,
// competing client-side navigation to the same target *minus* `status=approved` raced it and
// won. Root cause, confirmed by an isolated live reproduction with instrumented logging: a
// Server Action's redirect() causes ProductsTab to remount as a fresh component instance (not
// just re-render) on the landed URL. The "Sprint 1: push facet params to URL" effect always
// runs at least once per mount; on that fresh mount, local `facets` state had reset to `{}`
// (nothing ever rehydrated it from the incoming URL — unlike selectedFilter/searchQuery, which
// both resync from initialView/initialSearch), so the effect saw facets.status as undefined
// while the URL already had status=approved and "corrected" the URL by deleting it — a second,
// genuine router.push() that won the race. Fixed by seeding and resyncing `facets` from
// server-derived initial* props, the same pattern already used for selectedFilter/searchQuery.
//
// Both bugs are live React-reactivity/timing bugs that static apps/web/test/integration/*.test.cjs
// source-text assertions cannot catch — the source already correctly referenced searchParams
// and facets; only the *runtime* behavior was wrong. That gap is exactly how BUG 1 shipped
// undetected through #596 and #597, and how BUG 2 shipped undetected through #598's own
// Playwright spec (which only checked the hidden returnTo DOM value across facet changes and
// never actually submitted the form). Hence the second test below does the complete, real
// customer journey: apply facet -> select a product -> submit -> confirm -> wait for the
// navigation to fully settle -> assert the final landed URL still has the facet filter.

test.describe("Products workbench bulk-publish returnTo preserves active filters", () => {
  test("applying and changing a facet filter keeps the bulk-publish form's returnTo in sync — not stuck on the pre-navigation URL", async ({ page }) => {
    const adminToken = await apiLogin("admin");

    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    test.skip(
      !definitions.find((d) => d.slug === "flipkart"),
      "flipkart connector not configured in this environment",
    );

    let installation = null;
    try {
      installation = await apiRequest(
        "POST",
        "/connectors/flipkart/install",
        adminToken,
        { accountAlias: uniqueName("e2e-returnto-flipkart").toLowerCase() },
      );

      await loginViaUi(page, "admin");

      // Clean load, no query string — matches the live reproduction's starting point exactly.
      await page.goto("/catalog/products", { waitUntil: "domcontentloaded" });

      const returnToInput = page.locator('input[name="returnTo"]');
      await expect(returnToInput).toBeAttached();
      await expect(returnToInput).toHaveAttribute("value", "/catalog/products");

      // Open the faceted filter panel via a real UI interaction, same as the live repro
      // (which explicitly used a tool that drives React controlled selects properly, not a
      // raw DOM event dispatch — Playwright's selectOption does the same).
      await page.getByRole("button", { name: /Faceted/ }).click();
      const statusSelect = page.locator("#facet-status");
      await expect(statusSelect).toBeVisible();
      await statusSelect.selectOption("approved");

      // The facet change triggers a router.push() to /catalog/products?status=approved.
      // Wait for the URL to fully settle before asserting anything, matching the live repro's
      // "waited 2+ seconds" step — this test must fail if the staleness is merely delayed, not
      // just if it never resolves at all.
      await page.waitForURL(/\/catalog\/products\?status=approved/);
      await page.waitForTimeout(2_000);

      // The address bar being correct is necessary but not sufficient — that part already
      // worked before BUG 1's fix. The regression was specifically that the hidden returnTo
      // field lagged behind it.
      await expect(page).toHaveURL(/status=approved/);
      await expect(returnToInput).toHaveAttribute("value", "/catalog/products?status=approved");

      // Change the facet again to prove this isn't a one-off correct value from a lucky
      // timing, but genuine ongoing reactivity to further navigations.
      await statusSelect.selectOption("draft");
      await page.waitForURL(/\/catalog\/products\?status=draft/);
      await page.waitForTimeout(1_000);
      await expect(returnToInput).toHaveAttribute("value", "/catalog/products?status=draft");

      // Clear the facet back to nothing and confirm returnTo drops the query string again.
      await statusSelect.selectOption("");
      await page.waitForURL(/^(?!.*status=).*\/catalog\/products\/?$/);
      await page.waitForTimeout(1_000);
      await expect(returnToInput).toHaveAttribute("value", "/catalog/products");
    } finally {
      if (installation?.id) {
        try {
          await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {});
        } catch {}
        try {
          await apiRequest("DELETE", `/connectors/flipkart/install/${installation.id}`, adminToken);
        } catch {}
      }
    }
  });

  // BUG 2's real regression test: the complete submit -> confirm -> land customer journey,
  // not just an intermediate DOM value. This is what #598's own spec was missing.
  //
  // Fixture note (post-review correction): this originally used a Flipkart installation plus
  // a connector-mapping-template create/validate/publish sequence modeled on
  // channels-mapping-publish.spec.js. That failed in CI — not on the assertion under test, but
  // earlier, at the precondition: the checkbox never became enabled, because
  // channels-mapping-publish.spec.js never actually installs a connector with valid
  // credentials at all (it only exercises the mapping-*template* lifecycle in isolation) and
  // Flipkart's real credential validation requires a real external Flipkart OAuth exchange —
  // there is no local Flipkart stub in this repo, so a bare `POST /connectors/flipkart/install`
  // with no credentials leaves the installation uncredentialed
  // ("Missing Flipkart credential 'client_id'"), which is exactly the failure CI hit.
  //
  // Fixed by switching to Shopify, mirroring shopify-product-publish-journey.spec.js — the
  // one connector this repo already gets to a genuinely credentialed, publish-ready state in
  // CI without a real external account: `POST /connectors/:id/oauth/callback` with a direct
  // access token satisfies `hasCompletedShopifyAuth`, and Shopify's readiness path (unlike
  // Flipkart/Amazon's) does not go through the configurable connector-mapping-template system
  // at all, so no mapping-version setup is needed here either.
  //
  // The final assertion intentionally matches *any* `bulkPublishStatus=` outcome rather than
  // specifically `bulk-publish-queued`: the actual downstream Shopify publish call needs the
  // dedicated stub HTTP server + env vars the "E2E - Shopify connector journey" CI job sets up
  // (PIM_SHOPIFY_ADMIN_API_BASE_URL, PLAYWRIGHT_ENABLE_SHOPIFY_STUB, ...), which this job does
  // not configure — so the publish call itself may legitimately fail against a placeholder shop
  // domain. That's fine and expected: every outcome branch in triggerBulkPublishAction
  // (queued, none-eligible, too-large, timeout, error) redirects through the exact same
  // appendQueryParams(returnTo, { bulkPublishStatus: ... }) call this regression is about, so
  // asserting on the outcome family rather than one specific value keeps this test's scope
  // precisely on "does the facet survive the redirect," decoupled from "does the network call
  // to Shopify succeed," which is an unrelated concern already covered by
  // shopify-product-publish-journey.spec.js under its own dedicated CI job.
  test("submitting bulk publish while a facet filter is active preserves that filter on the landed page (full submit -> confirm -> redirect journey)", async ({ page }) => {
    const adminToken = await apiLogin("admin");

    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    test.skip(
      !definitions.find((d) => d.slug === "shopify"),
      "shopify connector not configured in this environment",
    );

    const shopDomain = String(process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com").trim();
    const category = await createCategory(adminToken, uniqueName("e2e-returnto-cat"));
    let product = await createProduct(adminToken, {
      title: uniqueName("e2e-returnto-product"),
      brand: "Vexa PIM",
      description: "PIM#598 follow-up full-journey regression fixture",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        mainImageUrl: "https://example.com/test-product-image.jpg",
      },
    });
    await apiRequest("POST", `/catalog/products/${product.id}/variants`, adminToken, {
      skuCode: uniqueName("sku-returnto").toLowerCase(),
      attributes: {},
      inventoryQty: 10,
      status: "active",
    });
    const freshProduct = await apiRequest("GET", `/catalog/products/${product.id}`, adminToken);
    await apiRequest("PATCH", `/catalog/products/${product.id}`, adminToken, {
      expectedVersion: freshProduct.version ?? 1,
      status: "in_review",
    });
    await reviewProduct(adminToken, product.id, "approved", "e2e auto-approval for PIM#598 full-journey regression");

    let installation = null;
    try {
      // Make the product genuinely publish-ready for Shopify — via API only, no UI round trip
      // — so the bulk-publish checkbox is really clickable, not just present in the DOM. See
      // the fixture note above for why Shopify + oauth/callback, not Flipkart + mappings.
      installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
        accountAlias: uniqueName("e2e-returnto-shopify").toLowerCase(),
        shopDomain,
      });
      await apiRequest("POST", `/connectors/${installation.id}/oauth/callback`, adminToken, {
        shop: shopDomain,
        accessToken: "e2e-direct-access-token",
      });
      await apiRequest("POST", `/connectors/${installation.id}/publication-targets`, adminToken, {
        publicationIds: ["gid://shopify/Publication/1"],
      });

      await loginViaUi(page, "admin");
      await page.goto(
        `/catalog/products?hideTestData=false&search=${encodeURIComponent(product.title)}`,
        { waitUntil: "domcontentloaded" },
      );

      // Apply the facet filter via a real UI interaction — the exact operator action that
      // triggered the live production bug.
      await page.getByRole("button", { name: /Faceted/ }).click();
      const statusSelect = page.locator("#facet-status");
      await expect(statusSelect).toBeVisible();
      await statusSelect.selectOption("approved");
      await page.waitForURL(/status=approved/);
      await page.waitForTimeout(1_000);

      // Select the connector/channel and the fixture product's checkbox. The checkbox only
      // becomes enabled once the readiness batch call resolves it as genuinely ready for the
      // selected channel — this is the real eligibility gate, not bypassed.
      const row = page.locator("tbody tr", { hasText: product.title }).first();
      await expect(row).toBeVisible();
      const checkbox = row.getByRole("checkbox", { name: `Select ${product.title} for bulk publish` });
      await expect(checkbox).toBeEnabled({ timeout: 20_000 });
      await checkbox.check();

      // Submit -> confirm, exactly as an operator would.
      await page.getByRole("button", { name: "Submit bulk publish" }).click();
      await expect(page.getByRole("heading", { name: "Submit bulk publish feed?" })).toBeVisible();
      await page.getByRole("button", { name: "Submit publish" }).click();

      // Wait for the full submit -> Server Action -> redirect round trip to settle, not just
      // for the URL to first contain the outcome param — the whole point of this regression is
      // that a *second* navigation can win *after* the first one lands. Match any bulk-publish
      // outcome (queued/none-eligible/too-large/timeout/error) — see the fixture note above for
      // why this deliberately doesn't pin the specific outcome.
      await page.waitForURL(/bulkPublishStatus=bulk-publish-/);
      await page.waitForTimeout(2_000);

      await expect(page).toHaveURL(/status=approved/);
      await expect(page).toHaveURL(/bulkPublishStatus=bulk-publish-/);
    } finally {
      if (installation?.id) {
        try {
          await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {});
        } catch {}
        try {
          await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken);
        } catch {}
      }
      try {
        await deleteProduct(adminToken, product.id);
      } catch {}
      try {
        await purgeProduct(adminToken, product.id);
      } catch {}
      try {
        await deleteCategory(adminToken, category.id);
      } catch {}
    }
  });
});
