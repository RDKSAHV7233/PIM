const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WORKSPACE = process.env.PLAYWRIGHT_WORKSPACE || "default";
const DEFAULT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const DEFAULT_API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
const DEFAULT_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";

const USERS = {
  admin:           { userId: process.env.PLAYWRIGHT_ADMIN_USER           || "admin@vexa-pim.local",           roleBadge: "Role: Admin" },
  editor:          { userId: process.env.PLAYWRIGHT_EDITOR_USER          || "editor@vexa-pim.local",          roleBadge: "Role: Editor" },
  publisher:       { userId: process.env.PLAYWRIGHT_PUBLISHER_USER       || "publisher@vexa-pim.local",       roleBadge: "Role: Publisher" },
  approver:        { userId: process.env.PLAYWRIGHT_APPROVER_USER        || "approver@vexa-pim.local",        roleBadge: "Role: Approver" },
  channel_manager: { userId: process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local", roleBadge: "Role: Channel Manager" },
  connector_admin: { userId: process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local", roleBadge: "Role: Connector Admin" },
  reviewer:        { userId: process.env.PLAYWRIGHT_REVIEWER_USER        || "reviewer@vexa-pim.local",        roleBadge: "Role: Reviewer" },
  viewer:          { userId: process.env.PLAYWRIGHT_VIEWER_USER          || "viewer@vexa-pim.local",          roleBadge: "Role: Viewer" },
};

const LOGIN_CACHE = new Map();

// ── Disk-backed login cache ───────────────────────────────────────────────────
// global-setup.cjs pre-authenticates all roles and writes api-tokens.json.
// Loading it here at module init means every spec file starts with a warm
// cache and never hits the auth rate limiter (10 logins / 15-min window).
const API_TOKEN_CACHE_FILE = path.join(
  __dirname,
  "../../../../../.runlogs/storage-state/api-tokens.json",
);
(function loadTokenCacheFromDisk() {
  try {
    if (fs.existsSync(API_TOKEN_CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(API_TOKEN_CACHE_FILE, "utf8"));
      for (const [key, payload] of Object.entries(saved)) {
        LOGIN_CACHE.set(key, payload);
        // Also register the localhost ↔ 127.0.0.1 alias so the cache hits
        // regardless of which hostname global-setup used vs what the spec uses.
        const alt = key.includes("localhost")
          ? key.replace("localhost", "127.0.0.1")
          : key.replace("127.0.0.1", "localhost");
        if (alt !== key) LOGIN_CACHE.set(alt, payload);
      }
    }
  } catch {
    // Cache miss — tests fall back to live login
  }
})();

function uniqueName(prefix) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  return `${prefix}-${stamp}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

async function apiRequest(method, route, token, body, apiUrl = DEFAULT_API_URL) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${apiUrl}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} failed: ${response.status}; payload=${JSON.stringify(payload)}`);
  }
  return payload;
}

async function apiLoginPayload(role, apiUrl = DEFAULT_API_URL, workspaceSlug = DEFAULT_WORKSPACE) {
  const identity = USERS[role];
  if (!identity) {
    throw new Error(`Unknown role "${role}"`);
  }
  const cacheKey = `${apiUrl}|${workspaceSlug}|${role}`;
  const cached = LOGIN_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }
  const payload = await apiRequest("POST", "/auth/login", null, {
    workspaceSlug,
    userId: identity.userId,
    password: DEFAULT_PASSWORD,
    expiresInMinutes: 240,
  }, apiUrl);
  LOGIN_CACHE.set(cacheKey, payload);
  return payload;
}

async function apiLogin(role, apiUrl = DEFAULT_API_URL, workspaceSlug = DEFAULT_WORKSPACE) {
  const payload = await apiLoginPayload(role, apiUrl, workspaceSlug);
  return payload.accessToken;
}

function clearLoginCache() {
  LOGIN_CACHE.clear();
}

async function loginViaUi(page, role, options = {}) {
  const workspaceSlug = options.workspaceSlug || DEFAULT_WORKSPACE;
  const baseURL = options.baseURL || DEFAULT_BASE_URL;
  const identity = USERS[role];
  if (!identity) {
    throw new Error(`Unknown role "${role}"`);
  }

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  const workspaceInput = page.getByTestId("workspace");
  const userIdInput = page.getByTestId("user-id");
  const passwordInput = page.getByTestId("password");
  await userIdInput.waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await workspaceInput.fill(workspaceSlug);
  await userIdInput.fill(identity.userId);
  await passwordInput.fill(DEFAULT_PASSWORD);
  await page.waitForFunction(
    ({ workspaceSlug: expectedWorkspace, userId: expectedUserId }) => {
      const workspace = document.querySelector('[data-testid="workspace"]');
      const userId = document.querySelector('[data-testid="user-id"]');
      return (
        workspace instanceof HTMLInputElement &&
        userId instanceof HTMLInputElement &&
        workspace.value === expectedWorkspace &&
        userId.value === expectedUserId
      );
    },
    { workspaceSlug, userId: identity.userId },
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
  await page.getByText(identity.roleBadge).waitFor({ state: "visible" });
}

async function createCategory(token, name, parentId = undefined, apiUrl = DEFAULT_API_URL) {
  return apiRequest("POST", "/taxonomy/categories", token, { name, parentId }, apiUrl);
}

async function createProduct(token, payload, apiUrl = DEFAULT_API_URL) {
  return apiRequest("POST", "/catalog/products", token, payload, apiUrl);
}

async function updateProduct(token, productId, payload, apiUrl = DEFAULT_API_URL) {
  return apiRequest("PATCH", `/catalog/products/${productId}`, token, payload, apiUrl);
}

async function reviewProduct(token, productId, status, note, apiUrl = DEFAULT_API_URL) {
  return apiRequest("POST", `/catalog/products/${productId}/review-decision`, token, { status, note }, apiUrl);
}

async function deleteProduct(token, productId, apiUrl = DEFAULT_API_URL) {
  return apiRequest("DELETE", `/catalog/products/${productId}`, token, undefined, apiUrl);
}

async function purgeProduct(token, productId, apiUrl = DEFAULT_API_URL) {
  return apiRequest("DELETE", `/catalog/products/${productId}/purge`, token, undefined, apiUrl);
}

async function deleteCategory(token, categoryId, apiUrl = DEFAULT_API_URL) {
  return apiRequest("DELETE", `/taxonomy/categories/${categoryId}`, token, undefined, apiUrl);
}

async function listNotifications(token, apiUrl = DEFAULT_API_URL) {
  return apiRequest("GET", "/notifications?limit=20", token, undefined, apiUrl);
}

/**
 * Verifies a Vexa PIM outbound webhook signature.
 *
 * The API signs each delivery as:
 *   HMAC-SHA256(key=signingSecret, data=`${timestamp}.${rawBody}`)
 * and sets the header: `X-PIM1-Webhook-Signature: sha256=${hexDigest}`
 *
 * @param {string} rawBody - The raw UTF-8 request body string (not parsed JSON).
 * @param {string} timestamp - Value of the `X-PIM1-Webhook-Timestamp` header.
 * @param {string} signingSecret - The plaintext secret provided at webhook creation.
 * @param {string} signatureHeader - Full value of `X-PIM1-Webhook-Signature` header.
 * @returns {boolean} true if the signature is valid.
 */
function verifyWebhookSignature(rawBody, timestamp, signingSecret, signatureHeader) {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected =
    "sha256=" +
    createHmac("sha256", signingSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
  return signatureHeader === expected;
}

module.exports = {
  DEFAULT_API_URL,
  DEFAULT_BASE_URL,
  DEFAULT_WORKSPACE,
  USERS,
  apiLogin,
  apiLoginPayload,
  apiRequest,
  clearLoginCache,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  listNotifications,
  loginViaUi,
  purgeProduct,
  reviewProduct,
  uniqueName,
  updateProduct,
  verifyWebhookSignature,
};
