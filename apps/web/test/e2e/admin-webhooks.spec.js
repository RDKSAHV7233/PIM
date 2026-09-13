const http = require("node:http");
const { test, expect } = require("@playwright/test");
const {
  apiLoginPayload,
  apiRequest,
  loginViaUi,
  uniqueName,
  verifyWebhookSignature,
  setTenantPlanTier,
  DEFAULT_WORKSPACE,
  DEFAULT_API_URL,
} = require("./helpers/vexa-pim.cjs");

function startCaptureServer() {
  const deliveries = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = rawBody;
      }
      deliveries.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody, // preserved for HMAC verification
        body,
      });
      res.statusCode = 204;
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve webhook capture server address."));
        return;
      }
      resolve({
        server,
        deliveries,
        targetUrl: `http://127.0.0.1:${address.port}/vexa-pim/webhook`,
      });
    });
  });
}

/**
 * Every mutation on /admin/webhooks is a server action that finishes with
 * `redirect("/admin/webhooks?status=<...>")`. The App Router turns that 303 into
 * a client-side RSC navigation. That navigation's RSC fetch is frequently
 * aborted (net::ERR_ABORTED) — most reliably the first submit right after a
 * `waitUntil:"domcontentloaded"` goto, before the router has settled: history
 * still moves to the new URL (so a bare `waitForURL` resolves) but <main> keeps
 * the previous render and the InlineAlert never appears.
 *
 * The server action has already committed its change by the time it issues the
 * redirect, so on that race we fall back to a clean full-page load of the
 * expected `?status=<...>` URL, which re-renders the destination — banner and
 * updated table included. A genuine "never rendered" regression still fails on
 * the post-reload assertion.
 */
async function waitForStatusBanner(page, statusValue, text) {
  const statusRe = new RegExp(`status=${statusValue}`);
  const banner = page.getByText(text);
  try {
    await page.waitForURL(statusRe, { timeout: 6_000 });
    await expect(banner).toBeVisible({ timeout: 4_000 });
    return;
  } catch {
    // fall through to a clean load of the expected status URL
  }
  await page.goto(`/admin/webhooks?status=${statusValue}`, { waitUntil: "domcontentloaded" });
  await expect(banner).toBeVisible();
}

test("admin can manage outbound webhooks from the browser", async ({ page }) => {
  // Five sequential server-action mutations, each with a recovery fallback for
  // the aborted post-action RSC navigation — give the lifecycle room.
  test.setTimeout(120_000);
  const adminAuth = await apiLoginPayload("admin");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const endpointName = uniqueName("e2e-webhook");
  const signingSecret = `secret-${Date.now()}-minimum-length`;
  const capture = await startCaptureServer();

  let endpointId = null;

  const endpointRow = () => page.locator("table").nth(0).locator("tbody tr", { hasText: endpointName }).first();
  const deliveryRow = () => page.locator("table").nth(1).locator("tbody tr", { hasText: endpointName }).first();

  try {
    // Outbound webhooks are gated to GROWTH+ (apps/web/src/app/admin/webhooks/page.tsx);
    // without this the page renders "Plan Upgrade Required" and the form is absent.
    await setTenantPlanTier("GROWTH", { tenantKey: DEFAULT_WORKSPACE });

    await loginViaUi(page, "admin");
    await page.goto("/admin/webhooks", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Name").fill(endpointName);
    await page.getByLabel("Event").selectOption("approval_decision");
    await page.getByLabel("Target URL").fill(capture.targetUrl);
    await page.getByLabel("Signing secret").fill(signingSecret);
    await page.getByRole("button", { name: "Create webhook" }).click();

    await waitForStatusBanner(page, "webhook-created", "Webhook endpoint created.");
    await expect(endpointRow()).toBeVisible();
    await expect(endpointRow()).toContainText("Approval decision");
    await expect(endpointRow()).toContainText("active");

    const endpoints = await apiRequest("GET", "/admin/webhooks", adminToken);
    const createdEndpoint = endpoints.find((row) => row.name === endpointName);
    expect(createdEndpoint).toBeTruthy();
    endpointId = createdEndpoint.id;
    expect(createdEndpoint.targetUrl).toBe(capture.targetUrl);
    expect(createdEndpoint.isActive).toBe(true);

    await endpointRow().getByRole("button", { name: "Send test" }).click();
    await waitForStatusBanner(page, "webhook-test-queued", "Webhook test delivery queued.");

    await expect.poll(() => capture.deliveries.length, { timeout: 20_000 }).toBe(1);
    const received = capture.deliveries[0];
    expect(received.method).toBe("POST");
    // Cryptographic signature verification — not just format check.
    // The API signs: HMAC-SHA256(key=signingSecret, data=`${timestamp}.${rawBody}`)
    const sigHeader = received.headers["x-pim1-webhook-signature"];
    const tsHeader = received.headers["x-pim1-webhook-timestamp"];
    expect(sigHeader).toMatch(/^sha256=/);
    expect(tsHeader).toBeTruthy();
    expect(
      verifyWebhookSignature(received.rawBody, tsHeader, signingSecret, sigHeader),
    ).toBe(true);
    expect(received.headers["x-pim1-webhook-event"]).toBe("approval_decision");
    expect(received.body?.source).toBe("test");
    expect(received.body?.type).toBe("approval_decision");
    expect(received.body?.metadata?.test).toBe(true);
    expect(received.body?.metadata?.endpointId).toBe(endpointId);
    expect(String(received.body?.title ?? "")).toContain(endpointName);

    await expect
      .poll(async () => {
        const deliveries = await apiRequest(
          "GET",
          `/admin/webhooks/deliveries?endpointId=${encodeURIComponent(endpointId)}&limit=5`,
          adminToken,
          undefined,
          DEFAULT_API_URL,
        );
        return deliveries[0]?.status ?? "";
      }, { timeout: 20_000 })
      .toBe("delivered");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(deliveryRow()).toBeVisible();
    await expect(deliveryRow()).toContainText("delivered");

    await endpointRow().getByRole("button", { name: "Pause" }).click();
    await waitForStatusBanner(page, "webhook-paused", "Webhook endpoint paused.");
    await expect(endpointRow()).toContainText("paused");
    await expect(endpointRow().getByRole("button", { name: "Resume" })).toBeVisible();

    await endpointRow().getByRole("button", { name: "Resume" }).click();
    await waitForStatusBanner(page, "webhook-resumed", "Webhook endpoint resumed.");
    await expect(endpointRow()).toContainText("active");

    // Delete is a two-step confirm: the row shows a "Delete" link that adds
    // `?confirmDelete=<id>`, which swaps in the "Delete" submit button that
    // actually fires the server action.
    await endpointRow().getByRole("link", { name: "Delete" }).click();
    const confirmDeleteButton = endpointRow().getByRole("button", { name: "Delete" });
    try {
      await expect(confirmDeleteButton).toBeVisible({ timeout: 6_000 });
    } catch {
      // Link nav's RSC fetch was aborted — load the confirm state directly.
      await page.goto(`/admin/webhooks?confirmDelete=${endpointId}`, { waitUntil: "domcontentloaded" });
      await expect(confirmDeleteButton).toBeVisible();
    }
    await confirmDeleteButton.click();
    await waitForStatusBanner(page, "webhook-deleted", "Webhook endpoint deleted.");
    await expect(endpointRow()).toHaveCount(0);
    endpointId = null;
  } finally {
    if (endpointId) {
      try {
        await apiRequest("DELETE", `/admin/webhooks/${encodeURIComponent(endpointId)}`, adminToken);
      } catch {}
    }
    await new Promise((resolve) => capture.server.close(resolve));
  }
});
