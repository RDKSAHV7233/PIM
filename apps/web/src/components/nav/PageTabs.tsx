import { cn } from "@/lib/utils";

export type HomeTab = "products" | "import" | "bulk-edit" | "categories" | "developer";

export interface PageTabItem {
  id: HomeTab;
  label: string;
  href: string;
}

interface PageTabsProps {
  activeTab: HomeTab;
  tabs: PageTabItem[];
}

export function PageTabs({ activeTab, tabs }: PageTabsProps) {
  return (
    <nav className="border-b border-slate-200">
      <div className="flex flex-wrap gap-1 py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <a
              key={tab.id}
              href={tab.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium",
                isActive
                  ? "bg-orange-50 text-orange-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
