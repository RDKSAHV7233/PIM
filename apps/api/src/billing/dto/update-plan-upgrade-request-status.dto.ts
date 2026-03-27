import { IsIn, IsString } from "class-validator";

export class UpdatePlanUpgradeRequestStatusDto {
  @IsString()
  requestId!: string;

  @IsString()
  @IsIn(["open", "acknowledged", "resolved", "cancelled"])
  status!: "open" | "acknowledged" | "resolved" | "cancelled";
}
