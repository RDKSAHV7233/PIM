import { DataPrivacyPageClient } from "@/components/settings/data-privacy-page-client";
import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminPrivacyPage() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/privacy", 401));
  }
  return <DataPrivacyPageClient actorRole={actorRole} />;
}
