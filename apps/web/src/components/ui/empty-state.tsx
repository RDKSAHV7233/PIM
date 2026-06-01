import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyAction {
  label: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

interface EmptyStateProps {
  icon: ReactNode | string;
  title: string;
  description: string;
  helperBullets?: string[];
  action?: EmptyAction;
  secondaryAction?: EmptyAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  helperBullets,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm", className)}>
      {typeof icon === "string" ? (
        <p className="text-3xl">{icon}</p>
      ) : (
        <div className="flex justify-center">{icon}</div>
      )}
      <h3 className="mt-2 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {helperBullets && helperBullets.length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-left text-sm text-slate-500">
          {helperBullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action?.href ? (
            <Link href={action.href}>
              <Button type="button">{action.label}</Button>
            </Link>
          ) : action ? (
            <Button type="button" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction?.href ? (
            <Link href={secondaryAction.href}>
              <Button type="button" variant="secondary">
                {secondaryAction.label}
              </Button>
            </Link>
          ) : secondaryAction ? (
            <Button type="button" variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
