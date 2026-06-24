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
