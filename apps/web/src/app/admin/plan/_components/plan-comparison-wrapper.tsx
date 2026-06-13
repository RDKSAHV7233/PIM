import type { PlanMetadata } from "@/lib/api";
import { PlanComparison } from "./plan-comparison";

interface PlanComparisonWrapperProps {
  plans: PlanMetadata[];
  currentTier: string;
  billingStatus: string;
  hasOpenUpgradeRequest: boolean;
  canRequestUpgrade: boolean;
}

export function PlanComparisonWrapper({
  plans,
  currentTier,
  billingStatus,
  hasOpenUpgradeRequest,
  canRequestUpgrade,
}: PlanComparisonWrapperProps) {
  return (
    <PlanComparison
      plans={plans}
      currentTier={currentTier}
      billingStatus={billingStatus}
      hasOpenUpgradeRequest={hasOpenUpgradeRequest}
      canRequestUpgrade={canRequestUpgrade}
    />
  );
}
