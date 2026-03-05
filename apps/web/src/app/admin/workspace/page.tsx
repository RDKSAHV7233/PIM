import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function AdminWorkspacePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Workspace Settings"
        description="Workspace-level controls for tenant configuration and defaults."
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">Workspace Settings</span>
          </>
        }
      />

      <Card>
        <CardTitle>Current Configuration</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Core workspace settings are currently managed through operational modules and API policy.
        </p>
        <div className="mt-4 grid gap-2 text-sm">
          <Link href="/admin/plan" className="text-blue-700 hover:underline">
            Open plan and usage
          </Link>
          <Link href="/admin/connectors" className="text-blue-700 hover:underline">
            Open connector access
          </Link>
        </div>
      </Card>
    </div>
  );
}
