const DEFAULT_WORKSPACE = process.env.PLAYWRIGHT_WORKSPACE || "default";
const DEFAULT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const DEFAULT_API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
const DEFAULT_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";

const USERS = {
  admin: { userId: process.env.PLAYWRIGHT_ADMIN_USER || "admin@vexa-pim.local", roleBadge: "Role: Admin" },
  editor: { userId: process.env.PLAYWRIGHT_EDITOR_USER || "editor@vexa-pim.local", roleBadge: "Role: Editor" },
  reviewer: { userId: process.env.PLAYWRIGHT_REVIEWER_USER || "reviewer@vexa-pim.local", roleBadge: "Role: Reviewer" },
  viewer: { userId: process.env.PLAYWRIGHT_VIEWER_USER || "viewer@vexa-pim.local", roleBadge: "Role: Viewer" },
};

const LOGIN_CACHE = new Map();

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
    expiresInMinutes: 360,
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
  await page.getByLabel("Workspace").fill(workspaceSlug);
  await page.getByLabel("User ID").fill(identity.userId);
  await page.getByLabel("Password").fill(DEFAULT_PASSWORD);
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
};
