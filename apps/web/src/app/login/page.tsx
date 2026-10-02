import { LoginPageClient } from "@/components/auth/login-page-client";
import { cookies } from "next/headers";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { isPublicSignupEnabled } from "@/lib/public-signup";
import { getServerSessionClaims } from "@/lib/server-session";
import { redirect } from "next/navigation";

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
  const reason = getString(params.reason).trim().toLowerCase();
  // A token that still *looks* valid locally (signature + exp) can be rejected by the API
  // (revoked after logout in another tab, lockout, password change, deploy). Pages then
  // redirect here with reason=session_expired. Bouncing straight back to /dashboard would
  // send the user into a loop that ends on a blank dashboard shell (prod-cert DEF-PC-016),
  // so only auto-forward when we were NOT sent here because the session failed. When the
  // reason already says the session failed there is nothing to decide, so skip the token check.
  const sentHereBecauseSessionFailed = reason === "session_expired" || reason === "forbidden";
  if (!sentHereBecauseSessionFailed && (await getServerSessionClaims())) {
    redirect("/dashboard");
  }
  const cookieStore = await cookies();
  const locale = resolveLocale(getString(params.lang) || cookieStore.get(PIM_LOCALE_COOKIE)?.value);
  const nextPath = sanitizeNextPath(getString(params.next));
  const workspaceSlug = getString(params.workspace).trim().toLowerCase();
  return (
    <LoginPageClient
      locale={locale}
      reason={reason}
      nextPath={nextPath}
      initialWorkspaceSlug={workspaceSlug}
      signupEnabled={isPublicSignupEnabled()}
    />
  );
}
