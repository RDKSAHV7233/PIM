import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { GlobalSearch } from "@/components/nav/global-search";
import { NotificationCenter } from "@/components/nav/notification-center";
import { BrandLogo } from "@/components/ui/brand-logo";
import { RoleBadge } from "@/components/ui/role-badge";
import { hasServerAuthToken } from "@/lib/server-auth";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "TEJ PIM",
  description: "India-first product information manager",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessionClaims = await getServerSessionClaims();
  const hasAuthToken = await hasServerAuthToken();
  const actorRole = await getServerActorRole();
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex w-full items-center justify-between gap-4 px-5 py-3 md:px-8">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="inline-flex items-center" aria-label="TEJ PIM home">
                <BrandLogo variant="compact" />
              </Link>
              {hasAuthToken ? <GlobalSearch /> : null}
            </div>
            <div className="flex items-center gap-3">
              {hasAuthToken ? <NotificationCenter /> : null}
              {sessionClaims ? <RoleBadge role={actorRole} /> : null}
              {hasAuthToken ? <LogoutButton /> : null}
            </div>
          </div>
        </header>
        {hasAuthToken ? (
          <div className="grid w-full grid-cols-1 gap-6 p-5 md:p-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <AppSidebar showInternal={false} />
            <main className="min-w-0">{children}</main>
          </div>
        ) : (
          <main className="mx-auto max-w-7xl p-5 md:p-8">{children}</main>
        )}
      </body>
    </html>
  );
}
