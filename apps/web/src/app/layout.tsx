import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AuthenticatedShell } from "@/components/nav/authenticated-shell";
import { BillingStatusBanner } from "@/components/nav/billing-status-banner";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getServerSessionClaims } from "@/lib/server-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vexa PIM",
  description: "Product information management for catalog, quality, and marketplace operations.",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/app_icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/brand/favicon.svg",
    apple: "/brand/app_icon.svg",
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessionClaims = await getServerSessionClaims();
  const hasAuthToken = Boolean(sessionClaims);
  const actorRole = sessionClaims?.role ?? "viewer";
  const assignedRoles = (sessionClaims?.assignedRoles ?? []) as string[];
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-indigo-500"
        >
          Skip to main content
        </a>
        {hasAuthToken ? (
          <AuthenticatedShell actorRole={actorRole} adminBoundaryRoles={assignedRoles} showRoleBadge={Boolean(sessionClaims)}>
            <BillingStatusBanner />
            {children}
          </AuthenticatedShell>
        ) : (
          <>
            <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/82 backdrop-blur-xl">
              <div className="flex w-full items-center justify-between gap-4 px-5 py-2.5 md:px-8">
                <Link href="/dashboard" className="inline-flex items-center" aria-label="Vexa PIM home">
                  <BrandLogo variant="compact" className="origin-left scale-[0.95] opacity-90" />
                </Link>
              </div>
            </header>
            <main id="main-content" className="relative isolate mx-auto min-h-[calc(100vh-73px)] max-w-7xl overflow-hidden px-5 py-6 md:px-8 md:py-10">
              <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_rgba(255,255,255,0)_34%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.10),_rgba(255,255,255,0)_28%),linear-gradient(180deg,_#f8fafc_0%,_#f4f7fb_100%)]" />
              <div className="pointer-events-none absolute inset-x-8 top-8 -z-10 h-px bg-[linear-gradient(90deg,_rgba(148,163,184,0),_rgba(148,163,184,0.22),_rgba(148,163,184,0))]" />
              <div className="pointer-events-none absolute left-[8%] top-28 -z-10 hidden h-48 w-48 opacity-50 md:block">
                <div className="absolute left-4 top-4 h-2.5 w-2.5 rounded-full bg-indigo-300 shadow-[0_0_0_6px_rgba(99,102,241,0.08)]" />
                <div className="absolute left-[5.2rem] top-[5.4rem] h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_0_5px_rgba(99,102,241,0.06)]" />
                <div className="absolute left-[2rem] top-[8.5rem] h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_0_5px_rgba(56,189,248,0.06)]" />
                <div className="absolute left-[1.55rem] top-[1.95rem] h-px w-[4.9rem] origin-left rotate-[47deg] bg-[linear-gradient(90deg,_rgba(129,140,248,0.15),_rgba(99,102,241,0.45),_rgba(129,140,248,0.12))]" />
                <div className="absolute left-[2.4rem] top-[8.35rem] h-px w-[4.25rem] origin-left -rotate-[47deg] bg-[linear-gradient(90deg,_rgba(125,211,252,0.12),_rgba(99,102,241,0.34),_rgba(125,211,252,0.08))]" />
              </div>
              <div className="pointer-events-none absolute bottom-16 right-[9%] -z-10 hidden h-56 w-56 opacity-40 md:block">
                <div className="absolute right-6 top-4 h-2.5 w-2.5 rounded-full bg-indigo-300 shadow-[0_0_0_6px_rgba(99,102,241,0.08)]" />
                <div className="absolute right-[6.1rem] top-[5.8rem] h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_0_5px_rgba(56,189,248,0.06)]" />
                <div className="absolute right-[2.65rem] top-[8.9rem] h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_0_5px_rgba(99,102,241,0.06)]" />
                <div className="absolute right-[2rem] top-[1.95rem] h-px w-[5.3rem] origin-right -rotate-[43deg] bg-[linear-gradient(90deg,_rgba(129,140,248,0.12),_rgba(99,102,241,0.4),_rgba(129,140,248,0.08))]" />
                <div className="absolute right-[4.05rem] top-[8.55rem] h-px w-[3.7rem] origin-right rotate-[50deg] bg-[linear-gradient(90deg,_rgba(125,211,252,0.08),_rgba(99,102,241,0.34),_rgba(125,211,252,0.08))]" />
              </div>
              <div className="mx-auto flex min-h-[calc(100vh-145px)] items-start justify-center pt-2 md:pt-6">{children}</div>
            </main>
          </>
        )}
      </body>
    </html>
  );
}
