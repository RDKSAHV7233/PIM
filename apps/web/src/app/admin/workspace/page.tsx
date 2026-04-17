import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const workspaceAdminModules = [
  {
    title: "Users & Roles",
    description: "Invite workspace users, update roles, and manage account access.",
    href: "/admin/users",
  },
  {
    title: "Plan & Usage",
    description: "Review plan status, billing contact routing, and upgrade-request state.",
    href: "/admin/plan",
  },
  {
    title: "Connector Access",
    description: "Grant or revoke connector permissions for the workspace.",
    href: "/admin/connectors",
  },
  {
    title: "API Keys",
    description: "Issue and revoke tenant-scoped machine credentials for the public API.",
    href: "/admin/api-keys",
  },
  {
    title: "Outbound Webhooks",
    description: "Configure outbound event deliveries for imports, approvals, and publishing.",
    href: "/admin/webhooks",
  },
  {
    title: "Privacy",
    description: "View export and deletion status for the signed-in account.",
    href: "/admin/privacy",
  },
  {
    title: "Audit Logs",
    description: "Review security and governance activity with actor and resource traceability.",
    href: "/admin/audit",
  },
];

export default async function AdminWorkspacePage() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/workspace", 401));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workspace Admin Guide"
        description="This route is a compatibility handoff for older bookmarks. Use the dedicated admin modules below for real configuration work."
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">Workspace Admin Guide</span>
          </>
        }
      />

      <Card>
        <CardTitle>Choose The Admin Module You Need</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Workspace settings are no longer managed from one shared page. Use the dedicated modules below for users,
          plan controls, integrations, privacy, and audit follow-up.
        </p>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspaceAdminModules.map((item) => (
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
