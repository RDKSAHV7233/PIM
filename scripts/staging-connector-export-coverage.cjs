#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const API_PREFIX = "/api/v1";
const RESULT_DIR = path.join(process.cwd(), ".run-logs");
const RESULT_PATH = path.join(
  RESULT_DIR,
  `res-02-connector-export-coverage-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

function normalizeApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.toLowerCase().endsWith(API_PREFIX)) {
    url.pathname = `${pathname === "/" ? "" : pathname}${API_PREFIX}`;
  }
  return url.toString().replace(/\/+$/, "");
}

function readEnv(name, required = true) {
  const value = String(process.env[name] ?? "").trim();
  if (required && !value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const CONFIG = {
  baseUrl: normalizeApiBaseUrl(readEnv("STAGING_BASE_URL")),
  workspace: readEnv("STAGING_SMOKE_WORKSPACE"),
  user: readEnv("STAGING_SMOKE_USER"),
  password: readEnv("STAGING_SMOKE_PASSWORD"),
  expectedEnv: String(process.env.STAGING_EXPECTED_ENV ?? "staging").trim().toLowerCase(),
  failOnBlocked: String(process.env.RES02_FAIL_ON_BLOCKED ?? "true").trim().toLowerCase() !== "false",
  processJobs: String(process.env.RES02_PROCESS_EXPORT_JOBS ?? "true").trim().toLowerCase() !== "false",
  allowedConnectorSlugs: String(process.env.RES02_ALLOWED_CONNECTOR_SLUGS ?? "shopify,woocommerce")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
};

const runTag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const state = {
  token: "",
  categoryId: "",
  selectedConnector: null,
  products: [],
  exportJobIds: [],
  submissionIds: [],
};
const results = [];

function record(status, label, detail = "", evidence = {}) {
  const normalizedStatus = status.toUpperCase();
  const entry = {
    status: normalizedStatus,
    label,
    detail: String(detail ?? ""),
    evidence,
  };
  results.push(entry);
  const marker = normalizedStatus.padEnd(7, " ");
  const suffix = entry.detail ? `  ${entry.detail}` : "";
  const output = `  ${marker} ${label}${suffix}`;
  if (normalizedStatus === "FAIL") {
    console.error(output);
  } else {
    console.log(output);
  }
}

function pass(label, detail = "", evidence = {}) {
  record("PASS", label, detail, evidence);
}

function fail(label, detail = "", evidence = {}) {
  record("FAIL", label, detail, evidence);
}

function blocked(label, detail = "", evidence = {}) {
  record("BLOCKED", label, detail, evidence);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function scrubText(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/accessToken["']?\s*:\s*["'][^"']+["']/g, 'accessToken:"[REDACTED]"')
    .slice(0, 600);
}

function getErrorCode(body) {
  return String(body?.error ?? body?.code ?? "").trim();
}

function getErrorMessage(body) {
  const raw = body?.message ?? body?.error ?? "";
  if (Array.isArray(raw)) return raw.join("; ");
  return String(raw ?? "");
}

async function request(method, route, options = {}) {
  const url = `${CONFIG.baseUrl}${route}`;
  const headers = {
    Accept: "application/json",
    ...(options.json ? { "Content-Type": "application/json" } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(url, {
    method,
    headers,
    body: options.json ? JSON.stringify(options.json) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
    headers: response.headers,
  };
}

async function api(method, route, options = {}) {
  return request(method, route, options);
}

function assertStatus(result, allowed, label) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  if (statuses.includes(result.status)) return;
  throw new Error(`${label} expected ${statuses.join("/")} got ${result.status}: ${scrubText(result.text)}`);
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function asSlug(item) {
  return String(item?.slug ?? item?.connectorSlug ?? "").trim().toLowerCase();
}

function mapConnectorSlugToChannel(slug) {
  const normalized = String(slug ?? "").trim().toLowerCase();
  if (normalized === "amazon-in") return "amazon";
  return normalized;
}

function isNonNativePublishConnector(item) {
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities.map(String) : [];
  return capabilities.includes("PUBLISH") && !capabilities.includes("BULK_PUBLISH");
}

function isUsableInstalledConnector(item) {
  const slug = asSlug(item);
  const status = String(item?.status ?? "").trim().toUpperCase();
  const launchStage = String(item?.launchStage ?? "").trim().toLowerCase();
  if (!CONFIG.allowedConnectorSlugs.includes(slug)) return false;
  if (status !== "ACTIVE") return false;
  if (!isNonNativePublishConnector(item)) return false;
  if (item?.credentialsValidated === false) return false;
  if (["planned", "under_development", "internal_diagnostic"].includes(launchStage)) return false;
  return true;
}

async function login() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await api("POST", "/auth/login", {
      json: {
        workspaceSlug: CONFIG.workspace,
        userId: CONFIG.user,
        password: CONFIG.password,
      },
      timeoutMs: 30000,
    });
    if (result.status === 200 || result.status === 201) {
      const token = String(result.body?.accessToken ?? result.body?.token ?? "").trim();
      assert(token, "login succeeded without an access token");
      state.token = token;
      return result.body;
    }
    if ((result.status === 429 || result.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      continue;
    }
    throw new Error(`login failed with ${result.status}: ${scrubText(result.text)}`);
  }
}

async function ensureEnterprisePlanTier(reason) {
  const result = await api("POST", "/billing/plan-tier", {
    token: state.token,
    json: { planTier: "ENTERPRISE" },
  });
  assertStatus(result, [200, 201], `POST /billing/plan-tier (${reason})`);
}

async function withPlanRetry(reason, requestFactory) {
  let result = await requestFactory();
  if (result.status !== 402 || getErrorCode(result.body) !== "PLAN_LIMIT_EXCEEDED") {
    return result;
  }
  await ensureEnterprisePlanTier(reason);
  result = await requestFactory();
  return result;
}

async function healthCheck() {
  const result = await api("GET", "/health");
  assertStatus(result, 200, "GET /health");
  const env = String(result.body?.env ?? "").trim().toLowerCase();
  assert(env === CONFIG.expectedEnv, `expected env=${CONFIG.expectedEnv} got ${env || "unknown"}`);
  pass("health.api_reachable", `env=${env}`, { env });
}

async function authCheck() {
  const payload = await login();
  pass("auth.admin_login", `role=${payload?.role ?? "unknown"}`, { role: payload?.role ?? null });
}

async function discoverConnectors() {
  const definitionsResult = await api("GET", "/connectors/definitions", { token: state.token });
  assertStatus(definitionsResult, 200, "GET /connectors/definitions");
  const definitions = items(definitionsResult.body);
  pass("connectors.definitions", `count=${definitions.length}`, {
    slugs: definitions.map(asSlug).filter(Boolean).sort(),
  });

  const installedResult = await api("GET", "/connectors/installed?limit=200", { token: state.token });
  assertStatus(installedResult, 200, "GET /connectors/installed");
  const installed = items(installedResult.body);
  pass("connectors.installed_inventory", `count=${installed.length}`, {
    connectors: installed.map((item) => ({
      id: item.id,
      slug: asSlug(item),
      status: item.status,
      capabilities: item.capabilities,
      launchStage: item.launchStage,
      credentialsValidated: item.credentialsValidated,
    })),
  });

  const candidates = installed.filter(isUsableInstalledConnector);
  if (candidates.length === 0) {
    blocked(
      "connectors.non_native_publish_fixture",
      `no ACTIVE non-native PUBLISH connector found for ${CONFIG.allowedConnectorSlugs.join(",")}`,
      {
        allowedConnectorSlugs: CONFIG.allowedConnectorSlugs,
        installed: installed.map((item) => ({
          slug: asSlug(item),
          status: item.status,
          capabilities: item.capabilities,
          launchStage: item.launchStage,
          credentialsValidated: item.credentialsValidated,
        })),
      },
    );
    return null;
  }

  state.selectedConnector = candidates[0];
  pass("connectors.selected_fixture", `${asSlug(candidates[0])}/${candidates[0].accountAlias ?? candidates[0].id}`, {
    id: candidates[0].id,
    slug: asSlug(candidates[0]),
    status: candidates[0].status,
  });
  return candidates[0];
}

async function ensureCategory() {
  const result = await api("GET", "/taxonomy/categories", { token: state.token });
  assertStatus(result, 200, "GET /taxonomy/categories");
  const first = items(result.body)[0];
  if (!first?.id) {
    blocked("fixtures.category_available", "no category available to create RES-02 products");
    return "";
  }
  state.categoryId = String(first.id);
  pass("fixtures.category_available", `categoryId=${state.categoryId}`, { categoryId: state.categoryId });
  return state.categoryId;
}

async function createDraftProduct(label, overrides = {}) {
  const payload = {
    title: `${label} ${runTag}`,
    brand: "Vexa QA",
    description: "RES-02 controlled staging connector/export coverage product.",
    categoryId: state.categoryId,
    hsnCode: "6205",
    gstRate: 18,
    attributes: {
      sku: `RES02-${runTag}-${state.products.length + 1}`,
      mrp: 599,
      sellingPrice: 499,
      price: 499,
      inventoryQty: 5,
      color: "blue",
      size: "M",
      material: "cotton",
      productType: "QA Apparel",
      mainImageUrl: "https://dummyimage.com/600x600/0f172a/ffffff.png&text=Vexa+RES02",
      imageAlt: "Vexa RES-02 QA product image",
    },
    status: "draft",
    ...overrides,
  };
  const result = await withPlanRetry("res02:create_product", () =>
    api("POST", "/catalog/products", { token: state.token, json: payload }),
  );
  assertStatus(result, 201, "POST /catalog/products");
  assert(result.body?.id, "created product id missing");
  const product = result.body;
  state.products.push(String(product.id));
  return product;
}

async function getProduct(productId) {
  const result = await api("GET", `/catalog/products/${encodeURIComponent(productId)}`, { token: state.token });
  assertStatus(result, 200, "GET /catalog/products/:id");
  return result.body;
}

async function patchProduct(productId, changes) {
  const current = await getProduct(productId);
  const payload = {
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
  const result = await api("PATCH", `/catalog/products/${encodeURIComponent(productId)}`, {
    token: state.token,
    json: payload,
  });
  assertStatus(result, 200, "PATCH /catalog/products/:id");
  return result.body;
}

async function approveProduct(productId) {
  const validationResult = await api("POST", `/compliance/products/${encodeURIComponent(productId)}/validate`, {
    token: state.token,
  });
  assertStatus(validationResult, [200, 201, 422], "POST /compliance/products/:id/validate");
  await patchProduct(productId, { status: "in_review" });
  const reviewResult = await api("POST", `/catalog/products/${encodeURIComponent(productId)}/review-decision`, {
    token: state.token,
    json: {
      status: "approved",
      note: "Approved by RES-02 connector/export fixture coverage.",
    },
  });
  assertStatus(reviewResult, 201, "POST /catalog/products/:id/review-decision");
  return reviewResult.body;
}

async function createApprovedProduct(label) {
  const draft = await createDraftProduct(label);
  return approveProduct(String(draft.id));
}

async function createFixtureProducts() {
  if (!state.categoryId) return {};
  const draft = await createDraftProduct("RES-02 Draft Blocked");
  pass("fixtures.draft_product", `productId=${draft.id}`, { productId: draft.id, status: draft.status });
  const approved = await createApprovedProduct("RES-02 Approved Candidate");
  pass("fixtures.approved_product", `productId=${approved.id}`, { productId: approved.id, status: approved.status });
  return { draft, approved };
}

async function evaluateReadiness(connector, product) {
  const slug = asSlug(connector);
  const result = await api("POST", `/marketplace/connectors/${encodeURIComponent(slug)}/publish-readiness`, {
    token: state.token,
    json: {
      categoryScope: product.categoryId,
      installationId: connector.id,
      productId: product.id,
      fallbackAcknowledged: true,
    },
  });
  assertStatus(result, [200, 201], "POST /marketplace/connectors/:slug/publish-readiness");
  const ok = result.body?.ok === true;
  pass("readiness.product_evaluated", `ok=${ok} blockers=${(result.body?.blockers ?? []).length}`, {
    productId: product.id,
    connectorSlug: slug,
    ok,
    blockers: result.body?.blockers ?? [],
    warnings: result.body?.warnings ?? [],
  });
  return result.body;
}

async function triggerBulkPublish(connector, productIds) {
  return api("POST", `/marketplace/connectors/${encodeURIComponent(connector.id)}/bulk-publish`, {
    token: state.token,
    json: { productIds },
    timeoutMs: 45000,
  });
}

async function verifyNoEligiblePath(connector, draftProduct) {
  const result = await triggerBulkPublish(connector, [String(draftProduct.id)]);
  assertStatus(result, 400, "POST /marketplace/connectors/:id/bulk-publish no eligible");
  assert(getErrorCode(result.body) === "no_eligible_products", `expected no_eligible_products got ${getErrorCode(result.body)}`);
  const excluded = Array.isArray(result.body?.excluded) ? result.body.excluded : [];
  assert(excluded.length === 1, `expected one excluded product got ${excluded.length}`);
  pass("bulk_publish.no_eligible_products", `excluded=${excluded.length}`, {
    connectorId: connector.id,
    productId: draftProduct.id,
    excluded,
  });
}

// Bulk-Publish Goes Async (Story 8) retired the old 50-product NON_BULK_PUBLISH_BATCH_CEILING
// service-level rejection: connectors without native BULK_PUBLISH now queue an async run
// (createBulkPublishRun) instead of running a synchronous per-product loop, so batch size alone
// no longer triggers a rejection — only TriggerBulkPublishDto's shared @ArrayMaxSize(2000) does,
// and it's the same for every connector. This proves the old size-based 400 is gone: a 51-item
// batch of IDs that don't exist is evaluated on merits (each excluded as "not found"), not
// rejected outright the way a pre-Story-8 server would reject it before any lookup ran.
async function verifyOversizedBatchNotRejectedBySizeAlone(connector, draftProduct) {
  const productIds = Array.from({ length: 51 }, (_, i) => `${draftProduct.id}-nonexistent-${i}`);
  const result = await triggerBulkPublish(connector, productIds);
  assertStatus(result, 400, "POST /marketplace/connectors/:id/bulk-publish oversized-but-merit-evaluated batch");
  assert(
    getErrorCode(result.body) === "no_eligible_products",
    `expected no_eligible_products (merit-based, not size-based) got ${getErrorCode(result.body)}`,
  );
  const excluded = Array.isArray(result.body?.excluded) ? result.body.excluded : [];
  assert(excluded.length === productIds.length, `expected all ${productIds.length} excluded, got ${excluded.length}`);
  pass("bulk_publish.non_native_51_evaluated_not_size_rejected", `excluded=${excluded.length}`, {
    connectorId: connector.id,
    submittedCount: productIds.length,
    excludedCount: excluded.length,
  });
}

async function verifySingleAndBulkHappyPaths(connector, approvedProduct, readiness) {
  if (!readiness?.ok) {
    blocked("publish.single_success", "approved fixture is not publish-ready", {
      productId: approvedProduct.id,
      blockers: readiness?.blockers ?? [],
      warnings: readiness?.warnings ?? [],
    });
    blocked("bulk_publish.success", "approved fixture is not publish-ready", {
      productId: approvedProduct.id,
      blockers: readiness?.blockers ?? [],
    });
    blocked("bulk_publish.partial_success", "no ready product available for partial-success fixture", {
      productId: approvedProduct.id,
      blockers: readiness?.blockers ?? [],
    });
    return null;
  }

  const channel = mapConnectorSlugToChannel(asSlug(connector));
  const singleResult = await api("POST", `/marketplace/products/${encodeURIComponent(approvedProduct.id)}/export-jobs`, {
    token: state.token,
    json: {
      channel,
      installationId: connector.id,
      fallbackAcknowledged: true,
    },
    timeoutMs: 45000,
  });
  assertStatus(singleResult, [200, 201], "POST /marketplace/products/:id/export-jobs");
  assert(singleResult.body?.id, "single publish job id missing");
  state.exportJobIds.push(String(singleResult.body.id));
  pass("publish.single_success", `jobId=${singleResult.body.id}`, {
    jobId: singleResult.body.id,
    status: singleResult.body.status,
  });

  const bulkProduct = await createApprovedProduct("RES-02 Bulk Ready");
  const bulkReadiness = await evaluateReadiness(connector, bulkProduct);
  if (!bulkReadiness?.ok) {
    blocked("bulk_publish.success", "second approved fixture is not publish-ready", {
      productId: bulkProduct.id,
      blockers: bulkReadiness?.blockers ?? [],
    });
  } else {
    const bulkResult = await triggerBulkPublish(connector, [String(bulkProduct.id)]);
    assertStatus(bulkResult, 200, "POST /marketplace/connectors/:id/bulk-publish success");
    const submissionIds = Array.isArray(bulkResult.body?.submissionIds) ? bulkResult.body.submissionIds : [];
    assert(submissionIds.length === 1, `expected 1 queued job got ${submissionIds.length}`);
    state.exportJobIds.push(...submissionIds.map(String));
    pass("bulk_publish.success", `queued=${submissionIds.length}`, {
      connectorId: connector.id,
      submissionIds,
      excluded: bulkResult.body?.excluded ?? [],
    });
  }

  const partialReadyProduct = await createApprovedProduct("RES-02 Partial Ready");
  const partialDraftProduct = await createDraftProduct("RES-02 Partial Draft");
  const partialReadiness = await evaluateReadiness(connector, partialReadyProduct);
  if (!partialReadiness?.ok) {
    blocked("bulk_publish.partial_success", "partial ready-side product is not publish-ready", {
      productId: partialReadyProduct.id,
      blockers: partialReadiness?.blockers ?? [],
    });
  } else {
    const partialResult = await triggerBulkPublish(connector, [
      String(partialReadyProduct.id),
      String(partialDraftProduct.id),
    ]);
    assertStatus(partialResult, 200, "POST /marketplace/connectors/:id/bulk-publish partial");
    const queued = Array.isArray(partialResult.body?.submissionIds) ? partialResult.body.submissionIds : [];
    const excluded = Array.isArray(partialResult.body?.excluded) ? partialResult.body.excluded : [];
    assert(queued.length === 1, `expected 1 queued in partial path got ${queued.length}`);
    assert(excluded.length === 1, `expected 1 excluded in partial path got ${excluded.length}`);
    state.exportJobIds.push(...queued.map(String));
    pass("bulk_publish.partial_success", `queued=${queued.length} excluded=${excluded.length}`, {
      connectorId: connector.id,
      queued,
      excluded,
    });
  }

  return String(singleResult.body.id);
}

async function verifyJobHistoryAndRetry(jobId) {
  if (!jobId) {
    blocked("submissions.history", "no publish job created in this run");
    blocked("publish.failed_submission", "no publish job created in this run");
    blocked("publish.retry", "no failed/dead-letter job available");
    return;
  }

  const jobResult = await api("GET", `/marketplace/export-jobs/${encodeURIComponent(jobId)}`, { token: state.token });
  assertStatus(jobResult, 200, "GET /marketplace/export-jobs/:id");
  pass("submissions.history", `jobStatus=${jobResult.body?.status ?? "unknown"}`, {
    jobId,
    productId: jobResult.body?.productId ?? null,
    status: jobResult.body?.status ?? null,
  });

  if (!CONFIG.processJobs) {
    blocked("publish.failed_submission", "RES02_PROCESS_EXPORT_JOBS=false");
    blocked("publish.retry", "RES02_PROCESS_EXPORT_JOBS=false");
    return;
  }

  const processResult = await api("POST", `/marketplace/export-jobs/${encodeURIComponent(jobId)}/process`, {
    token: state.token,
    timeoutMs: 60000,
  });
  assertStatus(processResult, [200, 201], "POST /marketplace/export-jobs/:id/process");
  const processedStatus = String(processResult.body?.status ?? "").toLowerCase();
  if (["failed", "dead_letter", "retrying"].includes(processedStatus)) {
    pass("publish.failed_submission", `status=${processedStatus}`, {
      jobId,
      failureReason: processResult.body?.failureReason ?? null,
      dlqReason: processResult.body?.dlqReason ?? null,
    });
    const requeueResult = await api("POST", `/marketplace/export-jobs/${encodeURIComponent(jobId)}/requeue`, {
      token: state.token,
      timeoutMs: 45000,
    });
    assertStatus(requeueResult, [200, 201], "POST /marketplace/export-jobs/:id/requeue");
    pass("publish.retry", `status=${requeueResult.body?.status ?? "unknown"}`, {
      jobId,
      status: requeueResult.body?.status ?? null,
      retryCount: requeueResult.body?.retryCount ?? null,
    });
    return;
  }

  blocked("publish.failed_submission", `processed job did not fail; status=${processedStatus || "unknown"}`, {
    jobId,
    status: processedStatus || null,
  });
  blocked("publish.retry", `retry requires failed/dead_letter/retrying job; got ${processedStatus || "unknown"}`, {
    jobId,
    status: processedStatus || null,
  });
}

async function run() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  console.log("\nRES-02 Connector / Export Fixture Coverage\n");

  try {
    await healthCheck();
    await authCheck();
    const connector = await discoverConnectors();
    await ensureCategory();

    if (!connector || !state.categoryId) {
      return;
    }

    const fixtures = await createFixtureProducts();
    if (!fixtures.draft || !fixtures.approved) {
      return;
    }

    await verifyNoEligiblePath(connector, fixtures.draft);
    await verifyOversizedBatchNotRejectedBySizeAlone(connector, fixtures.draft);
    const readiness = await evaluateReadiness(connector, fixtures.approved);
    const jobId = await verifySingleAndBulkHappyPaths(connector, fixtures.approved, readiness);
    await verifyJobHistoryAndRetry(jobId);
  } catch (error) {
    fail("res02.runner_crash", error instanceof Error ? error.message : String(error));
  } finally {
    const counts = {
      pass: results.filter((item) => item.status === "PASS").length,
      fail: results.filter((item) => item.status === "FAIL").length,
      blocked: results.filter((item) => item.status === "BLOCKED").length,
      total: results.length,
    };
    const finalStatus = counts.fail > 0 ? "FAIL" : counts.blocked > 0 ? "BLOCKED" : "PASS";
    const report = {
      status: finalStatus,
      counts,
      selectedConnector: state.selectedConnector
        ? {
            id: state.selectedConnector.id,
            slug: asSlug(state.selectedConnector),
            status: state.selectedConnector.status,
            accountAlias: state.selectedConnector.accountAlias ?? null,
          }
        : null,
      createdProductIds: state.products,
      exportJobIds: state.exportJobIds,
      results,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nRES-02 result: ${finalStatus}`);
    console.log(`Results written to ${RESULT_PATH}`);
    console.log(`TOTAL ${counts.total} | PASS ${counts.pass} | BLOCKED ${counts.blocked} | FAIL ${counts.fail}\n`);

    if (counts.fail > 0 || (CONFIG.failOnBlocked && counts.blocked > 0)) {
      process.exitCode = 1;
    }
  }
}

run();
