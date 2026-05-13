"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function CatalogError({ reset }: { reset: () => void }) {
  return <RouteErrorState retry={reset} />;
}
