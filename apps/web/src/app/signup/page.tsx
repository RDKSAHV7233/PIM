import { SignupPageClient } from "@/components/auth/signup-page-client";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";
import { isPublicSignupEnabled } from "@/lib/public-signup";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface SignupPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  if (!isPublicSignupEnabled()) {
    notFound();
  }
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);
  const initialWorkspaceSlug = getString(params.workspace).trim().toLowerCase();
  const initialEmail = getString(params.email).trim().toLowerCase();

  return (
    <SignupPageClient
      locale={locale}
      initialWorkspaceSlug={initialWorkspaceSlug}
      initialEmail={initialEmail}
    />
  );
}
