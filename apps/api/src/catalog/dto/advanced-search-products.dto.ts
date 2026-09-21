import { ArrayMaxSize, IsBoolean, IsOptional, IsString, IsIn, IsArray, IsInt, Max, MaxLength, Min } from "class-validator";
import { Transform, Type } from "class-transformer";

/**
 * RG-C6: Advanced catalog search DTO.
 *
 * Supports multi-dimensional filtering (status, category, brand, channel/connector
 * submission existence) combined with an optional full-text query across title,
 * SKU, brand, and description. Cursor-paginated for large-catalog performance.
 */
export class AdvancedSearchProductsDto {
  /**
   * Full-text search term — matched against title, SKU codes, brand, description,
   * and tags (all case-insensitive ILIKE).  Omit or pass empty string to filter
   * without a text query.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;

  /**
   * Filter by one or more product statuses.
   * Accepted values: draft, under_review, in_review, approved, rejected, archived, active.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []))
  status?: string[];

  /**
   * Filter to products in a specific category (exact match, tenant-scoped).
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

  /**
   * Partial brand filter (case-insensitive ILIKE).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  /**
   * Filter to products that have at least one ConnectorSubmission for the given
   * connector slug (e.g. "amazon-in", "shopify", "flipkart"). Useful for showing
   * products published / pending publish to a specific channel.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelSlug?: string;

  /**
   * Cursor for continuation from a previous response's nextCursor field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  /**
   * Maximum number of results per page. Range: 1–100. Default: 20.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * Sort field. Default: updatedAt.
   * Note: "status" is intentionally excluded — Prisma enum fields do not support
   * lt/gt cursor comparators; use status[] filter instead of status sort.
   */
  @IsOptional()
  @IsIn(["updatedAt", "createdAt", "title"])
  sort?: "updatedAt" | "createdAt" | "title";

  /**
   * Sort direction. Default: desc.
   */
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc";

  /**
   * Offset-based pagination: number of rows to skip. Range: 0–100 000.
   * When provided, cursor is ignored and a totalCount is returned.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;

  /**
   * F-004: exclude QA/E2E fixture products (see test-data-exclusion.ts) from results,
   * totalCount, and pagination — not just from the client's own rendered page.
   */
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  hideTestData?: boolean;
}
