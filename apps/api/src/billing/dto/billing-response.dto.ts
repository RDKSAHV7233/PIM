import { ApiProperty } from "@nestjs/swagger";

class PlanUsageCounterDto {
  @ApiProperty({ example: 12 })
  current!: number;

  @ApiProperty({ example: 100 })
  limit!: number;
}

class PlanUsageLimitOnlyDto {
  @ApiProperty({ example: 2000 })
  limit!: number;
}

class PlanMetadataLimitsDto {
  @ApiProperty({ example: 500 })
  skus!: number;

  @ApiProperty({ example: 500 })
  submissions!: number;

  @ApiProperty({ example: 3 })
  users!: number;

  @ApiProperty({ example: "3 (admin, editor, viewer)" })
  roles!: string;

  @ApiProperty({ example: 5 })
  storageGb!: number;

  @ApiProperty({ example: 2 })
  connectorInstallations!: number;

  @ApiProperty({ example: 1 })
  accountsPerConnector!: number;

  @ApiProperty({ example: 0 })
  apiKeys!: number;

  @ApiProperty({ example: 0 })
  outboundWebhooks!: number;

  @ApiProperty({ example: 2000 })
  importRowsPerJob!: number;
}

export class PlanMetadataDto {
  @ApiProperty({ enum: ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "STARTER" })
  tier!: string;

  @ApiProperty({ example: "Starter" })
  label!: string;

  @ApiProperty({ example: "Small serious seller" })
  tagline!: string;

  @ApiProperty({ type: () => PlanMetadataLimitsDto })
  limits!: PlanMetadataLimitsDto;

  @ApiProperty({ type: Object, example: {} })
  unlimited!: Record<string, boolean>;

  @ApiProperty({ type: [String], example: ["Product catalog management"] })
  features!: string[];
}

export class PlanMetadataListDto {
  @ApiProperty({ type: () => [PlanMetadataDto] })
  items!: PlanMetadataDto[];
}

export class PlanProfileSummaryDto {
  @ApiProperty({ example: "vexa-demo" })
  tenantKey!: string;

  @ApiProperty({ enum: ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "STARTER" })
  planTier!: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled", "expired"], example: "trial" })
  billingStatus!: "trial" | "active_paid" | "past_due" | "cancelled" | "expired";

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

export class PlanTierSummaryDto {
  @ApiProperty({ enum: ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "STARTER" })
  planTier!: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled", "expired"], example: "trial" })
  billingStatus!: "trial" | "active_paid" | "past_due" | "cancelled" | "expired";

  @ApiProperty({ enum: ["active", "suspended"], example: "active" })
  accessStatus!: "active" | "suspended";
}

export class PlanUsageSummaryDto {
  @ApiProperty({ enum: ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "STARTER" })
  planTier!: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled", "expired"], example: "trial" })
  billingStatus!: "trial" | "active_paid" | "past_due" | "cancelled" | "expired";

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

  @ApiProperty({ type: () => PlanUsageCounterDto })
  apiKeys!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageCounterDto })
  outboundWebhooks!: PlanUsageCounterDto;

  @ApiProperty({ type: () => PlanUsageLimitOnlyDto })
  importRowsPerJob!: PlanUsageLimitOnlyDto;

  @ApiProperty({ type: () => PlanProfileSummaryDto })
  profile!: PlanProfileSummaryDto;
}

export class PlanUpgradeRequestSummaryDto {
  @ApiProperty({ example: "ckreq_123" })
  id!: string;

  @ApiProperty({ example: "vexa-demo" })
  tenantKey!: string;

  @ApiProperty({ example: "vexa-demo", nullable: true })
  workspaceSlug!: string | null;

  @ApiProperty({ example: "Vexa Demo", nullable: true })
  displayName!: string | null;

  @ApiProperty({ example: "upgrade" })
  requestType!: string;

  @ApiProperty({ enum: ["open", "acknowledged", "resolved", "cancelled"], example: "open" })
  status!: "open" | "acknowledged" | "resolved" | "cancelled";

  @ApiProperty({ example: "admin@example.com" })
  requestedBy!: string;

  @ApiProperty({ example: "admin" })
  requesterRole!: string;

  @ApiProperty({ enum: ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "STARTER" })
  currentPlanTier!: string;

  @ApiProperty({ enum: ["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"], example: "GROWTH", nullable: true })
  requestedPlanTier!: string | null;

  @ApiProperty({ enum: ["trial", "active_paid", "past_due", "cancelled"], example: "trial" })
  currentBillingStatus!: string;

  @ApiProperty({ enum: ["active", "suspended"], example: "active" })
  currentAccessStatus!: string;

  @ApiProperty({ example: "We need more users and submission capacity.", nullable: true })
  notes!: string | null;

  @ApiProperty({ example: "admin_plan" })
  source!: string;

  @ApiProperty({ type: Object, nullable: true })
  usageSnapshot!: Record<string, unknown> | null;

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
