import { MfaEnrollPageClient } from "@/components/auth/mfa-enroll-page-client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

interface MfaEnrollPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export default async function MfaEnrollPage({ searchParams }: MfaEnrollPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const hasEnrollmentToken = Boolean(cookieStore.get("pim_mfa_enrollment_token")?.value);
  if (!hasEnrollmentToken) {
    redirect("/login");
  }
  const maskedEmail = getString(params.email).trim();
  const workspaceSlug = getString(params.workspace).trim().toLowerCase();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);

  return (
    <MfaEnrollPageClient
      maskedEmail={maskedEmail}
      workspaceSlug={workspaceSlug}
      locale={locale}
    />
  );
}
