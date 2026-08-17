const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  loginViaUi,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

// Regression for PIM#595/#596/#597 follow-up: a second, deeper bug that predated #597 and
// was already present in #596, found by live browser testing against production.
//
// `returnTo` in products-tab.tsx used to be computed as a useMemo that, on the client,
// read `window.location.search` directly instead of the reactive `searchParams` value
// `useSearchParams()` already handed it:
//
//   const returnTo = useMemo(() => {
//     const params = typeof window === "undefined"
//       ? new URLSearchParams(searchParams.toString())
//       : new URLSearchParams(window.location.search);   // <-- the bug
//     ...
//   }, [pathname, searchParams]);
//
// After a router.push() that changes only the search params (e.g. applying a facet filter),
// Next.js updates its reactive searchParams context — triggering this re-render — *before*
// it finishes mutating window.location to match. Reading window.location.search during
// render therefore captured a one-render-stale snapshot of the *previous* URL. Nothing forced
// a second re-render afterward, so the stale value stuck permanently, not just briefly.
//
// Confirmed live on production: apply a facet filter → wait 2+ seconds, fully settled → the
// hidden `returnTo` input on the bulk-publish form still had no query string, even though the
// address bar and the server-rendered product count both correctly reflected the filter.
// Because BulkPublishConfirmForm submits this exact hidden field as-is to
// triggerBulkPublishAction, submitting bulk publish while a facet filter was active silently
// dropped that filter after the redirect — an operator's active working population context
// destroyed by an unrelated action.
//
// This is a live React-reactivity/timing bug that static apps/web/test/integration/*.test.cjs
// source-text assertions cannot catch (the source correctly *references* searchParams; only
// the runtime behavior was wrong) — that gap is exactly how this shipped in both #596 and
// #597 undetected. Hence a real Playwright spec, not another static assertion.
//
// Scope note: BulkPublishConfirmForm always renders once any active, PUBLISH-capable
// connector is installed and the actor can publish — it does not require any product to be
// selected/eligible to render its hidden `returnTo` field. Submitting the form POSTs exactly
// whatever that hidden field's current value is; nothing transforms it further between render
// and submit. So directly inspecting the hidden `returnTo` input across facet-filter changes
// (mirroring the exact DOM inspection used to confirm this bug live) is a faithful, sufficient
// regression test for "bulk publish preserves the operator's active filters" — it does not
// require also standing up a full category/channel mapping fixture to make a product pass
// live publish-readiness, which is unrelated, orthogonal complexity to this bug.

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
      // worked before this fix (the coordinator's live repro confirmed it). The regression is
      // specifically that the hidden returnTo field lagged behind it.
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
});
