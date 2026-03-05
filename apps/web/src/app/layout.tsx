import type { Metadata } from "next";
import type { ReactNode } from "react";
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
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8">
            <p className="text-sm font-semibold text-slate-900">PIM1</p>
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
