import { DataPrivacyPageClient } from "@/components/settings/data-privacy-page-client";
import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminPrivacyPage() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/privacy", 401));
  }
  const actorRole = await getServerActorRole();
  return <DataPrivacyPageClient actorRole={actorRole} />;
}
