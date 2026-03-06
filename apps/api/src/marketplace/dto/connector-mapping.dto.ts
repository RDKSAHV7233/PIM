import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ListConnectorMappingVersionsQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  categoryScope?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}

export class CreateConnectorMappingVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  categoryScope!: string;

  @IsIn(["tenant_connector_default", "tenant_connector_category_mapping"])
  mappingLevel!: "tenant_connector_default" | "tenant_connector_category_mapping";

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  connectorDefinitionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  connectorDefinitionVersion!: string;

  @IsOptional()
  @IsIn(["compatible", "deprecated", "remap_required", "blocked"])
  compatibilityState?: "compatible" | "deprecated" | "remap_required" | "blocked";

  @IsObject()
  mappingRules!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  fallbackPolicy?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  fallbackAckRequired?: boolean;
}

export class PublishConnectorMappingVersionDto {
  @Type(() => Boolean)
  @IsBoolean()
  confirm!: boolean;
}

export class ArchiveConnectorMappingVersionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ResolveConnectorMappingQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  categoryScope!: string;
}

export class ConnectorMappingPreflightDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  categoryScope!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  fallbackAcknowledged?: boolean;
}

export class ConnectorPublishReadinessDto extends ConnectorMappingPreflightDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productId?: string;
}

export class ConnectorTaxonomySearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
