import { Injectable, Logger } from "@nestjs/common";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";
import { promises as fs } from "node:fs";

const PRESIGNED_URL_EXPIRY_SECONDS = 60 * 60;
const LOCAL_STORAGE_DIR_NAME = "storage/media";

export type MediaStorageProbeResult =
  | { status: "exists" }
  | { status: "missing" }
  | { status: "unverifiable"; reason: "object_storage_not_configured" | "local_filesystem_probe_disabled" }
  | { status: "storage_error"; reason: string };

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly bucketName = String(process.env.R2_BUCKET_NAME ?? "").trim();
  private readonly endpoint =
    String(process.env.R2_ENDPOINT ?? "").trim() ||
    `https://${String(process.env.R2_ACCOUNT_ID ?? "").trim()}.r2.cloudflarestorage.com`;
  private readonly publicUrl = String(process.env.R2_PUBLIC_URL ?? "").trim();
  private readonly useLocalFallback = this.shouldUseLocalFallback();
  private readonly s3Client = this.useLocalFallback
    ? null
    : new S3Client({
        region: "auto",
        endpoint: this.endpoint,
        forcePathStyle: this.shouldUsePathStyle(this.endpoint),
        credentials: {
          accessKeyId: String(process.env.R2_ACCESS_KEY_ID ?? "").trim(),
          secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
        },
      });

  isLocalMode(): boolean {
    return this.useLocalFallback;
  }

  isObjectStorageConfigured(): boolean {
    return !this.useLocalFallback && Boolean(this.s3Client) && Boolean(this.bucketName);
  }

  storageSnapshot() {
    return {
      mode: this.useLocalFallback ? "filesystem" : "object_storage",
      backend: String(process.env.STORAGE_BACKEND ?? "").trim() || "unset",
      objectStorageConfigured: this.isObjectStorageConfigured(),
      publicUrlConfigured: Boolean(this.publicUrl),
    };
  }

  async upload(input: {
    tenantId: string;
    assetId: string;
    extension: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string> {
    const safeTenantId = this.sanitizeSegment(input.tenantId);
    const safeAssetId = this.sanitizeSegment(input.assetId);
    const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;

    if (this.useLocalFallback) {
      const storageDir = path.join(process.cwd(), LOCAL_STORAGE_DIR_NAME, safeTenantId);
      await fs.mkdir(storageDir, { recursive: true });
      const storagePath = path.join(storageDir, `${safeAssetId}${extension}`);
      await fs.writeFile(storagePath, input.buffer);
      return storagePath;
    }

    const key = `media/${safeTenantId}/${safeAssetId}${extension}`;
    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );
    return key;
  }

  async resolveDownloadUrl(storagePath: string, fileName: string): Promise<string | null> {
    if (!storagePath) return null;

    if (path.isAbsolute(storagePath) || storagePath.startsWith("storage/")) {
      return null;
    }

    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, "")}/${storagePath}`;
    }

    try {
      const url = await getSignedUrl(
        this.s3Client as S3Client,
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: storagePath,
          ResponseContentDisposition: `inline; filename="${fileName}"`,
        }),
        { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS },
      );
      return url;
    } catch (error) {
      this.logger.warn("Failed to generate presigned URL for media asset", { storagePath, error: String(error) });
      return null;
    }
  }

  /** Reads a local-filesystem-stored asset back into memory. Only meaningful when isLocalMode() is true. */
  async readLocalFile(storagePath: string): Promise<Buffer> {
    return fs.readFile(storagePath);
  }

  async probeObjectKey(storagePath: string): Promise<MediaStorageProbeResult> {
    if (!this.isObjectStorageConfigured()) {
      return { status: "unverifiable", reason: "object_storage_not_configured" };
    }
    try {
      await this.s3Client!.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: storagePath }));
      return { status: "exists" };
    } catch (error: unknown) {
      const name = String((error as { name?: unknown })?.name ?? "");
      const httpStatus = Number((error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode ?? 0);
      if (name === "NotFound" || httpStatus === 404) {
        return { status: "missing" };
      }
      return { status: "storage_error", reason: name || `http_${httpStatus || "unknown"}` };
    }
  }

  async probeLocalPath(storagePath: string, enabled: boolean): Promise<MediaStorageProbeResult> {
    if (!enabled) {
      return { status: "unverifiable", reason: "local_filesystem_probe_disabled" };
    }
    try {
      await fs.access(storagePath);
      return { status: "exists" };
    } catch (error: unknown) {
      const code = String((error as { code?: unknown })?.code ?? "");
      if (code === "ENOENT") {
        return { status: "missing" };
      }
      return { status: "storage_error", reason: code || "local_probe_error" };
    }
  }

  async delete(storagePath: string): Promise<void> {
    if (!storagePath) return;

    if (path.isAbsolute(storagePath) || storagePath.startsWith("storage/")) {
      await fs.unlink(storagePath).catch(() => undefined);
      return;
    }

    try {
      await this.s3Client?.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: storagePath,
        }),
      );
    } catch (error) {
      this.logger.warn("Failed to delete media asset from R2", { storagePath, error: String(error) });
    }
  }

  private shouldUseLocalFallback(): boolean {
    // Per-service override takes priority over the global STORAGE_BACKEND flag,
    // matching the existing AuthExportStorageService (ACCOUNT_EXPORT_STORAGE_MODE)
    // pattern — lets this service migrate to R2 independently of the others.
    const explicitMode = String(process.env.MEDIA_STORAGE_MODE ?? "").trim().toLowerCase();
    if (explicitMode === "filesystem") {
      return true;
    }
    if (explicitMode === "object_storage") {
      return false;
    }
    if (String(process.env.STORAGE_BACKEND ?? "").trim().toLowerCase() === "local") {
      return true;
    }
    const explicitEndpoint = String(process.env.R2_ENDPOINT ?? "").trim();
    if (explicitEndpoint) return false;
    const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim().toLowerCase();
    return !accountId || accountId === "local-dev";
  }

  private shouldUsePathStyle(endpointInput: string): boolean {
    try {
      const ep = new URL(endpointInput);
      return ep.hostname === "127.0.0.1" || ep.hostname === "localhost";
    } catch {
      return false;
    }
  }

  private sanitizeSegment(value: string): string {
    return String(value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "media";
  }
}
