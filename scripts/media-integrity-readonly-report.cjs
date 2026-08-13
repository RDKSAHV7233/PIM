#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_OUTPUT = ".run-logs/media-integrity-readonly-report.json";

function loadPrismaClient() {
  return require("@prisma/client").PrismaClient;
}

function loadS3ClientPackage() {
  return require("@aws-sdk/client-s3");
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isLocalPath(value) {
  const raw = normalizeText(value);
  return (
    raw.length > 0 &&
    (path.isAbsolute(raw) ||
      /^[A-Za-z]:\\/.test(raw) ||
      raw.includes("storage/media") ||
      raw.includes("storage\\media"))
  );
}

function classifyStoragePath(value) {
  const raw = normalizeText(value);
  if (!raw) return "empty";
  if (isLocalPath(raw)) return "local_path";
  if (/^https?:\/\//i.test(raw)) return "external_url";
  return "object_key";
}

function createS3ClientFromEnv(env = process.env) {
  const accountId = normalizeText(env.R2_ACCOUNT_ID);
  const accessKeyId = normalizeText(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = normalizeText(env.R2_SECRET_ACCESS_KEY);
  const bucket = normalizeText(env.R2_BUCKET_NAME);
  const endpoint = normalizeText(env.R2_ENDPOINT) || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    return { available: false, bucketConfigured: Boolean(bucket), s3: null, bucket: "" };
  }

  return {
    available: true,
    bucketConfigured: true,
    bucket,
    s3: (() => {
      const { S3Client } = loadS3ClientPackage();
      return new S3Client({
        region: "auto",
        endpoint,
        forcePathStyle: shouldUsePathStyle(endpoint),
        credentials: { accessKeyId, secretAccessKey },
      });
    })(),
  };
}

function shouldUsePathStyle(endpointInput) {
  try {
    const parsed = new URL(endpointInput);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function emptyCounts() {
  return {
    total: 0,
    exists: 0,
    missing: 0,
    unverifiable: 0,
    errors: 0,
  };
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function buildSafeSummary(rows, probeResults, options = {}) {
  const byStorageKind = {};
  const byTenant = {};
  const byCreatedDate = {};
  const missingByTenant = {};
  const missingByCreatedDate = {};
  const productStatusCounts = {};
  const missingProductStatusCounts = {};
  const activeProductStatuses = new Set(["approved", "active", "published"]);
  const totals = {
    rowsExamined: rows.length,
    exists: 0,
    missing: 0,
    unverifiable: 0,
    errors: 0,
    referencedByProduct: 0,
    referencedByVariant: 0,
    referencedByActiveProduct: 0,
    missingReferencedByProduct: 0,
    missingReferencedByVariant: 0,
    missingReferencedByActiveProduct: 0,
  };

  const storageExistence = {
    object_key: emptyCounts(),
    local_path: emptyCounts(),
    external_url: emptyCounts(),
    empty: emptyCounts(),
  };

  let earliestMissingCreatedAt = null;
  let latestMissingCreatedAt = null;

  for (const row of rows) {
    const kind = classifyStoragePath(row.storagePath);
    const tenantKey = normalizeText(row.tenantKey) || "unknown";
    const createdDate = toIsoDate(row.createdAt) || "unknown";
    const productStatus = normalizeText(row.product?.status) || "none";
    const deletedAt = row.product?.deletedAt ?? null;
    const productActive = Boolean(row.productId && !deletedAt && activeProductStatuses.has(productStatus));
    const probe = probeResults.get(row.id) ?? { status: "unverifiable" };

    increment(byStorageKind, kind);
    increment(byTenant, tenantKey);
    increment(byCreatedDate, createdDate);
    increment(productStatusCounts, productStatus);

    storageExistence[kind].total++;
    if (probe.status === "exists") {
      storageExistence[kind].exists++;
      totals.exists++;
    } else if (probe.status === "missing") {
      storageExistence[kind].missing++;
      totals.missing++;
      increment(missingByTenant, tenantKey);
      increment(missingByCreatedDate, createdDate);
      increment(missingProductStatusCounts, productStatus);
      const createdAtIso = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
      if (!earliestMissingCreatedAt || createdAtIso < earliestMissingCreatedAt) {
        earliestMissingCreatedAt = createdAtIso;
      }
      if (!latestMissingCreatedAt || createdAtIso > latestMissingCreatedAt) {
        latestMissingCreatedAt = createdAtIso;
      }
    } else if (probe.status === "error") {
      storageExistence[kind].errors++;
      totals.errors++;
    } else {
      storageExistence[kind].unverifiable++;
      totals.unverifiable++;
    }

    if (row.productId) totals.referencedByProduct++;
    if (row.variantId) totals.referencedByVariant++;
    if (productActive) totals.referencedByActiveProduct++;

    if (probe.status === "missing") {
      if (row.productId) totals.missingReferencedByProduct++;
      if (row.variantId) totals.missingReferencedByVariant++;
      if (productActive) totals.missingReferencedByActiveProduct++;
    }
  }

  return {
    status: "ok",
    suite: "MEDIA_INTEGRITY_READONLY_CONFIRMATION",
    capturedAt: new Date().toISOString(),
    targetEnvironment: normalizeText(options.targetEnvironment) || normalizeText(process.env.MEDIA_INTEGRITY_TARGET_ENV) || "unknown",
    mode: "read_only",
    safety: {
      databaseMutations: false,
      storageMutations: false,
      rowIdentifiersIncluded: false,
      storagePathsIncluded: false,
      fileNamesIncluded: false,
      secretValuesIncluded: false,
    },
    storageConfig: {
      appEnv: normalizeText(options.appEnv) || normalizeText(process.env.APP_ENV) || "unknown",
      storageBackend: normalizeText(options.storageBackend) || normalizeText(process.env.STORAGE_BACKEND) || "unset",
      mediaStorageMode: normalizeText(options.mediaStorageMode) || normalizeText(process.env.MEDIA_STORAGE_MODE) || "unset",
      r2Configured: Boolean(options.r2Configured),
      localFileProbeEnabled: Boolean(options.localFileProbeEnabled),
    },
    totals,
    byStorageKind,
    storageExistence,
    affectedTenants: Object.keys(missingByTenant).sort(),
    byTenant,
    missingByTenant,
    byCreatedDate,
    missingByCreatedDate,
    missingCreatedAtRange: {
      earliest: earliestMissingCreatedAt,
      latest: latestMissingCreatedAt,
    },
    productStatusCounts,
    missingProductStatusCounts,
    productionClassification:
      normalizeText(options.targetEnvironment).toLowerCase() === "production"
        ? totals.missing > 0
          ? "PRODUCTION_CONFIRMED"
          : totals.unverifiable > 0 || totals.errors > 0
            ? "PRODUCTION_INCONCLUSIVE"
            : "PRODUCTION_NO_MISSING_CONFIRMED"
        : "NON_PRODUCTION_REPORT",
  };
}

async function probeObjectKey(s3Info, storagePath) {
  if (!s3Info.available) {
    return { status: "unverifiable", reason: "r2_not_configured" };
  }
  try {
    const { HeadObjectCommand } = loadS3ClientPackage();
    await s3Info.s3.send(new HeadObjectCommand({ Bucket: s3Info.bucket, Key: storagePath }));
    return { status: "exists" };
  } catch (error) {
    const name = String(error?.name ?? "");
    const httpStatus = Number(error?.$metadata?.httpStatusCode ?? 0);
    if (name === "NotFound" || httpStatus === 404) {
      return { status: "missing" };
    }
    return { status: "error", reason: name || `http_${httpStatus || "unknown"}` };
  }
}

async function probeLocalPath(storagePath, localFileProbeEnabled) {
  if (!localFileProbeEnabled) {
    return { status: "unverifiable", reason: "local_filesystem_probe_disabled" };
  }
  try {
    await fs.access(storagePath);
    return { status: "exists" };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "error", reason: String(error?.code ?? "local_probe_error") };
  }
}

async function probeRows(rows, options = {}) {
  const s3Info = options.s3Info ?? createS3ClientFromEnv();
  const localFileProbeEnabled = Boolean(options.localFileProbeEnabled);
  const probeResults = new Map();

  for (const row of rows) {
    const kind = classifyStoragePath(row.storagePath);
    if (kind === "object_key") {
      probeResults.set(row.id, await probeObjectKey(s3Info, row.storagePath));
    } else if (kind === "local_path") {
      probeResults.set(row.id, await probeLocalPath(row.storagePath, localFileProbeEnabled));
    } else {
      probeResults.set(row.id, { status: "unverifiable", reason: kind });
    }
  }
  return probeResults;
}

async function loadRows(prisma) {
  return prisma.mediaAsset.findMany({
    select: {
      id: true,
      tenantKey: true,
      productId: true,
      variantId: true,
      storagePath: true,
      createdAt: true,
      product: { select: { status: true, deletedAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--output") {
      args.output = argv[index + 1] || "";
      index += 1;
    } else if (item === "--target-environment") {
      args.targetEnvironment = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const output = normalizeText(args.output) || DEFAULT_OUTPUT;
  const targetEnvironment = normalizeText(args.targetEnvironment) || normalizeText(process.env.MEDIA_INTEGRITY_TARGET_ENV);
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the read-only media integrity report.");
  }

  const localFileProbeEnabled = normalizeText(process.env.MEDIA_INTEGRITY_VERIFY_LOCAL_FILES).toLowerCase() === "true";
  const s3Info = createS3ClientFromEnv();
  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient();
  try {
    const rows = await loadRows(prisma);
    const probeResults = await probeRows(rows, { s3Info, localFileProbeEnabled });
    const report = buildSafeSummary(rows, probeResults, {
      targetEnvironment,
      appEnv: process.env.APP_ENV,
      storageBackend: process.env.STORAGE_BACKEND,
      mediaStorageMode: process.env.MEDIA_STORAGE_MODE,
      r2Configured: s3Info.available,
      localFileProbeEnabled,
    });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          status: report.status,
          suite: report.suite,
          targetEnvironment: report.targetEnvironment,
          productionClassification: report.productionClassification,
          rowsExamined: report.totals.rowsExamined,
          missing: report.totals.missing,
          unverifiable: report.totals.unverifiable,
          errors: report.totals.errors,
          output,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildSafeSummary,
  classifyStoragePath,
  createS3ClientFromEnv,
  isLocalPath,
  probeRows,
};
