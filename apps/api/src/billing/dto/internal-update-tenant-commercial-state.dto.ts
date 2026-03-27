import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class InternalUpdateTenantCommercialStateDto {
  @IsString()
  tenantKey!: string;

  @IsOptional()
  @IsString()
  @IsIn(["trial", "active_paid", "past_due", "cancelled"])
  billingStatus?: "trial" | "active_paid" | "past_due" | "cancelled";

  @IsOptional()
  @IsString()
  @IsIn(["active", "suspended"])
  accessStatus?: "active" | "suspended";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  suspensionReason?: string;

  @IsOptional()
  @IsEmail()
  billingContactEmail?: string | null;

  @IsOptional()
  @IsDateString()
  trialEndsAt?: string | null;

  @IsOptional()
  @IsDateString()
  paidThroughAt?: string | null;

  @IsOptional()
  @IsDateString()
  graceEndsAt?: string | null;

  @IsOptional()
  @IsDateString()
  cancelledAt?: string | null;

  @IsOptional()
  @IsDateString()
  suspendedAt?: string | null;
}
