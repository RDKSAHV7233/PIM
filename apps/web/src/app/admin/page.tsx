import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { canViewAdminNavigationItem, describeAdminAccess, type AdminNavigationAudience } from "@/lib/admin-navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const adminLinks = [
  {
    title: "Plan & Usage",
    description: "Usage meters, tier controls, and plan enforcement visibility.",
    href: "/admin/plan",
    visibility: "editor_plus" as AdminNavigationAudience,
  },
  {
    title: "Users & Roles",
    description: "Access model and role visibility for operations teams.",
    href: "/admin/users",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "API Keys",
    description: "Issue tenant-scoped machine credentials for the public API.",
    href: "/admin/api-keys",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "Auth Policy",
    description: "Store tenant MFA, session timeout, and OIDC posture with audit visibility.",
    href: "/admin/auth-policy",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "OIDC / SSO",
    description: "Configure your external identity provider for single sign-on login.",
    href: "/admin/auth-policy/oidc",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "Connector Access",
    description: "Grant/revoke install, reconnect, and uninstall actions.",
    href: "/admin/connectors",
    visibility: "editor_plus" as AdminNavigationAudience,
  },
  {
    title: "Outbound Webhooks",
    description: "Deliver import, publish, and approval events to external HTTP endpoints.",
    href: "/admin/webhooks",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "Privacy",
    description: "View consent, export, and deletion status for the signed-in account.",
    href: "/admin/privacy",
    visibility: "all" as AdminNavigationAudience,
  },
  {
    title: "Commercial Ops",
    description: "Manage tenant plans, process upgrade requests, and change billing tiers.",
    href: "/admin/commercial",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
  {
    title: "Audit Logs",
    description: "Review security and governance actions with traceability.",
    href: "/admin/audit",
    visibility: "system_admin_gated" as AdminNavigationAudience,
  },
];

export default async function AdminPage() {
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin", 401));
  }
  const visibleAdminLinks = adminLinks.filter((item) => canViewAdminNavigationItem(actorRole, item.visibility, adminBoundaryRoles));
  const accessSummary = describeAdminAccess(actorRole, adminBoundaryRoles);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        description={`Workspace settings and governance controls available for your current ${actorRole} role.`}
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<span className="font-semibold text-slate-700">Admin</span>
          </>
        }
      />

      <Card>
        <CardTitle>{accessSummary.title}</CardTitle>
        <p className="mt-2 text-sm text-slate-600">{accessSummary.body}</p>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAdminLinks.map((item) => (
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
