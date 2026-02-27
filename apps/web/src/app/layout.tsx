import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIM1 Console",
  description: "India-first PIM Phase 1 catalog console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-7xl p-5 md:p-8">{children}</main>
      </body>
    </html>
  );
}
