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

export class PlanUpgradeRequestSummaryDto {
  @ApiProperty({ example: "ckreq_123" })
  id!: string;

  @ApiProperty({ example: "tej-demo" })
  tenantKey!: string;

  @ApiProperty({ example: "tej-demo", nullable: true })
  workspaceSlug!: string | null;

  @ApiProperty({ example: "TEJ Demo", nullable: true })
  displayName!: string | null;

  @ApiProperty({ example: "upgrade" })
  requestType!: string;

  @ApiProperty({ enum: ["open", "acknowledged", "resolved", "cancelled"], example: "open" })
  status!: "open" | "acknowledged" | "resolved" | "cancelled";

  @ApiProperty({ example: "admin@example.com" })
  requestedBy!: string;

  @ApiProperty({ example: "admin" })
  requesterRole!: string;

  @ApiProperty({ enum: ["STARTER", "GROWTH", "ENTERPRISE"], example: "STARTER" })
  currentPlanTier!: string;

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled"], example: "trial" })
  currentBillingStatus!: string;

  @ApiProperty({ enum: ["active", "suspended"], example: "active" })
  currentAccessStatus!: string;

  @ApiProperty({ example: "We need more users and submission capacity.", nullable: true })
  notes!: string | null;

  @ApiProperty({ example: "admin_plan" })
  source!: string;

  @ApiProperty({ example: null, nullable: true })
  resolvedAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  resolvedBy!: string | null;

  @ApiProperty({ example: "2026-03-27T08:30:00.000Z" })
  createdAt!: string;

  @ApiProperty({ example: "2026-03-27T08:30:00.000Z" })
  updatedAt!: string;
}

export class PlanUpgradeRequestLookupDto {
  @ApiProperty({ type: () => PlanUpgradeRequestSummaryDto, nullable: true })
  item!: PlanUpgradeRequestSummaryDto | null;
}

export class PlanUpgradeRequestCreateDto {
  @ApiProperty({ example: true })
  created!: boolean;

  @ApiProperty({ type: () => PlanUpgradeRequestSummaryDto })
  item!: PlanUpgradeRequestSummaryDto;
}
