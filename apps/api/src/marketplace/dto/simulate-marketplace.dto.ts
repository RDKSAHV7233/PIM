import { IsIn } from "class-validator";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class SimulateMarketplaceDto {
  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  installationId?: string;
}
