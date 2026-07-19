const { test, expect } = require("@playwright/test");
const { createHash, createHmac } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_API_URL,
  apiLogin,
  apiLoginPayload,
  apiRequest,
  loginViaUi,
} = require("./helpers/vexa-pim.cjs");

test.setTimeout(60_000);

const JWT_SECRET = "vexa-pim-local-dev-jwt-secret-minimum-length-32";

function computeFingerprint(overrides = {}) {
  const authConfig = {
    authMode: String(overrides.authMode ?? process.env.AUTH_MODE ?? "").trim().toLowerCase(),
    identitiesJson: String(overrides.identitiesJson ?? process.env.PIM_AUTH_IDENTITIES_JSON ?? "").trim(),
    workspacesJson: String(overrides.workspacesJson ?? process.env.PIM_AUTH_WORKSPACES_JSON ?? "").trim(),
    defaultTenantKey: String(overrides.defaultTenantKey ?? process.env.PIM_DEFAULT_TENANT_KEY ?? "").trim().toLowerCase(),
    defaultWorkspaceSlug: String(overrides.defaultWorkspaceSlug ?? process.env.PIM_DEFAULT_WORKSPACE_SLUG ?? "").trim().toLowerCase(),
    defaultRole: String(overrides.defaultRole ?? process.env.PIM_DEFAULT_ROLE ?? "").trim().toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(authConfig)).digest("base64url");
}

function toBase64Url(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return source.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  return Buffer.from(padding === 0 ? normalized : normalized + "=".repeat(4 - padding), "base64");
}

function decodeJwtPayload(jwt) {
  const [, payloadSegment] = jwt.split(".");
  return JSON.parse(fromBase64Url(payloadSegment).toString("utf8"));
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerSegment = toBase64Url(JSON.stringify(header));
  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const unsigned = `${headerSegment}.${payloadSegment}`;
  const signature = toBase64Url(createHmac("sha256", JWT_SECRET).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

test.describe("Auth config fingerprint regression", () => {
  test("same config produces same fingerprint deterministically", () => {
    const fp1 = computeFingerprint();
    const fp2 = computeFingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBeGreaterThan(20);
  });

  test("different config produces different fingerprint", () => {
    const baseline = computeFingerprint();
    const withDifferentTenant = computeFingerprint({ defaultTenantKey: "totally-different-tenant" });
    const withDifferentMode = computeFingerprint({ authMode: "oidc" });
    const withDifferentRole = computeFingerprint({ defaultRole: "admin" });
    const withDifferentWorkspace = computeFingerprint({ defaultWorkspaceSlug: "other-workspace" });

    expect(withDifferentTenant).not.toBe(baseline);
    expect(withDifferentMode).not.toBe(baseline);
    expect(withDifferentRole).not.toBe(baseline);
    expect(withDifferentWorkspace).not.toBe(baseline);

    expect(new Set([baseline, withDifferentTenant, withDifferentMode, withDifferentRole, withDifferentWorkspace]).size).toBe(5);
  });

  test("all API-issued JWTs carry identical fingerprint", async () => {
    const adminToken = await apiLogin("admin");
    const publisherToken = await apiLogin("publisher");
    const editorToken = await apiLogin("editor");

    const adminPayload = decodeJwtPayload(adminToken);
    const publisherPayload = decodeJwtPayload(publisherToken);
    const editorPayload = decodeJwtPayload(editorToken);

    expect(adminPayload.authConfigFingerprint).toBeDefined();
    expect(typeof adminPayload.authConfigFingerprint).toBe("string");
    expect(adminPayload.authConfigFingerprint.length).toBeGreaterThan(20);

    expect(publisherPayload.authConfigFingerprint).toBe(adminPayload.authConfigFingerprint);
    expect(editorPayload.authConfigFingerprint).toBe(adminPayload.authConfigFingerprint);
  });

  test("API-issued session accepted by web SSR (browser login)", async ({ page }) => {
    await loginViaUi(page, "admin");
    const roleBadge = page.getByText("Role: Admin");
    await expect(roleBadge).toBeVisible({ timeout: 15_000 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("/login");
    expect(currentUrl).not.toContain("session_expired");
  });

  test("tampered fingerprint in JWT causes API rejection", async () => {
    const validToken = await apiLogin("admin");
    const payload = decodeJwtPayload(validToken);

    const tamperedPayload = {
      ...payload,
      authConfigFingerprint: computeFingerprint({ defaultTenantKey: "tampered-tenant" }),
    };
    const tamperedJwt = signJwt(tamperedPayload);

    let errorStatus;
    try {
      await apiRequest("GET", "/catalog/products?limit=1", tamperedJwt);
      errorStatus = 200;
    } catch (err) {
      const match = String(err.message).match(/failed: (\d+)/);
      errorStatus = match ? parseInt(match[1], 10) : 0;
    }
    expect(errorStatus).toBe(401);
  });

  test("tampered fingerprint in cookie causes web SSR session rejection", async ({ page }) => {
    const validToken = await apiLogin("admin");
    const payload = decodeJwtPayload(validToken);

    const tamperedPayload = {
      ...payload,
      authConfigFingerprint: computeFingerprint({ defaultTenantKey: "tampered-tenant" }),
    };
    const tamperedJwt = signJwt(tamperedPayload);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
    const url = new URL(baseURL);

    await page.context().addCookies([
      {
        name: "pim_access_token",
        value: tamperedJwt,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });
});
