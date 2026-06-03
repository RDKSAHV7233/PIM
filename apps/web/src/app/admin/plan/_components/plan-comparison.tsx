"use client";

import { useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * Plan tier limits — matches PlanLimits seed in the API.
 * Kept in sync manually; the seam test catches drift.
 */
const PLAN_TIERS = [
  {
    tier: "STARTER",
    label: "Starter",
    price: "Free during trial",
    tagline: "Get started with core PIM features",
    limits: {
      skus: 500,
      submissions: 500,
      users: 3,
      storageGb: 5,
      connectorInstallations: 2,
      accountsPerConnector: 1,
    },
    features: [
      "Product catalog management",
      "Bulk import & repair",
      "Quality validation",
      "Approval workflow",
      "1 marketplace connector",
      "Community support",
    ],
  },
  {
    tier: "GROWTH",
    label: "Growth",
    price: "Contact sales",
    tagline: "Scale your catalog across channels",
    limits: {
      skus: 5000,
      submissions: 5000,
      users: 20,
      storageGb: 50,
      connectorInstallations: 10,
      accountsPerConnector: 3,
    },
    features: [
      "Everything in Starter",
      "10x catalog & submission limits",
      "Multi-account connectors",
      "Priority support",
      "Bulk edit operations",
      "Advanced compliance rules",
    ],
  },
  {
    tier: "ENTERPRISE",
    label: "Enterprise",
    price: "Custom",
    tagline: "Unlimited scale with dedicated support",
    limits: {
      skus: 99999,
      submissions: 99999,
      users: 999,
      storageGb: 500,
      connectorInstallations: 100,
      accountsPerConnector: 20,
    },
    features: [
      "Everything in Growth",
      "Unlimited SKUs & submissions",
      "Dedicated account manager",
      "Custom SLA & onboarding",
      "SSO / OIDC integration",
      "White-glove data migration",
    ],
  },
];

function formatLimit(value: number): string {
  if (value >= 99999) return "Unlimited";
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

interface PlanComparisonProps {
  currentTier: string;
  billingStatus: string;
  stripeEnabled: boolean;
  onUpgrade?: (tier: string) => void;
  upgradeLoading?: boolean;
}

export function PlanComparison({
  currentTier,
  billingStatus,
  stripeEnabled,
  onUpgrade,
  upgradeLoading,
}: PlanComparisonProps) {
  const normalizedCurrent = currentTier.toUpperCase();
  const tierIndex = PLAN_TIERS.findIndex((t) => t.tier === normalizedCurrent);

  return (
    <Card>
      <CardTitle>Compare Plans</CardTitle>
      <p className="mt-1 text-sm text-slate-600">
        Choose the plan that fits your catalog size and team.
        {billingStatus === "trial" ? " Upgrade anytime during your trial." : ""}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {PLAN_TIERS.map((plan, index) => {
          const isCurrent = plan.tier === normalizedCurrent;
          const isUpgrade = index > tierIndex;
          const isDowngrade = index < tierIndex;

          return (
            <div
              key={plan.tier}
              className={`relative rounded-xl border-2 p-5 transition-shadow ${
                isCurrent
                  ? "border-indigo-500 bg-indigo-50/30 shadow-md ring-1 ring-indigo-200"
                  : "border-slate-200 bg-white hover:shadow-sm"
              }`}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-4">
                  <StatusChip label="Current plan" tone="info" />
                </div>
              )}

              <div className="mt-1">
                <h3 className="text-lg font-semibold text-slate-900">{plan.label}</h3>
                <p className="mt-1 text-sm font-medium text-indigo-600">{plan.price}</p>
                <p className="mt-1 text-xs text-slate-500">{plan.tagline}</p>
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">SKUs</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.skus)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Submissions / month</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.submissions)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Users</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.users)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Storage</span>
                  <span className="font-medium text-slate-900">{plan.limits.storageGb} GB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Connectors</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.connectorInstallations)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Accounts / connector</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.accountsPerConnector)}</span>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                {isCurrent ? (
                  <div className="rounded-lg bg-indigo-100 px-4 py-2.5 text-center text-sm font-medium text-indigo-700">
                    Your current plan
                  </div>
                ) : isUpgrade && plan.tier !== "ENTERPRISE" && stripeEnabled ? (
                  <button
                    onClick={() => onUpgrade?.(plan.tier)}
                    disabled={upgradeLoading}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {upgradeLoading ? "Redirecting to checkout..." : `Upgrade to ${plan.label}`}
                  </button>
                ) : isUpgrade ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-medium text-slate-600">
                    Contact sales to upgrade
                  </div>
                ) : isDowngrade ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm text-slate-500">
                    Contact support to downgrade
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
