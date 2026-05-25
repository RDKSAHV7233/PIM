import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from "class-validator";

export class TriggerBulkPublishDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  productIds!: string[];
}
