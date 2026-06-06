import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { ApiHttpError, getBillingUpgradeRequest, getBillingUsage, getKpiTrends } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { resolveCommercialContactTarget } from "@/lib/commercial-contact";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { requestPlanUpgradeAction, updateBillingContactAction } from "./actions";
import { UsageMeters } from "./_components/usage-meters";
import { SignupConversionSection } from "./_components/signup-conversion";
import { PlanManagementSection } from "./_components/plan-management";
import { PlanComparisonWrapper } from "./_components/plan-comparison-wrapper";

export const dynamic = "force-dynamic";

interface PlanPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const SIGNUP_TREND_WINDOWS = [7, 30, 90] as const;

function sumTrendValues(points: Array<{ value: number }>): number {
  return points.reduce((sum, p) => sum + (Number.isFinite(p.value) ? p.value : 0), 0);
}

function latestTrendValue(points: Array<{ value: number }>): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i]?.value;
    if (Number.isFinite(v)) return Number(v);
  }
  return 0;
}

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0h";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
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

function resolveSignupTrendDays(input: string | undefined): (typeof SIGNUP_TREND_WINDOWS)[number] {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  return SIGNUP_TREND_WINDOWS.includes(parsed as (typeof SIGNUP_TREND_WINDOWS)[number])
    ? (parsed as (typeof SIGNUP_TREND_WINDOWS)[number])
    : 30;
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



function resolveSignupHealthAlert({ rangeDays, requests, verifications, verificationRate, medianVerifyHours }: { rangeDays: number; requests: number; verifications: number; verificationRate: number; medianVerifyHours: number }) {
  const pending = Math.max(requests - verifications, 0);
  if (requests < 3) return null;
  if (verificationRate < 40) return { tone: "border-red-200 bg-red-50 text-red-900", title: "Verification rate needs attention", body: `${pending} teams are still unverified in the last ${rangeDays} days. Check email delivery and the verification path.` };
  if (medianVerifyHours >= 24) return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Verification is slowing down", body: `Median verification time is ${formatHours(medianVerifyHours)} in the last ${rangeDays} days. Review the onboarding email.` };
  return { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", title: "Signup conversion looks healthy", body: `${verifications} of ${requests} signup requests verified in the last ${rangeDays} days.` };
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole: role } = await getServerSession();
  const claims = await getServerSessionClaims();
  const signupTrendDays = resolveSignupTrendDays(query.days);

  let usage: Awaited<ReturnType<typeof getBillingUsage>>;
  let signupTrends: Awaited<ReturnType<typeof getKpiTrends>> | null = null;
  let upgradeRequest: Awaited<ReturnType<typeof getBillingUpgradeRequest>>["item"] = null;

  try {
    [usage, signupTrends, upgradeRequest] = await Promise.all([
      getBillingUsage({ role, authHeader }),
      role === "admin" ? getKpiTrends({ days: signupTrendDays }, { role, authHeader }).catch((err: unknown) => { if (err instanceof ApiHttpError && err.status === 404) return null; throw err; }) : Promise.resolve(null),
      role === "admin" ? getBillingUpgradeRequest({ role, authHeader }).then((r) => r.item) : Promise.resolve(null),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/plan", error));
    }
    throw error;
  }

  const signupRequests = signupTrends ? Math.round(sumTrendValues(signupTrends.signupRequests)) : 0;
  const signupVerifications = signupTrends ? Math.round(sumTrendValues(signupTrends.signupVerifications)) : 0;
  const signupPendingBacklog = Math.max(signupRequests - signupVerifications, 0);
  const signupVerificationRate = signupTrends ? latestTrendValue(signupTrends.signupVerificationRate) : 0;
  const signupMedianVerifyHours = signupTrends ? latestTrendValue(signupTrends.signupMedianTimeToVerifyHours) : 0;

  const commercialStatusAlert = resolveCommercialStatusAlert(usage.profile);
  const upgradeRequestStatusAlert = resolveUpgradeRequestStatusAlert(query.requestStatus);
  const billingContactStatusAlert = resolveBillingContactStatusAlert(query.billingContactStatus, usage.profile.billingContactEmail);
  const signupHealthAlert = signupTrends ? resolveSignupHealthAlert({ rangeDays: signupTrends.rangeDays, requests: signupRequests, verifications: signupVerifications, verificationRate: signupVerificationRate, medianVerifyHours: signupMedianVerifyHours }) : null;
  const signupExportHref = `/api/admin/plan/signup-trends/export?days=${signupTrendDays}`;
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

      {role === "admin" && signupTrends ? (
        <SignupConversionSection
          signupTrends={signupTrends}
          signupRequests={signupRequests}
          signupVerifications={signupVerifications}
          signupPendingBacklog={signupPendingBacklog}
          signupVerificationRate={signupVerificationRate}
          signupMedianVerifyHours={signupMedianVerifyHours}
          signupHealthAlert={signupHealthAlert}
          signupExportHref={signupExportHref}
        />
      ) : null}

      {role === "admin" ? (
        <PlanManagementSection
          usage={usage}
          upgradeRequest={upgradeRequest}
          signupTrendDays={signupTrendDays}
          billingContactStatusAlert={billingContactStatusAlert}
          upgradeRequestStatusAlert={upgradeRequestStatusAlert}
          commercialContact={commercialContact}
        />
      ) : null}

      <PlanComparisonWrapper
        currentTier={usage.planTier}
        billingStatus={usage.billingStatus}
        stripeEnabled={false}
      />

      {role === "admin" ? (
        <Card>
          <CardTitle>Commercial operations</CardTitle>
          <p className="text-sm text-slate-600">Change tenant plan tiers, process upgrade requests, and view commercial overview across all workspaces.</p>
          <Link href="/admin/commercial" className="mt-3 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Open commercial ops
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
