import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const AUDIT_ENTITY_TYPES = [
  "product",
  "category",
  "mapping",
  "connector",
  "user",
  "plan",
  "privacy",
  "auth",
  "import",
  "job",
  "other",
] as const;

export type AuditEntityTypeFilter = (typeof AUDIT_ENTITY_TYPES)[number];

export class ListAuditEventsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resourceId?: string;

  @IsOptional()
  @IsIn(AUDIT_ENTITY_TYPES)
  entityType?: AuditEntityTypeFilter;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  limit?: string;
}
