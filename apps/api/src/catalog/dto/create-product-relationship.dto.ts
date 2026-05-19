import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { ProductRelationshipType } from "@prisma/client";

export class CreateProductRelationshipDto {
  @IsString()
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
