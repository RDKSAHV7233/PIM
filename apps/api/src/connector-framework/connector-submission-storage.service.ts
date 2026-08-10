import { Injectable } from "@nestjs/common";
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "node:path";
import { promises as fs } from "node:fs";
import { LoggerService } from "../common/logging/logger.service";

// Presigned URL TTL for payload snapshots — internal debug artifacts, 7-day access.
const SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_LOCAL_STORAGE_ROOT = path.join("storage", "connector-snapshots");

/**
 * Stores oversized connector submission payload snapshots.
 *
 * In staging/production: uploads to R2/S3 and returns a presigned download URL.
 * In development (no R2 credentials): falls back to local filesystem.
 *
 * Follows the same pattern as BulkImportStorageService and AuthExportStorageService.
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 *           R2_ENDPOINT (optional override), APP_ENV (staging|production forces R2).
 */
@Injectable()
export class ConnectorSubmissionStorageService {
  private readonly useLocalFallback: boolean;
  private readonly bucketName: string;
  private readonly s3Client: S3Client | null;
  private readonly localStorageRoot: string;

  constructor(private readonly logger: LoggerService) {
    const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
    const accessKeyId = String(process.env.R2_ACCESS_KEY_ID ?? "").trim();
    const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
    const explicitEndpoint = String(process.env.R2_ENDPOINT ?? "").trim();

    // Private artifacts live in a separate bucket from public media — falls back
    // to R2_BUCKET_NAME only if the dedicated private bucket isn't configured.
    this.bucketName = String(process.env.R2_PRIVATE_BUCKET_NAME ?? process.env.R2_BUCKET_NAME ?? "").trim();
    this.localStorageRoot = path.join(
      process.cwd(),
      String(process.env.CONNECTOR_SNAPSHOT_STORAGE_DIR ?? DEFAULT_LOCAL_STORAGE_ROOT).trim(),
    );
    this.useLocalFallback = this.shouldUseLocalFallback(accountId, explicitEndpoint);

    if (!this.useLocalFallback) {
      const endpoint = explicitEndpoint || `https://${accountId}.r2.cloudflarestorage.com`;
      this.s3Client = new S3Client({
        region: "auto",
        endpoint,
        forcePathStyle: this.isLocalEndpoint(endpoint),
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.s3Client = null;
    }
  }

  /**
   * Upload a payload snapshot and return a URL (presigned for R2, local path for FS).
   * The returned `storageKey` is stored in ConnectorSubmission.payloadSnapshotUrl.
   */
  async storeSnapshot(input: {
    tenantKey: string;
    jobId: string;
    content: string;
  }): Promise<{ storageKey: string; accessUrl: string }> {
    const safeTenant = this.sanitize(input.tenantKey);
    const safeJob = this.sanitize(input.jobId);
    const filename = `${safeJob}-payload.json`;

    if (this.useLocalFallback) {
      const dir = path.join(this.localStorageRoot, safeTenant);
      await fs.mkdir(dir, { recursive: true });
      const storagePath = path.join(dir, filename);
      await fs.writeFile(storagePath, input.content, "utf8");
      this.logger.info("connector.snapshot.stored_local", {
        tenantKey: input.tenantKey,
        jobId: input.jobId,
        path: storagePath,
      });
      return { storageKey: storagePath, accessUrl: storagePath };
    }

    const key = `connector-snapshots/${safeTenant}/${filename}`;
    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: input.content,
        ContentType: "application/json; charset=utf-8",
        // No public-read — accessed via presigned URL only.
      }),
    );

    const accessUrl = await getSignedUrl(
      this.s3Client!,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ResponseContentType: "application/json; charset=utf-8",
        ResponseContentDisposition: `inline; filename="${filename}"`,
      }),
      { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
    );

    this.logger.info("connector.snapshot.stored_r2", {
      tenantKey: input.tenantKey,
      jobId: input.jobId,
      key,
    });

    return { storageKey: key, accessUrl };
  }

  private shouldUseLocalFallback(accountId: string, explicitEndpoint: string): boolean {
    // Per-service override takes priority over the global STORAGE_BACKEND flag,
    // matching AuthExportStorageService's ACCOUNT_EXPORT_STORAGE_MODE pattern.
    const explicitMode = String(process.env.CONNECTOR_SNAPSHOT_STORAGE_MODE ?? "").trim().toLowerCase();
    if (explicitMode === "filesystem") {
      return true;
    }
    if (explicitMode === "object_storage") {
      return false;
    }
    if (String(process.env.STORAGE_BACKEND ?? "").trim().toLowerCase() === "local") {
      return true;
    }
    if (explicitEndpoint) return false;
    return !accountId || accountId.toLowerCase() === "local-dev";
  }

  private isLocalEndpoint(endpoint: string): boolean {
    try {
      const host = new URL(endpoint).hostname;
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  }

  private sanitize(value: string): string {
    return (
      String(value ?? "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/\.{2,}/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "")
      || "unknown"
    );
  }
}
