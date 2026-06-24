"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function ValidationError({ reset }: { reset: () => void }) {
  return <RouteErrorState retry={reset} />;
}
