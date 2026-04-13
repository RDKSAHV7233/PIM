const http = require("node:http");
const { test, expect } = require("@playwright/test");
const { apiLoginPayload, apiRequest, loginViaUi, uniqueName, DEFAULT_API_URL } = require("./helpers/vexa-pim.cjs");

function startCaptureServer() {
  const deliveries = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        body = bodyText;
      }
      deliveries.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
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

test("admin can manage outbound webhooks from the browser", async ({ page }) => {
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
    await loginViaUi(page, "admin");
    await page.goto("/admin/webhooks", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Name").fill(endpointName);
    await page.getByLabel("Event").selectOption("approval_decision");
    await page.getByLabel("Target URL").fill(capture.targetUrl);
    await page.getByLabel("Signing secret").fill(signingSecret);
    await page.getByRole("button", { name: "Create webhook" }).click();

    await page.waitForURL(/status=webhook-created/);
    await expect(page.getByText("Webhook endpoint created.")).toBeVisible();
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
    await page.waitForURL(/status=webhook-test-queued/);
    await expect(page.getByText("Webhook test delivery queued.")).toBeVisible();

    await expect.poll(() => capture.deliveries.length, { timeout: 20_000 }).toBe(1);
    const received = capture.deliveries[0];
    expect(received.method).toBe("POST");
    expect(received.headers["x-pim1-webhook-signature"]).toMatch(/^sha256=/);
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
    await page.waitForURL(/status=webhook-paused/);
    await expect(page.getByText("Webhook endpoint paused.")).toBeVisible();
    await expect(endpointRow()).toContainText("paused");
    await expect(endpointRow().getByRole("button", { name: "Resume" })).toBeVisible();

    await endpointRow().getByRole("button", { name: "Resume" }).click();
    await page.waitForURL(/status=webhook-resumed/);
    await expect(page.getByText("Webhook endpoint resumed.")).toBeVisible();
    await expect(endpointRow()).toContainText("active");

    await endpointRow().getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(/status=webhook-deleted/);
    await expect(page.getByText("Webhook endpoint deleted.")).toBeVisible();
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
