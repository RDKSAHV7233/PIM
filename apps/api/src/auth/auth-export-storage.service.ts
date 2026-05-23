import { Injectable, Logger } from "@nestjs/common";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "node:path";
import { promises as fs } from "node:fs";

const DOWNLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const ACCOUNT_EXPORT_STORAGE_PUBLIC_MESSAGE =
  "Account export storage is temporarily unavailable. Please contact support if this persists.";
const LOCAL_PLACEHOLDER_ACCOUNT_ID = "local-dev";
const LOCAL_PLACEHOLDER_BUCKET_NAME = "vexa-pim-local";

export class AccountExportStorageError extends Error {
  constructor(
    message: string,
    readonly publicMessage = ACCOUNT_EXPORT_STORAGE_PUBLIC_MESSAGE,
  ) {
    super(message);
    this.name = "AccountExportStorageError";
  }
}

export type AuthExportDownloadLocation =
  | {
      kind: "url";
      downloadUrl: string;
      expiresInSeconds: number;
    }
  | {
      kind: "binary";
      content: Buffer;
      contentType: string;
      fileName: string;
    }
  | {
      kind: "unavailable";
      reason: string;
    };

export interface AccountExportStorageProbeResult {
  ok: boolean;
  checkedAt: string;
  mode: "local_fallback" | "object_storage";
  code: string | null;
  message: string | null;
  endpointHost: string | null;
  bucketName: string | null;
}

@Injectable()
export class AuthExportStorageService {
  private readonly logger = new Logger(AuthExportStorageService.name);
  private readonly accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
  private readonly accessKeyId = String(process.env.R2_ACCESS_KEY_ID ?? "").trim();
  private readonly secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
  private readonly bucketName = String(process.env.R2_BUCKET_NAME ?? "").trim();
  private readonly explicitEndpoint = String(process.env.R2_ENDPOINT ?? "").trim();
  private readonly endpoint =
    this.explicitEndpoint ||
    `https://${this.accountId}.r2.cloudflarestorage.com`;
  private readonly useLocalFallback = this.shouldUseLocalFallback();
  private readonly s3Client = this.useLocalFallback
    ? null
    : new S3Client({
        region: "auto",
        endpoint: this.endpoint,
        forcePathStyle: this.shouldUsePathStyle(this.endpoint),
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });

  async storeAccountExportArtifact(input: {
    tenantId: string;
    userId: string;
    jobId: string;
    format: "json" | "csv";
    fileContents: string;
  }): Promise<{ storagePath: string; fileName: string }> {
    const safeTenantId = this.sanitizeSegment(input.tenantId);
    const safeUserId = this.sanitizeSegment(input.userId);
    const safeJobId = this.sanitizeSegment(input.jobId);
    const extension = input.format === "csv" ? ".csv" : ".json";
    const fileName = `${safeUserId}-${safeJobId}${extension}`;

    if (this.useLocalFallback) {
      const storageDir = path.join(process.cwd(), "storage", "account-exports", safeTenantId);
      await fs.mkdir(storageDir, { recursive: true });
      const storagePath = path.join(storageDir, fileName);
      await fs.writeFile(storagePath, input.fileContents, "utf8");
      return {
        storagePath,
        fileName,
      };
    }

    const configError = this.validateObjectStorageConfiguration();
    if (configError) {
      this.logger.error(
        `${configError.message} endpointHost=${this.endpointHost()} bucket=${this.bucketName || "unset"}`,
      );
      throw configError;
    }

    const key = `exports/${safeTenantId}/${safeJobId}${extension}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: input.fileContents,
      ContentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      ContentDisposition: `attachment; filename="account-export-${safeJobId}${extension}"`,
    });
    try {
      await this.s3Client?.send(command);
    } catch (error: unknown) {
      const storageError = this.normalizeStorageWriteError(error);
      this.logger.error(
        `${storageError.message} endpointHost=${this.endpointHost()} bucket=${this.bucketName || "unset"} raw=${this.toErrorMessage(error)}`,
      );
      throw storageError;
    }
    return {
      storagePath: key,
      fileName,
    };
  }

  async resolveAccountExportDownload(input: {
    artifactPath: string | null | undefined;
    format: "json" | "csv";
    fileName: string;
  }): Promise<AuthExportDownloadLocation> {
    const artifactPath = String(input.artifactPath ?? "").trim();
    if (!artifactPath) {
      return {
        kind: "unavailable",
        reason: "Export not yet ready or has expired.",
      };
    }

    if (path.isAbsolute(artifactPath)) {
      try {
        const content = await fs.readFile(artifactPath);
        return {
          kind: "binary",
          content,
          contentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
          fileName: input.fileName,
        };
      } catch {
        this.logger.warn("Legacy local-disk account export artifact is unavailable.", {
          artifactPath,
        });
        return {
          kind: "unavailable",
          reason: "Export not yet ready or has expired.",
        };
      }
    }

    try {
      await this.s3Client?.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: artifactPath,
        }),
      );
    } catch {
      return {
        kind: "unavailable",
        reason: "Export not yet ready or has expired.",
      };
    }

    const fileExtension = input.format === "csv" ? ".csv" : ".json";
    const downloadUrl = await getSignedUrl(
      this.s3Client as S3Client,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: artifactPath,
        ResponseContentDisposition: `attachment; filename="${input.fileName || `account-export${fileExtension}`}"`,
        ResponseContentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      }),
      { expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS },
    );

    return {
      kind: "url",
      downloadUrl,
      expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
    };
  }

  async probeAccountExportStorage(): Promise<AccountExportStorageProbeResult> {
    const checkedAt = new Date().toISOString();
    if (this.useLocalFallback) {
      return {
        ok: true,
        checkedAt,
        mode: "local_fallback",
        code: null,
        message: null,
        endpointHost: null,
        bucketName: null,
      };
    }

    const configError = this.validateObjectStorageConfiguration();
    if (configError) {
      return {
        ok: false,
        checkedAt,
        mode: "object_storage",
        code: this.extractStorageErrorCode(configError.message),
        message: configError.message,
        endpointHost: this.endpointHost(),
        bucketName: this.bucketName || null,
      };
    }

    const probeKey = this.buildProbeKey();
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: probeKey,
      Body: JSON.stringify({
        checkedAt,
        env: String(process.env.APP_ENV ?? "development").trim().toLowerCase() || "development",
      }),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
    });

    try {
      await this.s3Client?.send(command);
      return {
        ok: true,
        checkedAt,
        mode: "object_storage",
        code: null,
        message: null,
        endpointHost: this.endpointHost(),
        bucketName: this.bucketName || null,
      };
    } catch (error: unknown) {
      const storageError = this.normalizeStorageWriteError(error);
      return {
        ok: false,
        checkedAt,
        mode: "object_storage",
        code: this.extractStorageErrorCode(storageError.message),
        message: storageError.message,
        endpointHost: this.endpointHost(),
        bucketName: this.bucketName || null,
      };
    }
  }

  private shouldUseLocalFallback(): boolean {
    const env = String(process.env.APP_ENV ?? "").trim().toLowerCase();
    const explicitEndpoint = String(process.env.R2_ENDPOINT ?? "").trim();
    if (explicitEndpoint) {
      return false;
    }
    if (env === "staging" || env === "production") {
      return false;
    }
    const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim().toLowerCase();
    return !accountId || accountId === "local-dev";
  }

  private shouldUsePathStyle(endpointInput: string): boolean {
    try {
      const endpoint = new URL(endpointInput);
      return endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
    } catch {
      return false;
    }
  }

  private sanitizeSegment(value: string): string {
    return String(value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
  }

  private validateObjectStorageConfiguration(): AccountExportStorageError | null {
    if (this.useLocalFallback) {
      return null;
    }

    const missingVariables: string[] = [];
    if (!this.bucketName) {
      missingVariables.push("R2_BUCKET_NAME");
    }
    if (!this.accessKeyId) {
      missingVariables.push("R2_ACCESS_KEY_ID");
    }
    if (!this.secretAccessKey) {
      missingVariables.push("R2_SECRET_ACCESS_KEY");
    }
    if (!this.accountId && !this.explicitEndpoint) {
      missingVariables.push("R2_ACCOUNT_ID");
    }
    if (missingVariables.length > 0) {
      return new AccountExportStorageError(
        `account_export_storage_config_invalid: Missing required storage configuration (${missingVariables.join(", ")}).`,
      );
    }

    if (this.isLocalEndpointForTesting()) {
      return null;
    }

    const placeholderValues: string[] = [];
    if (this.accountId.toLowerCase() === LOCAL_PLACEHOLDER_ACCOUNT_ID) {
      placeholderValues.push("R2_ACCOUNT_ID=local-dev");
    }
    if (this.accessKeyId.toLowerCase() === LOCAL_PLACEHOLDER_ACCOUNT_ID) {
      placeholderValues.push("R2_ACCESS_KEY_ID=local-dev");
    }
    if (this.secretAccessKey.toLowerCase() === LOCAL_PLACEHOLDER_ACCOUNT_ID) {
      placeholderValues.push("R2_SECRET_ACCESS_KEY=local-dev");
    }
    if (this.bucketName.toLowerCase() === LOCAL_PLACEHOLDER_BUCKET_NAME) {
      placeholderValues.push("R2_BUCKET_NAME=vexa-pim-local");
    }
    if (this.endpointHost() === `${LOCAL_PLACEHOLDER_ACCOUNT_ID}.r2.cloudflarestorage.com`) {
      placeholderValues.push(`endpointHost=${LOCAL_PLACEHOLDER_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    }
    if (placeholderValues.length > 0) {
      return new AccountExportStorageError(
        `account_export_storage_config_invalid: Placeholder/local-default storage configuration detected (${placeholderValues.join(", ")}).`,
      );
    }

    return null;
  }

  private normalizeStorageWriteError(error: unknown): AccountExportStorageError {
    const rawMessage = this.toErrorMessage(error);
    const normalized = rawMessage.toLowerCase();

    if (
      normalized.includes("eproto") ||
      normalized.includes("ssl/tls") ||
      normalized.includes("ssl routines") ||
      normalized.includes("handshake failure") ||
      normalized.includes("wrong version number") ||
      normalized.includes("secure tls connection")
    ) {
      return new AccountExportStorageError(
        "account_export_storage_tls_handshake_failed: Verify R2 endpoint and TLS settings for account export storage.",
      );
    }

    if (
      normalized.includes("econnrefused") ||
      normalized.includes("enotfound") ||
      normalized.includes("eai_again") ||
      normalized.includes("timed out") ||
      normalized.includes("etimedout")
    ) {
      return new AccountExportStorageError(
        "account_export_storage_unreachable: Verify R2 endpoint reachability and network access for account export storage.",
      );
    }

    return new AccountExportStorageError(
      "account_export_storage_write_failed: Verify account export storage configuration and retry the export.",
    );
  }

  private endpointHost(): string {
    try {
      return new URL(this.endpoint).host;
    } catch {
      return "invalid-endpoint";
    }
  }

  private isLocalEndpointForTesting(): boolean {
    return this.shouldUsePathStyle(this.endpoint);
  }

  private buildProbeKey(): string {
    const env = this.sanitizeSegment(String(process.env.APP_ENV ?? "development").trim().toLowerCase() || "development");
    return `healthchecks/account-export-storage/${env}.json`;
  }

  private extractStorageErrorCode(message: string): string {
    const prefix = String(message ?? "").split(":")[0]?.trim();
    return prefix || "account_export_storage_probe_failed";
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim();
    }
    return String(error ?? "unknown_error");
  }
}
