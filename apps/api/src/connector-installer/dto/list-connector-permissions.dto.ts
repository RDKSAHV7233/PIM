import { IsOptional, IsString, MaxLength } from "class-validator";

export class ListConnectorPermissionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectorSlug?: string;
}
