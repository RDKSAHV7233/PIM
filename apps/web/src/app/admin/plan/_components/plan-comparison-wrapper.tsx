"use client";

import { useCallback, useState } from "react";
import { PlanComparison } from "./plan-comparison";
import { createCheckoutSessionAction } from "../actions";

interface PlanComparisonWrapperProps {
  currentTier: string;
  billingStatus: string;
  stripeEnabled: boolean;
}

export function PlanComparisonWrapper({
  currentTier,
  billingStatus,
  stripeEnabled,
}: PlanComparisonWrapperProps) {
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const handleUpgrade = useCallback(async (planTier: string) => {
    setUpgradeLoading(true);
    const formData = new FormData();
    formData.set("planTier", planTier);
    formData.set("days", "30");

    try {
      await createCheckoutSessionAction(formData);
    } catch (error) {
      setUpgradeLoading(false);
      console.error("Checkout failed:", error);
    }
  }, []);

  return (
    <PlanComparison
      currentTier={currentTier}
      billingStatus={billingStatus}
      stripeEnabled={stripeEnabled}
      onUpgrade={handleUpgrade}
      upgradeLoading={upgradeLoading}
    />
  );
}
