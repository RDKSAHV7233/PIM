import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { RoleBadge } from "@/components/ui/role-badge";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIM1",
  description: "India-first product information manager",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessionClaims = await getServerSessionClaims();
  const actorRole = await getServerActorRole();
  const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/connectors", label: "Connectors" },
    { href: "/settings/plan", label: "Plan" },
    { href: "/settings/connectors", label: "Connector Access" },
  ];
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 md:px-8">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-sm font-semibold text-slate-900">
                PIM1
              </Link>
              {sessionClaims ? (
                <nav className="flex flex-wrap items-center gap-2">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {sessionClaims ? <RoleBadge role={actorRole} /> : null}
              {sessionClaims ? <LogoutButton /> : null}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-5 md:p-8">{children}</main>
      </body>
    </html>
  );
}
