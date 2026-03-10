import { AccountLockedPageClient } from "@/components/auth/account-locked-page-client";
import { cookies } from "next/headers";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

interface LockedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

export default async function LockedPage({ searchParams }: LockedPageProps) {
  const params = await searchParams;
  const workspaceSlug = getString(params.workspace).trim().toLowerCase();
  const email = getString(params.email).trim();
  const maskedEmail = getString(params.maskedEmail).trim() || "yo***@example.com";
  const unlockAtIso = getString(params.unlockAt).trim();
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);

  return (
    <AccountLockedPageClient
      workspaceSlug={workspaceSlug}
      email={email}
      maskedEmail={maskedEmail}
      unlockAtIso={unlockAtIso}
      locale={locale}
    />
  );
}
