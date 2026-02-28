import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";

type Channel = "amazon" | "flipkart" | "meesho";

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
export class MediaService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  private async ensureTable() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        product_id TEXT NULL REFERENCES "Product"(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        width INTEGER NULL,
        height INTEGER NULL,
        size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_media_assets_product_created_at
      ON media_assets (product_id, created_at DESC);
    `);
  }

  async createAsset(dto: CreateMediaAssetDto) {
    const fileBuffer = Buffer.from(dto.contentBase64, "base64");
    if (fileBuffer.length === 0) {
      throw new BadRequestException("Uploaded media content is empty.");
    }
    if (fileBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException("Media file exceeds 10MB limit.");
    }

    if (dto.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) {
        throw new NotFoundException("Product not found");
      }
    }

    const detectedDimensions = parsePngDimensions(fileBuffer);
    const width = dto.width ?? detectedDimensions?.width ?? null;
    const height = dto.height ?? detectedDimensions?.height ?? null;
    const checksum = createHash("sha256").update(fileBuffer).digest("hex");
    const assetId = randomUUID();
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const extension = path.extname(safeFileName) || ".bin";
    const storageDir = path.join(process.cwd(), "storage", "media");
    await fs.mkdir(storageDir, { recursive: true });
    const storagePath = path.join(storageDir, `${assetId}${extension}`);
    await fs.writeFile(storagePath, fileBuffer);

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO media_assets (
        id, product_id, file_name, mime_type, storage_path, width, height, size_bytes, checksum, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `,
      assetId,
      dto.productId ?? null,
      dto.fileName.trim(),
      dto.mimeType.trim().toLowerCase(),
      storagePath,
      width,
      height,
      fileBuffer.length,
      checksum,
      JSON.stringify({
        extension,
        extractedFrom: detectedDimensions ? "png_header" : dto.width && dto.height ? "provided" : "none",
      }),
    );

    return this.getAsset(assetId);
  }

  async listAssets(productId?: string) {
    if (productId) {
      return this.prisma.$queryRawUnsafe(
        `
        SELECT
          id,
          product_id AS "productId",
          file_name AS "fileName",
          mime_type AS "mimeType",
          storage_path AS "storagePath",
          width,
          height,
          size_bytes AS "sizeBytes",
          checksum,
          metadata,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM media_assets
        WHERE product_id = $1
        ORDER BY created_at DESC
        `,
        productId,
      );
    }
    return this.prisma.$queryRawUnsafe(`
      SELECT
        id,
        product_id AS "productId",
        file_name AS "fileName",
        mime_type AS "mimeType",
        storage_path AS "storagePath",
        width,
        height,
        size_bytes AS "sizeBytes",
        checksum,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM media_assets
      ORDER BY created_at DESC
      LIMIT 200
    `);
  }

  async getAsset(assetId: string) {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      SELECT
        id,
        product_id AS "productId",
        file_name AS "fileName",
        mime_type AS "mimeType",
        storage_path AS "storagePath",
        width,
        height,
        size_bytes AS "sizeBytes",
        checksum,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM media_assets
      WHERE id = $1
      LIMIT 1
      `,
      assetId,
    )) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      throw new NotFoundException("Media asset not found");
    }
    return rows[0];
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

    return {
      channel,
      valid: issues.length === 0,
      issues,
      checks: {
        minWidth: rule.minWidth,
        minHeight: rule.minHeight,
        aspectMin: rule.aspectMin,
        aspectMax: rule.aspectMax,
        fileSizeBytes: asset.sizeBytes,
      },
    };
  }

  private parseChannel(value: string): Channel {
    const normalized = value.trim().toLowerCase();
    if (normalized === "amazon" || normalized === "flipkart" || normalized === "meesho") {
      return normalized;
    }
    throw new BadRequestException("Unsupported channel. Use amazon, flipkart, or meesho.");
  }
}
