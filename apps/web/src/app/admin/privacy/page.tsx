import { DataPrivacyPageClient } from "@/components/settings/data-privacy-page-client";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminPrivacyPage() {
  const actorRole = await getServerActorRole();
  return <DataPrivacyPageClient actorRole={actorRole} />;
}
