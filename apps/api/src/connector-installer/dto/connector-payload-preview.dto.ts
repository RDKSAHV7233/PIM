import { IsIn, IsOptional, IsString } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../../marketplace/dto/simulate-marketplace.dto";

export class ConnectorPayloadPreviewDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsIn(MARKETPLACE_CHANNELS)
  channel?: (typeof MARKETPLACE_CHANNELS)[number];
}

