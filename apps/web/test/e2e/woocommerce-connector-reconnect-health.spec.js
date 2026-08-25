// PRQ-CON-WOO-003 (production-readiness-qa-plan-2026-08-24.md, section 6.2)
//
// Reconnect WooCommerce with an unreachable Site URL must resolve to a distinct
// "verification unavailable" state (503, captured by Error Authority), not be
// conflated with "invalid credentials" (400) — this is exactly the PIM#653 fix
// (validateStoredCredentialsOrThrow / WooCommerceConnector.validateStoredCredentialsDetailed):
// before that fix, ANY reconnect failure (a genuine bad password, or a store that's
// simply unreachable) collapsed into the same plain 400.
//
// This needs no real WooCommerce store: `https://127.0.0.1:1` is a real HTTPS URL
// (passes the connector's own HTTPS-format check) that will always refuse the
// connection (port 1 is a reserved, never-listening port) — a genuine network
// failure, not a mock. Install itself never live-checks credentials (WooCommerce
// defers all live checking to reconnect/heartbeat — confirmed by reading
// captureAndStoreWooCommerceCredentials), so install with this URL succeeds; the
// live check only happens on reconnect.
const { test, expect } = require("@playwright/test");
const { apiLogin, apiRequest, uniqueName } = require("./helpers/vexa-pim.cjs");

const API_URL = String(process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1").trim();

test.setTimeout(60_000);

async function rawRequest(method, route, token, body) {
  const response = await fetch(`${API_URL}${route}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

test("reconnecting WooCommerce with an unreachable Site URL returns 503 (unavailable), not 400 (invalid) — PIM#653", async () => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(!definitions.find((item) => item.slug === "woocommerce"), "woocommerce connector not configured in this environment");

  let installation = null;
  try {
    installation = await apiRequest("POST", "/connectors/woocommerce/install", adminToken, {
      accountAlias: uniqueName("e2e-woo-unreachable").toLowerCase(),
      externalAccountRef: "https://127.0.0.1:1",
      clientId: "ck_e2e_test_placeholder",
      clientSecret: "cs_e2e_test_placeholder",
    });
    expect(installation?.id).toBeTruthy();

    const { status, payload } = await rawRequest("POST", `/connectors/${installation.id}/reconnect`, adminToken);

    expect(status).toBe(503);
    const errorCode = String(payload?.error ?? "");
    expect(errorCode).toBe("CONNECTOR_CREDENTIALS_STILL_INVALID_UNAVAILABLE");
    // Negative check for the PIM#653 bug this guards against: a genuine network
    // failure must never be reported under the "invalid credentials" error code.
    expect(errorCode).not.toBe("CONNECTOR_CREDENTIALS_STILL_INVALID");
  } finally {
    if (installation?.id) {
      try {
        await fetch(`${API_URL}/connectors/woocommerce/install/${installation.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        // best-effort cleanup
      }
    }
  }
});
