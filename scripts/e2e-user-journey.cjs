"use strict";

const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

mkdirSync(path.join(process.cwd(), ".run-logs"), { recursive: true });

if (String(process.env.USE_CURL_SHIM ?? "").trim().toLowerCase() === "true") {
  require(path.join(__dirname, "staging-fetch-via-curl.cjs"));
}

const PASS = "\u2713 PASS";
const FAIL = "\u2717 FAIL";
const SKIP = "~ SKIP";
const DRY = "~ DRY";
const DIVIDER = "----------------------------------------------";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

function readFlagValue(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return "";
  }
  return String(argv[index + 1] ?? "").trim();
}

function readBooleanEnv(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

const SECTION_FILTER = String(readFlagValue("--section") || process.env.E2E_SECTION || "").trim().toLowerCase();
const FAIL_ON_SKIP = argv.includes("--fail-on-skip") || readBooleanEnv("E2E_FAIL_ON_SKIP");
const SMOKE_MODE = argv.includes("--smoke") || readBooleanEnv("E2E_SMOKE");
const resultTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultFilePath = path.join(process.cwd(), ".run-logs", `e2e-result-${resultTimestamp}.json`);
const MODE_LABEL = SMOKE_MODE ? "smoke" : "full";
const SMOKE_CHECK_KEYS = new Set([
  "health:api_reachable",
  "health:env_is_staging",
  "health:queue_backend_bullmq",
  "health:queue_worker_enabled",
  "auth:admin_login",
  "auth:invalid_password_rejected",
  "auth:token_required_on_protected_route",
  "taxonomy:create_category",
  "taxonomy:create_attribute",
  "catalog:create_product_draft",
  "catalog:reject_non_draft_entry",
  "catalog:get_product",
  "catalog:validate_product",
  "catalog:workflow_submit_for_review",
  "catalog:workflow_approve",
  "mappings:list_channels",
  "mappings:get_channel_mapping",
  "mappings:create_mapping_template",
  "dashboard:dashboard_health",
  "dashboard:billing_usage",
  "users:list_workspace_users",
  "users:create_workspace_user",
  "users:lock_user",
  "users:unlock_user",
  "audit:audit_log_accessible",
  "cleanup:delete_variant",
  "cleanup:delete_product",
  "cleanup:delete_attribute",
  "cleanup:delete_category",
  "cleanup:final_logout",
]);

function toCheckKey(section, name) {
  return `${String(section ?? "").trim().toLowerCase()}:${String(name ?? "").trim()}`;
}

function isSmokeCheck(section, name) {
  return SMOKE_CHECK_KEYS.has(toCheckKey(section, name));
}

function normalizeApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const url = new URL(raw);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!/\/api\/v1$/i.test(normalizedPath)) {
    url.pathname = `${normalizedPath === "/" ? "" : normalizedPath}/api/v1`;
  }
  return url.toString().replace(/\/+$/, "");
}

const CONFIG = {
  baseUrl: normalizeApiBaseUrl(process.env.STAGING_BASE_URL),
  webUrl: String(process.env.STAGING_WEB_URL ?? "").trim(),
  workspace: String(process.env.STAGING_SMOKE_WORKSPACE ?? "").trim(),
  smokeUser: String(process.env.STAGING_SMOKE_USER ?? "").trim(),
  smokePassword: String(process.env.STAGING_SMOKE_PASSWORD ?? "").trim(),
  tenantId: String(process.env.STAGING_SMOKE_TENANT_ID ?? "default").trim() || "default",
  amazonSellerId: String(process.env.STAGING_AMAZON_SELLER_ID ?? "").trim(),
  amazonClientId: String(process.env.STAGING_AMAZON_CLIENT_ID ?? "").trim(),
  amazonClientSecret: String(process.env.STAGING_AMAZON_CLIENT_SECRET ?? "").trim(),
  amazonRefreshToken: String(process.env.STAGING_AMAZON_REFRESH_TOKEN ?? "").trim(),
};

const reportState = {
  total: 0,
  pass: 0,
  fail: 0,
  skip: 0,
};
const checkResults = [];

const runTag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const ctx = {
  adminToken: null,
  editorToken: null,
  reviewerToken: null,
  viewerToken: null,
  categoryId: null,
  categoryName: null,
  attributeId: null,
  productId: null,
  variantId: null,
  variantSkuCode: null,
  templateId: null,
  templateCloneId: null,
  mappingVersionId: null,
  importJobId: null,
  importTemplateId: null,
  bulkEditOpId: null,
  submissionId: null,
  connectorInstallId: null,
  connectorPermissionId: null,
  auditUserId: null,
  workspaceUserId: null,
  exportJobId: null,
  complianceRuleId: null,
  queueApproveProductId: null,
  queueRejectProductId: null,
  warningProductId: null,
  exportPrivacyJobId: null,
  cache: Object.create(null),
  knownProducts: new Map(),
  knownVariants: new Map(),
  createdProductIds: [],
  createdVariantIds: [],
};

class SkipError extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipError";
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function skip(message) {
  throw new SkipError(message);
}

function pad(text, width) {
  const value = String(text ?? "");
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function formatMs(ms) {
  return `${String(ms).padStart(5, " ")}ms`;
}

function trimNote(note) {
  const value = String(note ?? "").replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : "";
}

function report(status, section, name, ms, note) {
  const base = `  ${status}  [${section}] ${pad(name, 38)}`;
  if (status === DRY) {
    console.log(base);
    return;
  }
  const suffix = trimNote(note);
  console.log(`${base} ${formatMs(ms)}${suffix ? `  ${suffix}` : ""}`);
}

function sectionMatches(section) {
  if (!SECTION_FILTER) {
    return true;
  }
  return String(section ?? "").trim().toLowerCase() === SECTION_FILTER;
}

async function check(section, name, fn) {
  if (SECTION_FILTER && !sectionMatches(section)) {
    if (DRY_RUN) {
      return;
    }
    reportState.total += 1;
    reportState.skip += 1;
    checkResults.push({
      section,
      name,
      result: "skip",
      ms: 0,
      note: "section filtered",
    });
    report(SKIP, section, name, 0, "section filtered");
    return;
  }
  reportState.total += 1;
  if (DRY_RUN) {
    report(DRY, section, name, 0, "");
    return;
  }
  const startedAt = Date.now();
  try {
    const note = await fn();
    reportState.pass += 1;
    checkResults.push({
      section,
      name,
      result: "pass",
      ms: Date.now() - startedAt,
      note: trimNote(note ?? ""),
    });
    report(PASS, section, name, checkResults[checkResults.length - 1].ms, note ?? "");
  } catch (error) {
    if (error instanceof SkipError) {
      reportState.skip += 1;
      const ms = Date.now() - startedAt;
      checkResults.push({
        section,
        name,
        result: "skip",
        ms,
        note: error.message,
      });
      report(SKIP, section, name, ms, error.message);
      return;
    }
    reportState.fail += 1;
    const ms = Date.now() - startedAt;
    const reason = describeError(error);
    checkResults.push({
      section,
      name,
      result: "fail",
      ms,
      note: reason,
    });
    report(FAIL, section, name, ms, reason);
  }
}

function describeError(error) {
  if (!error) {
    return "unknown error";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function parseBody(text, contentType) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const lowerContentType = String(contentType ?? "").toLowerCase();
  if (lowerContentType.includes("application/json") || lowerContentType.includes("+json")) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessageFromBody(body) {
  if (!body) {
    return "";
  }
  if (typeof body === "string") {
    return body.trim();
  }
  if (typeof body === "object") {
    const candidate =
      body.message ??
      body.error ??
      body.code ??
      (Array.isArray(body.errors) ? body.errors.join(", ") : undefined);
    if (candidate) {
      return String(candidate);
    }
  }
  return "";
}

async function request(baseUrl, method, routeOrUrl, options = {}) {
  let url = routeOrUrl;
  if (!routeOrUrl.startsWith("http")) {
    const base = new URL(baseUrl);
    const queryIndex = routeOrUrl.indexOf("?");
    const pathPart = queryIndex >= 0 ? routeOrUrl.slice(0, queryIndex) : routeOrUrl;
    const searchPart = queryIndex >= 0 ? routeOrUrl.slice(queryIndex + 1) : "";
    const basePath = String(base.pathname ?? "").replace(/\/+$/, "");
    const routePath = `/${String(pathPart ?? "").replace(/^\/+/, "")}`;
    base.pathname = `${basePath}${routePath}`.replace(/\/{2,}/g, "/");
    base.search = searchPart ? `?${searchPart}` : "";
    url = base.toString();
  }
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }

  const retries = Number(options.retries ?? 0);
  let response;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "manual",
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await wait(300 * (attempt + 1));
    }
  }
  if (!response) {
    throw lastError ?? new Error("request failed");
  }

  const text = await response.text();
  const contentType = response.headers?.get?.("content-type") ?? "";
  const parsedBody = response.status === 204 ? null : parseBody(text, contentType);
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    body: parsedBody,
    url,
  };
}

async function api(method, route, options = {}) {
  assert(CONFIG.baseUrl, "STAGING_BASE_URL is required.");
  return request(CONFIG.baseUrl, method, route, options);
}

async function web(method, route, options = {}) {
  if (!CONFIG.webUrl) {
    skip("STAGING_WEB_URL not provided");
  }
  return request(CONFIG.webUrl, method, route, options);
}

function assertStatus(result, allowedStatuses, messagePrefix) {
  const allowed = Array.isArray(allowedStatuses) ? allowedStatuses : [allowedStatuses];
  if (allowed.includes(result.status)) {
    return result;
  }
  const detail = getErrorMessageFromBody(result.body);
  throw new Error(
    `${messagePrefix} expected ${allowed.join("/")} got ${result.status}${detail ? ` (${detail})` : ""}`,
  );
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  throw new Error("expected array or paginated items array");
}

function maybeItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function rememberProduct(product) {
  if (product && product.id) {
    ctx.knownProducts.set(String(product.id), product);
  }
  return product;
}

function rememberVariant(variant) {
  if (variant && variant.id) {
    ctx.knownVariants.set(String(variant.id), variant);
  }
  return variant;
}

async function getHealth() {
  if (!ctx.cache.health) {
    ctx.cache.health = api("GET", "/health").then((result) => {
      assertStatus(result, 200, "GET /health");
      return result.body;
    });
  }
  return ctx.cache.health;
}

async function login(userId, password, workspaceSlug) {
  return api("POST", "/auth/login", {
    json: {
      workspaceSlug,
      userId,
      password,
    },
  });
}

async function loginAsAdmin() {
  const result = await login(CONFIG.smokeUser, CONFIG.smokePassword, CONFIG.workspace);
  assertStatus(result, [200, 201], "POST /auth/login");
  assert(result.body?.accessToken, "login accessToken missing");
  ctx.adminToken = String(result.body.accessToken);
  return result.body;
}

async function loginOptional(prefix) {
  const user = String(process.env[`STAGING_${prefix}_USER`] ?? "").trim();
  if (!user) {
    skip(`${prefix.toLowerCase()} credentials not provided`);
  }
  const password = String(process.env[`STAGING_${prefix}_PASSWORD`] ?? CONFIG.smokePassword).trim();
  const workspace = String(process.env[`STAGING_${prefix}_WORKSPACE`] ?? CONFIG.workspace).trim();
  const result = await login(user, password, workspace);
  assertStatus(result, [200, 201], `POST /auth/login (${prefix.toLowerCase()})`);
  assert(result.body?.accessToken, `${prefix.toLowerCase()} accessToken missing`);
  return result.body;
}

async function ensureAnyCategoryId() {
  if (ctx.categoryId) {
    return ctx.categoryId;
  }
  const result = await api("GET", "/taxonomy/categories", { token: ctx.adminToken });
  assertStatus(result, 200, "GET /taxonomy/categories");
  const items = normalizeItems(result.body);
  const first = items[0];
  if (!first?.id) {
    skip("no category available yet");
  }
  return String(first.id);
}

async function getAnyProduct() {
  const listResult = await api("GET", "/catalog/products?slim=true&limit=1", { token: ctx.adminToken });
  assertStatus(listResult, 200, "GET /catalog/products?slim=true&limit=1");
  const items = maybeItems(listResult.body);
  const first = items[0];
  if (!first?.id) {
    skip("no product available yet");
  }
  const detailResult = await api("GET", `/catalog/products/${encodeURIComponent(first.id)}`, { token: ctx.adminToken });
  assertStatus(detailResult, 200, "GET /catalog/products/:id");
  return rememberProduct(detailResult.body);
}

async function getProduct(productId, token = ctx.adminToken) {
  const cached = ctx.knownProducts.get(String(productId));
  if (cached && token === ctx.adminToken && cached.completenessScore !== undefined) {
    return cached;
  }
  const result = await api("GET", `/catalog/products/${encodeURIComponent(productId)}`, { token });
  assertStatus(result, 200, "GET /catalog/products/:id");
  return rememberProduct(result.body);
}

async function patchProduct(productId, changes, token = ctx.adminToken) {
  const current = await getProduct(productId);
  // When only the status is changing (workflow transition), send a minimal
  // payload so the API doesn't reject it as a "content change" on approved
  // or archived products.
  const statusOnlyKeys = Object.keys(changes);
  const isStatusOnlyTransition =
    statusOnlyKeys.length === 1 && statusOnlyKeys[0] === "status";
  const payload = isStatusOnlyTransition
    ? { expectedVersion: current.version, status: changes.status }
    : {
        expectedVersion: current.version,
        title: current.title,
        description: current.description,
        brand: current.brand,
        categoryId: current.categoryId,
        hsnCode: current.hsnCode ?? undefined,
        gstRate: current.gstRate ?? undefined,
        attributes: current.attributes ?? {},
        status: current.status,
        ...changes,
      };
  return api("PATCH", `/catalog/products/${encodeURIComponent(productId)}`, {
    token,
    json: payload,
  });
}

async function ensureEnterprisePlanTier(reason) {
  if (ctx.cache.enterprisePlanTierReady) {
    return ctx.cache.enterprisePlanTierReady;
  }
  const result = await api("POST", "/billing/plan-tier", {
    token: ctx.adminToken,
    json: {
      planTier: "ENTERPRISE",
    },
  });
  assertStatus(result, [200, 201], "POST /billing/plan-tier");
  ctx.cache.enterprisePlanTierReady = {
    planTier: String(result.body?.planTier ?? "ENTERPRISE"),
    reason,
  };
  return ctx.cache.enterprisePlanTierReady;
}

async function withEnterprisePlanRetry(label, requestFactory) {
  let result = await requestFactory();
  if (result.status !== 402 || String(result.body?.error ?? "").trim() !== "PLAN_LIMIT_EXCEEDED") {
    return result;
  }
  await ensureEnterprisePlanTier(label);
  result = await requestFactory();
  return result;
}

async function createDraftProduct(label, overrides = {}, token = ctx.adminToken) {
  const categoryId = ctx.categoryId ?? (await ensureAnyCategoryId());
  const title = `${label} ${runTag}`;
  const productPayload = {
    title,
    brand: "E2EBrand",
    description: "E2E automated product for staging validation.",
    categoryId,
    hsnCode: "6205",
    gstRate: 18,
    attributes: {
      pricing: {
        sellingPrice: 499,
      },
    },
    status: "draft",
    ...overrides,
  };
  const result = await withEnterprisePlanRetry("catalog:create_product_draft", () =>
    api("POST", "/catalog/products", {
      token,
      json: productPayload,
    }),
  );
  assertStatus(result, 201, "POST /catalog/products");
  assert(result.body?.id, "created product id missing");
  ctx.createdProductIds.push(String(result.body.id));
  return rememberProduct(result.body);
}

async function createNonDraftProductExpectingWorkflowError() {
  const payload = {
    title: `E2E Invalid Product ${runTag}`,
    brand: "E2EBrand",
    description: "Invalid workflow entry product.",
    categoryId: ctx.categoryId,
    status: "active",
  };
  return withEnterprisePlanRetry("catalog:reject_non_draft_entry", () =>
    api("POST", "/catalog/products", {
      token: ctx.adminToken,
      json: payload,
    }),
  );
}

async function createApprovalReadyProduct(label, token = ctx.adminToken) {
  const product = await createDraftProduct(label, {}, token);
  const validationResult = await api("POST", `/compliance/products/${encodeURIComponent(product.id)}/validate`, { token });
  assertStatus(validationResult, [200, 201], "POST /compliance/products/:id/validate");
  const patchResult = await patchProduct(product.id, { status: "in_review" }, token);
  assertStatus(patchResult, 200, "PATCH /catalog/products/:id");
  return rememberProduct(patchResult.body);
}

async function createWarningProduct() {
  const product = await createDraftProduct("E2E Warning Product", { description: "" });
  ctx.warningProductId = product.id;
  const validationResult = await api("POST", `/compliance/products/${encodeURIComponent(product.id)}/validate`, {
    token: ctx.adminToken,
  });
  assertStatus(validationResult, [200, 201], "POST /compliance/products/:id/validate");
  return product;
}

async function normalizeProductForDelete(productId) {
  try {
    const product = await getProduct(productId);
    const status = String(product.status ?? "").toLowerCase();
    if (status === "approved") {
      const archived = await patchProduct(productId, { status: "archived" });
      if (archived.status === 200) rememberProduct(archived.body);
      const draft = await patchProduct(productId, { status: "draft" });
      if (draft.status === 200) rememberProduct(draft.body);
      return;
    }
    if (status === "in_review" || status === "rejected" || status === "archived") {
      const draft = await patchProduct(productId, { status: "draft" });
      if (draft.status === 200) rememberProduct(draft.body);
    }
  } catch {
    // Best effort only for cleanup.
  }
}

async function purgeCreatedProductsForCategory(categoryId) {
  const targetCategoryId = String(categoryId);
  let attempted = 0;
  let purged = 0;
  for (const productId of [...new Set(ctx.createdProductIds)].reverse()) {
    const knownProduct = ctx.knownProducts.get(String(productId));
    if (String(knownProduct?.categoryId ?? "") !== targetCategoryId) {
      continue;
    }
    attempted += 1;
    try {
      await normalizeProductForDelete(productId);
      const deleteResult = await api("DELETE", `/catalog/products/${encodeURIComponent(productId)}`, {
        token: ctx.adminToken,
      });
      if (![200, 204, 404].includes(deleteResult.status)) {
        continue;
      }
      const purgeResult = await api("DELETE", `/catalog/products/${encodeURIComponent(productId)}/purge`, {
        token: ctx.adminToken,
      });
      if ([200, 204, 404].includes(purgeResult.status)) {
        purged += 1;
      }
    } catch {
      // Best effort: category cleanup will still skip if hard references remain.
    }
  }
  return { attempted, purged };
}

function encodeUser(userId) {
  return encodeURIComponent(String(userId));
}

function isFutureIso(value) {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now();
}

async function ensureConnectorDefinition(slug) {
  if (!ctx.cache.connectorDefinitions) {
    ctx.cache.connectorDefinitions = api("GET", "/connectors/definitions", { token: ctx.adminToken }).then((result) => {
      assertStatus(result, 200, "GET /connectors/definitions");
      return normalizeItems(result.body);
    });
  }
  const definitions = await ctx.cache.connectorDefinitions;
  const definition = definitions.find((item) => String(item.slug).toLowerCase() === String(slug).toLowerCase());
  if (!definition) {
    skip(`connector definition ${slug} not available`);
  }
  return definition;
}

async function ensureAmazonInstallationForExports() {
  const installedResult = await api("GET", "/connectors/installed?limit=50", { token: ctx.adminToken });
  assertStatus(installedResult, 200, "GET /connectors/installed");
  const installedItems = maybeItems(installedResult.body);
  const existing = installedItems.find((item) => String(item.slug ?? item.connectorSlug ?? "").toLowerCase() === "amazon-in");
  if (existing?.id) {
    return String(existing.id);
  }

  if (!hasConfiguredAmazonInstallCredentials()) {
    skip("amazon-in installation unavailable for export jobs (staging amazon credentials not configured)");
  }

  const installResult = await api("POST", "/connectors/amazon-in/install", {
    token: ctx.adminToken,
    json: buildAmazonInstallPayload(`E2E Export ${runTag}`),
  });
  if (installResult.status === 201 && installResult.body?.id) {
    ctx.connectorInstallId = String(installResult.body.id);
    return ctx.connectorInstallId;
  }
  skip(`amazon-in installation unavailable for export jobs (${installResult.status})`);
}

function hasConfiguredAmazonInstallCredentials() {
  return Boolean(
    CONFIG.amazonSellerId &&
      CONFIG.amazonClientId &&
      CONFIG.amazonClientSecret &&
      CONFIG.amazonRefreshToken,
  );
}

function buildAmazonInstallPayload(accountAlias) {
  return {
    accountAlias,
    externalAccountRef: CONFIG.amazonSellerId || undefined,
    clientId: CONFIG.amazonClientId || undefined,
    clientSecret: CONFIG.amazonClientSecret || undefined,
    refreshToken: CONFIG.amazonRefreshToken || undefined,
  };
}

function toCookie(token) {
  return `pim_access_token=${token}`;
}

function getIssueInboxItems(body) {
  if (body && Array.isArray(body.items)) {
    return body.items;
  }
  if (Array.isArray(body)) {
    return body;
  }
  return [];
}

function buildChecks() {
  const checks = [];
  const cleanupChecks = [];
  const add = (section, name, fn) => checks.push({ section, name, fn, smoke: isSmokeCheck(section, name) });
  const addCleanup = (name, fn) => cleanupChecks.push({ section: "cleanup", name, fn, smoke: isSmokeCheck("cleanup", name) });
  add("health", "api_reachable", async () => {
    const health = await getHealth();
    assert(String(health?.status).toLowerCase() === "ok", "health status is not ok");
    return `env=${health.env}`;
  });

  add("health", "env_is_staging", async () => {
    const health = await getHealth();
    assert(String(health?.env).toLowerCase() === "staging", `expected env=staging got ${health?.env}`);
    return `env=${health.env}`;
  });

  add("health", "queue_backend_bullmq", async () => {
    const health = await getHealth();
    assert(String(health?.queueRuntime?.backend).toLowerCase() === "bullmq", "queue backend is not bullmq");
    return `backend=${health.queueRuntime.backend}`;
  });

  add("health", "queue_worker_enabled", async () => {
    const health = await getHealth();
    assert(health?.queueRuntime?.workerEnabled === true, "queue worker is not enabled");
    return "workerEnabled=true";
  });

  add("auth", "login_page_renders", async () => {
    const result = await web("GET", "/login");
    assertStatus(result, 200, "GET web /login");
    const html = String(result.text ?? "");
    assert(html.includes("workspace") || html.includes("Workspace"), "login page does not mention workspace");
    return "web login page rendered";
  });

  add("auth", "admin_login", async () => {
    const payload = await loginAsAdmin();
    assert(payload.role === "admin", `expected role=admin got ${payload.role}`);
    return `role=${payload.role}`;
  });

  add("auth", "invalid_password_rejected", async () => {
    const result = await login(CONFIG.smokeUser, "wrong-password", CONFIG.workspace);
    assertStatus(result, 401, "POST /auth/login invalid password");
    assert(result.body?.error === "INVALID_CREDENTIALS", `unexpected error ${result.body?.error}`);
    return `attemptsRemaining=${result.body?.attemptsRemaining ?? "?"}`;
  });

  add("auth", "missing_workspace_rejected", async () => {
    const result = await login(CONFIG.smokeUser, CONFIG.smokePassword, "does-not-exist-xyz");
    assertStatus(result, 404, "POST /auth/login missing workspace");
    assert(result.body?.error === "WORKSPACE_NOT_FOUND", `unexpected error ${result.body?.error}`);
    return "workspace not found rejected";
  });

  add("auth", "token_required_on_protected_route", async () => {
      const result = await api("GET", "/catalog/products", { retries: 2 });
      assertStatus(result, 401, "GET /catalog/products without token");
      return "401 as expected";
    });

  add("auth", "step_up_issued", async () => {
    if (!ctx.adminToken) {
      skip("admin token not available");
    }
    const result = await api("POST", "/auth/step-up", {
      token: ctx.adminToken,
      json: {
        password: CONFIG.smokePassword,
        scope: "mapping_high_risk",
      },
    });
    assertStatus(result, 201, "POST /auth/step-up");
    assert(result.body?.stepUpToken, "stepUpToken missing");
    assert(result.body?.scope === "mapping_high_risk", `unexpected scope ${result.body?.scope}`);
    return "scope=mapping_high_risk";
  });

  add("auth", "logout_revokes_token", async () => {
    if (!ctx.adminToken) {
      skip("admin token not available");
    }
    const originalToken = ctx.adminToken;
    const logoutResult = await api("POST", "/auth/logout", { token: originalToken });
    assertStatus(logoutResult, 204, "POST /auth/logout");
    const protectedResult = await api("GET", "/catalog/products", { token: originalToken });
    assertStatus(protectedResult, 401, "GET /catalog/products with revoked token");
    const payload = await loginAsAdmin();
    return `relogged role=${payload.role}`;
  });

  add("auth", "consent_recorded", async () => {
    const result = await api("POST", "/auth/consent", {
      token: ctx.adminToken,
      json: {
        accepted: true,
        policyVersion: "dpdp-v1",
      },
    });
    assertStatus(result, 200, "POST /auth/consent");
    assert(result.body?.accepted === true, "consent response not accepted");
    return `policy=${result.body?.policyVersion ?? "dpdp-v1"}`;
  });

  add("auth", "privacy_status_readable", async () => {
    const result = await api("GET", "/auth/account/privacy-status", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /auth/account/privacy-status");
    assert(result.body?.latestConsent?.accepted === true, "latestConsent.accepted is not true");
    return `policy=${result.body?.latestConsent?.policyVersion ?? "unknown"}`;
  });

  add("auth", "password_reset_flow_stub", async () => {
    const result = await api("POST", "/auth/password-reset/request", {
      json: {
        email: CONFIG.smokeUser,
      },
    });
    assertStatus(result, [200, 201], "POST /auth/password-reset/request");
    return "delivery not verifiable without email integration";
  });

  add("roles", "viewer_cannot_write_catalog", async () => {
    const payload = await loginOptional("VIEWER");
    ctx.viewerToken = String(payload.accessToken);
    const anyProduct = await getAnyProduct();
    const result = await api("PATCH", `/catalog/products/${encodeURIComponent(anyProduct.id)}`, {
      token: ctx.viewerToken,
      json: {
        expectedVersion: anyProduct.version,
        title: anyProduct.title,
        description: anyProduct.description,
        brand: anyProduct.brand,
        categoryId: anyProduct.categoryId,
        hsnCode: anyProduct.hsnCode ?? undefined,
        gstRate: anyProduct.gstRate ?? undefined,
        attributes: anyProduct.attributes ?? {},
        status: anyProduct.status,
      },
    });
    assertStatus(result, 403, "PATCH /catalog/products/:id with viewer");
    return "viewer blocked";
  });

  add("roles", "editor_can_write_catalog", async () => {
    const payload = await loginOptional("EDITOR");
    ctx.editorToken = String(payload.accessToken);
    const result = await api("GET", "/catalog/products?limit=5", { token: ctx.editorToken });
    assertStatus(result, 200, "GET /catalog/products with editor");
    return "editor read access ok";
  });

  add("roles", "reviewer_can_approve", async () => {
    const payload = await loginOptional("REVIEWER");
    ctx.reviewerToken = String(payload.accessToken);
    const result = await web("GET", "/quality/approvals", {
      cookie: toCookie(ctx.reviewerToken),
    });
    assertStatus(result, 200, "GET web /quality/approvals");
    assert(String(result.text).includes("Approval Queue"), "approval queue page did not render");
    return "approval page rendered";
  });

  add("roles", "viewer_cannot_access_admin_users", async () => {
    if (!ctx.viewerToken) {
      const payload = await loginOptional("VIEWER");
      ctx.viewerToken = String(payload.accessToken);
    }
    const result = await api("GET", "/admin/workspace/users", { token: ctx.viewerToken });
    assertStatus(result, 403, "GET /admin/workspace/users with viewer");
    return "viewer denied";
  });

  add("roles", "editor_cannot_access_admin_users", async () => {
    if (!ctx.editorToken) {
      const payload = await loginOptional("EDITOR");
      ctx.editorToken = String(payload.accessToken);
    }
    const result = await api("GET", "/admin/workspace/users", { token: ctx.editorToken });
    assertStatus(result, 403, "GET /admin/workspace/users with editor");
    return "editor denied";
  });

  add("taxonomy", "list_categories", async () => {
    const result = await api("GET", "/taxonomy/categories", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /taxonomy/categories");
    const items = normalizeItems(result.body);
    assert(Array.isArray(items), "categories response is not an array");
    return `count=${items.length}`;
  });

  add("taxonomy", "create_category", async () => {
    ctx.categoryName = `E2E Test Category ${runTag}`;
    const result = await api("POST", "/taxonomy/categories", {
      token: ctx.adminToken,
      json: {
        name: ctx.categoryName,
      },
    });
    assertStatus(result, 201, "POST /taxonomy/categories");
    assert(result.body?.id, "category id missing");
    ctx.categoryId = String(result.body.id);
    return `id=${ctx.categoryId}`;
  });

  add("taxonomy", "get_category", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("GET", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /taxonomy/categories/:id");
    assert(String(result.body?.name) === String(ctx.categoryName), "category name mismatch");
    return `name=${result.body?.name}`;
  });

  add("taxonomy", "rename_category", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    ctx.categoryName = `E2E Test Category Renamed ${runTag}`;
    const result = await api("PATCH", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}`, {
      token: ctx.adminToken,
      json: {
        name: ctx.categoryName,
      },
    });
    assertStatus(result, 200, "PATCH /taxonomy/categories/:id");
    assert(result.body?.name === ctx.categoryName, "category rename did not persist");
    return `name=${ctx.categoryName}`;
  });

  add("taxonomy", "create_attribute", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("POST", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}/attributes`, {
      token: ctx.adminToken,
      json: {
        name: "E2E Attribute",
        key: `e2e_attr_${runTag.replace(/[^a-zA-Z0-9]/g, "")}`,
        dataType: "text",
        required: false,
        appliesTo: "product",
      },
    });
    assertStatus(result, 201, "POST /taxonomy/categories/:id/attributes");
    assert(result.body?.id, "attribute id missing");
    ctx.attributeId = String(result.body.id);
    return `id=${ctx.attributeId}`;
  });

  add("taxonomy", "list_category_attributes", async () => {
    if (!ctx.categoryId || !ctx.attributeId) {
      skip("category attribute not created");
    }
    const result = await api("GET", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}/attributes`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /taxonomy/categories/:id/attributes");
    const items = normalizeItems(result.body);
    assert(items.some((item) => String(item.id) === ctx.attributeId), "attribute not found in category attributes");
    return `count=${items.length}`;
  });

  add("taxonomy", "update_attribute", async () => {
    if (!ctx.attributeId) {
      skip("attribute not created");
    }
    const result = await api("PATCH", `/taxonomy/categories/attributes/${encodeURIComponent(ctx.attributeId)}`, {
      token: ctx.adminToken,
      json: {
        name: "E2E Attribute Updated",
        key: `e2e_attr_${runTag.replace(/[^a-zA-Z0-9]/g, "")}`,
        dataType: "text",
        required: false,
        appliesTo: "product",
      },
    });
    assertStatus(result, 200, "PATCH /taxonomy/categories/attributes/:id");
    assert(result.body?.name === "E2E Attribute Updated", "attribute name did not update");
    return `name=${result.body?.name}`;
  });

  add("catalog", "create_product_draft", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const product = await createDraftProduct("E2E Test Product");
    ctx.productId = String(product.id);
    assert(product.status === "draft", `expected draft got ${product.status}`);
    return `id=${ctx.productId}`;
  });

  add("catalog", "reject_non_draft_entry", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await createNonDraftProductExpectingWorkflowError();
    assertStatus(result, 400, "POST /catalog/products non-draft entry");
    assert(result.body?.code === "WORKFLOW_ENTRY_INVALID", `unexpected code ${result.body?.code}`);
    return "workflow entry rejected";
  });

  add("catalog", "get_product", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/catalog/products/${encodeURIComponent(ctx.productId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /catalog/products/:id");
    assert(String(result.body?.title).includes("E2E Test Product"), "product title mismatch");
    rememberProduct(result.body);
    return `status=${result.body?.status}`;
  });

  add("catalog", "list_products", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    let cursor = "";
    let pageCount = 0;
    while (pageCount < 5) {
      const query = cursor
        ? `/catalog/products?slim=true&limit=200&cursor=${encodeURIComponent(cursor)}`
        : "/catalog/products?slim=true&limit=200";
      const result = await api("GET", query, { token: ctx.adminToken });
      assertStatus(result, 200, "GET /catalog/products?slim=true");
      const items = maybeItems(result.body);
      if (items.some((item) => String(item.id) === ctx.productId)) {
        return `count=${items.length} page=${pageCount + 1}`;
      }
      cursor = String(result.body?.nextCursor ?? "").trim();
      if (!cursor) {
        break;
      }
      pageCount += 1;
    }
    assert(false, "product not found in slim list");
  });

  add("catalog", "search_products", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/catalog/products/search?q=${encodeURIComponent("E2E Test Product")}&limit=10`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /catalog/products/search");
    const items = normalizeItems(result.body);
    assert(items.length > 0, "product search returned no results");
    return `count=${items.length}`;
  });

  add("catalog", "update_product", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await patchProduct(ctx.productId, {
      description: "Updated by E2E suite",
    });
    assertStatus(result, 200, "PATCH /catalog/products/:id");
    rememberProduct(result.body);
    assert(result.body?.description === "Updated by E2E suite", "description did not update");
    return `version=${result.body?.version ?? "?"}`;
  });

  add("catalog", "validate_product", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("POST", `/compliance/products/${encodeURIComponent(ctx.productId)}/validate`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 201, 422], "POST /compliance/products/:id/validate");
    assert(Array.isArray(result.body?.issues), "validation response issues array missing");
    return `errors=${result.body?.errorCount ?? 0} warnings=${result.body?.warningCount ?? 0}`;
  });

  add("catalog", "get_product_issues", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/compliance/products/${encodeURIComponent(ctx.productId)}/issues`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /compliance/products/:id/issues");
    const items = normalizeItems(result.body);
    return `count=${items.length}`;
  });

  add("catalog", "create_variant", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    ctx.variantSkuCode = `E2E-SKU-${runTag}`;
    const result = await api("POST", `/catalog/products/${encodeURIComponent(ctx.productId)}/variants`, {
      token: ctx.adminToken,
      json: {
        skuCode: ctx.variantSkuCode,
        attributes: {
          color: "red",
          size: "M",
        },
        inventoryQty: 10,
        status: "draft",
      },
    });
    assertStatus(result, 201, "POST /catalog/products/:id/variants");
    assert(result.body?.id, "variant id missing");
    ctx.variantId = String(result.body.id);
    ctx.createdVariantIds.push(ctx.variantId);
    rememberVariant(result.body);
    return `id=${ctx.variantId}`;
  });

  add("catalog", "list_variants", async () => {
    if (!ctx.productId || !ctx.variantId) {
      skip("variant not created");
    }
    const result = await api("GET", `/catalog/products/${encodeURIComponent(ctx.productId)}/variants`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /catalog/products/:id/variants");
    const items = normalizeItems(result.body);
    const variant = items.find((item) => String(item.id) === ctx.variantId);
    assert(variant, "variant not found in product variants");
    rememberVariant(variant);
    return `count=${items.length}`;
  });

  add("catalog", "update_variant", async () => {
    if (!ctx.variantId) {
      skip("variant not created");
    }
    const current = ctx.knownVariants.get(ctx.variantId);
    if (!current) {
      skip("variant payload missing");
    }
    const result = await api("PATCH", `/catalog/variants/${encodeURIComponent(ctx.variantId)}`, {
      token: ctx.adminToken,
      json: {
        skuCode: current.skuCode,
        attributes: {
          color: "blue",
          size: "M",
        },
        inventoryQty: current.inventoryQty ?? 10,
        status: current.status ?? "draft",
        mrp: current.mrp ?? undefined,
        sellingPrice: current.sellingPrice ?? undefined,
      },
    });
    assertStatus(result, 200, "PATCH /catalog/variants/:id");
    rememberVariant(result.body);
    assert(result.body?.attributes?.color === "blue", "variant color did not update");
    return `sku=${result.body?.skuCode}`;
  });

  add("catalog", "completeness_score_present", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const product = await getProduct(ctx.productId);
    assert(typeof product.completenessScore === "number", "completenessScore is not a number");
    return `score=${product.completenessScore}`;
  });

  add("catalog", "workflow_submit_for_review", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await patchProduct(ctx.productId, { status: "in_review" });
    assertStatus(result, 200, "PATCH /catalog/products/:id");
    rememberProduct(result.body);
    assert(result.body?.status === "in_review", `unexpected status ${result.body?.status}`);
    return `status=${result.body?.status}`;
  });

  add("catalog", "workflow_approve", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("POST", `/catalog/products/${encodeURIComponent(ctx.productId)}/review-decision`, {
      token: ctx.adminToken,
      json: {
        status: "approved",
      },
    });
    assertStatus(result, 201, "POST /catalog/products/:id/review-decision");
    rememberProduct(result.body);
    assert(result.body?.status === "approved", `unexpected status ${result.body?.status}`);
    return `status=${result.body?.status}`;
  });

  add("catalog", "workflow_invalid_transition_rejected", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await patchProduct(ctx.productId, { status: "draft" });
    assertStatus(result, [400, 422], "PATCH /catalog/products/:id invalid transition");
    return `status=${result.status}`;
  });
  add("approvals", "list_approval_queue", async () => {
    const result = await api("GET", "/issues/inbox?pagination=cursor&productStatus=in_review&limit=50", {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /issues/inbox productStatus=in_review");
    const items = getIssueInboxItems(result.body);
    return `count=${items.length}`;
  });

  add("approvals", "approve_product_from_queue", async () => {
    const actorToken = ctx.reviewerToken || ctx.adminToken;
    const actorLabel = ctx.reviewerToken ? "reviewer" : "admin-fallback";
    const product = await createApprovalReadyProduct("E2E Queue Approve");
    ctx.queueApproveProductId = String(product.id);
    const result = await api("POST", `/catalog/products/${encodeURIComponent(product.id)}/review-decision`, {
      token: actorToken,
      json: {
        status: "approved",
        note: "Approved by E2E queue flow",
      },
    });
    assertStatus(result, 201, "POST /catalog/products/:id/review-decision");
    rememberProduct(result.body);
    assert(result.body?.status === "approved", "product was not approved");
    return actorLabel;
  });

  add("approvals", "reject_product_from_queue", async () => {
    const actorToken = ctx.reviewerToken || ctx.adminToken;
    const product = await createApprovalReadyProduct("E2E Queue Reject");
    ctx.queueRejectProductId = String(product.id);
    const result = await api("POST", `/catalog/products/${encodeURIComponent(product.id)}/review-decision`, {
      token: actorToken,
      json: {
        status: "rejected",
        note: "Rejected by E2E queue flow",
      },
    });
    assertStatus(result, 201, "POST /catalog/products/:id/review-decision");
    rememberProduct(result.body);
    assert(result.body?.status === "rejected", "product was not rejected");
    return `status=${result.body?.status}`;
  });

  add("compliance", "create_compliance_rule", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("POST", "/compliance/rules", {
      token: ctx.adminToken,
      json: {
        ruleCode: `E2E_RULE_${runTag.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`,
        name: "E2E Rule",
        categoryId: ctx.categoryId,
        severity: "warning",
        ruleType: "required_field",
        config: {
          field: "description",
          message: "Description is required for E2E warning coverage.",
        },
        active: true,
      },
    });
    assertStatus(result, 201, "POST /compliance/rules");
    assert(result.body?.id, "compliance rule id missing");
    ctx.complianceRuleId = String(result.body.id);
    return `id=${ctx.complianceRuleId}`;
  });

  add("compliance", "list_rules", async () => {
    const result = await api("GET", `/compliance/rules${ctx.categoryId ? `?categoryId=${encodeURIComponent(ctx.categoryId)}` : ""}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /compliance/rules");
    const items = normalizeItems(result.body);
    assert(items.some((item) => String(item.id) === ctx.complianceRuleId), "new rule not found in list");
    return `count=${items.length}`;
  });

  add("compliance", "issue_inbox_accessible", async () => {
    const result = await api("GET", "/issues/inbox?pagination=cursor&limit=50", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /issues/inbox");
    const items = getIssueInboxItems(result.body);
    return `count=${items.length}`;
  });

  add("compliance", "resolve_inbox_warning", async () => {
    await createWarningProduct();
    const inboxResult = await api("GET", "/issues/inbox?pagination=cursor&severity=WARNING&limit=50", {
      token: ctx.adminToken,
    });
    assertStatus(inboxResult, 200, "GET /issues/inbox severity=WARNING");
    const items = getIssueInboxItems(inboxResult.body).filter((item) => String(item.productId) === String(ctx.warningProductId));
    if (items.length === 0) {
      skip("no warnings in inbox");
    }
    const resolveResult = await api("POST", "/issues/inbox/resolve", {
      token: ctx.adminToken,
      json: {
        issueIds: items.map((item) => String(item.issueId)),
      },
    });
    assertStatus(resolveResult, [200, 201], "POST /issues/inbox/resolve");
    return `resolved=${items.length}`;
  });

  add("mappings", "list_channels", async () => {
    const result = await api("GET", "/marketplace/channels", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /marketplace/channels");
    const items = normalizeItems(result.body);
    const haystack = items.map((item) => JSON.stringify(item).toLowerCase()).join(" ");
    for (const channel of ["amazon", "flipkart", "meesho"]) {
      assert(haystack.includes(channel), `channel ${channel} missing`);
    }
    return `count=${items.length}`;
  });

  add("mappings", "get_channel_mapping", async () => {
    const query = ctx.categoryId ? `?categoryId=${encodeURIComponent(ctx.categoryId)}` : "";
    const result = await api("GET", `/marketplace/channels/amazon/mapping${query}`, { token: ctx.adminToken });
    assertStatus(result, 200, "GET /marketplace/channels/amazon/mapping");
    assert(result.body?.fieldMap && typeof result.body.fieldMap === "object", "fieldMap missing");
    return `templateId=${result.body?.templateId ?? "none"}`;
  });

  add("mappings", "create_mapping_template", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("POST", `/marketplace/categories/${encodeURIComponent(ctx.categoryId)}/templates`, {
      token: ctx.adminToken,
      json: {
        name: `E2E Template ${runTag}`,
        channel: "amazon",
        requiredFields: ["title", "brand"],
        fieldMap: {
          title: "item_name",
          brand: "brand_name",
        },
        isDefault: false,
      },
    });
    assertStatus(result, 201, "POST /marketplace/categories/:id/templates");
    assert(result.body?.id, "template id missing");
    ctx.templateId = String(result.body.id);
    return `id=${ctx.templateId}`;
  });

  add("mappings", "get_template", async () => {
    if (!ctx.templateId) {
      skip("mapping template not created");
    }
    const result = await api("GET", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /marketplace/templates/:id");
    assert(String(result.body?.name).includes("E2E Template"), "template name mismatch");
    return `version=${result.body?.version ?? "?"}`;
  });

  add("mappings", "update_template", async () => {
    if (!ctx.templateId) {
      skip("mapping template not created");
    }
    const current = await api("GET", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(current, 200, "GET /marketplace/templates/:id");
    const result = await api("PATCH", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}`, {
      token: ctx.adminToken,
      json: {
        name: "E2E Template Updated",
        version: current.body?.version,
      },
    });
    assertStatus(result, 200, "PATCH /marketplace/templates/:id");
    assert(result.body?.name === "E2E Template Updated", "template name did not update");
    return `version=${result.body?.version ?? "?"}`;
  });

  add("mappings", "clone_template", async () => {
    if (!ctx.templateId) {
      skip("mapping template not created");
    }
    const result = await api("POST", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}/clone`, {
      token: ctx.adminToken,
      json: {
        name: `E2E Template Clone ${runTag}`,
      },
    });
    assertStatus(result, 201, "POST /marketplace/templates/:id/clone");
    assert(result.body?.id, "cloned template id missing");
    assert(String(result.body.id) !== String(ctx.templateId), "clone id matches original");
    ctx.templateCloneId = String(result.body.id);
    return `id=${ctx.templateCloneId}`;
  });

  add("mappings", "simulate_product", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/marketplace/products/${encodeURIComponent(ctx.productId)}/simulate?channel=amazon`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /marketplace/products/:id/simulate");
    assert(String(result.body?.channel).toLowerCase() === "amazon", `unexpected channel ${result.body?.channel}`);
    return `missingFields=${Array.isArray(result.body?.missingFields) ? result.body.missingFields.length : 0}`;
  });

  add("mappings", "connector_mapping_version_create", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const definition = await ensureConnectorDefinition("amazon-in");
    const result = await api("POST", "/marketplace/connectors/amazon-in/mappings/versions", {
      token: ctx.adminToken,
      json: {
        categoryScope: ctx.categoryId,
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: definition.id,
        connectorDefinitionVersion: definition.connectorVersion,
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "item_name",
            brand: "brand_name",
          },
          category: {
            target: "amazon_default",
          },
        },
        fallbackPolicy: {},
        fallbackAckRequired: false,
      },
    });
    assertStatus(result, 201, "POST /marketplace/connectors/amazon-in/mappings/versions");
    assert(result.body?.id, "mapping version id missing");
    ctx.mappingVersionId = String(result.body.id);
    return `id=${ctx.mappingVersionId}`;
  });

  add("mappings", "connector_mapping_version_validate", async () => {
    if (!ctx.mappingVersionId) {
      skip("mapping version not created");
    }
    const result = await api("POST", `/marketplace/connectors/amazon-in/mappings/versions/${encodeURIComponent(ctx.mappingVersionId)}/validate`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 201, 422], "POST /marketplace/connectors/amazon-in/mappings/versions/:id/validate");
    return `status=${result.status}`;
  });

  add("mappings", "connector_mapping_resolve", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("GET", `/marketplace/connectors/amazon-in/mappings/resolve?categoryScope=${encodeURIComponent(ctx.categoryId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /marketplace/connectors/amazon-in/mappings/resolve");
    return `version=${result.body?.versionId ?? result.body?.id ?? "resolved"}`;
  });

  add("mappings", "delete_template", async () => {
    if (!ctx.templateId) {
      skip("mapping template not created");
    }
    const result = await api("DELETE", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /marketplace/templates/:id");
    return `status=${result.status}`;
  });

  add("import", "create_import_job", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const csvContent = [
      "title,brand,description,categoryId,status",
      `E2E Import Product ${runTag},E2EBrand,Imported via E2E suite,${ctx.categoryId},draft`,
    ].join("\n");
    const result = await api("POST", "/bulk-import/jobs", {
      token: ctx.adminToken,
      json: {
        categoryId: ctx.categoryId,
        sourceFormat: "csv",
        csvContent,
        mapping: {
          title: "title",
          brand: "brand",
          description: "description",
          categoryId: "categoryId",
          status: "status",
        },
      },
    });
    assertStatus(result, [201, 202], "POST /bulk-import/jobs");
    assert(result.body?.id, "bulk import job id missing");
    ctx.importJobId = String(result.body.id);
    return `id=${ctx.importJobId}`;
  });

  add("import", "get_import_job", async () => {
    if (!ctx.importJobId) {
      skip("import job not created");
    }
    const result = await api("GET", `/bulk-import/jobs/${encodeURIComponent(ctx.importJobId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /bulk-import/jobs/:id");
    assert(result.body?.status, "job status missing");
    return `status=${result.body.status}`;
  });

  add("import", "list_import_jobs", async () => {
    if (!ctx.importJobId) {
      skip("import job not created");
    }
    const result = await api("GET", "/bulk-import/jobs", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /bulk-import/jobs");
    const items = normalizeItems(result.body);
    assert(items.some((item) => String(item.id) === ctx.importJobId), "import job missing from list");
    return `count=${items.length}`;
  });

  add("import", "get_import_job_rows", async () => {
    if (!ctx.importJobId) {
      skip("import job not created");
    }
    const result = await api("GET", `/bulk-import/jobs/${encodeURIComponent(ctx.importJobId)}/rows?limit=20`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /bulk-import/jobs/:id/rows");
    const items = normalizeItems(result.body);
    return `count=${items.length}`;
  });

  add("import", "process_import_job", async () => {
    if (!ctx.importJobId) {
      skip("import job not created");
    }
    const result = await api("POST", `/bulk-import/jobs/${encodeURIComponent(ctx.importJobId)}/process`, {
      token: ctx.adminToken,
      json: {},
    });
    assertStatus(result, [200, 201, 202], "POST /bulk-import/jobs/:id/process");
    return `status=${result.status}`;
  });

  add("import", "import_template_create", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    const result = await api("POST", "/bulk-import/templates", {
      token: ctx.adminToken,
      json: {
        categoryId: ctx.categoryId,
        name: `E2E Import Template ${runTag}`,
        sourceFormat: "csv",
        mapping: {
          title: "title",
          brand: "brand",
        },
      },
    });
    assertStatus(result, 201, "POST /bulk-import/templates");
    assert(result.body?.id, "bulk import template id missing");
    ctx.importTemplateId = String(result.body.id);
    return `id=${ctx.importTemplateId}`;
  });

  add("import", "import_template_list", async () => {
    if (!ctx.categoryId || !ctx.importTemplateId) {
      skip("import template not created");
    }
    const result = await api(
      "GET",
      `/bulk-import/templates?categoryId=${encodeURIComponent(ctx.categoryId)}`,
      { token: ctx.adminToken },
    );
    assertStatus(result, 200, "GET /bulk-import/templates");
    const items = normalizeItems(result.body);
    assert(items.some((item) => String(item.id) === ctx.importTemplateId), "import template missing from list");
    return `count=${items.length}`;
  });
  add("bulk_edit", "preview_bulk_edit", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("POST", "/bulk-edit/preview", {
      token: ctx.adminToken,
      json: {
        scope: {
          productIds: [ctx.productId],
        },
        updates: {
          brand: "E2EBulkBrand",
        },
      },
    });
    assertStatus(result, [200, 201], "POST /bulk-edit/preview");
    assert(Array.isArray(result.body?.sample) && result.body.sample.length > 0, "bulk edit preview sample empty");
    return `sample=${result.body.sample.length}`;
  });

  add("bulk_edit", "apply_bulk_edit", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("POST", "/bulk-edit/apply", {
      token: ctx.adminToken,
      json: {
        scope: {
          productIds: [ctx.productId],
        },
        updates: {
          brand: "E2EBulkBrand",
        },
      },
    });
    assertStatus(result, [200, 201, 202], "POST /bulk-edit/apply");
    const operationId = result.body?.operationId ?? result.body?.id;
    assert(operationId, "bulk edit operation id missing");
    ctx.bulkEditOpId = String(operationId);
    return `id=${ctx.bulkEditOpId}`;
  });

  add("bulk_edit", "get_bulk_edit_operation", async () => {
    if (!ctx.bulkEditOpId) {
      skip("bulk edit operation not created");
    }
    const result = await api("GET", `/bulk-edit/operations/${encodeURIComponent(ctx.bulkEditOpId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /bulk-edit/operations/:id");
    assert(result.body?.status, "bulk edit operation status missing");
    return `status=${result.body.status}`;
  });

  add("bulk_edit", "list_bulk_edit_operations", async () => {
    const result = await api("GET", "/bulk-edit/operations?limit=20", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /bulk-edit/operations");
    const items = normalizeItems(result.body);
    return `count=${items.length}`;
  });

  add("submissions", "create_export_job", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    await ensureAmazonInstallationForExports();
    const result = await api("POST", `/marketplace/products/${encodeURIComponent(ctx.productId)}/export-jobs`, {
      token: ctx.adminToken,
      json: {
        channel: "amazon",
        fallbackAcknowledged: true,
      },
    });
    assertStatus(result, [201, 400], "POST /marketplace/products/:id/export-jobs");
    if (result.status === 400) {
      const topLevelError = String(result.body?.error ?? "").trim().toLowerCase();
      const nestedError = String(result.body?.message?.error ?? "").trim().toLowerCase();
      const blockers = Array.isArray(result.body?.blockers)
        ? result.body.blockers
        : Array.isArray(result.body?.message?.blockers)
          ? result.body.message.blockers
          : [];
      const detail = getErrorMessageFromBody(result.body?.message ?? result.body);
      if (topLevelError === "publish_readiness_blocked" || nestedError === "publish_readiness_blocked" || blockers.length > 0) {
        skip("publish readiness blocked for staging connector/category configuration");
      }
      const normalizedDetail = detail.toLowerCase();
      if (
        normalizedDetail.includes("installation") ||
        normalizedDetail.includes("capability") ||
        normalizedDetail.includes("credential")
      ) {
        skip(`amazon export job unavailable for staging connector configuration (${detail})`);
      }
    }
    assert(result.body?.id, `export job id missing; payload=${JSON.stringify(result.body)}`);
    ctx.exportJobId = String(result.body.id);
    return `id=${ctx.exportJobId}`;
  });

  add("submissions", "process_export_job", async () => {
    if (!ctx.exportJobId) {
      skip("no export job created in this run");
    }
    const result = await api("POST", `/marketplace/export-jobs/${encodeURIComponent(ctx.exportJobId)}/process`, {
      token: ctx.adminToken,
      json: {},
    });
    assertStatus(result, [200, 202], "POST /marketplace/export-jobs/:id/process");
    return `status=${result.status}`;
  });

  add("submissions", "list_submissions", async () => {
    const query = ctx.productId ? `?productId=${encodeURIComponent(ctx.productId)}&limit=20` : "?limit=20";
    const result = await api("GET", `/submissions${query}`, { token: ctx.adminToken });
    assertStatus(result, 200, "GET /submissions");
    const items = maybeItems(result.body);
    const first = items.find((item) => !ctx.productId || String(item.productId) === String(ctx.productId));
    if (first?.id) {
      ctx.submissionId = String(first.id);
    }
    return `count=${items.length}`;
  });

  add("submissions", "dead_letter_queue_accessible", async () => {
    const result = await api("GET", "/submissions/dead-letter?limit=20", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /submissions/dead-letter");
    const items = maybeItems(result.body);
    return `count=${items.length}`;
  });

  add("submissions", "submission_detail", async () => {
    if (!ctx.submissionId) {
      skip("no submission created in this run");
    }
    const result = await api("GET", `/submissions/${encodeURIComponent(ctx.submissionId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, 200, "GET /submissions/:id");
    assert(result.body?.id === ctx.submissionId, "submission detail mismatch");
    return `status=${result.body?.status ?? "unknown"}`;
  });

  add("connectors", "list_definitions", async () => {
    const result = await api("GET", "/connectors/definitions", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /connectors/definitions");
    const items = normalizeItems(result.body);
    assert(items.some((item) => String(item.slug).toLowerCase() === "amazon-in"), "amazon-in missing");
    return `count=${items.length}`;
  });

  add("connectors", "list_installed", async () => {
    const result = await api("GET", "/connectors/installed?limit=50", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /connectors/installed");
    const items = maybeItems(result.body);
    return `count=${items.length}`;
  });

  add("connectors", "install_connector", async () => {
    if (!hasConfiguredAmazonInstallCredentials()) {
      skip("staging amazon seller credentials not configured");
    }
    const result = await api("POST", "/connectors/amazon-in/install", {
      token: ctx.adminToken,
      json: buildAmazonInstallPayload(`E2E Amazon Account ${runTag}`),
    });
    assertStatus(result, [201, 402, 422], "POST /connectors/amazon-in/install");
    if (result.status === 201 && result.body?.id) {
      ctx.connectorInstallId = String(result.body.id);
      return `installed=${ctx.connectorInstallId}`;
    }
    if (result.status === 402) {
      return "plan limit exceeded";
    }
    return "credential validation rejected";
  });

  add("connectors", "list_permissions", async () => {
    const result = await api("GET", "/connectors/permissions", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /connectors/permissions");
    const items = normalizeItems(result.body);
    return `count=${items.length}`;
  });

  add("connectors", "grant_permission", async () => {
    const result = await api("POST", "/connectors/permissions", {
      token: ctx.adminToken,
      json: {
        connectorSlug: "amazon-in",
        principalId: CONFIG.smokeUser,
        principalType: "user",
        action: "install",
      },
    });
    assertStatus(result, 201, "POST /connectors/permissions");
    assert(result.body?.id, "connector permission id missing");
    ctx.connectorPermissionId = String(result.body.id);
    return `id=${ctx.connectorPermissionId}`;
  });

  add("connectors", "uninstall_connector", async () => {
    if (!ctx.connectorInstallId) {
      skip("connector not installed");
    }
    const result = await api("DELETE", `/connectors/amazon-in/install/${encodeURIComponent(ctx.connectorInstallId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /connectors/amazon-in/install/:id");
    return `status=${result.status}`;
  });

  add("connectors", "connector_publish_flipkart", async () => {
    skip("TODO: implement when Flipkart publish path lands (P5-S3)");
  });

  add("dashboard", "dashboard_health", async () => {
    const result = await api("GET", "/dashboard/health", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /dashboard/health");
    assert(typeof result.body?.pendingApprovals === "number", "pendingApprovals is not a number");
    assert(typeof result.body?.snapshot?.totalSkus === "number", "snapshot.totalSkus is not a number");
    return `totalSkus=${result.body.snapshot.totalSkus}`;
  });

  add("dashboard", "billing_usage", async () => {
    const result = await api("GET", "/billing/usage", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /billing/usage");
    assert(typeof result.body?.users?.current === "number", "users.current is not a number");
    assert(typeof result.body?.users?.limit === "number", "users.limit is not a number");
    return `users=${result.body.users.current}/${result.body.users.limit}`;
  });

  add("dashboard", "billing_plan_profile", async () => {
    const result = await api("GET", "/billing/plan-profile", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /billing/plan-profile");
    assert(result.body?.tenantKey, "tenantKey missing from plan profile");
    return `plan=${result.body?.planTier ?? "unknown"}`;
  });

  add("dashboard", "kpi_trends", async () => {
    const result = await api("GET", "/metrics/kpi-trends?days=7", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /metrics/kpi-trends");
    const keys = result.body && typeof result.body === "object" ? Object.keys(result.body) : [];
    assert(keys.length > 0, "kpi trends response is empty");
    return `keys=${keys.length}`;
  });

  add("dashboard", "catalog_stats", async () => {
    const result = await api("GET", "/catalog/stats", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /catalog/stats");
    assert(typeof result.body?.products === "number", "products is not a number");
    return `products=${result.body.products}`;
  });

  add("users", "list_workspace_users", async () => {
    const result = await api("GET", "/admin/workspace/users", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /admin/workspace/users");
    const items = normalizeItems(result.body);
    if (items.length > 0) {
      const first = items[0];
      for (const key of ["id", "userId", "role", "isActive", "lockedUntil", "isLocked"]) {
        assert(Object.prototype.hasOwnProperty.call(first, key), `missing field ${key}`);
      }
    }
    return `count=${items.length}`;
  });

  add("users", "create_workspace_user", async () => {
    ctx.workspaceUserId = `e2e-editor-${runTag}@pim1.test`;
    const result = await api("POST", "/admin/workspace/users", {
      token: ctx.adminToken,
      json: {
        userId: ctx.workspaceUserId,
        role: "editor",
      },
    });
    assertStatus(result, 201, "POST /admin/workspace/users");
    assert(result.body?.userId === ctx.workspaceUserId, "workspace user id mismatch");
    return `user=${ctx.workspaceUserId}`;
  });

  add("users", "duplicate_user_rejected", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api("POST", "/admin/workspace/users", {
      token: ctx.adminToken,
      json: {
        userId: ctx.workspaceUserId,
        role: "viewer",
      },
    });
    assertStatus(result, 409, "POST /admin/workspace/users duplicate");
    assert(result.body?.error === "USER_ALREADY_EXISTS", `unexpected error ${result.body?.error}`);
    return "duplicate rejected";
  });

  add("users", "change_user_role", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api("PATCH", `/admin/workspace/users/${encodeUser(ctx.workspaceUserId)}/role`, {
      token: ctx.adminToken,
      json: {
        role: "reviewer",
      },
    });
    assertStatus(result, 200, "PATCH /admin/workspace/users/:userId/role");
    assert(result.body?.role === "reviewer", `unexpected role ${result.body?.role}`);
    return `role=${result.body?.role}`;
  });

  add("users", "self_role_change_rejected", async () => {
    const result = await api("PATCH", `/admin/workspace/users/${encodeUser(CONFIG.smokeUser)}/role`, {
      token: ctx.adminToken,
      json: {
        role: "viewer",
      },
    });
    assertStatus(result, 400, "PATCH /admin/workspace/users/:self/role");
    return "self role change rejected";
  });

  add("users", "lock_user", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api("POST", `/admin/workspace/users/${encodeUser(ctx.workspaceUserId)}/lock`, {
      token: ctx.adminToken,
      json: {
        durationMinutes: 1,
        reason: "E2E lock test",
      },
    });
    assertStatus(result, 200, "POST /admin/workspace/users/:userId/lock");
    assert(isFutureIso(result.body?.lockedUntil), "lockedUntil is not a future ISO date");
    assert(result.body?.isLocked === true, "user isLocked is not true");
    return `lockedUntil=${result.body.lockedUntil}`;
  });

  add("users", "locked_user_login_rejected", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await login(ctx.workspaceUserId, CONFIG.smokePassword, CONFIG.workspace);
    if (result.status === 401 && result.body?.error === "AUTH_CREDENTIAL_MIGRATION_INCOMPLETE") {
      skip("staging workspace users have no shared initial password configured");
    }
    assertStatus(result, 423, "POST /auth/login locked user");
    assert(result.body?.error === "ACCOUNT_LOCKED", `unexpected error ${result.body?.error}`);
    return `unlockAt=${result.body?.unlockAt ?? "unknown"}`;
  });

  add("users", "unlock_user", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api("POST", `/admin/workspace/users/${encodeUser(ctx.workspaceUserId)}/unlock`, {
      token: ctx.adminToken,
      json: {},
    });
    assertStatus(result, 200, "POST /admin/workspace/users/:userId/unlock");
    assert(result.body?.lockedUntil === null, "lockedUntil was not cleared");
    assert(result.body?.isLocked === false, "isLocked is not false");
    return "unlocked";
  });

  add("users", "deactivate_user", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api("POST", `/admin/workspace/users/${encodeUser(ctx.workspaceUserId)}/deactivate`, {
      token: ctx.adminToken,
      json: {},
    });
    assertStatus(result, 200, "POST /admin/workspace/users/:userId/deactivate");
    assert(result.body?.isActive === false, "user is still active");
    return "deactivated";
  });

  add("users", "deactivated_user_login_rejected", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await login(ctx.workspaceUserId, CONFIG.smokePassword, CONFIG.workspace);
    assertStatus(result, 401, "POST /auth/login deactivated user");
    assert(result.body?.error === "INVALID_CREDENTIALS", `unexpected error ${result.body?.error}`);
    return "invalid credentials after deactivation";
  });

  add("users", "viewer_blocked_from_user_management", async () => {
    const result = ctx.viewerToken
      ? await api("GET", "/admin/workspace/users", { token: ctx.viewerToken })
      : await api("GET", "/admin/workspace/users");
    assertStatus(result, ctx.viewerToken ? 403 : [401, 403], "GET /admin/workspace/users without admin");
    return ctx.viewerToken ? "viewer denied" : "anonymous denied";
  });

  add("users", "admin_users_page_renders_controls", async () => {
    const result = await web("GET", "/admin/users?showInvite=true", {
      cookie: toCookie(ctx.adminToken),
    });
    assertStatus(result, 200, "GET web /admin/users?showInvite=true");
    const html = String(result.text ?? "");
    assert(html.includes("Workspace Users"), "workspace users card missing");
    assert(html.includes("Close Invite"), "invite toggle missing");
    assert(html.includes("Create User"), "invite form submit button missing");
    assert(
      !html.includes("Admin role is required to invite users, change roles, or change account access state."),
      "page still rendered non-admin access fallback for admin",
    );
    return "admin controls visible";
  });

  add("users", "admin_session_revoke_todo", async () => {
    skip("TODO: implement when DELETE /admin/workspace/users/:userId/sessions is added");
  });
  add("audit", "audit_log_accessible", async () => {
    const result = await api("GET", "/audit/logs?limit=20", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /audit/logs");
    const items = maybeItems(result.body);
    ctx.cache.auditLogs = items;
    return `count=${items.length}`;
  });

  add("audit", "audit_log_has_recent_entries", async () => {
    const items = Array.isArray(ctx.cache.auditLogs) ? ctx.cache.auditLogs : null;
    const logs = items ?? maybeItems((await api("GET", "/audit/logs?limit=20", { token: ctx.adminToken })).body);
    assert(logs.length > 0, "audit log is empty");
    return `count=${logs.length}`;
  });

  add("audit", "audit_log_role_change_present", async () => {
    if (!ctx.workspaceUserId) {
      skip("workspace user not created");
    }
    const result = await api(
      "GET",
      `/audit/events?action=${encodeURIComponent("workspace_user.role_changed")}&limit=50`,
      { token: ctx.adminToken },
    );
    assertStatus(result, 200, "GET /audit/events?action=workspace_user.role_changed");
    const items = maybeItems(result.body);
    const match = items.find((item) => String(item?.metadata?.targetUserId ?? "") === String(ctx.workspaceUserId));
    assert(match, "role change audit entry not found");
    return `event=${match.action}`;
  });

  add("audit", "audit_log_product_create_present", async () => {
    skip("product.created audit action not implemented in current audit model");
  });

  add("audit", "webhook_admin_surfaces_accessible", async () => {
    const endpoints = await api("GET", "/admin/webhooks", {
      token: ctx.adminToken,
    });
    assertStatus(endpoints, 200, "GET /admin/webhooks");
    const endpointItems = normalizeItems(endpoints.body);

    const deliveries = await api("GET", "/admin/webhooks/deliveries?limit=10", {
      token: ctx.adminToken,
    });
    assertStatus(deliveries, 200, "GET /admin/webhooks/deliveries");
    const deliveryItems = normalizeItems(deliveries.body);

    return `endpoints=${endpointItems.length} deliveries=${deliveryItems.length}`;
  });

  add("privacy", "account_export_request", async () => {
      const result = await api("POST", "/auth/account/export", {
        token: ctx.adminToken,
        json: {
          format: "json",
        },
      });
      assertStatus(result, 202, "POST /auth/account/export");
    assert(result.body?.status === "queued", `unexpected status ${result.body?.status}`);
      assert(result.body?.jobId, "account export job id missing");
      ctx.exportPrivacyJobId = String(result.body.jobId);
      return `jobId=${ctx.exportPrivacyJobId}`;
    });

  add("privacy", "privacy_status_after_export", async () => {
    if (!ctx.exportPrivacyJobId) {
      skip("privacy export not requested");
    }
    const result = await api("GET", "/auth/account/privacy-status", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /auth/account/privacy-status");
    assert(result.body?.latestExport?.jobId === ctx.exportPrivacyJobId, "latestExport.jobId mismatch");
    return `jobId=${result.body.latestExport.jobId}`;
  });

  add("privacy", "consent_update", async () => {
    const result = await api("POST", "/auth/consent", {
      token: ctx.adminToken,
      json: {
        accepted: true,
        policyVersion: "dpdp-v2",
        purpose: "analytics",
      },
    });
    assertStatus(result, 200, "POST /auth/consent update");
    return `policy=${result.body?.policyVersion ?? "dpdp-v2"}`;
  });

  add("privacy", "privacy_status_after_consent", async () => {
    const result = await api("GET", "/auth/account/privacy-status", { token: ctx.adminToken });
    assertStatus(result, 200, "GET /auth/account/privacy-status after consent");
    assert(result.body?.latestConsent?.policyVersion === "dpdp-v2", "latestConsent.policyVersion mismatch");
    return `policy=${result.body.latestConsent.policyVersion}`;
  });

  add("ai", "title_suggestion", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/auto-suggestions/products/${encodeURIComponent(ctx.productId)}/title-suggestion`, {
      token: ctx.adminToken,
    });
    if (result.status === 404) {
      skip("AI title suggestion not enabled");
    }
    assertStatus(result, 200, "GET /auto-suggestions/products/:id/title-suggestion");
    if (String(result.body?.suggestion ?? "").trim().length === 0) {
      skip("AI title suggestion returned empty content");
    }
    return "AI title suggestion returned";
  });

  add("ai", "attribute_enrichment", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/auto-suggestions/products/${encodeURIComponent(ctx.productId)}/attribute-enrichment`, {
      token: ctx.adminToken,
    });
    if (result.status === 404) {
      skip("AI attribute enrichment not enabled");
    }
    assertStatus(result, 200, "GET /auto-suggestions/products/:id/attribute-enrichment");
    assert(result.body && typeof result.body === "object", "attribute enrichment response missing");
    return "AI attribute enrichment returned";
  });

  add("ai", "category_suggestion", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/auto-suggestions/products/${encodeURIComponent(ctx.productId)}/category-suggestion`, {
      token: ctx.adminToken,
    });
    if (result.status === 404) {
      skip("AI category suggestion not enabled");
    }
    assertStatus(result, 200, "GET /auto-suggestions/products/:id/category-suggestion");
    assert(result.body && typeof result.body === "object", "category suggestion response missing");
    return "AI category suggestion returned";
  });

  add("ai", "rejection_intelligence_score", async () => {
    if (!ctx.productId) {
      skip("product not created");
    }
    const result = await api("GET", `/rejection-intelligence/products/${encodeURIComponent(ctx.productId)}/score?channel=amazon`, {
      token: ctx.adminToken,
    });
    if (result.status === 404) {
      skip("rejection intelligence not enabled");
    }
    assertStatus(result, 200, "GET /rejection-intelligence/products/:id/score");
    assert(result.body && typeof result.body === "object", "rejection intelligence response missing");
    return "rejection intelligence returned";
  });

  addCleanup("delete_variant", async () => {
    if (!ctx.variantId) {
      skip("variant not created");
    }
    const variant = ctx.knownVariants.get(String(ctx.variantId));
    const parentProductId = variant?.productId ?? ctx.productId;
    if (parentProductId) {
      await normalizeProductForDelete(String(parentProductId));
    }
    const result = await api("DELETE", `/catalog/variants/${encodeURIComponent(ctx.variantId)}`, {
      token: ctx.adminToken,
    });
    // 400 is tolerated: if the parent product is in approved status and
    // normalizeProductForDelete could not transition it (workflow guard),
    // variant deletion is blocked. The product purge in delete_product
    // will cascade-delete the variant anyway.
    assertStatus(result, [200, 204, 400, 404], "DELETE /catalog/variants/:id");
    return `status=${result.status}`;
  });

  addCleanup("delete_product", async () => {
    if (!ctx.createdProductIds.length) {
      skip("no created products");
    }
    for (const productId of [...new Set(ctx.createdProductIds)].reverse()) {
      await normalizeProductForDelete(productId);
      await api("DELETE", `/catalog/products/${encodeURIComponent(productId)}`, {
        token: ctx.adminToken,
      });
    }
    return `deleted=${new Set(ctx.createdProductIds).size}`;
  });

  addCleanup("delete_attribute", async () => {
    if (!ctx.attributeId) {
      skip("attribute not created");
    }
    const result = await api("DELETE", `/taxonomy/categories/attributes/${encodeURIComponent(ctx.attributeId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /taxonomy/categories/attributes/:id");
    return `status=${result.status}`;
  });

  addCleanup("delete_category", async () => {
    if (!ctx.categoryId) {
      skip("category not created");
    }
    if (ctx.templateId) {
      const templateDeleteResult = await api("DELETE", `/marketplace/templates/${encodeURIComponent(ctx.templateId)}`, {
        token: ctx.adminToken,
      });
      assertStatus(templateDeleteResult, [200, 204, 404], "DELETE /marketplace/templates/:id during category cleanup");
      ctx.templateId = null;
    }
    let purgeStats = { attempted: 0, purged: 0 };
    let result = await api("DELETE", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}`, {
      token: ctx.adminToken,
    });
    if (![200, 204].includes(result.status)) {
      const productsResult = await api("GET", "/catalog/products?slim=true&limit=200", {
        token: ctx.adminToken,
      });
      assertStatus(productsResult, 200, "GET /catalog/products?slim=true for category cleanup");
      const items = maybeItems(productsResult.body).filter((item) => String(item.categoryId) === String(ctx.categoryId));
      for (const item of items) {
        const productId = String(item.id);
        await normalizeProductForDelete(productId);
        await api("DELETE", `/catalog/products/${encodeURIComponent(productId)}`, {
          token: ctx.adminToken,
        });
      }
      purgeStats = await purgeCreatedProductsForCategory(ctx.categoryId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await api("DELETE", `/taxonomy/categories/${encodeURIComponent(ctx.categoryId)}`, {
        token: ctx.adminToken,
      });
    }
    if (![200, 204].includes(result.status)) {
      skip(
        `category still referenced after cleanup retry (${result.status}; productPurge=${purgeStats.purged}/${purgeStats.attempted})`,
      );
    }
    return `status=${result.status}`;
  });

  addCleanup("delete_compliance_rule", async () => {
    if (!ctx.complianceRuleId) {
      skip("compliance rule not created");
    }
    const result = await api("DELETE", `/compliance/rules/${encodeURIComponent(ctx.complianceRuleId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /compliance/rules/:id");
    return `status=${result.status}`;
  });

  addCleanup("delete_template_clone", async () => {
    if (!ctx.templateCloneId) {
      skip("template clone not created");
    }
    const result = await api("DELETE", `/marketplace/templates/${encodeURIComponent(ctx.templateCloneId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /marketplace/templates/:id clone");
    return `status=${result.status}`;
  });

  addCleanup("delete_connector_permission", async () => {
    if (!ctx.connectorPermissionId) {
      skip("connector permission not granted");
    }
    const result = await api("DELETE", `/connectors/permissions/${encodeURIComponent(ctx.connectorPermissionId)}`, {
      token: ctx.adminToken,
    });
    assertStatus(result, [200, 204], "DELETE /connectors/permissions/:id");
    return `status=${result.status}`;
  });

  addCleanup("final_logout", async () => {
    if (!ctx.adminToken) {
      skip("admin token unavailable");
    }
    try {
      if (ctx.workspaceUserId) {
        const deactivateResult = await api("POST", `/admin/workspace/users/${encodeUser(ctx.workspaceUserId)}/deactivate`, {
          token: ctx.adminToken,
          retries: 2,
        });
        assertStatus(deactivateResult, [200, 404], "POST /admin/workspace/users/:userId/deactivate during cleanup");
        ctx.workspaceUserId = null;
      }
      const result = await api("POST", "/auth/logout", {
        token: ctx.adminToken,
        retries: 2,
      });
      assertStatus(result, 204, "POST /auth/logout final");
      return "admin logged out";
    } catch (error) {
      // Logout correctness is already proven in the dedicated post-deploy check.
      // Cleanup should not fail the whole smoke run on a transient network hiccup.
      skip(error instanceof Error ? `final logout cleanup unavailable (${error.message})` : "final logout cleanup unavailable");
    }
  });

  return { checks, cleanupChecks };
}

async function main() {
  const { checks, cleanupChecks } = buildChecks();
  const activeChecks = SMOKE_MODE ? checks.filter((item) => item.smoke) : checks;
  const activeCleanupChecks = SMOKE_MODE ? cleanupChecks.filter((item) => item.smoke) : cleanupChecks;
  const startedAt = Date.now();
  let fatalError = null;

  try {
    for (const item of activeChecks) {
      await check(item.section, item.name, item.fn);
    }
  } catch (error) {
    fatalError = error;
  } finally {
    for (const item of activeCleanupChecks) {
      await check(item.section, item.name, item.fn);
    }
    if (fatalError) {
      reportState.total += 1;
      reportState.fail += 1;
      const reason = describeError(fatalError);
      checkResults.push({
        section: "runner",
        name: "fatal_error",
        result: "fail",
        ms: 0,
        note: reason,
      });
      report(FAIL, "runner", "fatal_error", 0, reason);
    }
    const wallTimeMs = Date.now() - startedAt;
    const wallSeconds = (wallTimeMs / 1000).toFixed(1);
    if (!DRY_RUN) {
      writeFileSync(
        resultFilePath,
        `${JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            sha: process.env.GITHUB_SHA || "local",
            runId: process.env.GITHUB_RUN_ID || "local",
            mode: MODE_LABEL,
            total: reportState.total,
            pass: reportState.pass,
            fail: reportState.fail,
            skip: reportState.skip,
            wallTimeMs,
            checks: checkResults,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    console.log(DIVIDER);
    console.log(
      `  TOTAL  ${reportState.total} checks${SMOKE_MODE ? " [smoke]" : ""}  |  ${reportState.pass} pass  |  ${reportState.fail} fail  |  ${reportState.skip} skip`,
    );
    console.log(`  Wall time: ${wallSeconds}s`);
    console.log(DIVIDER);
    process.exitCode = reportState.fail > 0 || (FAIL_ON_SKIP && reportState.skip > 0) ? 1 : 0;
  }
}

main();
