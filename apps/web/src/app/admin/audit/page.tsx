import { Card, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function AdminAuditPage() {
  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Audit log explorer UI is planned as a dedicated governance screen.
        </p>
      </header>
      <Card>
        <CardTitle>Current State</CardTitle>
        <p className="mt-2 text-sm text-slate-700">
          Audit events are captured server-side for key actions (plan updates, connector permissions, connector lifecycle).
        </p>
      </Card>
    </div>
  );
}
