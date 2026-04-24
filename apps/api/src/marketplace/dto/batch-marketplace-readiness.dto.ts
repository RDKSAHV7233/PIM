import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class BatchMarketplaceReadinessDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  productIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARKETPLACE_CHANNELS.length)
  @IsIn(MARKETPLACE_CHANNELS, { each: true })
  channels?: (typeof MARKETPLACE_CHANNELS)[number][];
}
