"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { GlobalSearch } from "@/components/nav/global-search";
import { NotificationCenter } from "@/components/nav/notification-center";
import { AppDrawer } from "@/components/ui/app-drawer";
import { BrandLogo } from "@/components/ui/brand-logo";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { RoleBadge } from "@/components/ui/role-badge";
import { ToastProvider } from "@/components/ui/toast-provider";
import type { AppRole } from "@/lib/api";
import type { PimLocale } from "@/lib/locale";

interface AuthenticatedShellProps {
  children: ReactNode;
  actorRole: AppRole;
  adminBoundaryRoles?: string[];
  locale: PimLocale;
  showRoleBadge: boolean;
}

export function AuthenticatedShell({
  children,
  actorRole,
  adminBoundaryRoles = [],
  locale,
  showRoleBadge,
}: AuthenticatedShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <ToastProvider>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={mobileNavOpen}
            >
              Menu
            </button>
            <Link href="/dashboard" className="inline-flex items-center" aria-label="Vexa PIM home">
              <BrandLogo variant="compact" />
            </Link>
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <LocaleSwitcher locale={locale} />
            <NotificationCenter />
            {showRoleBadge ? <RoleBadge role={actorRole} /> : null}
            <LogoutButton />
          </div>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="lg:hidden">
          <AppDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Navigation" width="sm" side="left">
            <AppSidebar actorRole={actorRole} adminBoundaryRoles={adminBoundaryRoles} showInternal={false} />
          </AppDrawer>
        </div>
      ) : null}

      <div className="grid w-full grid-cols-1 gap-6 p-5 md:p-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <AppSidebar actorRole={actorRole} adminBoundaryRoles={adminBoundaryRoles} showInternal={false} />
        </div>
        <main id="main-content" className="min-w-0">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
