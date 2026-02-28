import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RoleBadge } from "@/components/ui/role-badge";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIM1 Console",
  description: "India-first PIM Phase 1 catalog console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8">
            <p className="text-sm font-semibold text-slate-900">PIM1</p>
            <RoleBadge />
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-5 md:p-8">{children}</main>
      </body>
    </html>
  );
}
