import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class ExportOndcCatalogDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  productIds!: string[];

  @IsString()
  @MaxLength(50)
  nodeType!: string;

  @IsString()
  @MaxLength(20)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  mappingId?: string;
}
