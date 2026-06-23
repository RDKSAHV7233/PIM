"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function ConnectorDetailError({ reset }: { reset: () => void }) {
  return <RouteErrorState retry={reset} />;
}
