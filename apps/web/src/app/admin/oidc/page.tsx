import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface OidcPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminOidcPage({ searchParams }: OidcPageProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string" && value.trim().length > 0) {
      params.set(key, value);
    }
  }
  redirect(params.size > 0 ? `/admin/auth-policy/oidc?${params.toString()}` : "/admin/auth-policy/oidc");
}
