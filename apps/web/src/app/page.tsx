import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TAB_ROUTE_MAP: Record<string, string> = {
  products: "/catalog/products",
  categories: "/catalog/categories",
  import: "/operations/imports",
  "bulk-edit": "/operations/bulk-edit",
};

function normalizeQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }
  return String(value ?? "").trim();
}

function buildRedirectPath(
  basePath: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (key === "tab") {
      continue;
    }
    const value = normalizeQueryValue(raw);
    if (value.length > 0) {
      params.set(key, value);
    }
  }
  const encoded = params.toString();
  return encoded ? `${basePath}?${encoded}` : basePath;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const query = await searchParams;
  const tab = normalizeQueryValue(query.tab).toLowerCase();
  const targetPath = TAB_ROUTE_MAP[tab] ?? "/dashboard";
  redirect(buildRedirectPath(targetPath, query));
}
