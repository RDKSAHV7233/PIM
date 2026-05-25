import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { canViewAdminNavigationItem, describeAdminAccess, type AdminNavigationAudience } from "@/lib/admin-navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const workspaceAdminModules = [
  {
    title: "Users & Roles",
    description: "Invite workspace users, update roles, and manage account access.",
    href: "/admin/users",
    visibility: "editor_plus" as AdminNavigationAudience,
  },
  {
    title: "Plan & Usage",
    description: "Review plan status, billing contact routing, and upgrade-request state.",
    href: "/admin/plan",
    visibility: "editor_plus" as AdminNavigationAudience,
  },
  {
    title: "Connector Access",
    description: "Grant or revoke connector permissions for the workspace.",
    href: "/admin/connectors",
    visibility: "editor_plus" as AdminNavigationAudience,
  },
  {
    title: "API Keys",
    description: "Issue and revoke tenant-scoped machine credentials for the public API.",
    href: "/admin/api-keys",
    visibility: "admin" as AdminNavigationAudience,
  },
  {
    title: "Auth Policy",
    description: "Store tenant MFA, session timeout, and OIDC posture ahead of enterprise identity rollout.",
    href: "/admin/auth-policy",
    visibility: "admin" as AdminNavigationAudience,
  },
  {
    title: "Outbound Webhooks",
    description: "Configure outbound event deliveries for imports, approvals, and publishing.",
    href: "/admin/webhooks",
    visibility: "admin" as AdminNavigationAudience,
  },
  {
    title: "Privacy",
    description: "View export and deletion status for the signed-in account.",
    href: "/admin/privacy",
    visibility: "all" as AdminNavigationAudience,
  },
  {
    title: "Audit Logs",
    description: "Review security and governance activity with actor and resource traceability.",
    href: "/admin/audit",
    visibility: "admin" as AdminNavigationAudience,
  },
];

export default async function AdminWorkspacePage() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/workspace", 401));
  }
  const visibleWorkspaceAdminModules = workspaceAdminModules.filter((item) =>
    canViewAdminNavigationItem(actorRole, item.visibility),
  );
  const accessSummary = describeAdminAccess(actorRole);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workspace Admin Guide"
        description={`This route is a compatibility handoff for older bookmarks. Use the admin modules available for your current ${actorRole} role below.`}
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">Workspace Admin Guide</span>
          </>
        }
      />

      <Card>
        <CardTitle>{accessSummary.title}</CardTitle>
        <p className="mt-2 text-sm text-slate-600">{accessSummary.body}</p>
      </Card>

      <Card>
        <CardTitle>Choose The Admin Module You Need</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Workspace settings are no longer managed from one shared page. Use the dedicated modules below for the admin,
          integration, and privacy tools available to your current role.
        </p>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleWorkspaceAdminModules.map((item) => (
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
