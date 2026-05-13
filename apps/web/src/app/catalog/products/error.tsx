"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function CatalogProductsError({ reset }: { reset: () => void }) {
  return <RouteErrorState retry={reset} />;
}
