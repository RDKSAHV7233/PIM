import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const adminLinks = [
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
    description: "View consent, export, and deletion status for the signed-in account.",
    href: "/admin/privacy",
  },
  {
    title: "Audit Logs",
    description: "Review security and governance actions with traceability.",
    href: "/admin/audit",
  },
];

export default async function AdminPage() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin", 401));
  }
  const actorRole = await getServerActorRole();
  if (actorRole !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        description="Governance controls for access, plan, privacy, and audit."
        breadcrumb={<span className="font-semibold text-slate-700">Admin</span>}
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
