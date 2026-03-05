import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function SettingsIndexPage() {
  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-slate-600 underline">
        Back to dashboard
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">Manage tenant plan, connector access, and privacy controls.</p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardTitle>Plan</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Review usage meters and update plan tier.
          </p>
          <Link href="/settings/plan" className="mt-3 inline-block text-sm text-slate-700 underline">
            Open Plan Settings
          </Link>
        </Card>
        <Card>
          <CardTitle>Connector Access</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Grant and revoke connector action permissions.
          </p>
          <Link href="/settings/connectors" className="mt-3 inline-block text-sm text-slate-700 underline">
            Open Connector Access
          </Link>
        </Card>
        <Card>
          <CardTitle>Privacy</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            View export, consent, and deletion request controls.
          </p>
          <Link href="/settings/privacy" className="mt-3 inline-block text-sm text-slate-700 underline">
            Open Privacy Settings
          </Link>
        </Card>
      </div>
    </div>
  );
}
