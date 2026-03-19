import { Injectable, Logger } from "@nestjs/common";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "node:path";
import { promises as fs } from "node:fs";

const DOWNLOAD_URL_EXPIRY_SECONDS = 15 * 60;

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

@Injectable()
export class AuthExportStorageService {
  private readonly logger = new Logger(AuthExportStorageService.name);
  private readonly bucketName = String(process.env.R2_BUCKET_NAME ?? "").trim();
  private readonly endpoint =
    String(process.env.R2_ENDPOINT ?? "").trim() ||
    `https://${String(process.env.R2_ACCOUNT_ID ?? "").trim()}.r2.cloudflarestorage.com`;
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

    const key = `exports/${safeTenantId}/${safeJobId}${extension}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: input.fileContents,
      ContentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      ContentDisposition: `attachment; filename="account-export-${safeJobId}${extension}"`,
    });
    await this.s3Client?.send(command);
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
}
