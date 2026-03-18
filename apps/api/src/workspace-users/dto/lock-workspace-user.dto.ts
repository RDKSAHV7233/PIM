import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString } from "class-validator";

export class LockWorkspaceUserDto {
  @Transform(({ value }) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return undefined;
    }
    return Number.parseInt(String(value), 10);
  })
  @IsOptional()
  @IsInt()
  durationMinutes?: number;

  @Transform(({ value }) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : undefined;
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
