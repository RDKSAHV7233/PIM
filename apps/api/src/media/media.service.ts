import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { IncomingMessage } from "node:http";
import { request as httpsRequest, RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { PrismaService } from "../prisma/prisma.service";
import { BulkMediaAssociationDto, BulkMediaAssociationRowDto } from "./dto/bulk-media-association.dto";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";

type Channel = "amazon" | "flipkart" | "meesho";

type EntityLink = {
  productId: string | null;
  variantId: string | null;
  entityType: "product" | "variant";
};

type ResolvedMediaInput = {
  fileName: string;
  mimeType: string;
  contentBuffer: Buffer;
  width?: number;
  height?: number;
  sourceRef?: string | null;
};

type ResolvedRemoteImageUrl = {
  parsedUrl: URL;
  resolvedAddress: string;
  family: 4 | 6;
};

type ChannelRule = {
  minWidth: number;
  minHeight: number;
  aspectMin: number;
  aspectMax: number;
};

const CHANNEL_RULES: Record<Channel, ChannelRule> = {
  amazon: { minWidth: 1000, minHeight: 1000, aspectMin: 0.8, aspectMax: 1.91 },
  flipkart: { minWidth: 800, minHeight: 800, aspectMin: 0.75, aspectMax: 1.5 },
  meesho: { minWidth: 700, minHeight: 700, aspectMin: 0.75, aspectMax: 1.6 },
};

const MAX_MEDIA_FILE_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 10_000;
const MAX_BULK_ASSOCIATION_ROWS = 5000;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "100.100.100.200",
  "169.254.169.254",
  "169.254.170.2",
]);

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.replace("::ffff:", "");
    return isBlockedIpv4(mapped);
  }
  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIpv4(address);
  }
  if (version === 6) {
    return isBlockedIpv6(address);
  }
  return true;
}

function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) {
    return null;
  }
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width > 0 && height > 0) {
    return { width, height };
  }
  return null;
}

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  async createAsset(dto: CreateMediaAssetDto) {
    const entity = await this.resolveEntityLink(dto.productId, dto.variantId);
    return this.createAssetFromBuffer({
      entity,
      fileName: dto.fileName.trim(),
      mimeType: dto.mimeType.trim().toLowerCase(),
      contentBuffer: Buffer.from(dto.contentBase64, "base64"),
      width: dto.width,
      height: dto.height,
      source: "direct_upload",
      sourceRef: null,
    });
  }

  async bulkAssociate(dto: BulkMediaAssociationDto) {
    const rows = await this.resolveBulkRows(dto);
    if (rows.length === 0) {
      throw new BadRequestException("Bulk media association requires at least one row.");
    }
    if (rows.length > MAX_BULK_ASSOCIATION_ROWS) {
      throw new BadRequestException(`Bulk media association supports up to ${MAX_BULK_ASSOCIATION_ROWS} rows per request.`);
    }

    const results: Array<{
      rowNumber: number;
      skuCode: string;
      status: "success" | "failed";
      assetId?: string;
      deduplicated?: boolean;
      error?: string;
    }> = [];

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 1;
      const row = rows[index];
      const skuCode = row.skuCode.trim();
      try {
        if (!skuCode) {
          throw new BadRequestException("skuCode is required.");
        }
        const variant = await this.prisma.tenant().variant.findFirst({
          where: { skuCode },
          select: {
            id: true,
            productId: true,
          },
        });
        if (!variant) {
          throw new NotFoundException(`Variant not found for skuCode '${skuCode}'.`);
        }

        const resolved = await this.resolveBulkRowMediaInput(row);
        const asset = (await this.createAssetFromBuffer({
          entity: {
            productId: variant.productId,
            variantId: variant.id,
            entityType: "variant",
          },
          fileName: resolved.fileName,
          mimeType: resolved.mimeType,
          contentBuffer: resolved.contentBuffer,
          width: resolved.width,
          height: resolved.height,
          source: "bulk_association",
          sourceRef: resolved.sourceRef ?? row.imageUrl ?? null,
        })) as { id: string; deduplicated?: boolean };

        results.push({
          rowNumber,
          skuCode,
          status: "success",
          assetId: asset.id,
          deduplicated: Boolean(asset.deduplicated),
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Bulk association failed for row.";
        results.push({
          rowNumber,
          skuCode,
          status: "failed",
          error: message,
        });
      }
    }

    const successRows = results.filter((result) => result.status === "success").length;
    const failedRows = results.length - successRows;
    return {
      totalRows: results.length,
      successRows,
      failedRows,
      rows: results,
    };
  }

  async listAssets(productId?: string, variantId?: string, pagination?: CursorPaginationQuery) {
    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
        throw new BadRequestException("Invalid cursor.");
      }

      const rows = await this.prisma.tenant().mediaAsset.findMany({
        where: {
          ...(variantId ? { variantId } : productId ? { productId } : {}),
          ...(token && cursorDate
            ? {
                OR: [
                  { createdAt: { lt: cursorDate } },
                  {
                    createdAt: cursorDate,
                    id: { lt: token.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const items = hasNext ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const createdAt = last?.createdAt ?? null;

      return {
        items,
        limit,
        nextCursor: hasNext && last?.id && createdAt && !Number.isNaN(createdAt.getTime())
          ? encodeCursorToken({
              sort: createdAt.toISOString(),
              id: String(last.id),
            })
          : null,
      };
    }

    if (variantId) {
      return this.prisma.tenant().mediaAsset.findMany({
        where: { variantId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    }
    if (productId) {
      return this.prisma.tenant().mediaAsset.findMany({
        where: { productId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    }
    return this.prisma.tenant().mediaAsset.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
  }

  async getAsset(assetId: string) {
    const asset = await this.prisma.tenant().mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("Media asset not found");
    }
    return asset;
  }

  async validateAsset(assetId: string, channelInput: string) {
    const channel = this.parseChannel(channelInput);
    const asset = (await this.getAsset(assetId)) as {
      width: number | null;
      height: number | null;
      mimeType: string;
      sizeBytes: number;
    };
    const rule = CHANNEL_RULES[channel];
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!asset.mimeType.startsWith("image/")) {
      issues.push("File is not an image MIME type.");
    }
    if (!asset.width || !asset.height) {
      issues.push("Image dimensions missing. Provide width/height metadata.");
    } else {
      if (asset.width < rule.minWidth || asset.height < rule.minHeight) {
        issues.push(`Image resolution below ${rule.minWidth}x${rule.minHeight}.`);
      }
      const aspect = asset.width / asset.height;
      if (aspect < rule.aspectMin || aspect > rule.aspectMax) {
        issues.push(`Aspect ratio ${aspect.toFixed(2)} outside ${rule.aspectMin}-${rule.aspectMax}.`);
      }
    }
    if (asset.mimeType === "image/jpeg" && asset.sizeBytes < 150 * 1024) {
      warnings.push("Image looks heavily compressed (possible WhatsApp share). Consider re-uploading original quality.");
    }

    return {
      channel,
      valid: issues.length === 0,
      issues,
      warnings,
      checks: {
        minWidth: rule.minWidth,
        minHeight: rule.minHeight,
        aspectMin: rule.aspectMin,
        aspectMax: rule.aspectMax,
        fileSizeBytes: asset.sizeBytes,
      },
    };
  }

  private async createAssetFromBuffer(input: {
    entity: EntityLink;
    fileName: string;
    mimeType: string;
    contentBuffer: Buffer;
    width?: number;
    height?: number;
    source: "direct_upload" | "bulk_association";
    sourceRef: string | null;
  }) {
    const fileBuffer = input.contentBuffer;
    if (fileBuffer.length === 0) {
      throw new BadRequestException("Uploaded media content is empty.");
    }
    if (fileBuffer.length > MAX_MEDIA_FILE_BYTES) {
      throw new BadRequestException("Media file exceeds 10MB limit.");
    }

    const detectedDimensions = parsePngDimensions(fileBuffer);
    const width = input.width ?? detectedDimensions?.width ?? null;
    const height = input.height ?? detectedDimensions?.height ?? null;
    const checksum = createHash("sha256").update(fileBuffer).digest("hex");

    const existing = await this.prisma.tenant().mediaAsset.findFirst({
      where: {
        checksum,
        productId: input.entity.productId,
        variantId: input.entity.variantId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (existing) {
      const asset = (await this.getAsset(existing.id)) as Record<string, unknown>;
      return {
        ...asset,
        deduplicated: true,
      };
    }

    const assetId = randomUUID();
    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const extension = path.extname(safeFileName) || this.extensionFromMime(input.mimeType) || ".bin";
    const storageDir = path.join(process.cwd(), "storage", "media");
    await fs.mkdir(storageDir, { recursive: true });
    const storagePath = path.join(storageDir, `${assetId}${extension}`);
    await fs.writeFile(storagePath, fileBuffer);

    await this.prisma.tenant().mediaAsset.create({
      data: {
        id: assetId,
        productId: input.entity.productId,
        variantId: input.entity.variantId,
        entityType: input.entity.entityType,
        fileName: input.fileName.trim(),
        mimeType: input.mimeType.trim().toLowerCase(),
        storagePath,
        width,
        height,
        sizeBytes: fileBuffer.length,
        checksum,
        metadata: {
          extension,
          extractedFrom: detectedDimensions ? "png_header" : input.width && input.height ? "provided" : "none",
          source: input.source,
          sourceRef: input.sourceRef,
        } as Prisma.JsonObject,
      },
    });

    return this.getAsset(assetId);
  }

  private async resolveEntityLink(productId?: string, variantId?: string): Promise<EntityLink> {
    const normalizedProductId = productId?.trim() || null;
    const normalizedVariantId = variantId?.trim() || null;
    if (normalizedVariantId) {
      const variant = await this.prisma.tenant().variant.findUnique({
        where: { id: normalizedVariantId },
        select: { id: true, productId: true },
      });
      if (!variant) {
        throw new NotFoundException("Variant not found");
      }
      if (normalizedProductId && normalizedProductId !== variant.productId) {
        throw new BadRequestException("Provided productId does not match variant product.");
      }
      return {
        productId: variant.productId,
        variantId: variant.id,
        entityType: "variant",
      };
    }
    if (normalizedProductId) {
      const product = await this.prisma.tenant().product.findUnique({
        where: { id: normalizedProductId },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException("Product not found");
      }
      return {
        productId: normalizedProductId,
        variantId: null,
        entityType: "product",
      };
    }
    return {
      productId: null,
      variantId: null,
      entityType: "product",
    };
  }

  private async resolveBulkRows(dto: BulkMediaAssociationDto): Promise<BulkMediaAssociationRowDto[]> {
    if (Array.isArray(dto.rows) && dto.rows.length > 0) {
      return dto.rows;
    }
    const csv = dto.csvContent?.trim() ?? "";
    if (!csv) {
      return [];
    }

    const parsed = this.parseCsv(csv);
    return parsed.map((row) => ({
      skuCode: this.pickCsvValue(row, ["skuCode", "sku_code", "sku"]).trim(),
      imageUrl: this.pickCsvValue(row, ["imageUrl", "image_url", "url"]) || undefined,
      contentBase64: this.pickCsvValue(row, ["contentBase64", "content_base64", "base64"]) || undefined,
      fileName: this.pickCsvValue(row, ["fileName", "file_name"]) || undefined,
      mimeType: this.pickCsvValue(row, ["mimeType", "mime_type"]) || undefined,
      width: this.parseOptionalInt(this.pickCsvValue(row, ["width"])),
      height: this.parseOptionalInt(this.pickCsvValue(row, ["height"])),
    }));
  }

  private async resolveBulkRowMediaInput(row: BulkMediaAssociationRowDto): Promise<ResolvedMediaInput> {
    if (row.contentBase64 && row.contentBase64.trim().length > 0) {
      return {
        fileName: row.fileName?.trim() || `${row.skuCode}.bin`,
        mimeType: row.mimeType?.trim().toLowerCase() || "application/octet-stream",
        contentBuffer: Buffer.from(row.contentBase64, "base64"),
        width: row.width,
        height: row.height,
        sourceRef: row.imageUrl?.trim() || null,
      };
    }

    const imageUrl = row.imageUrl?.trim() || "";
    if (!imageUrl) {
      throw new BadRequestException("Either contentBase64 or imageUrl must be provided.");
    }
    if (imageUrl.startsWith("data:")) {
      return this.parseDataUrl(imageUrl, row);
    }

    const resolvedUrl = await this.validateRemoteImageUrl(imageUrl);
    try {
      const remoteImage = await this.fetchRemoteImage(resolvedUrl);
      const contentType = remoteImage.contentType;
      if (!contentType.startsWith("image/")) {
        throw new BadRequestException("Remote imageUrl must return content-type image/*.");
      }
      const contentBuffer = remoteImage.contentBuffer;
      const mimeType =
        row.mimeType?.trim().toLowerCase() ||
        contentType ||
        "application/octet-stream";
      if (!mimeType.startsWith("image/")) {
        throw new BadRequestException("Remote imageUrl must resolve to image/* MIME type.");
      }
      return {
        fileName: row.fileName?.trim() || this.fileNameFromUrl(resolvedUrl.parsedUrl.toString(), row.skuCode),
        mimeType,
        contentBuffer,
        width: row.width,
        height: row.height,
        sourceRef: resolvedUrl.parsedUrl.toString(),
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException("Unable to fetch remote imageUrl.");
    }
  }

  private async validateRemoteImageUrl(imageUrl: string): Promise<ResolvedRemoteImageUrl> {
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw new BadRequestException("imageUrl must be a valid URL.");
    }

    if (parsed.protocol !== "https:") {
      throw new BadRequestException("imageUrl must use https.");
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException("imageUrl must not include credentials.");
    }
    if (parsed.port && parsed.port !== "443") {
      throw new BadRequestException("imageUrl must use default HTTPS port.");
    }

    const hostname = parsed.hostname.trim().toLowerCase();
    if (!hostname) {
      throw new BadRequestException("imageUrl hostname is required.");
    }
    if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
      throw new BadRequestException("imageUrl points to a blocked host.");
    }

    if (isIP(hostname) > 0) {
      if (isBlockedIpAddress(hostname)) {
        throw new BadRequestException("imageUrl points to a private or link-local IP.");
      }
      const family = isIP(hostname);
      return {
        parsedUrl: parsed,
        resolvedAddress: hostname,
        family: family === 6 ? 6 : 4,
      };
    }

    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!resolved || resolved.length === 0) {
      throw new BadRequestException("imageUrl hostname could not be resolved.");
    }
    const allowed = resolved.filter((entry) => entry?.address && !isBlockedIpAddress(entry.address));
    if (allowed.length === 0) {
      throw new BadRequestException("imageUrl hostname resolves to blocked network ranges.");
    }
    for (const entry of resolved) {
      if (!entry?.address || isBlockedIpAddress(entry.address)) {
        throw new BadRequestException("imageUrl hostname resolves to blocked network ranges.");
      }
    }
    const selected = allowed[0];
    return {
      parsedUrl: parsed,
      resolvedAddress: selected.address,
      family: selected.family === 6 ? 6 : 4,
    };
  }

  private async fetchRemoteImage(
    resolved: ResolvedRemoteImageUrl,
  ): Promise<{ contentType: string; contentBuffer: Buffer }> {
    return await new Promise<{ contentType: string; contentBuffer: Buffer }>((resolve, reject) => {
      const pathAndQuery = `${resolved.parsedUrl.pathname}${resolved.parsedUrl.search}`;
      const requestOptions: HttpsRequestOptions = {
        protocol: "https:",
        hostname: resolved.parsedUrl.hostname,
        port: resolved.parsedUrl.port ? Number(resolved.parsedUrl.port) : 443,
        path: pathAndQuery,
        method: "GET",
        servername: resolved.parsedUrl.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.resolvedAddress, resolved.family);
        },
      };

      const req = httpsRequest(requestOptions, (response) => {
        this.readIncomingMessageWithLimit(response, MAX_MEDIA_FILE_BYTES)
          .then(resolve)
          .catch(reject);
      });
      req.setTimeout(REMOTE_FETCH_TIMEOUT_MS, () => {
        req.destroy(new Error("REMOTE_FETCH_TIMEOUT"));
      });
      req.on("error", (error) => {
        reject(error);
      });
      req.end();
    });
  }

  private async readIncomingMessageWithLimit(
    response: IncomingMessage,
    maxBytes: number,
  ): Promise<{ contentType: string; contentBuffer: Buffer }> {
    const statusCode = response.statusCode ?? 0;
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new BadRequestException(`Unable to download imageUrl (${statusCode}).`);
    }
    const contentType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      response.resume();
      throw new BadRequestException("Remote imageUrl must return content-type image/*.");
    }
    const contentLengthHeader = response.headers["content-length"];
    if (contentLengthHeader) {
      const lengthRaw = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
      const contentLength = Number(lengthRaw);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.resume();
        throw new BadRequestException("Remote image exceeds 10MB limit.");
      }
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    return await new Promise<{ contentType: string; contentBuffer: Buffer }>((resolve, reject) => {
      response.on("data", (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          response.destroy(new BadRequestException("Remote image exceeds 10MB limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () =>
        resolve({
          contentType,
          contentBuffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
        }),
      );
      response.on("error", (error) => reject(error));
      response.on("aborted", () => reject(new BadRequestException("Remote image fetch was aborted.")));
    });
  }

  private parseDataUrl(imageUrl: string, row: BulkMediaAssociationRowDto): ResolvedMediaInput {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) {
      throw new BadRequestException("Unsupported data URL format. Expected base64 data URL.");
    }
    const mimeType = row.mimeType?.trim().toLowerCase() || match[1].trim().toLowerCase();
    const contentBuffer = Buffer.from(match[2], "base64");
    return {
      fileName: row.fileName?.trim() || `${row.skuCode}${this.extensionFromMime(mimeType)}`,
      mimeType,
      contentBuffer,
      width: row.width,
      height: row.height,
      sourceRef: "data-url",
    };
  }

  private parseCsv(csvContent: string): Array<Record<string, string>> {
    const lines = csvContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2) {
      return [];
    }

    const headers = this.splitCsvLine(lines[0]).map((header) => header.trim());
    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i += 1) {
      const values = this.splitCsvLine(lines[i]);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j += 1) {
        const key = headers[j];
        if (!key) {
          continue;
        }
        row[key] = (values[j] ?? "").trim();
      }
      rows.push(row);
    }
    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    values.push(current);
    return values;
  }

  private pickCsvValue(row: Record<string, string>, keys: string[]): string {
    const normalized = new Map<string, string>();
    for (const [key, value] of Object.entries(row)) {
      normalized.set(key.trim().toLowerCase(), value);
    }
    for (const key of keys) {
      const value = normalized.get(key.toLowerCase());
      if (value !== undefined) {
        return value;
      }
    }
    return "";
  }

  private parseOptionalInt(value: string): number | undefined {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  private extensionFromMime(mimeType: string): string {
    switch (mimeType) {
      case "image/png":
        return ".png";
      case "image/jpeg":
        return ".jpg";
      case "image/webp":
        return ".webp";
      default:
        return ".bin";
    }
  }

  private fileNameFromUrl(imageUrl: string, fallbackKey: string): string {
    try {
      const parsed = new URL(imageUrl);
      const leaf = path.basename(parsed.pathname);
      if (leaf && leaf !== "/") {
        return leaf;
      }
    } catch {
      // ignore invalid URL parsing and fallback
    }
    return `${fallbackKey}.bin`;
  }

  private parseChannel(value: string): Channel {
    const normalized = value.trim().toLowerCase();
    if (normalized === "amazon" || normalized === "flipkart" || normalized === "meesho") {
      return normalized;
    }
    throw new BadRequestException("Unsupported channel. Use amazon, flipkart, or meesho.");
  }
}

