import { IsIn, IsString, MaxLength } from "class-validator";

export class UpdatePlanUpgradeRequestStatusDto {
  @IsString()
  @MaxLength(50)
  requestId!: string;

  @IsString()
  @IsIn(["open", "acknowledged", "resolved", "cancelled"])
  status!: "open" | "acknowledged" | "resolved" | "cancelled";
}
