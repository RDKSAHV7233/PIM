import { BulkImportStorageService } from "../bulk-import/bulk-import-storage.service";

// TEMPORARY, gated by RUN_BULK_IMPORT_STORAGE_PROBE_ONCE=true. Part of #483
// (TECH-STORAGE-BACKEND-MIGRATION-001) acceptance verification. Exercises the
// real BulkImportStorageService (no NestJS DI needed — it has no constructor
// dependencies) rather than reimplementing its S3 calls: storeStagedCsv() to
// write, readStagedCsvStream() to read back — the exact method the real
// import processor calls — against a clearly-marked non-tenant key. Also
// confirms an unsigned direct request to the same key is rejected. Touches
// no DB row. Remove this file and its call site in main.ts once #483
// acceptance verification is complete.

const PROBE_TENANT_SEGMENT = "_acceptance-probe";

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runBulkImportStorageProbeOnce(): Promise<void> {
  if (String(process.env.RUN_BULK_IMPORT_STORAGE_PROBE_ONCE ?? "").trim().toLowerCase() !== "true") {
    return;
  }

  console.log("[bulk-import-storage-probe] RUN_BULK_IMPORT_STORAGE_PROBE_ONCE=true, starting");

  const runId = `probe-${Date.now()}`;
  const csvContent = "sku,title\nACCEPTANCE-PROBE,safe to delete\n";
  const result: {
    write: boolean;
    storageKey: string | null;
    authorizedRead: boolean;
    unsignedRejected: boolean;
  } = { write: false, storageKey: null, authorizedRead: false, unsignedRejected: false };

  const storage = new BulkImportStorageService();

  try {
    const { storageKey } = await storage.storeStagedCsv({
      tenantKey: PROBE_TENANT_SEGMENT,
      runId,
      content: Buffer.from(csvContent, "utf8"),
    });
    result.storageKey = storageKey;
    result.write = true;
  } catch (error) {
    console.error("[bulk-import-storage-probe] write failed:", error instanceof Error ? error.message : String(error));
    console.log("[bulk-import-storage-probe] result:", JSON.stringify(result));
    return;
  }

  try {
    const stream = await storage.readStagedCsvStream(result.storageKey!);
    const readBack = await streamToString(stream);
    result.authorizedRead = readBack === csvContent;
    if (!result.authorizedRead) {
      console.error("[bulk-import-storage-probe] authorized read content mismatch");
    }
  } catch (error) {
    console.error("[bulk-import-storage-probe] authorized read failed:", error instanceof Error ? error.message : String(error));
  }

  // readStagedCsvStream uses the app's own R2 credentials server-side — there is
  // no presigned-URL concept in this service (unlike media/exports/connector
  // snapshots). To prove the object isn't reachable without those credentials,
  // issue a plain unsigned GET straight at the R2 S3-compatible endpoint.
  try {
    const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
    const endpoint = String(process.env.R2_ENDPOINT ?? "").trim() || `https://${accountId}.r2.cloudflarestorage.com`;
    const bucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? process.env.R2_BUCKET_NAME ?? "").trim();
    const unsignedUrl = `${endpoint.replace(/\/+$/, "")}/${bucket}/${result.storageKey}`;
    const unsignedRes = await fetch(unsignedUrl);
    result.unsignedRejected = unsignedRes.status !== 200;
    if (!result.unsignedRejected) {
      console.error("[bulk-import-storage-probe] unsigned request was NOT rejected — private bucket may be misconfigured");
    }
  } catch {
    result.unsignedRejected = true;
  }

  console.log("[bulk-import-storage-probe] result:", JSON.stringify(result));
}
