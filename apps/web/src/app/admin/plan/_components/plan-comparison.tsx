"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { PlanMetadata } from "@/lib/api";
import { requestPlanUpgradeAction } from "../actions";

function formatLimit(value: number, unlimited = false): string {
  if (unlimited) return "Unlimited";
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

interface PlanComparisonProps {
  plans: PlanMetadata[];
  currentTier: string;
  billingStatus: string;
  hasOpenUpgradeRequest: boolean;
  canRequestUpgrade: boolean;
}

export function PlanComparison({
  plans,
  currentTier,
  billingStatus,
  hasOpenUpgradeRequest,
  canRequestUpgrade,
}: PlanComparisonProps) {
  const normalizedCurrent = currentTier.toUpperCase();
  const tierIndex = plans.findIndex((plan) => plan.tier === normalizedCurrent);

  return (
    <Card>
      <CardTitle>Compare Plans</CardTitle>
      <p className="mt-1 text-sm text-slate-600">
        Choose the plan that fits your catalog size and team.
        {billingStatus === "trial" ? " Upgrade anytime during your trial." : ""}
      </p>
      <p className="mt-1 text-xs text-slate-500">A SKU is a sellable product variant, not a product record.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {plans.map((plan, index) => {
          const isCurrent = plan.tier === normalizedCurrent;
          const isUpgrade = tierIndex >= 0 && index > tierIndex;
          const isDowngrade = tierIndex >= 0 && index < tierIndex;

          return (
            <div
              key={plan.tier}
              className={`relative rounded-xl border-2 p-5 transition-shadow ${
                isCurrent
                  ? "border-indigo-500 bg-indigo-50/30 shadow-md ring-1 ring-indigo-200"
                  : "border-slate-200 bg-white hover:shadow-sm"
              }`}
            >
              {isCurrent ? (
                <div className="absolute -top-3 left-4">
                  <StatusChip label="Current plan" tone="info" />
                </div>
              ) : null}

              <div className="mt-1">
                <h3 className="text-lg font-semibold text-slate-900">{plan.label}</h3>
                <p className="mt-1 text-xs text-slate-500">{plan.tagline}</p>
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">SKUs</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.skus, plan.unlimited.skus)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Submissions / month</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.submissions, plan.unlimited.submissions)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Users</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.users, plan.unlimited.users)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Roles</span>
                  <span className="font-medium text-slate-900">{plan.limits.roles}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Storage</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.storageGb, plan.unlimited.storageGb)} GB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Connectors</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.connectorInstallations, plan.unlimited.connectorInstallations)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Accounts / connector</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.accountsPerConnector, plan.unlimited.accountsPerConnector)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">API keys</span>
                  <span className="font-medium text-slate-900">{plan.limits.apiKeys === 0 ? "-" : formatLimit(plan.limits.apiKeys, plan.unlimited.apiKeys)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Outbound webhooks</span>
                  <span className="font-medium text-slate-900">{plan.limits.outboundWebhooks === 0 ? "-" : formatLimit(plan.limits.outboundWebhooks, plan.unlimited.outboundWebhooks)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Import rows / job</span>
                  <span className="font-medium text-slate-900">{formatLimit(plan.limits.importRowsPerJob, plan.unlimited.importRowsPerJob)}</span>
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
                ) : isUpgrade && canRequestUpgrade ? (
                  <form action={requestPlanUpgradeAction}>
                    <input type="hidden" name="requestedPlanTier" value={plan.tier} />
                    <input type="hidden" name="source" value="admin_plan_card" />
                    <button
                      type="submit"
                      disabled={hasOpenUpgradeRequest}
                      className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {hasOpenUpgradeRequest ? "Request already open" : `Request ${plan.label}`}
                    </button>
                  </form>
                ) : isUpgrade ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-medium text-slate-600">
                    Admin required to request
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
