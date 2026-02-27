import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class RequeueDlqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
