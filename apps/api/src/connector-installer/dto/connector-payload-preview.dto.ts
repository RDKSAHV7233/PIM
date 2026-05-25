import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../../marketplace/marketplace-channels";

export class ConnectorPayloadPreviewDto {
  @IsString()
  @MaxLength(50)
  productId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateId?: string;

  @IsOptional()
  @IsIn(MARKETPLACE_CHANNELS)
  channel?: (typeof MARKETPLACE_CHANNELS)[number];
}
