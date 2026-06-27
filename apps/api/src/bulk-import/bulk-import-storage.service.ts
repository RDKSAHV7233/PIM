import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";

@Injectable()
export class BulkImportStorageService implements OnModuleInit {
  private readonly logger = new Logger(BulkImportStorageService.name);
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

  onModuleInit() {
    if (this.useLocalFallback) {
      this.logger.log("Bulk import storage: using local filesystem fallback");
    } else if (!this.bucketName) {
      this.logger.warn(
        "R2_BUCKET_NAME is not configured — bulk import file staging will fail. " +
        "Set R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY environment variables.",
      );
    }
  }

  async storeStagedCsv(input: {
    tenantKey: string;
    runId: string;
    content: Buffer;
  }): Promise<{ storageKey: string }> {
    const safeTenantKey = this.sanitizeSegment(input.tenantKey);
    const safeRunId = this.sanitizeSegment(input.runId);

    if (this.useLocalFallback) {
      const storageDir = path.join(process.cwd(), "storage", "imports", safeTenantKey, safeRunId);
      await fs.mkdir(storageDir, { recursive: true });
      const storagePath = path.join(storageDir, "source.csv");
      await fs.writeFile(storagePath, input.content);
      return { storageKey: storagePath };
    }

    const key = `imports/${safeTenantKey}/${safeRunId}/source.csv`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: input.content,
      ContentType: "text/csv; charset=utf-8",
    });
    if (!this.s3Client) {
      throw new Error("S3/R2 client is not initialized");
    }
    await this.s3Client.send(command);
    return { storageKey: key };
  }

  async readStagedCsvStream(storageKey: string): Promise<NodeJS.ReadableStream> {
    if (path.isAbsolute(storageKey)) {
      return createReadStream(storageKey, { encoding: "utf8" });
    }

    if (!this.s3Client) {
      throw new Error("S3/R2 client is not initialized");
    }
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: storageKey,
    });
    const response = await this.s3Client.send(command);
    if (!response?.Body) {
      throw new Error(`Failed to read staged CSV from storage: ${storageKey}`);
    }
    return response.Body as NodeJS.ReadableStream;
  }

  stagingKeyToLocalPath(storageKey: string): string | null {
    if (path.isAbsolute(storageKey)) {
      return storageKey;
    }
    return null;
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
    return !accountId || accountId.startsWith("local-");
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
    return String(value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "import";
  }
}
