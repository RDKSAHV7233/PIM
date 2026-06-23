import Link from "next/link";
import { redirect } from "next/navigation";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { ApiHttpError, getBillingPlans, getBillingUpgradeRequest, getBillingUsage } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { resolveCommercialContactTarget } from "@/lib/commercial-contact";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { UsageMeters } from "./_components/usage-meters";
import { PlanManagementSection } from "./_components/plan-management";
import { PlanComparisonWrapper } from "./_components/plan-comparison-wrapper";

export const dynamic = "force-dynamic";

interface PlanPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
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

function resolveCommercialStatusAlert(profile: Awaited<ReturnType<typeof getBillingUsage>>["profile"]) {
  const trialEndsAt = profile.trialEndsAt ? new Date(profile.trialEndsAt).toLocaleDateString("en-IN") : null;
  const graceEndsAt = profile.graceEndsAt ? new Date(profile.graceEndsAt).toLocaleDateString("en-IN") : null;
  const paidThroughAt = profile.paidThroughAt ? new Date(profile.paidThroughAt).toLocaleDateString("en-IN") : null;
  const suspendedAt = profile.suspendedAt ? new Date(profile.suspendedAt).toLocaleDateString("en-IN") : null;

  if (profile.accessStatus === "suspended") return { tone: "border-rose-200 bg-rose-50 text-rose-900", title: "Workspace access is suspended", body: profile.suspensionReason ? `${profile.suspensionReason}${suspendedAt ? ` Since ${suspendedAt}.` : ""}` : `Contact Vexa commercial ops to restore access.` };
  if (profile.billingStatus === "past_due") return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Billing needs attention", body: graceEndsAt ? `Payment is past due. Resolve before ${graceEndsAt} to avoid interruption.` : "Contact Vexa commercial ops to avoid interruption." };
  if (profile.billingStatus === "cancelled") return { tone: "border-slate-300 bg-slate-50 text-slate-800", title: "Workspace is scheduled to end", body: paidThroughAt ? `Current access continues through ${paidThroughAt}.` : "Contact Vexa commercial ops if continued access is required." };
  if (profile.billingStatus === "trial") return { tone: "border-blue-200 bg-blue-50 text-blue-900", title: "Trial is active", body: trialEndsAt ? `Your trial runs through ${trialEndsAt}.` : "Vexa will confirm commercial terms before any access change." };
  return null;
}

function resolveUpgradeRequestStatusAlert(statusInput: string | undefined) {
  const status = String(statusInput ?? "").trim().toLowerCase();
  if (status === "submitted") return { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", title: "Upgrade request submitted", body: "Vexa commercial ops has your request and will follow up on next steps." };
  if (status === "already-open") return { tone: "border-sky-200 bg-sky-50 text-sky-900", title: "Upgrade request already open", body: "An open upgrade request already exists. Vexa will continue from the existing request." };
  if (status === "forbidden") return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Upgrade request needs an admin session", body: "Sign in again with an active admin session to submit a commercial change request." };
  return null;
}

function resolveBillingContactStatusAlert(statusInput: string | undefined, billingContactEmail: string | null) {
  const status = String(statusInput ?? "").trim().toLowerCase();
  if (status === "saved") return { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", title: "Billing contact updated", body: billingContactEmail ? `Commercial notices will now go to ${billingContactEmail}.` : "Notices will fall back to active workspace admins." };
  if (status === "cleared") return { tone: "border-sky-200 bg-sky-50 text-sky-900", title: "Billing contact cleared", body: "Commercial notices will now fall back to active workspace admins." };
  if (status === "invalid") return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Billing contact needs a valid email", body: "Enter a valid billing email address or clear the field." };
  if (status === "forbidden") return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Billing contact update needs an admin session", body: "Sign in again with an active admin session." };
  return null;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole: role } = await getServerSession();
  const claims = await getServerSessionClaims();

  let usage: Awaited<ReturnType<typeof getBillingUsage>>;
  let plans: Awaited<ReturnType<typeof getBillingPlans>>["items"] = [];
  let upgradeRequest: Awaited<ReturnType<typeof getBillingUpgradeRequest>>["item"] = null;

  try {
    [usage, plans, upgradeRequest] = await Promise.all([
      getBillingUsage({ role, authHeader }),
      getBillingPlans({ role, authHeader }).then((response) => response.items),
      role === "admin" ? getBillingUpgradeRequest({ role, authHeader }).then((r) => r.item) : Promise.resolve(null),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/plan", error));
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Plan & Usage"
          description="Plan and billing information is temporarily unavailable."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link><span> / </span><Link href="/admin" className="underline">Admin</Link><span> / </span><span className="font-semibold text-slate-700">Plan &amp; Usage</span></>}
        />
        <InlineAlert tone="error" title="Plan data unavailable" message="Billing and usage information could not be loaded. Retry in a moment or contact support if the issue persists." />
      </div>
    );
  }

  const commercialStatusAlert = resolveCommercialStatusAlert(usage.profile);
  const upgradeRequestStatusAlert = resolveUpgradeRequestStatusAlert(query.requestStatus);
  const billingContactStatusAlert = resolveBillingContactStatusAlert(query.billingContactStatus, usage.profile.billingContactEmail);
  const commercialContact = resolveCommercialContactTarget({ tenantKey: usage.profile.tenantKey, planTier: usage.planTier, requesterId: claims?.sub ?? null, source: "admin_plan" });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plan & Usage"
        description={`Plan: ${usage.planTier} | Billing: ${formatCommercialStatus(usage.billingStatus)} | Access: ${formatAccessStatus(usage.accessStatus)} | Billing month: ${usage.month} | Resets on ${new Date(usage.billingCycleResetAt).toLocaleDateString("en-IN")}`}
        breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link><span> / </span><Link href="/admin" className="underline">Admin</Link><span> / </span><span className="font-semibold text-slate-700">Plan &amp; Usage</span></>}
      />

      {commercialStatusAlert ? (
        <InlineAlert
          tone={
            commercialStatusAlert.tone.includes("rose") || commercialStatusAlert.tone.includes("red") ? "error" :
            commercialStatusAlert.tone.includes("amber") ? "warning" : "info"
          }
          message={`${commercialStatusAlert.title} — ${commercialStatusAlert.body}`}
        />
      ) : null}

      <UsageMeters usage={usage} />

      {role !== "admin" ? (
        <div className="rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-600">
          <span className="font-semibold">Commercial controls are admin-only.</span> You can still review current usage and status above.
        </div>
      ) : null}

      {role === "admin" ? (
        <PlanManagementSection
          usage={usage}
          upgradeRequest={upgradeRequest}
          signupTrendDays={30}
          billingContactStatusAlert={billingContactStatusAlert}
          upgradeRequestStatusAlert={upgradeRequestStatusAlert}
          commercialContact={commercialContact}
        />
      ) : null}

      <PlanComparisonWrapper
        plans={plans}
        currentTier={usage.planTier}
        billingStatus={usage.billingStatus}
        hasOpenUpgradeRequest={Boolean(upgradeRequest)}
        canRequestUpgrade={role === "admin"}
      />
    </div>
  );
}
