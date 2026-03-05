import { PasswordResetPageClient } from "@/components/auth/password-reset-page-client";
import { cookies } from "next/headers";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

interface ResetPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

export default async function ResetPage({ searchParams }: ResetPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);
  const initialEmail = getString(params.email).trim();
  return <PasswordResetPageClient locale={locale} initialEmail={initialEmail} />;
}
