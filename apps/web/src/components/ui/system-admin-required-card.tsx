import Link from "@/components/ui/app-link";
import { Card, CardTitle } from "@/components/ui/card";

interface SystemAdminRequiredCardProps {
  /** What the user was trying to reach, e.g. "API keys" or "Webhooks". */
  surfaceLabel: string;
  backHref?: string;
}

// CTO review remediation (SEC-003/UX-003): system-admin-gated pages used to
// silently redirect("/admin") when the caller lacked the boundary role, with
// no explanation — the user just bounced back to /admin and had to guess why.
// This renders the same explicit denial panel apps/web/src/app/admin/
// auth-policy/page.tsx already used for its actorRole check, extended to
// cover the boundary-role check every one of these pages performs first.
export function SystemAdminRequiredCard({ surfaceLabel, backHref = "/admin" }: SystemAdminRequiredCardProps) {
  return (
    <Card>
      <CardTitle>Security Admin access required</CardTitle>
      <p className="mt-2 text-sm text-slate-600">
        {surfaceLabel} is restricted to workspace members with the System Admin or Super Admin boundary role. Your
        current account doesn&apos;t have that boundary role, so this surface isn&apos;t available to you.
      </p>
      <div className="mt-4">
        <Link
          href={backHref}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Back to Admin
        </Link>
      </div>
    </Card>
  );
}
