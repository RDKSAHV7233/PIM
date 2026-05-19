#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
let stdoutBuffer = [];
let stderrBuffer = [];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6500 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `wf-tenant-${runId}`;
  const workspaceSlug = `wfs-${runId}`.slice(0, 24);
  const adminId = `wf-admin-${runId}`;
  const editorId = `wf-editor-${runId}`;
  const reviewerId = `wf-reviewer-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminId]:    { tenantId: tenantA, role: "admin",    workspaceSlug },
      [editorId]:   { tenantId: tenantA, role: "editor",   workspaceSlug },
      [reviewerId]: { tenantId: tenantA, role: "reviewer", workspaceSlug },
    }),
    PIM_TENANT_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId: tenantA, displayName: "Workflow SLA Test" },
    }),
  };

  const apiProcess = spawn("node", [API_ENTRY], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  stdoutBuffer = [];
  stderrBuffer = [];
  apiProcess.stdout.on("data", (chunk) => { stdoutBuffer.push(String(chunk)); if (stdoutBuffer.length > 200) stdoutBuffer.shift(); });
  apiProcess.stderr.on("data", (chunk) => { stderrBuffer.push(String(chunk)); if (stderrBuffer.length > 200) stderrBuffer.shift(); });

  try {
    await waitForHealth(baseUrl, 60_000);

    // --- Auth
    const [loginAdmin, loginEditor, loginReviewer] = await Promise.all([
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug, userId: adminId,    password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug, userId: editorId,   password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug, userId: reviewerId, password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
    ]);
    assertStatus(loginAdmin,    201, "admin login");
    assertStatus(loginEditor,   201, "editor login");
    assertStatus(loginReviewer, 201, "reviewer login");
    const tokenAdmin    = String(loginAdmin.payload.accessToken);
    const tokenEditor   = String(loginEditor.payload.accessToken);
    const tokenReviewer = String(loginReviewer.payload.accessToken);

    // --- Taxonomy + Product
    const catRes = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenAdmin, { name: `WF Cat ${runId}` });
    assertStatus(catRes, 201, "create category");

    const productRes = await apiRequest(baseUrl, "POST", "/catalog/products", tokenAdmin, {
      title: `Workflow Test Product ${runId}`,
      brand: "PIM",
      description: "workflow collab test",
      categoryId: catRes.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(productRes, 201, "create product");
    const productId = productRes.payload.id;

    // ─── SLA CONFIGURATION ────────────────────────────────────────────────────

    // Admin can upsert SLA config (3 → 5 days)
    const slaUpsert = await apiRequest(baseUrl, "PUT", "/catalog/workflow/sla", tokenAdmin, { reviewTargetDays: 5 });
    assertStatus(slaUpsert, 200, "upsert SLA config");
    assert(slaUpsert.payload.reviewTargetDays === 5, "SLA config returns correct reviewTargetDays");

    // Admin can read SLA config
    const slaGet = await apiRequest(baseUrl, "GET", "/catalog/workflow/sla", tokenAdmin);
    assertStatus(slaGet, 200, "get SLA config");
    assert(slaGet.payload.reviewTargetDays === 5, "SLA GET returns correct reviewTargetDays");

    // Reviewer cannot upsert SLA (admin-only endpoint — should be 403 or 401)
    const slaReviewerUpsert = await apiRequest(baseUrl, "PUT", "/catalog/workflow/sla", tokenReviewer, { reviewTargetDays: 1 });
    assert(slaReviewerUpsert.status === 403 || slaReviewerUpsert.status === 401, "reviewer cannot upsert SLA");

    // Overdue count — should be 0 before any in_review transitions
    const overdueRes = await apiRequest(baseUrl, "GET", "/catalog/workflow/sla/overdue", tokenAdmin);
    assertStatus(overdueRes, 200, "overdue count");
    assert(typeof overdueRes.payload.count === "number", "overdue returns count");
    assert(overdueRes.payload.count === 0, "overdue count is 0 before any reviews");

    // ─── ASSIGNEE ─────────────────────────────────────────────────────────────

    const assignRes = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productId}/assignee`, tokenAdmin, {
      assigneeId: editorId,
    });
    assertStatus(assignRes, 200, "assign product to editor");
    assert(assignRes.payload.assigneeId === editorId, "assigneeId set correctly");

    // Unassign
    const unassignRes = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productId}/assignee`, tokenAdmin, {
      assigneeId: null,
    });
    assertStatus(unassignRes, 200, "unassign product");
    assert(unassignRes.payload.assigneeId === null, "assigneeId cleared");

    // ─── CHANGE REQUESTS ──────────────────────────────────────────────────────

    // Transition product to in_review to enable change requests
    const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productId}`, tokenEditor, {
      status: "in_review",
    });
    assertStatus(toReview, 200, "transition to in_review");
    // slaDeadlineAt should be set when transitioning to in_review (5-day SLA configured above)
    assert(toReview.payload.slaDeadlineAt != null, "slaDeadlineAt set on in_review transition");
    const deadline = new Date(toReview.payload.slaDeadlineAt);
    const now = Date.now();
    const expectedDeadlineApprox = now + 5 * 24 * 60 * 60 * 1000;
    assert(Math.abs(deadline.getTime() - expectedDeadlineApprox) < 60_000, "slaDeadlineAt is approx 5 days from now");

    // Reviewer creates change request
    const crCreate = await apiRequest(baseUrl, "POST", `/catalog/products/${productId}/change-requests`, tokenReviewer, {
      reason: "Please fix the product description — missing key details.",
    });
    assertStatus(crCreate, 201, "create change request");
    assert(crCreate.payload.reason === "Please fix the product description — missing key details.", "change request reason correct");
    assert(crCreate.payload.status === "open", "change request status is open");
    const crId = crCreate.payload.id;

    // List change requests — admin, editor, reviewer can all read
    const crListAdmin    = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/change-requests`, tokenAdmin);
    const crListEditor   = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/change-requests`, tokenEditor);
    const crListReviewer = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/change-requests`, tokenReviewer);
    assertStatus(crListAdmin,    200, "admin list change requests");
    assertStatus(crListEditor,   200, "editor list change requests");
    assertStatus(crListReviewer, 200, "reviewer list change requests");
    assert(crListAdmin.payload.some((cr) => cr.id === crId), "change request appears in list");

    // Resolve change request (admin)
    const crResolve = await apiRequest(baseUrl, "POST", `/catalog/products/${productId}/change-requests/${crId}/resolve`, tokenAdmin);
    assertStatus(crResolve, 200, "resolve change request");
    assert(crResolve.payload.status === "resolved", "change request status is resolved after resolve");

    // Resolved change request shows in list with resolved status
    const crListAfter = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/change-requests`, tokenAdmin);
    assertStatus(crListAfter, 200, "list after resolve");
    const resolvedCr = crListAfter.payload.find((cr) => cr.id === crId);
    assert(resolvedCr, "resolved change request still in list");
    assert(resolvedCr.status === "resolved", "change request status is resolved in list");

    // ─── OVERDUE COUNT after SLA with short window ─────────────────────────────
    // This product transitioned to in_review with a 5-day SLA, so it should NOT be overdue yet
    const overdueAfter = await apiRequest(baseUrl, "GET", "/catalog/workflow/sla/overdue", tokenAdmin);
    assertStatus(overdueAfter, 200, "overdue count after in_review");
    assert(overdueAfter.payload.count === 0, "product with future deadline is not overdue");

    console.log(JSON.stringify({
      status: "ok",
      validated: [
        "rg_c5_sla_upsert_returns_correct_days",
        "rg_c5_sla_get_returns_config",
        "rg_c5_reviewer_cannot_mutate_sla",
        "rg_c5_overdue_count_zero_before_review",
        "rg_c5_assignee_set_and_cleared",
        "rg_c5_transition_to_in_review_sets_sla_deadline",
        "rg_c5_sla_deadline_is_5_days_from_now",
        "rg_c5_change_request_create_open",
        "rg_c5_change_request_list_readable_by_all_roles",
        "rg_c5_change_request_resolve",
        "rg_c5_overdue_count_zero_for_future_deadline",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    apiProcess.kill();
    await sleep(800);
  }
}

run().catch((error) => {
  console.error("[workflow-collab-sla.test] FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  try {
    if (stdoutBuffer.length > 0) { console.error("[workflow-collab-sla.test] stdout tail:"); console.error(stdoutBuffer.join("")); }
    if (stderrBuffer.length > 0) { console.error("[workflow-collab-sla.test] stderr tail:"); console.error(stderrBuffer.join("")); }
  } catch {}
  process.exit(1);
});
