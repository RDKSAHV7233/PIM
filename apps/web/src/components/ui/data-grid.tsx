import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataGridView = "desktop" | "mobile";

export interface Column<T> {
  key: string;
  header: string;
  // DataGrid renders every row twice — once into the desktop <table>, once into
  // the CSS-hidden-on-desktop mobile card list (see the two `rows.map` calls below).
  // `view` lets a render() that builds a `form`/`id` attribute keep the desktop and
  // mobile copies distinct. Two DOM elements sharing an id is invalid HTML, and when
  // cells reference a form via the `form="..."` attribute (as the variants table
  // does), a duplicate id makes the browser resolve every matching element to
  // whichever form is first in tree order — silently dropping the mobile form's own
  // fields from its submission (PIM#600).
  render?: (row: T, view: DataGridView) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  mobileHide?: boolean;
}

interface DataGridProps<T extends object> {
  columns: Column<T>[];
  rows: T[];
  caption?: string;
  emptyState?: ReactNode;
  getRowKey: (row: T) => string | number;
  rowClassName?: string | ((row: T) => string);
  className?: string;
}

function getCellValue<T extends object>(row: T, key: string): string {
  return String((row as Record<string, unknown>)[key] ?? "");
}

function resolveRowClassName<T extends object>(
  row: T,
  rowClassName: DataGridProps<T>["rowClassName"],
): string | undefined {
  if (typeof rowClassName === "function") {
    return rowClassName(row);
  }
  return rowClassName;
}

export function DataGrid<T extends object>({
  columns,
  rows,
  caption,
  emptyState,
  getRowKey,
  rowClassName,
  className,
}: DataGridProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <table className="w-full text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={cn("px-3 py-2.5", col.headerClassName)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className={cn("border-t border-slate-200 hover:bg-slate-50/50", resolveRowClassName(row, rowClassName))}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-3 py-2.5", col.cellClassName)}>
                    {col.render ? col.render(row, "desktop") : getCellValue(row, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div
            key={getRowKey(row)}
            className={cn("rounded-lg border border-slate-200 bg-white p-4", resolveRowClassName(row, rowClassName))}
          >
            <dl className="divide-y divide-slate-100">
              {columns
                .filter((col) => !col.mobileHide)
                .map((col) => (
                  <div key={col.key} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="shrink-0 text-xs font-medium text-slate-500">{col.header}</dt>
                    <dd className={cn("min-w-0 break-words text-right text-sm text-slate-900", col.cellClassName)}>
                      {col.render ? col.render(row, "mobile") : getCellValue(row, col.key)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataCardList<T extends object>({
  columns,
  rows,
  getRowKey,
  emptyState,
  rowClassName,
  className,
}: DataGridProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {rows.map((row) => (
        <div
          key={getRowKey(row)}
          className={cn("rounded-lg border border-slate-200 bg-white p-4", resolveRowClassName(row, rowClassName))}
        >
          <dl className="divide-y divide-slate-100">
            {columns
              .filter((col) => !col.mobileHide)
              .map((col) => (
                <div key={col.key} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                  <dt className="shrink-0 text-xs font-medium text-slate-500">{col.header}</dt>
                  <dd className={cn("min-w-0 break-words text-right text-sm text-slate-900", col.cellClassName)}>
                    {col.render ? col.render(row, "mobile") : getCellValue(row, col.key)}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
