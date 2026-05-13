"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="min-h-screen bg-slate-50">
        <RouteErrorState
          title="Application error"
          description="Vexa PIM hit a top-level error. Try again or return to the dashboard."
          retry={reset}
        />
      </body>
    </html>
  );
}
