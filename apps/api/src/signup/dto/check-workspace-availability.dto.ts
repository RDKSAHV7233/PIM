import { Transform } from "class-transformer";
import { IsString } from "class-validator";

export class CheckWorkspaceAvailabilityDto {
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  workspaceSlug!: string;
}
