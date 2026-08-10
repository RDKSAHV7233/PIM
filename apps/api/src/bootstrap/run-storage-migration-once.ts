import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// TEMPORARY, gated by RUN_STORAGE_MIGRATION_ONCE=true. Part of #483
// (TECH-STORAGE-BACKEND-MIGRATION-001). Copies existing local-disk-referenced
// MediaAsset and AccountExportRequest rows to R2, verifies integrity, updates
// the DB row's storage key -- and nothing else. Never deletes local files.
// Idempotent: safe to re-run, skips rows that already look like R2 keys.
// Remove this file and its call site in main.ts once the migration is
// confirmed complete and this flag is permanently unset.

function isLocalPath(value: string): boolean {
  if (!value) return false;
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:\\/.test(value) ||
    value.includes("storage/media") ||
    value.includes("storage\\media") ||
    value.includes("storage/account-exports") ||
    value.includes("storage\\account-exports")
  );
}

async function migrateMediaAssets(prisma: PrismaClient, s3: S3Client, bucket: string) {
  const summary = { attempted: 0, migrated: 0, skipped: 0, failed: 0 };
  const rows = await prisma.mediaAsset.findMany({
    select: { id: true, tenantKey: true, storagePath: true, sizeBytes: true, checksum: true, mimeType: true },
  });
  for (const row of rows) {
    if (!isLocalPath(row.storagePath)) {
      summary.skipped++;
      continue;
    }
    summary.attempted++;
    try {
      const buffer = await fs.readFile(row.storagePath);
      const actualChecksum = createHash("sha256").update(buffer).digest("hex");
      if (row.checksum && actualChecksum !== row.checksum) {
        console.error(`[storage-migration] media ${row.id}: checksum mismatch, skipping upload`);
        summary.failed++;
        continue;
      }
      const extension = path.extname(row.storagePath) || "";
      const key = `media/${row.tenantKey}/${row.id}${extension}`;
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: row.mimeType }),
      );
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (Number(head.ContentLength ?? -1) !== row.sizeBytes) {
        console.error(`[storage-migration] media ${row.id}: size mismatch after upload, not updating DB row`);
        summary.failed++;
        continue;
      }
      await prisma.mediaAsset.update({ where: { id: row.id }, data: { storagePath: key } });
      summary.migrated++;
    } catch (error) {
      console.error(
        `[storage-migration] media ${row.id}: failed -`,
        error instanceof Error ? error.message : String(error),
      );
      summary.failed++;
    }
  }
  return summary;
}

async function migrateAccountExports(prisma: PrismaClient, s3: S3Client, bucket: string) {
  const summary = { attempted: 0, migrated: 0, skipped: 0, failed: 0 };
  const rows = await prisma.accountExportRequest.findMany({
    where: { artifactPath: { not: null } },
    select: { id: true, tenantKey: true, artifactPath: true },
  });
  for (const row of rows) {
    const artifactPath = String(row.artifactPath ?? "");
    if (!isLocalPath(artifactPath)) {
      summary.skipped++;
      continue;
    }
    summary.attempted++;
    try {
      const buffer = await fs.readFile(artifactPath);
      const extension = path.extname(artifactPath) || "";
      const key = `exports/${row.tenantKey}/${row.id}${extension}`;
      const contentType = extension === ".csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (Number(head.ContentLength ?? -1) !== buffer.length) {
        console.error(`[storage-migration] export ${row.id}: size mismatch after upload, not updating DB row`);
        summary.failed++;
        continue;
      }
      await prisma.accountExportRequest.update({ where: { id: row.id }, data: { artifactPath: key } });
      summary.migrated++;
    } catch (error) {
      console.error(
        `[storage-migration] export ${row.id}: failed -`,
        error instanceof Error ? error.message : String(error),
      );
      summary.failed++;
    }
  }
  return summary;
}

export async function runStorageMigrationOnce(): Promise<void> {
  if (String(process.env.RUN_STORAGE_MIGRATION_ONCE ?? "").trim().toLowerCase() !== "true") {
    return;
  }

  console.log("[storage-migration] RUN_STORAGE_MIGRATION_ONCE=true, starting");

  const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
  const endpoint = String(process.env.R2_ENDPOINT ?? "").trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  const mediaBucket = String(process.env.R2_BUCKET_NAME ?? "").trim();
  const privateBucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? "").trim();
  if (!mediaBucket || !privateBucket) {
    console.error("[storage-migration] R2_BUCKET_NAME or R2_PRIVATE_BUCKET_NAME missing, aborting");
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: String(process.env.R2_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
    },
  });

  const prisma = new PrismaClient();
  try {
    const mediaSummary = await migrateMediaAssets(prisma, s3, mediaBucket);
    const exportSummary = await migrateAccountExports(prisma, s3, privateBucket);
    console.log(
      "[storage-migration] complete:",
      JSON.stringify({ media: mediaSummary, accountExports: exportSummary }),
    );
    console.log(
      "[storage-migration] NOT migrated (out of scope, see #483 Gate A): ConnectorSubmission snapshots (none exist yet), BulkImportRun staged CSVs (all already expired)",
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}
