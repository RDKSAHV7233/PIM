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
  const apiPort = 6400 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `rel-tenant-a-${runId}`;
  const tenantB = `rel-tenant-b-${runId}`;
  const workspaceSlugA = `rwa-${runId}`.slice(0, 24);
  const workspaceSlugB = `rwb-${runId}`.slice(0, 24);
  const adminA = `rel-admin-a-${runId}`;
  const adminB = `rel-admin-b-${runId}`;
  const viewerA = `rel-viewer-a-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [viewerA]: { tenantId: tenantA, role: "viewer", workspaceSlug: workspaceSlugA },
      [adminB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_TENANT_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Relationships A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Relationships B" },
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
    const [loginA, loginViewer, loginB] = await Promise.all([
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug: workspaceSlugA, userId: adminA, password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug: workspaceSlugA, userId: viewerA, password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
      apiRequest(baseUrl, "POST", "/auth/login", null, { workspaceSlug: workspaceSlugB, userId: adminB, password: "vexa-pim-demo-password", expiresInMinutes: 30 }),
    ]);
    assertStatus(loginA, 201, "admin A login");
    assertStatus(loginViewer, 201, "viewer A login");
    assertStatus(loginB, 201, "admin B login");
    const tokenA = String(loginA.payload.accessToken);
    const tokenViewer = String(loginViewer.payload.accessToken);
    const tokenB = String(loginB.payload.accessToken);

    // --- Taxonomy
    const [catA, catB] = await Promise.all([
      apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, { name: `Rel Cat A ${runId}` }),
      apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenB, { name: `Rel Cat B ${runId}` }),
    ]);
    assertStatus(catA, 201, "category A");
    assertStatus(catB, 201, "category B");

    // --- Products in tenant A
    const [parentRes, componentRes, otherTenantRes] = await Promise.all([
      apiRequest(baseUrl, "POST", "/catalog/products", tokenA, { title: `Bundle Parent ${runId}`, brand: "PIM", description: "d", categoryId: catA.payload.id, status: "draft", hsnCode: "62046200", gstRate: 18, attributes: {} }),
      apiRequest(baseUrl, "POST", "/catalog/products", tokenA, { title: `Bundle Component ${runId}`, brand: "PIM", description: "d", categoryId: catA.payload.id, status: "draft", hsnCode: "62046200", gstRate: 18, attributes: {} }),
      apiRequest(baseUrl, "POST", "/catalog/products", tokenB, { title: `Other Tenant Product ${runId}`, brand: "PIM", description: "d", categoryId: catB.payload.id, status: "draft", hsnCode: "62046200", gstRate: 18, attributes: {} }),
    ]);
    assertStatus(parentRes, 201, "parent product");
    assertStatus(componentRes, 201, "component product");
    assertStatus(otherTenantRes, 201, "other tenant product");

    const parentId = parentRes.payload.id;
    const componentId = componentRes.payload.id;
    const otherTenantProductId = otherTenantRes.payload.id;

    // --- Create relationship: bundle_component
    const createRel = await apiRequest(baseUrl, "POST", `/catalog/products/${parentId}/relationships`, tokenA, {
      targetProductId: componentId,
      type: "bundle_component",
      quantityInParent: 2,
      sortOrder: 1,
    });
    assertStatus(createRel, 201, "create bundle_component relationship");
    assert(createRel.payload.sourceProductId === parentId, "relationship sourceProductId correct");
    assert(createRel.payload.targetProductId === componentId, "relationship targetProductId correct");
    assert(createRel.payload.type === "bundle_component", "relationship type correct");
    assert(createRel.payload.quantityInParent === 2, "quantityInParent correct");
    const relId = createRel.payload.id;

    // --- Duplicate relationship rejected (409)
    const dupRel = await apiRequest(baseUrl, "POST", `/catalog/products/${parentId}/relationships`, tokenA, {
      targetProductId: componentId,
      type: "bundle_component",
    });
    assertStatus(dupRel, 409, "duplicate relationship rejected with 409");

    // --- Self-relationship rejected (400)
    const selfRel = await apiRequest(baseUrl, "POST", `/catalog/products/${parentId}/relationships`, tokenA, {
      targetProductId: parentId,
      type: "accessory",
    });
    assertStatus(selfRel, 400, "self-relationship rejected with 400");

    // --- List relationships
    const listRel = await apiRequest(baseUrl, "GET", `/catalog/products/${parentId}/relationships`, tokenA);
    assertStatus(listRel, 200, "list relationships");
    assert(Array.isArray(listRel.payload.outgoing), "outgoing is array");
    assert(Array.isArray(listRel.payload.incoming), "incoming is array");
    assert(listRel.payload.outgoing.some((r) => r.id === relId), "created relationship in outgoing list");

    // --- Viewer can list relationships
    const viewerList = await apiRequest(baseUrl, "GET", `/catalog/products/${parentId}/relationships`, tokenViewer);
    assertStatus(viewerList, 200, "viewer can list relationships");

    // --- Tenant isolation: tenant B cannot see tenant A's product relationships
    const tenantBList = await apiRequest(baseUrl, "GET", `/catalog/products/${parentId}/relationships`, tokenB);
    assert(tenantBList.status === 404 || (tenantBList.status === 200 && tenantBList.payload.outgoing.length === 0),
      "tenant B cannot access tenant A product relationships");

    // --- Cross-tenant relationship blocked: tenant A product → tenant B product
    const crossTenantRel = await apiRequest(baseUrl, "POST", `/catalog/products/${parentId}/relationships`, tokenA, {
      targetProductId: otherTenantProductId,
      type: "accessory",
    });
    assert(crossTenantRel.status === 400 || crossTenantRel.status === 404,
      "cross-tenant relationship must be blocked");

    // --- Delete relationship
    const deleteRel = await apiRequest(baseUrl, "DELETE", `/catalog/relationships/${relId}`, tokenA);
    assertStatus(deleteRel, 200, "delete relationship");
    assert(deleteRel.payload.deleted === true, "deleted flag set");

    // --- Deleted relationship no longer in list
    const afterDeleteList = await apiRequest(baseUrl, "GET", `/catalog/products/${parentId}/relationships`, tokenA);
    assertStatus(afterDeleteList, 200, "list after delete");
    assert(!afterDeleteList.payload.outgoing.some((r) => r.id === relId), "deleted relationship not in list");

    // --- Viewer cannot delete
    const createForDeleteTest = await apiRequest(baseUrl, "POST", `/catalog/products/${parentId}/relationships`, tokenA, {
      targetProductId: componentId,
      type: "accessory",
    });
    assertStatus(createForDeleteTest, 201, "create for delete-permission test");
    const relId2 = createForDeleteTest.payload.id;

    const viewerDelete = await apiRequest(baseUrl, "DELETE", `/catalog/relationships/${relId2}`, tokenViewer);
    assert(viewerDelete.status === 403 || viewerDelete.status === 401,
      "viewer cannot delete relationship");

    console.log(JSON.stringify({
      status: "ok",
      validated: [
        "rg_c4_create_bundle_component_relationship",
        "rg_c4_duplicate_relationship_rejected_409",
        "rg_c4_self_relationship_rejected_400",
        "rg_c4_list_outgoing_and_incoming",
        "rg_c4_viewer_can_list_relationships",
        "rg_c4_tenant_isolation_enforced",
        "rg_c4_cross_tenant_relationship_blocked",
        "rg_c4_delete_relationship",
        "rg_c4_viewer_cannot_delete",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    apiProcess.kill();
    await sleep(800);
  }
}

run().catch((error) => {
  console.error("[product-relationships.test] FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  try {
    if (stdoutBuffer.length > 0) { console.error("[product-relationships.test] stdout tail:"); console.error(stdoutBuffer.join("")); }
    if (stderrBuffer.length > 0) { console.error("[product-relationships.test] stderr tail:"); console.error(stderrBuffer.join("")); }
  } catch {}
  process.exit(1);
});
