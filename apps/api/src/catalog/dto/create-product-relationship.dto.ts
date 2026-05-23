import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { ProductRelationshipType } from "@prisma/client";

export class CreateProductRelationshipDto {
  @IsString()
  @MaxLength(50)
  targetProductId!: string;

  @IsEnum(ProductRelationshipType)
  type!: ProductRelationshipType;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantityInParent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
