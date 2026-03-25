import { SignupVerifyPageClient } from "@/components/auth/signup-verify-page-client";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";
import { isPublicSignupEnabled } from "@/lib/public-signup";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface SignupVerifyPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

export default async function SignupVerifyPage({ searchParams }: SignupVerifyPageProps) {
  if (!isPublicSignupEnabled()) {
    notFound();
  }
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);
  const initialToken = getString(params.token).trim();
  const initialEmail = getString(params.email).trim().toLowerCase();
  const initialWorkspaceSlug = getString(params.workspace).trim().toLowerCase();

  return (
    <SignupVerifyPageClient
      locale={locale}
      initialToken={initialToken}
      initialEmail={initialEmail}
      initialWorkspaceSlug={initialWorkspaceSlug}
    />
  );
}
