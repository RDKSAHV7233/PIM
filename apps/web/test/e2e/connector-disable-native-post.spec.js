// @ts-check
const { test, expect } = require("@playwright/test");
const { apiLogin, apiRequest, loginViaUi, uniqueName } = require("./helpers/vexa-pim.cjs");
const { apiURL } = require("../../../../playwright.config.cjs").metadata;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Production acceptance for the Disable-only native-form POST/303
 * containment path (see the PR416 hydration-race investigation and
 * HANDOFF_PRODUCTION_BUILD_20260730.md). Deliberately has NO fallback
 * branch — unlike the diagnostic-era connector-permanent-delete-lifecycle
 * spec's clickAndAwaitActionRedirect helper (which had a strict/non-strict
 * split gated by STRICT_NATIVE_REDIRECT), this flow has nothing to fall
 * back to: it's a plain HTML form, so any failure here is a real failure,
 * not a hydration-race flake being masked. Run with --repeat-each=N to
 * accumulate consecutive-run evidence; rebuild the production bundle
 * between batches per the acceptance plan, not within this file.
 */

let adminToken;

test.beforeAll(async () => {
  adminToken = await apiLogin("admin", apiURL);
});

test.describe("connector disable native POST/303 containment", () => {
  let installation;

  test.beforeEach(async () => {
    // Fixture prep via direct API call — reported separately from the
    // browser journey below, per the acceptance plan. Fresh installation
    // per run so each journey is a real ACTIVE -> DISABLED transition,
    // not a repeat of an already-disabled no-op.
    const accountAlias = uniqueName("native-post-disable");
    installation = await apiRequest("POST", "/connectors/flipkart/install", adminToken, { accountAlias }, apiURL);
  });

  test.afterEach(async () => {
    if (!installation) return;
    await apiRequest("DELETE", `/connectors/flipkart/install/${installation.id}`, adminToken).catch(() => {});
  });

  test("real UI Disable journey: document POST -> 303 -> raw HTML GET, no fallback", async ({ page }) => {
    // #12/#13 baseline — count existing SUCCESS audit events for this fresh
    // installation (should be 0; asserted defensively, not assumed).
    const auditBefore = await apiRequest(
      "GET",
      `/audit/events?resourceId=${encodeURIComponent(installation.id)}&action=CONNECTOR_UNINSTALL_SUCCESS`,
      adminToken,
      undefined,
      apiURL,
    );
    expect(auditBefore.items.length, "fresh installation must start with zero uninstall-success audit events").toBe(0);

    await loginViaUi(page, "admin");
    await page.goto("/channels/connectors", { waitUntil: "domcontentloaded" });

    // #1 — control visible and enabled. The page renders several similar
    // installation cards with no per-card test id, so div-based ancestor
    // filtering is ambiguous (nested wrapper divs all "contain" both the
    // heading and a Disable button). Instead, find this exact installation's
    // heading, then take the first "Disable" button that follows it in
    // document order — reliable regardless of the surrounding markup.
    const heading = page.getByRole("heading", { name: new RegExp(`Flipkart / ${escapeRegExp(installation.accountAlias)}`) });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    const disableButton = heading.locator("xpath=following::button[normalize-space(text())='Disable'][1]");
    await expect(disableButton).toBeVisible({ timeout: 10_000 });
    await expect(disableButton).toBeEnabled();

    const requestEvents = [];
    page.on("request", (request) => {
      if (request.url().includes(`/connector-operations/${installation.id}/disable`)) {
        requestEvents.push({ method: request.method(), headers: request.headers() });
      }
    });

    // #2/#3 — real navigation POST, captured via the browser's own response event
    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(`/connector-operations/${installation.id}/disable`) && res.request().method() === "POST",
        { timeout: 15_000 },
      ),
      disableButton.click(),
    ]);

    expect(requestEvents.length, "exactly one POST to the disable endpoint").toBe(1);
    // #4 — no Next-Action header (this is not a Server Action request)
    expect(requestEvents[0].headers["next-action"], "no Next-Action header on a native form POST").toBeUndefined();

    // #5 — exactly 303
    expect(postResponse.status(), "response must be exactly 303 See Other").toBe(303);
    // #6 — no x-action-redirect header (this is not going through Next's
    // Server-Action redirect mechanism)
    expect(postResponse.headers()["x-action-redirect"], "no x-action-redirect header").toBeUndefined();
    // #7 — Location is a server-controlled internal path, never client-supplied
    const location = postResponse.headers()["location"];
    expect(location, "Location header present").toBeTruthy();
    expect(location.startsWith("/connector-operation-results/disable/"), "Location is the fixed internal result path").toBe(true);
    expect(location.includes("://"), "Location is not an absolute/external URL").toBe(false);

    // #8/#9 — browser followed with a document GET, landed on the raw-HTML result page
    await page.waitForURL(/\/connector-operation-results\/disable\//, { timeout: 15_000 });
    const resultHtml = await page.content();
    expect(resultHtml.includes("Open navigation menu"), "result page must not mount AuthenticatedShell (no nav toggle)").toBe(false);
    expect(resultHtml.includes("Open notifications"), "result page must not mount AuthenticatedShell (no notification bell)").toBe(false);
    expect(resultHtml.includes('id="main-content"'), "result page must not use the shared shell's main-content region").toBe(false);

    // #10 — result reports DISABLED, derived from the authoritative API state
    // (the handler re-queries the API; this just confirms what the user sees)
    expect(resultHtml.includes("disabled successfully") || resultHtml.includes(">DISABLED<"), "result page reports the disabled outcome").toBe(true);

    // #11 — installation is actually DISABLED in persisted state (independent
    // check via the API, not just trusting the rendered page)
    const persisted = await apiRequest("GET", `/connectors/installed/${installation.id}`, adminToken, undefined, apiURL);
    expect(persisted.status, "installation status is DISABLED in the database").toBe("DISABLED");

    // #12/#13 — correct audit success event exists, mutation happened exactly once
    const auditAfter = await apiRequest(
      "GET",
      `/audit/events?resourceId=${encodeURIComponent(installation.id)}&action=CONNECTOR_UNINSTALL_SUCCESS`,
      adminToken,
      undefined,
      apiURL,
    );
    expect(auditAfter.items.length, "exactly one uninstall-success audit event after one click").toBe(1);

    // #17 — no raw exception, password, token, or internal stack in the response
    expect(resultHtml.toLowerCase().includes("stack trace")).toBe(false);
    expect(resultHtml.toLowerCase().includes("prismaclientknownrequesterror")).toBe(false);
    expect(resultHtml.includes("csrfToken")).toBe(false);

    // #14 — refreshing the result page must not repeat the mutation
    await page.reload({ waitUntil: "domcontentloaded" });
    const auditAfterReload = await apiRequest(
      "GET",
      `/audit/events?resourceId=${encodeURIComponent(installation.id)}&action=CONNECTOR_UNINSTALL_SUCCESS`,
      adminToken,
      undefined,
      apiURL,
    );
    expect(auditAfterReload.items.length, "reloading the result page (a GET) must not add a second success event").toBe(1);

    // #15/#16 — the journey above completed without any timeout/hang and
    // without any page.goto fallback anywhere in this file or the handler
    // it exercises; a forever-pending button or a fallback navigation would
    // have already failed one of the waitForResponse/waitForURL calls above.
  });
});
