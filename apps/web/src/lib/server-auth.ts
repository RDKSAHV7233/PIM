import { cookies } from "next/headers";
import { getServerSessionClaims } from "@/lib/server-session";

export async function hasServerAuthToken(): Promise<boolean> {
  const claims = await getServerSessionClaims();
  return Boolean(claims);
}

export async function getServerAuthHeader(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("pim_access_token")?.value ?? "").trim();
  if (!token) {
    return undefined;
  }
  const claims = await getServerSessionClaims();
  return claims ? `Bearer ${token}` : undefined;
}

/**
 * Reads the CSRF cookie server-side, for embedding as a hidden field in a
 * native (URL-action) form. Native form submissions can't set the
 * `x-csrf-token` header the way client-side fetch calls do (see
 * apps/web/src/app/api/_auth.ts validateFormCsrf), so the token has to ride
 * in the form body instead — this is the server-rendered source for that.
 */
export async function getServerCsrfToken(): Promise<string> {
  const cookieStore = await cookies();
  return String(cookieStore.get("pim_csrf_token")?.value ?? "").trim();
}
