#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * QA: Bulk Mapping Coverage via Tenant Default
 *
 * Validates that a single tenant_connector_default mapping version provides
 * effective coverage across MULTIPLE categories (the "bulk mapping" approach).
 *
 * Test matrix:
 *   1. Tenant default covers all categories via fallback resolution
 *   2. Unmapped-categories API reflects correct state at each stage
 *   3. Category-specific override takes precedence over tenant default
 *   4. Archiving category override falls back to tenant default
 *   5. System defaults merge under tenant default for all categories
 *   6. Mixed compatibility: blocked category does not contaminate siblings
 *   7. Batch readiness evaluates correctly under tenant default coverage
 *   8. Multiple categories resolved in sequence yield consistent results
 *   9. Tenant isolation: tenant B sees zero coverage from tenant A's default
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_SCOPE = "mapping_high_risk";
const DEFAULT_API_HEALTH_TIMEOUT_MS = REPO_ROOT.startsWith("/mnt/") ? 600_000 : 240_000;
const API_HEALTH_TIMEOUT_MS = Number.parseInt(
  process.env.PIM_INTEGRATION_API_HEALTH_TIMEOUT_MS || String(DEFAULT_API_HEALTH_TIMEOUT_MS),
  10,
);

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
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
    } catch { /* retry */ }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function issueStepUp(baseUrl, token) {
  const result = await apiRequest(baseUrl, "POST", "/auth/step-up", token, {
    password: getAuthPassword(),
    scope: STEP_UP_SCOPE,
  });
  assertStatus(result, 201, "issue step-up token");
  const stepUpToken = String(result.payload?.stepUpToken ?? "");
  assert(stepUpToken.length > 10, "missing step-up token");
  return stepUpToken;
}

async function createDraftVersion(baseUrl, token, connectorSlug, payload) {
  const result = await apiRequest(
    baseUrl, "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`,
    token, payload,
  );
  assertStatus(result, 201, `create mapping draft (${payload.mappingLevel} / ${payload.categoryScope})`);
  return result.payload;
}

async function validateMappingVersion(baseUrl, token, connectorSlug, versionId) {
  const result = await apiRequest(
    baseUrl, "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    token, {},
  );
  assertStatus(result, 201, "validate mapping version");
  return result.payload;
}

async function publishMappingVersion(baseUrl, token, connectorSlug, versionId) {
  const stepUpToken = await issueStepUp(baseUrl, token);
  const result = await apiRequest(
    baseUrl, "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    token, { confirm: true },
    { [STEP_UP_HEADER]: stepUpToken },
  );
  assertStatus(result, 201, "publish mapping version");
  return result.payload;
}

async function archiveMappingVersion(baseUrl, token, connectorSlug, versionId, reason) {
  const stepUpToken = await issueStepUp(baseUrl, token);
  const result = await apiRequest(
    baseUrl, "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/archive`,
    token, { reason },
    { [STEP_UP_HEADER]: stepUpToken },
  );
  assertStatus(result, 201, "archive mapping version");
  return result.payload;
}

async function resolveMapping(baseUrl, token, connectorSlug, categoryScope, installationId) {
  let route = `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/resolve?categoryScope=${encodeURIComponent(categoryScope)}`;
  if (installationId) route += `&installationId=${encodeURIComponent(installationId)}`;
  const result = await apiRequest(baseUrl, "GET", route, token);
  assertStatus(result, 200, `resolve mapping (${categoryScope})`);
  return result.payload;
}

async function preflightMapping(baseUrl, token, connectorSlug, categoryScope, opts = {}) {
  const result = await apiRequest(
    baseUrl, "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/preflight`,
    token,
    { categoryScope, fallbackAcknowledged: opts.fallbackAcknowledged ?? false, installationId: opts.installationId },
  );
  assertStatus(result, 201, `preflight mapping (${categoryScope})`);
  return result.payload;
}

async function listUnmapped(baseUrl, token, connectorSlug) {
  const result = await apiRequest(
    baseUrl, "GET",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/taxonomy/unmapped`,
    token,
  );
  assertStatus(result, 200, "list unmapped categories");
  return result.payload;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const passed = [];
const failed = [];

function pass(name) {
  passed.push(name);
  console.log(`  ✓ ${name}`);
}

function fail(name, error) {
  failed.push({ name, error: String(error) });
  console.error(`  ✗ ${name}: ${error}`);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7100 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `bulk-map-a-${runId}`;
  const tenantB = `bulk-map-b-${runId}`;
  const workspaceSlugA = `bulka-${runId}`.slice(0, 24);
  const workspaceSlugB = `bulkb-${runId}`.slice(0, 24);
  const userA = `bulk-map-user-a-${runId}`;
  const userB = `bulk-map-user-b-${runId}`;
  const connectorSlug = "flipkart";
  const CATEGORY_COUNT = 5;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Bulk Mapping A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Bulk Mapping B" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    console.log(`[bulk-coverage] waiting for API on port ${apiPort}...`);
    await waitForHealth(baseUrl, Number.isFinite(API_HEALTH_TIMEOUT_MS) ? API_HEALTH_TIMEOUT_MS : DEFAULT_API_HEALTH_TIMEOUT_MS);

    // ── Auth ──────────────────────────────────────────────────────────────
    const loginA = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userA, workspaceSlug: workspaceSlugA,
      password: getAuthPassword(), expiresInMinutes: 30,
    });
    assertStatus(loginA, 201, "login tenant A");
    const tokenA = String(loginA.payload?.accessToken ?? "");

    const loginB = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userB, workspaceSlug: workspaceSlugB,
      password: getAuthPassword(), expiresInMinutes: 30,
    });
    assertStatus(loginB, 201, "login tenant B");
    const tokenB = String(loginB.payload?.accessToken ?? "");

    // ── Seed: create N categories in tenant A ─────────────────────────────
    const categoryIds = [];
    for (let i = 0; i < CATEGORY_COUNT; i++) {
      const cat = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
        name: `Bulk QA Category ${i + 1} ${runId}`,
      });
      assertStatus(cat, 201, `create category ${i + 1}`);
      categoryIds.push(String(cat.payload.id));
    }

    // Also create a category in tenant B for isolation checks
    const catB = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenB, {
      name: `Bulk QA B Category ${runId}`,
    });
    assertStatus(catB, 201, "create tenant B category");
    const categoryIdB = String(catB.payload.id);

    // ── Install connector ─────────────────────────────────────────────────
    const installA = await apiRequest(baseUrl, "POST", `/connectors/${connectorSlug}/install`, tokenA, {
      accountAlias: `bulk-qa-${runId}`, externalAccountRef: `merchant-bulk-${runId}`,
    });
    assertStatus(installA, 201, "install connector tenant A");

    console.log("\n── Test 1: Before tenant default, all categories are unmapped ──");
    try {
      const unmappedBefore = await listUnmapped(baseUrl, tokenA, connectorSlug);
      const unmappedIds = unmappedBefore.map((c) => c.id);
      for (const catId of categoryIds) {
        assert(unmappedIds.includes(catId), `category ${catId} should be listed as unmapped`);
      }
      pass("all_categories_listed_as_unmapped_before_any_mapping");
    } catch (e) { fail("all_categories_listed_as_unmapped_before_any_mapping", e.message); }

    // ── Create + publish tenant default (the "bulk mapping") ──────────────
    console.log("\n── Test 2: Publish tenant default (bulk coverage) ──");
    const tenantDefault = await createDraftVersion(baseUrl, tokenA, connectorSlug, {
      categoryScope: "*",
      mappingLevel: "tenant_connector_default",
      connectorDefinitionId: connectorSlug,
      connectorDefinitionVersion: "1.0.0",
      compatibilityState: "compatible",
      mappingRules: {
        field_mappings: {
          title: "product_title",
          brand: "brand",
          description: "description",
          hsnCode: "hsn_code",
          gstRate: "gst_rate",
          "attributes.color": "color",
          "attributes.size": "size",
          "attributes.material": "material",
        },
      },
      fallbackPolicy: { enabled: true, warning_tag: "fallback_category_mapping" },
      fallbackAckRequired: false,
    });
    const tenantDefaultId = String(tenantDefault.id);
    await validateMappingVersion(baseUrl, tokenA, connectorSlug, tenantDefaultId);
    const tdPublish = await publishMappingVersion(baseUrl, tokenA, connectorSlug, tenantDefaultId);
    assert(tdPublish.published?.lifecycleState === "published", "tenant default not published");
    pass("tenant_default_published_successfully");

    // ── Test 3: Tenant default resolves for ALL categories ────────────────
    console.log("\n── Test 3: Tenant default resolves for all categories ──");
    try {
      for (const catId of categoryIds) {
        const resolved = await resolveMapping(baseUrl, tokenA, connectorSlug, catId);
        assert(
          resolved.resolvedMapping?.field_mappings?.title === "product_title",
          `category ${catId}: title mapping did not resolve from tenant default`,
        );
        assert(
          resolved.resolvedMapping?.field_mappings?.["attributes.color"] === "color",
          `category ${catId}: attribute mapping did not resolve from tenant default`,
        );
        assert(resolved.fallbackApplied === true, `category ${catId}: fallbackApplied should be true`);
        assert(resolved.compatibilityState === "compatible", `category ${catId}: should be compatible`);
      }
      pass(`tenant_default_resolves_for_all_${CATEGORY_COUNT}_categories`);
    } catch (e) { fail(`tenant_default_resolves_for_all_${CATEGORY_COUNT}_categories`, e.message); }

    // ── Test 4: System defaults merge under tenant default ────────────────
    console.log("\n── Test 4: System defaults merge under tenant default ──");
    try {
      const resolved = await resolveMapping(baseUrl, tokenA, connectorSlug, categoryIds[0]);
      assert(
        resolved.resolvedMapping?.field_mappings?.title === "product_title",
        "tenant default should override system default for title",
      );
      pass("system_defaults_merge_under_tenant_default");
    } catch (e) { fail("system_defaults_merge_under_tenant_default", e.message); }

    // ── Test 5: Preflight passes for all categories under tenant default ──
    console.log("\n── Test 5: Preflight passes for all categories ──");
    try {
      for (const catId of categoryIds) {
        const pf = await preflightMapping(baseUrl, tokenA, connectorSlug, catId);
        assert(pf.ok === true, `category ${catId}: preflight should pass`);
        assert(
          Array.isArray(pf.warnings) && pf.warnings.includes("fallback_mapping_applied"),
          `category ${catId}: should have fallback_mapping_applied warning`,
        );
      }
      pass(`preflight_passes_for_all_${CATEGORY_COUNT}_categories`);
    } catch (e) { fail(`preflight_passes_for_all_${CATEGORY_COUNT}_categories`, e.message); }

    // ── Test 6: Category-specific override takes precedence ───────────────
    console.log("\n── Test 6: Category-specific override takes precedence ──");
    const overrideCatId = categoryIds[0];
    let overrideVersionId;
    try {
      const overrideDraft = await createDraftVersion(baseUrl, tokenA, connectorSlug, {
        categoryScope: overrideCatId,
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: connectorSlug,
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "custom_category_title",
            brand: "custom_brand",
            description: "custom_desc",
          },
          category: { source: overrideCatId, target: overrideCatId },
        },
        fallbackPolicy: {},
        fallbackAckRequired: false,
      });
      overrideVersionId = String(overrideDraft.id);
      await validateMappingVersion(baseUrl, tokenA, connectorSlug, overrideVersionId);
      await publishMappingVersion(baseUrl, tokenA, connectorSlug, overrideVersionId);

      const resolvedOverride = await resolveMapping(baseUrl, tokenA, connectorSlug, overrideCatId);
      assert(
        resolvedOverride.resolvedMapping?.field_mappings?.title === "custom_category_title",
        "category override must take precedence over tenant default",
      );
      assert(resolvedOverride.fallbackApplied === false, "fallbackApplied must be false when category mapping exists");

      // Siblings still use tenant default
      const resolvedSibling = await resolveMapping(baseUrl, tokenA, connectorSlug, categoryIds[1]);
      assert(
        resolvedSibling.resolvedMapping?.field_mappings?.title === "product_title",
        "sibling category must still use tenant default",
      );
      assert(resolvedSibling.fallbackApplied === true, "sibling fallbackApplied must remain true");

      pass("category_override_takes_precedence_siblings_unaffected");
    } catch (e) { fail("category_override_takes_precedence_siblings_unaffected", e.message); }

    // ── Test 7: Unmapped categories list reflects override ────────────────
    console.log("\n── Test 7: Unmapped categories list updated after override ──");
    try {
      const unmappedAfterOverride = await listUnmapped(baseUrl, tokenA, connectorSlug);
      const unmappedIds = unmappedAfterOverride.map((c) => c.id);
      assert(!unmappedIds.includes(overrideCatId), "overridden category should NOT be in unmapped list");
      for (let i = 1; i < categoryIds.length; i++) {
        assert(unmappedIds.includes(categoryIds[i]), `category ${categoryIds[i]} should still be unmapped`);
      }
      pass("unmapped_list_reflects_category_override");
    } catch (e) { fail("unmapped_list_reflects_category_override", e.message); }

    // ── Test 8: Archive override falls back to tenant default ─────────────
    console.log("\n── Test 8: Archive override → fallback to tenant default ──");
    try {
      await archiveMappingVersion(baseUrl, tokenA, connectorSlug, overrideVersionId, "testing archive fallback");
      const resolvedAfterArchive = await resolveMapping(baseUrl, tokenA, connectorSlug, overrideCatId);
      assert(
        resolvedAfterArchive.resolvedMapping?.field_mappings?.title === "product_title",
        "after archiving override, tenant default must cover category again",
      );
      assert(resolvedAfterArchive.fallbackApplied === true, "fallbackApplied must be true after archive");
      pass("archive_override_falls_back_to_tenant_default");
    } catch (e) { fail("archive_override_falls_back_to_tenant_default", e.message); }

    // ── Test 9: Blocked category does not contaminate siblings ────────────
    console.log("\n── Test 9: Blocked category does not contaminate siblings ──");
    const blockedCatId = categoryIds[2];
    try {
      const blockedDraft = await createDraftVersion(baseUrl, tokenA, connectorSlug, {
        categoryScope: blockedCatId,
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: connectorSlug,
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "blocked",
        mappingRules: {
          field_mappings: { title: "blocked_title", brand: "blocked_brand" },
          category: { source: blockedCatId, target: blockedCatId },
        },
        fallbackPolicy: {},
        fallbackAckRequired: false,
      });
      await validateMappingVersion(baseUrl, tokenA, connectorSlug, String(blockedDraft.id));
      await publishMappingVersion(baseUrl, tokenA, connectorSlug, String(blockedDraft.id));

      // Blocked category should be blocked
      const blockedPf = await preflightMapping(baseUrl, tokenA, connectorSlug, blockedCatId);
      assert(blockedPf.ok === false, "blocked category preflight must fail");
      assert(
        blockedPf.blockers.includes("mapping_compatibility_blocked"),
        "blocked category must have compatibility blocker",
      );

      // Sibling categories must still be compatible
      for (const siblingId of [categoryIds[1], categoryIds[3], categoryIds[4]]) {
        const siblingPf = await preflightMapping(baseUrl, tokenA, connectorSlug, siblingId);
        assert(siblingPf.ok === true, `sibling ${siblingId}: preflight must pass despite blocked sibling`);
      }
      pass("blocked_category_does_not_contaminate_siblings");
    } catch (e) { fail("blocked_category_does_not_contaminate_siblings", e.message); }

    // ── Test 10: Multiple sequential resolutions are consistent ───────────
    console.log("\n── Test 10: Sequential resolution consistency ──");
    try {
      const results = [];
      for (const catId of [categoryIds[1], categoryIds[3], categoryIds[4]]) {
        const r = await resolveMapping(baseUrl, tokenA, connectorSlug, catId);
        results.push(r);
      }
      for (const r of results) {
        assert(r.compatibilityState === "compatible", "all non-blocked categories must be compatible");
        assert(r.resolvedMapping?.field_mappings?.title === "product_title", "all must resolve tenant default title");
        assert(r.resolvedMapping?.field_mappings?.brand === "brand", "all must resolve tenant default brand");
      }
      pass("sequential_resolution_yields_consistent_results");
    } catch (e) { fail("sequential_resolution_yields_consistent_results", e.message); }

    // ── Test 11: Tenant isolation — B sees zero mapping coverage ──────────
    console.log("\n── Test 11: Tenant isolation ──");
    try {
      const versionsB = await apiRequest(
        baseUrl, "GET",
        `/marketplace/connectors/${connectorSlug}/mappings/versions?categoryScope=*&includeArchived=true`,
        tokenB,
      );
      assertStatus(versionsB, 200, "tenant B version listing");
      assert(Array.isArray(versionsB.payload), "tenant B must return array");
      assert(versionsB.payload.length === 0, "tenant B must see zero mapping versions from tenant A");

      // Tenant B resolution should only have system defaults
      const resolvedB = await resolveMapping(baseUrl, tokenB, connectorSlug, categoryIdB);
      assert(
        resolvedB.resolvedMapping?.field_mappings?.title === "product_title",
        "tenant B must only see system default (Flipkart system default title is product_title)",
      );
      assert(resolvedB.matchedVersions.length === 0, "tenant B must have zero matched versions");

      pass("tenant_isolation_no_cross_tenant_mapping_leakage");
    } catch (e) { fail("tenant_isolation_no_cross_tenant_mapping_leakage", e.message); }

    // ── Test 12: Validation rejects default mapping with non-* scope ──────
    console.log("\n── Test 12: Validation: default mapping requires scope=* ──");
    try {
      const badDefault = await apiRequest(
        baseUrl, "POST",
        `/marketplace/connectors/${connectorSlug}/mappings/versions`,
        tokenA,
        {
          categoryScope: categoryIds[0],
          mappingLevel: "tenant_connector_default",
          connectorDefinitionId: connectorSlug,
          connectorDefinitionVersion: "1.0.0",
          mappingRules: { field_mappings: { title: "t" } },
        },
      );
      assert(badDefault.status === 400, "creating default with non-* scope must fail with 400");
      assert(
        badDefault.payload?.details?.includes("tenant_connector_default_requires_global_scope"),
        "error must include tenant_connector_default_requires_global_scope",
      );
      pass("validation_rejects_default_mapping_with_specific_scope");
    } catch (e) { fail("validation_rejects_default_mapping_with_specific_scope", e.message); }

    // ── Test 13: Validation rejects category mapping with scope=* ─────────
    console.log("\n── Test 13: Validation: category mapping rejects scope=* ──");
    try {
      const badCategory = await apiRequest(
        baseUrl, "POST",
        `/marketplace/connectors/${connectorSlug}/mappings/versions`,
        tokenA,
        {
          categoryScope: "*",
          mappingLevel: "tenant_connector_category_mapping",
          connectorDefinitionId: connectorSlug,
          connectorDefinitionVersion: "1.0.0",
          mappingRules: {
            field_mappings: { title: "t" },
            category: { source: "*", target: "*" },
          },
        },
      );
      assert(badCategory.status === 400, "creating category mapping with * scope must fail with 400");
      assert(
        badCategory.payload?.details?.includes("tenant_connector_category_mapping_requires_specific_scope"),
        "error must include tenant_connector_category_mapping_requires_specific_scope",
      );
      pass("validation_rejects_category_mapping_with_global_scope");
    } catch (e) { fail("validation_rejects_category_mapping_with_global_scope", e.message); }

    // ── Test 14: Validation rejects empty field mappings ──────────────────
    console.log("\n── Test 14: Validation: empty field_mappings rejected ──");
    try {
      const emptyFields = await apiRequest(
        baseUrl, "POST",
        `/marketplace/connectors/${connectorSlug}/mappings/versions`,
        tokenA,
        {
          categoryScope: categoryIds[3],
          mappingLevel: "tenant_connector_category_mapping",
          connectorDefinitionId: connectorSlug,
          connectorDefinitionVersion: "1.0.0",
          mappingRules: {
            field_mappings: {},
            category: { source: categoryIds[3], target: categoryIds[3] },
          },
        },
      );
      assert(emptyFields.status === 400, "empty field_mappings must fail with 400");
      assert(
        emptyFields.payload?.details?.includes("field_mappings_required"),
        "error must include field_mappings_required",
      );
      pass("validation_rejects_empty_field_mappings");
    } catch (e) { fail("validation_rejects_empty_field_mappings", e.message); }

    // ── Test 15: Second tenant default supersedes first ───────────────────
    console.log("\n── Test 15: Updated tenant default supersedes previous ──");
    try {
      const updatedDefault = await createDraftVersion(baseUrl, tokenA, connectorSlug, {
        categoryScope: "*",
        mappingLevel: "tenant_connector_default",
        connectorDefinitionId: connectorSlug,
        connectorDefinitionVersion: "2.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "updated_title_v2",
            brand: "updated_brand_v2",
            description: "updated_desc_v2",
            hsnCode: "hsn_code",
            gstRate: "gst_rate",
          },
        },
        fallbackPolicy: { enabled: true },
        fallbackAckRequired: false,
      });
      const updatedId = String(updatedDefault.id);
      await validateMappingVersion(baseUrl, tokenA, connectorSlug, updatedId);
      const pubResult = await publishMappingVersion(baseUrl, tokenA, connectorSlug, updatedId);

      assert(
        Array.isArray(pubResult.superseded) && pubResult.superseded.includes(tenantDefaultId),
        "publishing new default must supersede old default",
      );

      // All non-blocked, non-overridden categories now use the updated default
      for (const catId of [categoryIds[1], categoryIds[3], categoryIds[4]]) {
        const resolved = await resolveMapping(baseUrl, tokenA, connectorSlug, catId);
        assert(
          resolved.resolvedMapping?.field_mappings?.title === "updated_title_v2",
          `category ${catId}: must resolve to updated default v2`,
        );
      }
      pass("updated_tenant_default_supersedes_and_propagates_to_all_categories");
    } catch (e) { fail("updated_tenant_default_supersedes_and_propagates_to_all_categories", e.message); }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log("\n════════════════════════════════════════════════════");
    console.log(`  Bulk Mapping Coverage QA: ${passed.length} passed, ${failed.length} failed`);
    console.log("════════════════════════════════════════════════════");
    if (failed.length > 0) {
      console.log("\nFailed tests:");
      for (const f of failed) {
        console.log(`  ✗ ${f.name}: ${f.error}`);
      }
    }

    console.log(
      JSON.stringify({
        status: failed.length === 0 ? "ok" : "FAILED",
        tenantA,
        tenantB,
        categoryCount: CATEGORY_COUNT,
        passed: passed,
        failed: failed.map((f) => f.name),
        validated: passed,
        checkedAt: new Date().toISOString(),
      }, null, 2),
    );

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (!apiProcess.killed) apiProcess.kill("SIGTERM");
    await sleep(500);
    if (!apiProcess.killed) apiProcess.kill("SIGKILL");
  }
}

run().catch((error) => {
  console.error("[connector-mapping-bulk-coverage.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
