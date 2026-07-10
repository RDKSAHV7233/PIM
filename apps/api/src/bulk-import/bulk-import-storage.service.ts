import { Injectable, Logger } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";

const LOCAL_FALLBACK_ACCOUNT_IDS = new Set([
  "local-dev",
  "replace-me",
  "changeme",
  "change_me",
  "todo",
  "fixme",
]);

@Injectable()
export class BulkImportStorageService {
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
    this.assertSafeStorageKey(storageKey);

    if (path.isAbsolute(storageKey)) {
      const expectedBase = path.join(process.cwd(), "storage", "imports");
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(expectedBase)) {
        this.logger.warn(`Blocked local read outside storage dir: ${storageKey}`);
        throw new Error("Invalid staged file path.");
      }
      return createReadStream(resolved, { encoding: "utf8" });
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
      this.assertSafeStorageKey(storageKey);
      return storageKey;
    }
    return null;
  }

  private shouldUseLocalFallback(): boolean {
    if (String(process.env.STORAGE_BACKEND ?? "").trim().toLowerCase() === "local") {
      return true;
    }
    const explicitEndpoint = String(process.env.R2_ENDPOINT ?? "").trim();
    if (explicitEndpoint) {
      return false;
    }
    const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim().toLowerCase();
    return !accountId || this.isLocalFallbackAccountId(accountId);
  }

  private isLocalFallbackAccountId(accountId: string): boolean {
    return (
      LOCAL_FALLBACK_ACCOUNT_IDS.has(accountId) ||
      accountId.startsWith("local-") ||
      accountId.includes("replace") ||
      accountId.includes("placeholder")
    );
  }

  private shouldUsePathStyle(endpointInput: string): boolean {
    try {
      const endpoint = new URL(endpointInput);
      return endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
    } catch {
      return false;
    }
  }

  private assertSafeStorageKey(key: string): void {
    if (!key || typeof key !== "string") {
      throw new Error("Invalid staged file path.");
    }
    if (key.includes("..")) {
      this.logger.warn(`Blocked traversal in storage key: ${key}`);
      throw new Error("Invalid staged file path.");
    }
    if (path.isAbsolute(key)) {
      return;
    }
    if (key.includes("\\")) {
      this.logger.warn(`Blocked backslash in storage key: ${key}`);
      throw new Error("Invalid staged file path.");
    }
    if (!key.startsWith("imports/")) {
      this.logger.warn(`Blocked unexpected storage key prefix: ${key}`);
      throw new Error("Invalid staged file path.");
    }
  }

  private sanitizeSegment(value: string): string {
    return String(value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "import";
  }
}
