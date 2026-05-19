import { IsOptional, IsString, IsIn, IsArray, IsInt, Min, Max } from "class-validator";
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
  q?: string;

  /**
   * Filter by one or more product statuses.
   * Accepted values: draft, under_review, in_review, approved, rejected, archived, active.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []))
  status?: string[];

  /**
   * Filter to products in a specific category (exact match, tenant-scoped).
   */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /**
   * Partial brand filter (case-insensitive ILIKE).
   */
  @IsOptional()
  @IsString()
  brand?: string;

  /**
   * Filter to products that have at least one ConnectorSubmission for the given
   * connector slug (e.g. "amazon-in", "shopify", "flipkart"). Useful for showing
   * products published / pending publish to a specific channel.
   */
  @IsOptional()
  @IsString()
  channelSlug?: string;

  /**
   * Cursor for continuation from a previous response's nextCursor field.
   */
  @IsOptional()
  @IsString()
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
}
