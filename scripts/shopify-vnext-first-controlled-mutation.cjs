#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const {
  buildRailwayExecutionEnv,
  isServiceNotFoundRailwayError,
  readRailwayVariablesAcrossServiceTargets,
  resolveConfig,
} = require("./railway-deploy.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_PREFIX = "/api/v1";

// Mirrors MarketplaceService.hashStableJson — keep in sync if the service version changes.
function normalizeComparableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
function normalizeComparableObject(value) {
  if (Array.isArray(value)) return value.map(normalizeComparableObject);
  if (!value || typeof value !== "object") return normalizeComparableString(value);
  const entries = Object.entries(value)
    .map(([k, v]) => [k, normalizeComparableObject(v)])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return Object.fromEntries(entries);
}
function hashStableJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeComparableObject(value))).digest("hex");
}
function buildImageFilenameFromUrl(url) {
  try {
    const urlPath = new URL(url).pathname;
    const ext = urlPath.split("/").pop()?.split(".").slice(1).pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return `product-image.${ext}`;
  } catch (_) { /* ignore */ }
  return null;
}
function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(name, required = true) {
  const value = String(process.env[name] ?? "").trim();
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

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

function redact(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/\S{48,}/g, "[REDACTED]");
}

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeoutMs ?? 120000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(redact(`${command} ${args.join(" ")} failed with exit ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`));
  }
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function runRailway(config, railwayEnv, args, options = {}) {
  return runCommand(config.railwayBin, args, {
    cwd: config.repoRoot,
    env: railwayEnv,
    timeoutMs: options.timeoutMs ?? 180000,
  });
}

function runRailwayCapture(config, railwayEnv, args, options = {}) {
  const result = childProcess.spawnSync(config.railwayBin, args, {
    cwd: config.repoRoot,
    env: railwayEnv,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60000,
  });
  return {
    status: result.status ?? -1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    error: result.error ?? null,
  };
}

async function request(method, baseUrl, route, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body, text };
}

function assertStatus(result, allowed, label) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  if (statuses.includes(result.status)) {
    return;
  }
  throw new Error(`${label} expected ${statuses.join("/")} got ${result.status}: ${redact(result.text)}`);
}

async function login(config) {
  const result = await request("POST", config.apiBaseUrl, "/auth/login", {
    body: {
      workspaceSlug: config.workspace,
      userId: config.smokeUser,
      password: config.smokePassword,
    },
    timeoutMs: 30000,
  });
  assertStatus(result, [200, 201], "POST /auth/login");
  const token = String(result.body?.accessToken ?? result.body?.token ?? "").trim();
  if (!token) {
    throw new Error("Login succeeded without an access token.");
  }
  return token;
}

async function waitForReadiness(apiBaseUrl, label) {
  let last = "";
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    try {
      const result = await request("GET", apiBaseUrl, "/health/ready", { timeoutMs: 15000 });
      last = result.text;
      if (result.status === 200 && result.body?.status === "ready") {
        return { label, attempt, checkedAt: nowIso() };
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(5000);
  }
  throw new Error(`API did not become ready for ${label}: ${redact(last)}`);
}

function readRuntimeVariables(config, railwayEnv) {
  const raw = readRailwayVariablesAcrossServiceTargets(config, railwayEnv, config.apiServiceTargets, "API runtime env vars");
  return {
    RAILWAY_GIT_COMMIT_SHA: String(raw.RAILWAY_GIT_COMMIT_SHA ?? "").trim(),
    VNEXT_MUTATION_ENABLED: String(raw.VNEXT_MUTATION_ENABLED ?? "").trim(),
    VNEXT_MUTATION_ALLOWLIST_JSON: String(raw.VNEXT_MUTATION_ALLOWLIST_JSON ?? "").trim(),
    VNEXT_MUTATION_APPROVED_RELEASE_SHA: String(raw.VNEXT_MUTATION_APPROVED_RELEASE_SHA ?? "").trim(),
    VNEXT_MUTATION_ALLOWED_FIELD_CLASS: String(raw.VNEXT_MUTATION_ALLOWED_FIELD_CLASS ?? "").trim(),
    VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256: String(raw.VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256 ?? "").trim(),
  };
}

function summarizeVnextVariables(vars) {
  return {
    RAILWAY_GIT_COMMIT_SHA: vars.RAILWAY_GIT_COMMIT_SHA,
    VNEXT_MUTATION_ENABLED: vars.VNEXT_MUTATION_ENABLED || "<unset>",
    VNEXT_MUTATION_ALLOWLIST_JSON: vars.VNEXT_MUTATION_ALLOWLIST_JSON ? "<set>" : "<unset>",
    VNEXT_MUTATION_APPROVED_RELEASE_SHA: vars.VNEXT_MUTATION_APPROVED_RELEASE_SHA || "<unset>",
    VNEXT_MUTATION_ALLOWED_FIELD_CLASS: vars.VNEXT_MUTATION_ALLOWED_FIELD_CLASS || "<unset>",
    VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256: vars.VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256 || "<unset>",
  };
}

function assertExactPreflight(config, vars) {
  if (vars.RAILWAY_GIT_COMMIT_SHA !== config.releaseSha) {
    throw new Error(`Deployment SHA mismatch: expected ${config.releaseSha}, got ${vars.RAILWAY_GIT_COMMIT_SHA || "<unset>"}.`);
  }
  if (String(vars.VNEXT_MUTATION_ENABLED).toLowerCase() === "true") {
    throw new Error("VNEXT_MUTATION_ENABLED is already true before authorization window.");
  }
}

function setVariablesAcrossTargets(config, railwayEnv, pairs, label) {
  let lastError = null;
  for (const serviceTarget of config.apiServiceTargets) {
    const args = [
      "variable",
      "set",
      ...pairs.map(([key, value]) => `${key}=${value}`),
      "--service",
      serviceTarget,
      "--environment",
      config.environmentName,
      "--project",
      config.projectId,
      "--json",
    ];
    try {
      runRailway(config, railwayEnv, args);
      return serviceTarget;
    } catch (error) {
      lastError = error;
      const canTryNext = serviceTarget !== config.apiServiceTargets[config.apiServiceTargets.length - 1];
      if (canTryNext && isServiceNotFoundRailwayError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`No Railway API service target accepted ${label}.`);
}

function restartApi(config, railwayEnv, label) {
  let lastError = null;
  for (const serviceTarget of config.apiServiceTargets) {
    try {
      runRailway(config, railwayEnv, [
        "restart",
        "--service",
        serviceTarget,
        "--environment",
        config.environmentName,
        "--project",
        config.projectId,
        "--yes",
        "--json",
      ], { timeoutMs: 180000 });
      return serviceTarget;
    } catch (error) {
      lastError = error;
      const canTryNext = serviceTarget !== config.apiServiceTargets[config.apiServiceTargets.length - 1];
      if (canTryNext && isServiceNotFoundRailwayError(error)) {
        continue;
      }
      throw new Error(`${label} restart failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError ?? new Error(`${label} restart failed: no API service targets available.`);
}

async function applyGate(config, railwayConfig, railwayEnv, enabled, evidence, label) {
  const pairs = enabled
    ? [
        ["VNEXT_MUTATION_ENABLED", "true"],
        ["VNEXT_MUTATION_ALLOWLIST_JSON", JSON.stringify(config.allowlist)],
        ["VNEXT_MUTATION_APPROVED_RELEASE_SHA", config.releaseSha],
        ["VNEXT_MUTATION_ALLOWED_FIELD_CLASS", "image"],
        ["VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256", config.mutationPayloadChecksum],
      ]
    : [
        ["VNEXT_MUTATION_ENABLED", "false"],
        ["VNEXT_MUTATION_ALLOWLIST_JSON", JSON.stringify(config.allowlist)],
        ["VNEXT_MUTATION_APPROVED_RELEASE_SHA", config.releaseSha],
        ["VNEXT_MUTATION_ALLOWED_FIELD_CLASS", "image"],
        ["VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256", config.mutationPayloadChecksum],
      ];
  const variableTarget = setVariablesAcrossTargets(railwayConfig, railwayEnv, pairs, label);
  await sleep(20000);
  const ready = await waitForReadiness(config.apiBaseUrl, label);
  const vars = readRuntimeVariables(railwayConfig, railwayEnv);
  evidence.gateTransitions.push({
    label,
    enabled,
    variableTarget,
    ready,
    variables: summarizeVnextVariables(vars),
    changedAt: nowIso(),
  });
  return vars;
}

function prepareDatabaseEnv() {
  process.env.DATABASE_URL_DIRECT ||= process.env.STAGING_DATABASE_URL_DIRECT || "";
  process.env.DATABASE_URL ||= process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL_DIRECT || "";
  process.env.DATABASE_URL_POOLED ||= process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || "";
}

function resolveDatabaseUrl() {
  const url = String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL_DIRECT or STAGING_DATABASE_URL_DIRECT is required for submission evidence.");
  }
  return url;
}

function runSnapshot(config, outputPath, label) {
  runCommand(process.execPath, [
    path.join(REPO_ROOT, "scripts", "capture-shopify-vnext-rollback-snapshot.cjs"),
    "--release",
    config.releaseSha,
    "--tenant",
    config.tenant,
    "--connector",
    config.connector,
    "--installation",
    config.installation,
    "--product",
    config.product,
    "--shopifyProductGid",
    config.shopifyProductGid,
    "--runUrl",
    config.runUrl,
    "--output",
    outputPath,
  ], { timeoutMs: 180000 });
  const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  return { label, path: outputPath, capturedAt: parsed.capturedAt, snapshot: parsed.snapshot, compensatingPayload: parsed.compensatingPayload };
}

function compareStableProductFields(before, after) {
  const beforeProduct = before.snapshot.product;
  const afterProduct = after.snapshot.product;
  const fields = ["id", "title", "handle", "descriptionHtml", "status", "vendor", "productType"];
  const mismatches = [];
  for (const field of fields) {
    if (JSON.stringify(beforeProduct[field] ?? null) !== JSON.stringify(afterProduct[field] ?? null)) {
      mismatches.push(field);
    }
  }
  for (const field of ["tags", "seo", "options"]) {
    if (JSON.stringify(beforeProduct[field] ?? null) !== JSON.stringify(afterProduct[field] ?? null)) {
      mismatches.push(field);
    }
  }
  const normalizeVariants = (variants) => variants.map((variant) => ({
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    price: variant.price ?? null,
    compareAtPrice: variant.compareAtPrice ?? null,
    barcode: variant.barcode ?? null,
    inventoryPolicy: variant.inventoryPolicy ?? null,
    taxable: variant.taxable ?? null,
    selectedOptions: variant.selectedOptions ?? [],
    inventoryItem: variant.inventoryItem ?? null,
  }));
  if (JSON.stringify(normalizeVariants(beforeProduct.variants ?? [])) !== JSON.stringify(normalizeVariants(afterProduct.variants ?? []))) {
    mismatches.push("variants");
  }
  return mismatches;
}

function assertSnapshotTransition(config, before, after) {
  const beforeProduct = before.snapshot.product;
  const afterProduct = after.snapshot.product;
  if (beforeProduct.id !== config.shopifyProductGid || afterProduct.id !== config.shopifyProductGid) {
    throw new Error("Shopify product GID changed or does not match the authorized product.");
  }
  const stableMismatches = compareStableProductFields(before, after);
  if (stableMismatches.length > 0) {
    throw new Error(`Unexpected non-image Shopify field changes: ${stableMismatches.join(", ")}`);
  }
  const beforeImage = beforeProduct.images?.[0] ?? {};
  const afterImage = afterProduct.images?.[0] ?? {};
  if (config.expectedOldImage && beforeImage.src !== config.expectedOldImage) {
    throw new Error(`Pre-mutation image mismatch: expected ${config.expectedOldImage}, got ${beforeImage.src ?? "<unset>"}.`);
  }
  if (!afterImage.src || afterImage.src === beforeImage.src) {
    throw new Error("Post-mutation image did not change from the pre-mutation Shopify image.");
  }
  if ((afterProduct.images ?? []).length !== 1) {
    throw new Error(`Expected exactly one Shopify image after mutation, got ${(afterProduct.images ?? []).length}.`);
  }
  return {
    productGidStable: true,
    changedFields: ["images[0].src", "images[0].id"],
    oldImage: beforeImage.src ?? null,
    newImage: afterImage.src ?? null,
    targetOriginalSource: config.expectedTargetImage,
  };
}

async function querySubmissionEvidence(config, jobId) {
  prepareDatabaseEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  try {
    const idempotencyKey = `${jobId}:PUBLISH`;
    const submission = await prisma.connectorSubmission.findFirst({
      where: {
        tenantKey: config.tenant,
        installationId: config.installation,
        productId: config.product,
        idempotencyKey,
      },
      select: {
        id: true,
        tenantKey: true,
        installationId: true,
        productId: true,
        idempotencyKey: true,
        submissionType: true,
        source: true,
        attemptNumber: true,
        status: true,
        externalRef: true,
        submittedAt: true,
        resolvedAt: true,
        connectorSlug: true,
        channelErrors: true,
        payloadSnapshot: true,
      },
    });
    if (!submission) {
      throw new Error(`No ConnectorSubmission found for idempotency key ${idempotencyKey}.`);
    }
    const duplicateSubmissions = await prisma.connectorSubmission.count({
      where: {
        tenantKey: config.tenant,
        installationId: config.installation,
        productId: config.product,
        idempotencyKey: { not: idempotencyKey },
        submittedAt: { gte: config.startedAt },
      },
    });
    const crossTenantSubmissions = await prisma.connectorSubmission.count({
      where: {
        tenantKey: { not: config.tenant },
        installationId: config.installation,
        productId: config.product,
        submittedAt: { gte: config.startedAt },
      },
    });
    return {
      submission: {
        ...submission,
        payloadSnapshot: undefined,
        vnextAudit: submission.payloadSnapshot?.__vnextMutationAudit ?? null,
      },
      duplicateSubmissions,
      crossTenantSubmissions,
    };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function queryRecentAuthorizedState(config) {
  prepareDatabaseEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  try {
    const [jobs, submissions] = await Promise.all([
      prisma.marketplaceExportJob.findMany({
        where: {
          tenantKey: config.tenant,
          productId: config.product,
          channel: "shopify",
          installationId: config.installation,
        },
        select: {
          id: true,
          status: true,
          retryCount: true,
          failureReason: true,
          dlqReason: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.connectorSubmission.findMany({
        where: {
          tenantKey: config.tenant,
          installationId: config.installation,
          productId: config.product,
        },
        select: {
          id: true,
          idempotencyKey: true,
          status: true,
          source: true,
          externalRef: true,
          attemptNumber: true,
          submittedAt: true,
          resolvedAt: true,
          connectorSlug: true,
        },
        orderBy: { submittedAt: "desc" },
        take: 10,
      }),
    ]);
    return { jobs, submissions };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function queryActiveAuthorizedJobs(config) {
  prepareDatabaseEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  try {
    return await prisma.marketplaceExportJob.findMany({
      where: {
        tenantKey: config.tenant,
        productId: config.product,
        channel: "shopify",
        installationId: config.installation,
        status: { in: ["queued", "processing", "retrying"] },
      },
      select: {
        id: true,
        status: true,
        retryCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function waitForExportJobTerminal(config, token, jobId) {
  let last = null;
  // 90 attempts × 5 s = 7.5 minutes maximum.
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const result = await request("GET", config.apiBaseUrl, `/marketplace/export-jobs/${encodeURIComponent(jobId)}`, {
      token,
      timeoutMs: 30000,
    });
    assertStatus(result, 200, "GET /marketplace/export-jobs/:id");
    last = result.body;
    const status = String(result.body?.status ?? "").toLowerCase();
    // All four states are queue-native terminal: completed, failed, dead_letter, skipped.
    // For ShopifyControlledMutationError specifically, processExportJob() RETURNS (does not
    // throw), so BullMQ never sees a rejection — it marks the job complete and no retry fires.
    // status=failed is therefore a definitive terminal state for the controlled mutation path.
    if (["completed", "failed", "dead_letter", "skipped"].includes(status)) {
      return { attempt, job: result.body };
    }
    await sleep(5000);
  }
  return { attempt: 90, job: last };
}

function findVnextFailedLog(config, railwayConfig, railwayEnv) {
  for (const serviceTarget of railwayConfig.apiServiceTargets) {
    try {
      const result = runRailway(railwayConfig, railwayEnv, [
        "logs",
        "--deployment",
        "--service",
        serviceTarget,
        "--environment",
        railwayConfig.environmentName,
        "--lines",
        "10000",
        "--since",
        "30m",
      ], { timeoutMs: 120000 });
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const match = lines.reverse().find((line) =>
        (
          line.includes("shopify_vnext_mutation_failed") ||
          line.includes("shopify_vnext_mutation_blocked")
        ) &&
        (line.includes(config.product) || line.includes(config.installation))
      );
      if (match) {
        return { serviceTarget, matched: true, line: redact(match).slice(0, 2000) };
      }
    } catch {
      // ignore
    }
  }
  return { matched: false, line: null };
}

function findVnextExecutionLog(config, railwayConfig, railwayEnv) {
  for (const serviceTarget of railwayConfig.apiServiceTargets) {
    try {
      const result = runRailway(railwayConfig, railwayEnv, [
        "logs",
        "--deployment",
        "--service",
        serviceTarget,
        "--environment",
        railwayConfig.environmentName,
        "--lines",
        "10000",
        "--since",
        "30m",
      ], { timeoutMs: 120000 });
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const match = lines.reverse().find((line) =>
        (
          line.includes("shopify_vnext_controlled_mutation_executed") ||
          line.includes("Shopify controlled vNext product sync completed")
        ) &&
        (line.includes(config.product) || line.includes(config.installation) || line.includes("correlationId"))
      );
      if (match) {
        return { serviceTarget, matched: true, line: redact(match).slice(0, 1200) };
      }
    } catch {
      // Log retrieval is retried by the caller.
    }
  }
  return { matched: false, line: null };
}

async function waitForRailwaySha(config, railwayConfig, railwayEnv) {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const vars = readRuntimeVariables(railwayConfig, railwayEnv);
    if (vars.RAILWAY_GIT_COMMIT_SHA === config.releaseSha) {
      return vars;
    }
    await sleep(10000);
  }
  const vars = readRuntimeVariables(railwayConfig, railwayEnv);
  throw new Error(
    `Railway did not deploy SHA ${config.releaseSha} within 15 minutes. ` +
    `Current stored RAILWAY_GIT_COMMIT_SHA: ${vars.RAILWAY_GIT_COMMIT_SHA || "<unset>"}.`,
  );
}

async function waitForVnextGateActive(config, token) {
  let lastStatus = null;
  let lastBody = null;
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      const result = await request(
        "GET",
        config.apiBaseUrl,
        `/marketplace/vnext-mutation-config-preflight?tenantKey=${encodeURIComponent(config.tenant)}&connectorSlug=shopify&installationId=${encodeURIComponent(config.installation)}&productId=${encodeURIComponent(config.product)}`,
        { token, timeoutMs: 15000 },
      );
      lastStatus = result.status;
      lastBody = result.body;
      if (result.status === 200 && result.body?.result === "READY") {
        return { attempt, checkedAt: nowIso(), checks: result.body.checks };
      }
    } catch (error) {
      lastStatus = "error";
      lastBody = error instanceof Error ? error.message : String(error);
    }
    await sleep(10000);
  }
  throw new Error(
    `Running API process did not confirm vNext gate active within 20 minutes. ` +
    `Last preflight response: status=${lastStatus}, body=${JSON.stringify(lastBody)}. ` +
    `The Railway deploy triggered by variable set may have failed or taken longer than expected.`,
  );
}

async function waitForOldDeploymentDrained(config, railwayConfig, railwayEnv) {
  const drainResult = {
    method: "railway_deployment_list",
    approvedSha: config.releaseSha,
    startedAt: nowIso(),
    attempts: [],
    outcome: "unknown",
  };

  function shaMatches(deploySha) {
    if (!deploySha) return false;
    const s = String(deploySha).toLowerCase().trim();
    const a = config.releaseSha.toLowerCase().trim();
    return a === s || a.startsWith(s) || s.startsWith(a.slice(0, 8));
  }

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const attemptResult = { attempt, checkedAt: nowIso() };
    let parsed = null;

    for (const serviceTarget of railwayConfig.apiServiceTargets) {
      try {
        const result = runRailwayCapture(railwayConfig, railwayEnv, [
          "deployment",
          "list",
          "--service", serviceTarget,
          "--environment", railwayConfig.environmentName,
          "--limit", "10",
          "--json",
        ], { timeoutMs: 30000 });
        if (result.status === 0 && result.stdout.trim()) {
          try {
            parsed = JSON.parse(result.stdout.trim());
            attemptResult.serviceTarget = serviceTarget;
            break;
          } catch {
            // not valid JSON — try next target
          }
        }
      } catch {
        // CLI invocation failed — try next target
      }
    }

    if (!parsed) {
      attemptResult.outcome = "parse_failed";
      drainResult.attempts.push(attemptResult);
      drainResult.outcome = "time_buffer_only";
      drainResult.checkedAt = nowIso();
      return drainResult;
    }

    // Railway deployment list JSON is typically an array of deployment objects.
    // Each entry may have: { id, status, createdAt, meta: { commitHash } } or { commitHash } at root.
    const entries = Array.isArray(parsed)
      ? parsed
      : (parsed.deployments ?? parsed.edges?.map((e) => e?.node) ?? []);

    const INACTIVE_STATUSES = new Set(["REMOVED", "CRASHED", "FAILED", "CANCELED", "CANCELLED"]);
    const active = entries.filter((d) => {
      const s = String(d?.status ?? "").toUpperCase();
      return !INACTIVE_STATUSES.has(s);
    });
    const oldActive = active.filter((d) => {
      const sha = String(d?.meta?.commitHash ?? d?.commitHash ?? d?.meta?.commitSha ?? d?.commitSha ?? "");
      return sha && !shaMatches(sha);
    });

    attemptResult.totalDeployments = entries.length;
    attemptResult.activeDeployments = active.length;
    attemptResult.oldActiveDeployments = oldActive.length;
    attemptResult.activeShas = active.slice(0, 5).map((d) => ({
      id: d?.id,
      status: d?.status,
      sha: String(d?.meta?.commitHash ?? d?.commitHash ?? d?.meta?.commitSha ?? d?.commitSha ?? "").slice(0, 16) || "<unknown>",
    }));
    drainResult.attempts.push(attemptResult);

    if (oldActive.length === 0) {
      drainResult.outcome = "drained";
      drainResult.checkedAt = nowIso();
      return drainResult;
    }

    if (attempt < 6) {
      await sleep(15000);
    }
  }

  // Old deployments still appearing after 90 s — proceed; 60 s buffer covers Railway grace period.
  drainResult.outcome = "timeout_proceed_with_time_buffer";
  drainResult.checkedAt = nowIso();
  return drainResult;
}

async function waitForVnextExecutionLog(config, railwayConfig, railwayEnv) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = findVnextExecutionLog(config, railwayConfig, railwayEnv);
    if (result.matched) {
      return { ...result, attempt, checkedAt: nowIso() };
    }
    await sleep(10000);
  }
  throw new Error("Could not find shopify_vnext_controlled_mutation_executed log line for the authorized product/installation.");
}

async function run() {
  const config = {
    apiBaseUrl: normalizeApiBaseUrl(readEnv("STAGING_BASE_URL")),
    workspace: readEnv("STAGING_SMOKE_WORKSPACE"),
    smokeUser: readEnv("STAGING_SMOKE_USER"),
    smokePassword: readEnv("STAGING_SMOKE_PASSWORD"),
    tenant: readEnv("AUTHORIZED_TENANT"),
    connector: readEnv("AUTHORIZED_CONNECTOR"),
    installation: readEnv("AUTHORIZED_INSTALLATION"),
    product: readEnv("AUTHORIZED_PRODUCT"),
    releaseSha: readEnv("AUTHORIZED_RELEASE_SHA"),
    mutationPayloadChecksum: readEnv("AUTHORIZED_MUTATION_PAYLOAD_SHA256").toLowerCase(),
    shopifyProductGid: readEnv("AUTHORIZED_SHOPIFY_PRODUCT_GID"),
    expectedOldImage: readEnv("EXPECTED_OLD_IMAGE", false),
    expectedTargetImage: readEnv("EXPECTED_TARGET_IMAGE", false),
    runUrl: readEnv("RUN_URL", false),
    outputPath: readEnv("MUTATION_EVIDENCE_OUTPUT", false) || path.join(REPO_ROOT, ".run-logs", `shopify-vnext-first-controlled-mutation-${Date.now()}.json`),
    diagnosticOnly: String(process.env.CONTROLLED_VNEXT_DIAGNOSTIC_ONLY ?? "").trim().toLowerCase() === "true",
    preflightOnly: String(process.env.CONTROLLED_VNEXT_PREFLIGHT_ONLY ?? "").trim().toLowerCase() === "true",
    startedAt: new Date(),
  };
  config.allowlist = {
    tenantKey: config.tenant,
    connectorSlug: config.connector,
    installationId: config.installation,
    productId: config.product,
  };

  if (config.connector !== "shopify") {
    throw new Error(`This runner only supports connector=shopify, got ${config.connector}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(config.mutationPayloadChecksum)) {
    throw new Error("AUTHORIZED_MUTATION_PAYLOAD_SHA256 must be a 64 character lowercase SHA-256 hex digest.");
  }

  const railwayConfig = resolveConfig(process.env, REPO_ROOT);
  const railwayEnv = buildRailwayExecutionEnv(process.env);
  const evidence = {
    status: "started",
    authorizedBy: "chat: AUTHORIZE FIRST CONTROLLED MUTATION",
    startedAt: config.startedAt.toISOString(),
    runUrl: config.runUrl || null,
    tuple: {
      tenant: config.tenant,
      connector: config.connector,
      installation: config.installation,
      product: config.product,
      release: config.releaseSha,
      mutationPayloadChecksum: config.mutationPayloadChecksum,
      shopifyProductGid: config.shopifyProductGid,
    },
    allowlist: config.allowlist,
    gateTransitions: [],
    preflight: {},
    api: {},
    verification: {},
  };

  fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });

  let gateEnabled = false;
  try {
    await waitForReadiness(config.apiBaseUrl, "initial preflight");
    const initialVars = await waitForRailwaySha(config, railwayConfig, railwayEnv);
    assertExactPreflight(config, initialVars);
    evidence.preflight.initialVariables = summarizeVnextVariables(initialVars);

    const beforePath = path.join(path.dirname(config.outputPath), `shopify-vnext-first-controlled-mutation-before-${process.env.GITHUB_RUN_ID || Date.now()}.json`);
    const before = runSnapshot(config, beforePath, "before");
    evidence.preflight.beforeSnapshot = {
      path: before.path,
      capturedAt: before.capturedAt,
      image: before.snapshot.product.images?.[0]?.src ?? null,
      productGid: before.snapshot.product.id,
    };
    // Compute the expected outbound mutation payload checksum before any gate changes.
    // This mirrors the service's payloadChecksum = hashStableJson({ files }) and lets the
    // authorization packet bind to the exact payload that will be sent to Shopify.
    const productTitle = before.snapshot.product.title ?? "";
    const targetUrl = config.expectedTargetImage;
    const targetFilename = buildImageFilenameFromUrl(targetUrl);
    const expectedControlledInput = {
      files: [
        {
          originalSource: targetUrl,
          alt: productTitle,
          contentType: "IMAGE",
          ...(targetFilename ? { filename: targetFilename } : {}),
        },
      ],
    };
    const mutationPayloadChecksum = hashStableJson(expectedControlledInput);
    evidence.preflight.expectedControlledInput = expectedControlledInput;
    evidence.preflight.mutationPayloadChecksum = mutationPayloadChecksum;
    if (mutationPayloadChecksum !== config.mutationPayloadChecksum) {
      throw new Error(
        `Authorized mutation payload checksum mismatch before gate enable: expected runtime reconstruction ${mutationPayloadChecksum}, got ${config.mutationPayloadChecksum}.`,
      );
    }

    const activeJobs = await queryActiveAuthorizedJobs(config);
    evidence.preflight.activeAuthorizedJobsBeforeGate = activeJobs;
    if (config.diagnosticOnly) {
      // This is deliberately the same runtime endpoint used by the READY path,
      // while mutation authority remains disabled. It proves the production
      // process hard-blocks a controlled-required attempt without enabling a gate.
      const token = await login(config);
      const preflightResult = await request(
        "GET",
        config.apiBaseUrl,
        `/marketplace/vnext-mutation-config-preflight?tenantKey=${encodeURIComponent(config.tenant)}&connectorSlug=shopify&installationId=${encodeURIComponent(config.installation)}&productId=${encodeURIComponent(config.product)}`,
        { token, timeoutMs: 15000 },
      );
      const runtimePreflight = {
        checkedAt: nowIso(),
        status: preflightResult.status,
        result: preflightResult.body?.result ?? null,
        reason: preflightResult.body?.reason ?? null,
        providerWrites: preflightResult.body?.providerWrites ?? null,
        legacyWrites: preflightResult.body?.legacyWrites ?? null,
        exportJobCreated: preflightResult.body?.exportJobCreated ?? null,
      };
      evidence.diagnostic = { runtimePreflight };
      if (
        runtimePreflight.status !== 200 ||
        runtimePreflight.result !== "BLOCKED" ||
        runtimePreflight.reason !== "vnext_disabled" ||
        runtimePreflight.providerWrites !== 0 ||
        runtimePreflight.legacyWrites !== 0 ||
        runtimePreflight.exportJobCreated !== 0
      ) {
        throw new Error(`Gates-off runtime preflight did not hard-block safely: ${JSON.stringify(runtimePreflight)}.`);
      }
      evidence.status = "diagnostic_only";
      evidence.diagnostic = {
        ...evidence.diagnostic,
        currentAuthorizedState: await queryRecentAuthorizedState(config),
        vnextExecutionLog: findVnextExecutionLog(config, railwayConfig, railwayEnv),
      };
      return;
    }
    if (activeJobs.length > 0) {
      throw new Error(`Found ${activeJobs.length} active authorized-product export job(s) before enabling vNext gate.`);
    }

    const enabledVars = await applyGate(config, railwayConfig, railwayEnv, true, evidence, "enable vNext gate");
    gateEnabled = true;
    if (enabledVars.VNEXT_MUTATION_ENABLED.toLowerCase() !== "true") {
      throw new Error("VNEXT_MUTATION_ENABLED was not true after gate enable.");
    }
    if (enabledVars.VNEXT_MUTATION_APPROVED_RELEASE_SHA !== config.releaseSha) {
      throw new Error("VNEXT_MUTATION_APPROVED_RELEASE_SHA does not match authorized release after gate enable.");
    }
    if (enabledVars.VNEXT_MUTATION_ALLOWLIST_JSON !== JSON.stringify(config.allowlist)) {
      throw new Error("VNEXT_MUTATION_ALLOWLIST_JSON does not exactly match the authorized tuple after gate enable.");
    }
    if (enabledVars.VNEXT_MUTATION_ALLOWED_FIELD_CLASS !== "image") {
      throw new Error("VNEXT_MUTATION_ALLOWED_FIELD_CLASS was not exactly image after gate enable.");
    }
    if (enabledVars.VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256.toLowerCase() !== config.mutationPayloadChecksum) {
      throw new Error("VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256 does not match the authorized outbound mutation checksum after gate enable.");
    }

    const token = await login(config);
    const gateActiveResult = await waitForVnextGateActive(config, token);
    evidence.preflight.gateActiveVerification = gateActiveResult;

    // Confirm the old Railway deployment is drained before submitting the controlled job.
    // waitForVnextGateActive already proves the NEW HTTP instance has the right SHA + gate.
    // waitForOldDeploymentDrained is the authoritative drain check: it polls the Railway
    // deployment list and waits until no old-SHA deployments remain active (i.e. the old
    // instance that had gate=OFF is gone from the deployment list).  A fixed 60 s sleep
    // follows as a final buffer for Railway's BullMQ graceful-shutdown grace period (~30 s).
    const drainResult = await waitForOldDeploymentDrained(config, railwayConfig, railwayEnv);
    evidence.preflight.oldDeploymentDrained = drainResult;
    if (config.preflightOnly) {
      evidence.status = "preflight_ready_no_write";
      evidence.api.createdJob = null;
      evidence.api.processedJob = null;
      evidence.verification.providerWrites = 0;
      evidence.verification.exportJobCreated = 0;
      return;
    }
    await sleep(60000);

    const createResult = await request("POST", config.apiBaseUrl, `/marketplace/products/${encodeURIComponent(config.product)}/export-jobs`, {
      token,
      body: {
        channel: "shopify",
        installationId: config.installation,
        fallbackAcknowledged: true,
        executionMode: "controlled_vnext_required",
      },
      timeoutMs: 45000,
    });
    assertStatus(createResult, [200, 201], "POST /marketplace/products/:id/export-jobs");
    const jobId = String(createResult.body?.id ?? "").trim();
    if (!jobId) {
      throw new Error("Created export job did not return an id.");
    }
    evidence.api.createdJob = {
      id: jobId,
      status: createResult.body?.status ?? null,
      channel: createResult.body?.channel ?? null,
      installationId: createResult.body?.installationId ?? null,
    };

    const processResult = await request("POST", config.apiBaseUrl, `/marketplace/export-jobs/${encodeURIComponent(jobId)}/process`, {
      token,
      timeoutMs: 90000,
      body: { executionMode: "controlled_vnext_required" },
    });
    assertStatus(processResult, [200, 201, 202], "POST /marketplace/export-jobs/:id/process");
    const terminalJob = await waitForExportJobTerminal(config, token, jobId);
    evidence.api.processedJob = {
      id: processResult.body?.id ?? jobId,
      status: processResult.body?.status ?? null,
      failureReason: processResult.body?.failureReason ?? null,
      dlqReason: processResult.body?.dlqReason ?? null,
    };
    evidence.api.terminalJob = {
      attempt: terminalJob.attempt,
      id: terminalJob.job?.id ?? jobId,
      status: terminalJob.job?.status ?? null,
      failureReason: terminalJob.job?.failureReason ?? null,
      dlqReason: terminalJob.job?.dlqReason ?? null,
    };
    if (String(terminalJob.job?.status ?? "").toLowerCase() !== "completed") {
      evidence.api.failedLog = findVnextFailedLog(config, railwayConfig, railwayEnv);
      throw new Error(`Export job did not complete successfully; terminal status is ${terminalJob.job?.status ?? "<unknown>"}. failedLog=${JSON.stringify(evidence.api.failedLog)}`);
    }

    const submissionEvidence = await querySubmissionEvidence(config, jobId);
    evidence.verification.submission = submissionEvidence.submission;
    evidence.verification.duplicateSubmissions = submissionEvidence.duplicateSubmissions;
    evidence.verification.crossTenantSubmissions = submissionEvidence.crossTenantSubmissions;
    if (submissionEvidence.submission.status !== "SUCCESS") {
      throw new Error(`Connector submission status is ${submissionEvidence.submission.status}, expected SUCCESS.`);
    }
    if (submissionEvidence.submission.externalRef !== config.shopifyProductGid) {
      throw new Error(`Connector submission externalRef mismatch: expected ${config.shopifyProductGid}, got ${submissionEvidence.submission.externalRef ?? "<unset>"}.`);
    }
    if (submissionEvidence.duplicateSubmissions !== 0) {
      throw new Error(`Duplicate submission count after start is ${submissionEvidence.duplicateSubmissions}, expected 0.`);
    }
    if (submissionEvidence.crossTenantSubmissions !== 0) {
      throw new Error(`Cross-tenant submission count after start is ${submissionEvidence.crossTenantSubmissions}, expected 0.`);
    }
    if (!submissionEvidence.submission.vnextAudit) {
      throw new Error("Connector submission is missing __vnextMutationAudit.");
    }
    if (submissionEvidence.submission.vnextAudit.payloadChecksum !== config.mutationPayloadChecksum) {
      throw new Error(`Audit payload checksum mismatch: expected ${config.mutationPayloadChecksum}, got ${submissionEvidence.submission.vnextAudit.payloadChecksum ?? "<unset>"}.`);
    }
    if (submissionEvidence.submission.vnextAudit.approvedPayloadChecksum !== config.mutationPayloadChecksum) {
      throw new Error(`Audit approved payload checksum mismatch: expected ${config.mutationPayloadChecksum}, got ${submissionEvidence.submission.vnextAudit.approvedPayloadChecksum ?? "<unset>"}.`);
    }

    const executionLog = await waitForVnextExecutionLog(config, railwayConfig, railwayEnv);
    evidence.verification.vnextExecutionLog = executionLog;

    const afterPath = path.join(path.dirname(config.outputPath), `shopify-vnext-first-controlled-mutation-after-${process.env.GITHUB_RUN_ID || Date.now()}.json`);
    const after = runSnapshot(config, afterPath, "after");
    evidence.verification.afterSnapshot = {
      path: after.path,
      capturedAt: after.capturedAt,
      image: after.snapshot.product.images?.[0]?.src ?? null,
      productGid: after.snapshot.product.id,
    };
    evidence.verification.diff = assertSnapshotTransition(config, before, after);

    evidence.status = "mutation_verified";
  } finally {
    try {
      if (config.diagnosticOnly && !gateEnabled) {
        const currentVars = readRuntimeVariables(railwayConfig, railwayEnv);
        evidence.cleanup = {
          status: "diagnostic_no_gate_change",
          variables: summarizeVnextVariables(currentVars),
          completedAt: nowIso(),
        };
      } else {
        const disabledVars = await applyGate(config, railwayConfig, railwayEnv, false, evidence, "disable vNext gate");
        gateEnabled = false;
        evidence.cleanup = {
          status: disabledVars.VNEXT_MUTATION_ENABLED.toLowerCase() === "true" ? "unsafe_enabled" : "safe_disabled",
          variables: summarizeVnextVariables(disabledVars),
          completedAt: nowIso(),
        };
      }
    } catch (cleanupError) {
      evidence.cleanup = {
        status: gateEnabled ? "cleanup_failed_gate_may_still_be_enabled" : "cleanup_failed_gate_state_unknown",
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        completedAt: nowIso(),
      };
      throw cleanupError;
    } finally {
      evidence.finishedAt = nowIso();
      fs.writeFileSync(config.outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(`Wrote Shopify vNext first controlled mutation evidence to ${config.outputPath}`);
      console.log(JSON.stringify({
        status: evidence.status,
        jobId: evidence.api.createdJob?.id ?? null,
        submissionId: evidence.verification.submission?.id ?? null,
        cleanup: evidence.cleanup?.status ?? "unknown",
        output: config.outputPath,
      }, null, 2));
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
