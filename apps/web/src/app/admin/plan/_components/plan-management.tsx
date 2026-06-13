import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { PlanUsageResponse } from "@/lib/api/core";
import { requestPlanUpgradeAction, updateBillingContactAction } from "../actions";

type BillingProfile = PlanUsageResponse["profile"];

interface UpgradeRequest {
  id: string;
  status: string;
  notes?: string | null;
  requestedBy: string;
  requestedPlanTier?: string | null;
  createdAt: string;
}

interface PlanManagementProps {
  usage: PlanUsageResponse;
  upgradeRequest: UpgradeRequest | null;
  signupTrendDays: number;
  billingContactStatusAlert: { tone: string; title: string; body: string } | null;
  upgradeRequestStatusAlert: { tone: string; title: string; body: string } | null;
  commercialContact: { href: string; label: string; helperText: string } | null;
}

function formatCommercialStatus(value: string): string {
  const n = String(value ?? "").trim().toLowerCase();
  if (n === "active_paid") return "Active paid";
  if (n === "past_due") return "Past due";
  if (n === "cancelled") return "Cancelled";
  if (n === "suspended") return "Suspended";
  return "Trial";
}

function formatAccessStatus(value: string): string {
  return String(value ?? "").trim().toLowerCase() === "suspended" ? "Suspended" : "Active";
}

function describeUpgradeRequest(request: UpgradeRequest) {
  if (request.status === "acknowledged") return {
    title: "Upgrade request acknowledged",
    body: "Vexa commercial ops has picked this up and is reviewing the next plan change.",
    tone: "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950",
  };
  return {
    title: "Upgrade request pending",
    body: "Vexa commercial ops is reviewing this request.",
    tone: "rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950",
  };
}

function resolveNextPlanTier(currentTier: string): string | null {
  const tiers = ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"];
  const index = tiers.indexOf(String(currentTier ?? "").trim().toUpperCase());
  if (index < 0 || index >= tiers.length - 1) {
    return null;
  }
  return tiers[index + 1];
}

export function PlanManagementSection({
  usage,
  upgradeRequest,
  signupTrendDays,
  billingContactStatusAlert,
  upgradeRequestStatusAlert,
  commercialContact,
}: PlanManagementProps) {
  const descriptor = upgradeRequest ? describeUpgradeRequest(upgradeRequest) : null;
  const nextPlanTier = resolveNextPlanTier(usage.planTier);

  return (
    <Card>
      <CardTitle>Plan management</CardTitle>
      <div className="mt-3 space-y-4 text-sm text-slate-700">
        <p>Plan changes are managed by Vexa commercial ops. Admins can review plan usage here, but paid-plan changes are applied through Vexa&apos;s commercial workflow.</p>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current plan</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">{usage.planTier}</div>
          <div className="mt-1 text-xs text-slate-500">
            Billing: {formatCommercialStatus(usage.profile.billingStatus)} | Access: {formatAccessStatus(usage.profile.accessStatus)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Tenant key: {usage.profile.tenantKey}</div>
          <div className="mt-1 text-xs text-slate-500">
            Billing notices: {usage.profile.billingContactEmail ?? "active workspace admins"}
          </div>
        </div>

        {billingContactStatusAlert ? (
          <InlineAlert
            tone={billingContactStatusAlert.tone.includes("emerald") ? "success" : billingContactStatusAlert.tone.includes("amber") ? "warning" : "info"}
            message={`${billingContactStatusAlert.title} — ${billingContactStatusAlert.body}`}
          />
        ) : null}

        <form action={updateBillingContactAction} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <input type="hidden" name="days" value={String(signupTrendDays)} />
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="billing-contact-email">
              Billing contact email
            </label>
            <p className="mt-1 text-xs text-slate-500">Commercial notices go to this email first. Empty falls back to active workspace admins.</p>
            <input
              id="billing-contact-email"
              type="email"
              name="billingContactEmail"
              defaultValue={usage.profile.billingContactEmail ?? ""}
              maxLength={200}
              placeholder="billing@example.com"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save billing contact</button>
            {usage.profile.billingContactEmail ? (
              <button type="submit" name="clear" value="true" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Use admin fallback</button>
            ) : null}
            <p className="text-xs text-slate-500">Current path: {usage.profile.billingContactEmail ?? "active workspace admins"}</p>
          </div>
        </form>

        {upgradeRequestStatusAlert ? (
          <div className={`rounded-md border px-3 py-3 text-sm ${upgradeRequestStatusAlert.tone}`}>
            <div className="font-semibold">{upgradeRequestStatusAlert.title}</div>
            <div className="mt-1">{upgradeRequestStatusAlert.body}</div>
          </div>
        ) : null}

        {upgradeRequest ? (
          <div className={descriptor?.tone}>
            <div className="font-semibold">{descriptor?.title}</div>
            <div className="mt-1">
              Submitted on {new Date(upgradeRequest.createdAt).toLocaleString("en-IN")} by {upgradeRequest.requestedBy}. {descriptor?.body}
              {upgradeRequest.requestedPlanTier ? ` Requested plan: ${upgradeRequest.requestedPlanTier}.` : ""}
            </div>
            {upgradeRequest.notes ? (
              <div className="mt-2 rounded-md border border-sky-100 bg-white/70 px-3 py-2 text-xs text-sky-950">
                <div className="font-semibold uppercase tracking-wide text-sky-700">Request notes</div>
                <div className="mt-1 whitespace-pre-wrap">{upgradeRequest.notes}</div>
              </div>
            ) : null}
          </div>
        ) : usage.planTier === "ENTERPRISE" ? null : (
          <form action={requestPlanUpgradeAction} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <input type="hidden" name="source" value="admin_plan" />
            {nextPlanTier ? <input type="hidden" name="requestedPlanTier" value={nextPlanTier} /> : null}
            <input type="hidden" name="days" value={String(signupTrendDays)} />
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="upgrade-request-notes">Request notes</label>
              <p className="mt-1 text-xs text-slate-500">Share what changed so Vexa commercial ops can review the right plan and timeline.</p>
              <textarea
                id="upgrade-request-notes"
                name="notes"
                rows={4}
                maxLength={1000}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="Example: We need more users, more submission volume, and a paid plan review before the trial ends."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                {nextPlanTier ? `Request ${nextPlanTier}` : "Request upgrade"}
              </button>
              <p className="text-xs text-slate-500">Vexa commercial ops will review and follow up with the right plan change.</p>
            </div>
          </form>
        )}

        {commercialContact ? (
          <div className="flex flex-wrap items-center gap-3">
            <a href={commercialContact.href} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {commercialContact.label}
            </a>
            <p className="text-xs text-slate-500">{commercialContact.helperText}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
