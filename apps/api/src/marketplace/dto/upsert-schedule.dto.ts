import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class UpsertScheduleDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^(\S+\s+){4,5}\S+$/, { message: "cronExpression must be a valid 5 or 6-field cron expression" })
  cronExpression!: string;

  @IsOptional()
  @IsIn(["approved_only", "all"])
  scope?: string;

  @IsOptional()
  @IsIn(["active", "paused"])
  status?: string;
}
