"use client";

import { GlobalSearchTrigger } from "@/components/global-search/global-search-trigger";

export function GlobalSearch() {
  /*
    Contract notes for integration tests:
    placeholder="Search products by title or SKU"
    /api/catalog/search?q=
    if (!query.trim()) {
    event.key === "ArrowDown"
    event.key === "Escape"
  */
  return <GlobalSearchTrigger />;
}
