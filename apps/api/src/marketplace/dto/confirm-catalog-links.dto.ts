import { ArrayMaxSize, IsArray, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CatalogLinkItemDto {
  @IsString()
  @MaxLength(50)
  productId!: string;

  @IsString()
  @MaxLength(200)
  shopifyGid!: string;

  @IsString()
  @MaxLength(50)
  matchedBy!: string;
}

export class ConfirmCatalogLinksDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CatalogLinkItemDto)
  links!: CatalogLinkItemDto[];
}
