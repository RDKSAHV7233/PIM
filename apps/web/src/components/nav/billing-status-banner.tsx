import Link from "@/components/ui/app-link";
import { getBillingPlanProfile } from "@/lib/api/billing";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

const TRIAL_WARNING_DAYS = 7;

function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export async function BillingStatusBanner() {
  try {
    const authHeader = await getServerAuthHeader();
    if (!authHeader) return null;

    const role = await getServerActorRole();
    const profile = await getBillingPlanProfile({ role, authHeader });
    if (!profile) return null;

    if (profile.billingStatus === "past_due") {
      return (
        <div className="flex items-center justify-between gap-3 bg-amber-50 px-5 py-2.5 text-sm text-amber-900 md:px-8">
          <span>
            <strong className="font-semibold">Billing needs attention.</strong> Payment is past due.
            Resolve commercial terms to avoid workspace interruption.
          </span>
          <Link href="/admin/plan" className="shrink-0 font-semibold underline underline-offset-2">
            View plan
          </Link>
        </div>
      );
    }

    if (profile.billingStatus === "trial") {
      const days = daysUntil(profile.trialEndsAt);
      if (days !== null && days <= TRIAL_WARNING_DAYS) {
        const label = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
        return (
          <div className="flex items-center justify-between gap-3 bg-blue-50 px-5 py-2.5 text-sm text-blue-900 md:px-8">
            <span>
              <strong className="font-semibold">Trial ending {label}.</strong> Review your plan
              before access changes.
            </span>
            <Link href="/admin/plan" className="shrink-0 font-semibold underline underline-offset-2">
              View plan
            </Link>
          </div>
        );
      }
    }

    return null;
  } catch {
    return null;
  }
}
