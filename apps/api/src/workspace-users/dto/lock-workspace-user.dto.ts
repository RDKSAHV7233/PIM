import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from "class-validator";

export class LockWorkspaceUserDto {
  @Transform(({ value }) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return undefined;
    }
    return Number.parseInt(String(value), 10);
  })
  @IsOptional()
  @IsInt()
  @IsIn([60, 240, 1440, 10080])
  durationMinutes?: number;

  @Transform(({ value }) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
