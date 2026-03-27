import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class SearchCommercialTenantsDto {
  @IsString()
  q!: string;

  @IsOptional()
  @Transform(({ value }) => {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}
