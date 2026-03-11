"use client";

import { deleteCategoryAction } from "@/app/actions";

interface CategoryDeleteButtonProps {
  categoryId: string;
  categoryPath: string;
  disabledReason: string | null;
  returnTo: string;
}

export function CategoryDeleteButton({
  categoryId,
  categoryPath,
  disabledReason,
  returnTo,
}: CategoryDeleteButtonProps) {
  const disabled = Boolean(disabledReason);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const confirmed = window.confirm(
      `Delete category "${categoryPath}"? This cannot be undone.`,
    );
    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <form action={deleteCategoryAction} onSubmit={handleSubmit} className="inline-flex">
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="confirmDelete" value="yes" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        disabled={disabled}
        title={disabledReason ?? "Delete category"}
        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
          disabled
            ? "cursor-not-allowed border-slate-200 text-slate-400"
            : "border-red-200 text-red-700 hover:bg-red-50"
        }`}
      >
        Delete
      </button>
    </form>
  );
}
