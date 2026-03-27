import { ApiProperty } from "@nestjs/swagger";

class PlanUsageCounterDto {
  @ApiProperty({ example: 12 })
  current!: number;

  @ApiProperty({ example: 100 })
  limit!: number;
}

export class PlanProfileSummaryDto {
  @ApiProperty({ example: "tej-demo" })
  tenantKey!: string;

  @ApiProperty({ enum: ["STARTER", "GROWTH", "ENTERPRISE"], example: "STARTER" })
  planTier!: "STARTER" | "GROWTH" | "ENTERPRISE";

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled"], example: "trial" })
  billingStatus!: "trial" | "active_paid" | "past_due" | "cancelled";

  @ApiProperty({ enum: ["active", "suspended"], example: "active" })
  accessStatus!: "active" | "suspended";

  @ApiProperty({ example: "2026-03-27T00:00:00.000Z", nullable: true })
  effectiveFrom!: string | null;

  @ApiProperty({ example: "2026-04-10T00:00:00.000Z", nullable: true })
  trialEndsAt!: string | null;

  @ApiProperty({ example: "2026-04-30T23:59:59.000Z", nullable: true })
  paidThroughAt!: string | null;

  @ApiProperty({ example: "2026-05-07T23:59:59.000Z", nullable: true })
  graceEndsAt!: string | null;

  @ApiProperty({ example: "2026-05-01T00:00:00.000Z", nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ example: "2026-05-08T00:00:00.000Z", nullable: true })
  suspendedAt!: string | null;

  @ApiProperty({ example: "non_payment", nullable: true })
  suspensionReason!: string | null;

  @ApiProperty({ example: "billing@example.com", nullable: true })
  billingContactEmail!: string | null;

  @ApiProperty({ example: "ops@example.com", nullable: true })
  updatedBy!: string | null;

  @ApiProperty({ example: "2026-03-27T00:00:00.000Z" })
  createdAt!: string;

  @ApiProperty({ example: "2026-03-27T00:00:00.000Z" })
  updatedAt!: string;
}

export class PlanUsageSummaryDto {
  @ApiProperty({ enum: ["STARTER", "GROWTH", "ENTERPRISE"], example: "STARTER" })
  planTier!: "STARTER" | "GROWTH" | "ENTERPRISE";

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled"], example: "trial" })
  billingStatus!: "trial" | "active_paid" | "past_due" | "cancelled";

  @ApiProperty({ enum: ["active", "suspended"], example: "active" })
  accessStatus!: "active" | "suspended";

  @ApiProperty({ example: "2026-03" })
  month!: string;

  @ApiProperty({ example: "2026-04-01T00:00:00.000Z" })
  billingCycleResetAt!: string;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  skus!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  submissions!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  storageGb!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  users!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  connectorsInstallations!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  connectorAccounts!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanProfileSummaryDto })
  profile!: PlanProfileSummaryDto;
}
