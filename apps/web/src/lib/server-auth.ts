import { cookies } from "next/headers";

export async function getServerAuthHeader(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("pim_access_token")?.value ?? "").trim();
  if (!token) {
    return undefined;
  }
  return `Bearer ${token}`;
}
