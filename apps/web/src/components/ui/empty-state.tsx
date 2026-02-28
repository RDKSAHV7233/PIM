import Link from "next/link";
import type { MouseEventHandler } from "react";
import { Button } from "@/components/ui/button";

interface EmptyAction {
  label: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: EmptyAction;
  secondaryAction?: EmptyAction;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
      <p className="text-3xl">{icon}</p>
      <h3 className="mt-2 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
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
