import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProductsIndexPage({ searchParams }: Props) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextSearch = new URLSearchParams();

  if (resolvedSearchParams) {
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          nextSearch.append(key, entry);
        }
      } else if (typeof value === "string") {
        nextSearch.set(key, value);
      }
    }
  }

  const target = nextSearch.size > 0 ? `/catalog/products?${nextSearch.toString()}` : "/catalog/products";
  redirect(target);
}
