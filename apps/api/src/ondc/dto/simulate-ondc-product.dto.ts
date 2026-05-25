import { IsOptional, IsString, MaxLength } from "class-validator";

export class SimulateOndcProductDto {
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
