import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const adminLinks = [
  {
    title: "Workspace Settings",
    description: "Tenant-level defaults and workspace configuration.",
    href: "/admin/workspace",
  },
  {
    title: "Plan & Usage",
    description: "Usage meters, tier controls, and plan enforcement visibility.",
    href: "/admin/plan",
  },
  {
    title: "Users & Roles",
    description: "Access model and role visibility for operations teams.",
    href: "/admin/users",
  },
  {
    title: "API Keys",
    description: "Issue tenant-scoped machine credentials for the public API.",
    href: "/admin/api-keys",
  },
  {
    title: "Connector Access",
    description: "Grant/revoke install, reconnect, and uninstall actions.",
    href: "/admin/connectors",
  },
  {
    title: "Outbound Webhooks",
    description: "Deliver import, publish, and approval events to external HTTP endpoints.",
    href: "/admin/webhooks",
  },
  {
    title: "Privacy",
    description: "Consent, export, and account deletion governance controls.",
    href: "/admin/privacy",
  },
  {
    title: "Audit Logs",
    description: "Review security and governance actions with traceability.",
    href: "/admin/audit",
  },
];

export default function AdminPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        description="Governance controls for access, plan, privacy, and audit."
        breadcrumb={
          <>
            Dashboard / <span className="font-semibold text-slate-700">Admin</span>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {adminLinks.map((item) => (
          <Card key={item.href}>
            <CardTitle>{item.title}</CardTitle>
            <p className="mt-2 text-sm text-slate-600">{item.description}</p>
            <Link href={item.href} className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Open
            </Link>
          </Card>
        ))}
      </section>
    </div>
  );
}
