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
    tier: "TRIAL",
    label: "Trial",
    price: "Free for 14 days",
    setupFee: null,
    tagline: "Explore Vexa PIM before you commit",
    limits: {
      skus: 100,
      submissions: 100,
      users: 2,
      roles: "3 (admin, editor, viewer)",
      storageGb: 1,
      connectorInstallations: 1,
      accountsPerConnector: 1,
      apiKeys: 0,
      outboundWebhooks: 0,
      importRowsPerJob: 500,
    },
    features: [
      "Product catalog management",
      "Bulk import (up to 500 rows)",
      "Quality validation",
      "1 marketplace connector",
    ],
  },
  {
    tier: "STARTER",
    label: "Starter",
    price: "₹9,999/month",
    setupFee: "₹15,000–₹25,000 (optional)",
    tagline: "Small serious seller",
    limits: {
      skus: 500,
      submissions: 500,
      users: 3,
      roles: "3 (admin, editor, viewer)",
      storageGb: 5,
      connectorInstallations: 2,
      accountsPerConnector: 1,
      apiKeys: 0,
      outboundWebhooks: 0,
      importRowsPerJob: 2000,
    },
    features: [
      "Product catalog management",
      "Bulk import & repair (up to 2K rows)",
      "Quality validation",
      "2 marketplace connectors",
      "Community support",
    ],
  },
  {
    tier: "GROWTH",
    label: "Growth",
    price: "₹29,999/month",
    setupFee: "₹75,000–₹1,50,000",
    tagline: "Scale your catalog across channels",
    limits: {
      skus: 10000,
      submissions: 10000,
      users: 20,
      roles: "6 (+reviewer, approver, publisher)",
      storageGb: 50,
      connectorInstallations: 10,
      accountsPerConnector: 3,
      apiKeys: 3,
      outboundWebhooks: 3,
      importRowsPerJob: 10000,
    },
    features: [
      "Everything in Starter",
      "Approval workflow",
      "API keys & outbound webhooks",
      "Bulk import up to 10K rows",
      "Multi-account connectors",
      "Priority support",
      "Bulk edit operations",
      "Advanced compliance rules",
    ],
  },
  {
    tier: "BUSINESS",
    label: "Business",
    price: "₹69,999/month",
    setupFee: "₹1,50,000–₹3,00,000",
    tagline: "Large catalog operations at scale",
    limits: {
      skus: 50000,
      submissions: 50000,
      users: 100,
      roles: "8 (all roles)",
      storageGb: 200,
      connectorInstallations: 50,
      accountsPerConnector: 10,
      apiKeys: 20,
      outboundWebhooks: 20,
      importRowsPerJob: 20000,
    },
    features: [
      "Everything in Growth",
      "50K SKUs & submissions",
      "100 users, all 8 roles",
      "20 API keys & webhooks",
      "Bulk import up to 20K rows",
      "200 GB storage",
      "Dedicated support",
    ],
  },
  {
    tier: "ENTERPRISE",
    label: "Enterprise",
    price: "From ₹1,49,999/month",
    setupFee: "Custom",
    tagline: "Unlimited scale with dedicated support",
    limits: {
      skus: 100000,
      submissions: 100000,
      users: 999,
      roles: "8 (all roles)",
      storageGb: 500,
      connectorInstallations: 100,
      accountsPerConnector: 20,
      apiKeys: 50,
      outboundWebhooks: 50,
      importRowsPerJob: 30000,
    },
    features: [
      "Everything in Business",
      "100K SKUs & submissions",
      "50 API keys & outbound webhooks",
      "Bulk import up to 30K rows",
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

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                {plan.setupFee && (
                  <p className="mt-0.5 text-xs text-slate-500">Setup: {plan.setupFee}</p>
                )}
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
                  <span className="text-slate-600">Roles</span>
                  <span className="font-medium text-slate-900">{plan.limits.roles}</span>
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
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">API keys</span>
                  <span className="font-medium text-slate-900">{plan.limits.apiKeys === 0 ? "—" : formatLimit(plan.limits.apiKeys)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Outbound webhooks</span>
                  <span className="font-medium text-slate-900">{plan.limits.outboundWebhooks === 0 ? "—" : formatLimit(plan.limits.outboundWebhooks)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Import rows / job</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.importRowsPerJob)}</span>
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
