"use client";

import { useRouter } from "next/navigation";

interface StoreOption {
  id: string;
  label: string;
}

interface StoreSwitcherProps {
  currentId: string;
  stores: StoreOption[];
  currentTab?: string;
}

export function StoreSwitcher({ currentId, stores, currentTab }: StoreSwitcherProps) {
  const router = useRouter();
  if (stores.length < 2) return null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const selected = event.target.value;
    if (!selected || selected === currentId) return;
    const href = currentTab
      ? `/channels/connectors/${encodeURIComponent(selected)}?tab=${encodeURIComponent(currentTab)}`
      : `/channels/connectors/${encodeURIComponent(selected)}`;
    router.push(href);
  }

  return (
    <select
      value={currentId}
      onChange={handleChange}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      aria-label="Switch store"
    >
      {stores.map((store) => (
        <option key={store.id} value={store.id}>
          {store.label}
        </option>
      ))}
    </select>
  );
}
