import { LoginPageClient } from "@/components/auth/login-page-client";
import { cookies } from "next/headers";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";
import { sanitizeNextPath } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);
  const reason = getString(params.reason).trim().toLowerCase();
  const nextPath = sanitizeNextPath(getString(params.next));
  return <LoginPageClient locale={locale} reason={reason} nextPath={nextPath} />;
}
