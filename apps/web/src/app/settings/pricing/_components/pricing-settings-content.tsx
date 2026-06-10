"use client";

import { useRef, useState, useTransition } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusChip } from "@/components/ui/status-chip";
import {
  createMarket,
  createCurrency,
  createPriceList,
  deleteMarket,
  deleteCurrency,
  deletePriceList,
  updateMarket,
  updateCurrency,
  updatePriceList,
  importPriceListPricesCsv,
  downloadPriceListTemplate,
  type Market,
  type Currency,
  type PriceList,
  type PriceImportResult,
} from "@/lib/api/pricing";

// ── tab types ──────────────────────────────────────────────────────────────

type Tab = "markets" | "currencies" | "price-lists";

// ── helpers ────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

// ── sub-components ─────────────────────────────────────────────────────────

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-accent pb-2 text-sm font-medium text-ink"
          : "pb-2 text-sm text-slate-500 hover:text-slate-700"
      }
    >
      {children}
    </button>
  );
}

// ── Markets panel ──────────────────────────────────────────────────────────

interface MarketsPanelProps {
  initialMarkets: Market[];
  canEdit: boolean;
}

function MarketsPanel({ initialMarkets, canEdit }: MarketsPanelProps) {
  const [markets, setMarkets] = useState<Market[]>(initialMarkets);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Market | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // form state
  const [code, setCode] = useState("");
  const [locale, setLocale] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [status, setStatus] = useState<"active" | "inactive">("active");

  function openCreate() {
    setEditTarget(null);
    setCode("");
    setLocale("");
    setDisplayName("");
    setIsDefault(false);
    setStatus("active");
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(market: Market) {
    setEditTarget(market);
    setCode(market.code);
    setLocale(market.locale);
    setDisplayName(market.displayName);
    setIsDefault(market.isDefault);
    setStatus(market.status);
    setFormError(null);
    setDialogOpen(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      try {
        if (editTarget) {
          const updated = await updateMarket(editTarget.id, { locale, displayName, isDefault, status });
          setMarkets((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        } else {
          const created = await createMarket({ code: code.toUpperCase(), locale, displayName, isDefault, status });
          setMarkets((prev) =>
            isDefault
              ? [created, ...prev.map((m) => ({ ...m, isDefault: false }))]
              : [...prev, created],
          );
        }
        setDialogOpen(false);
      } catch (err) {
        setFormError(extractErrorMessage(err));
      }
    });
  }

  function handleDelete(market: Market) {
    if (!confirm(`Delete market "${market.displayName}" (${market.code})? This will fail if price lists reference it.`)) return;
    startTransition(async () => {
      try {
        await deleteMarket(market.id);
        setMarkets((prev) => prev.filter((m) => m.id !== market.id));
      } catch (err) {
        alert(extractErrorMessage(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Markets define the geographic regions you sell into. Each market has a locale and can be
          linked to one or more price lists.
        </p>
        {canEdit && (
          <Button size="sm" onClick={openCreate} disabled={isPending}>
            + Add Market
          </Button>
        )}
      </div>

      {markets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No markets configured yet. Add your first market to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Locale</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Default</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {markets.map((market) => (
                <tr key={market.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">{market.code}</td>
                  <td className="px-4 py-3 text-slate-800">{market.displayName}</td>
                  <td className="px-4 py-3 text-slate-500">{market.locale}</td>
                  <td className="px-4 py-3">
                    <StatusChip
                      label={market.status}
                      tone={market.status === "active" ? "success" : "neutral"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {market.isDefault && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Default
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(market)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(market)} disabled={isPending}>
                          <span className="text-red-600">Delete</span>
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AppDialog
        open={dialogOpen}
        title={editTarget ? `Edit Market — ${editTarget.code}` : "Add Market"}
        description={
          editTarget
            ? "Update the market locale, display name, or status."
            : "Create a new market for your tenant. The code must be an ISO 3166-1 alpha-2 country code (e.g. IN, US, GB)."
        }
        onClose={() => setDialogOpen(false)}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <InlineAlert tone="error" message={formError} />}

          {!editTarget && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Market Code *</span>
              <input
                required
                pattern="[A-Za-z]{2}"
                title="2-letter ISO 3166-1 alpha-2 code (e.g. IN)"
                maxLength={2}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="IN"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Display Name *</span>
            <input
              required
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="India"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Locale *</span>
            <input
              required
              maxLength={20}
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="en-IN"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="text-xs text-slate-500">BCP-47 locale string, e.g. en-IN, en-US, de-DE</p>
          </label>

          <div className="flex items-center gap-3">
            <label className="block space-y-1 flex-1">
              <span className="text-sm font-medium text-slate-700">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="flex items-center gap-2 mt-5 cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Set as default market</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isPending}>
              {editTarget ? "Save Changes" : "Create Market"}
            </Button>
          </div>
        </form>
      </AppDialog>
    </div>
  );
}

// ── Currencies panel ───────────────────────────────────────────────────────

interface CurrenciesPanelProps {
  initialCurrencies: Currency[];
  canEdit: boolean;
}

function CurrenciesPanel({ initialCurrencies, canEdit }: CurrenciesPanelProps) {
  const [currencies, setCurrencies] = useState<Currency[]>(initialCurrencies);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Currency | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [code, setCode] = useState("");
  const [symbol, setSymbol] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [decimalPlaces, setDecimalPlaces] = useState(2);

  function openCreate() {
    setEditTarget(null);
    setCode("");
    setSymbol("");
    setDisplayName("");
    setDecimalPlaces(2);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(currency: Currency) {
    setEditTarget(currency);
    setCode(currency.code);
    setSymbol(currency.symbol);
    setDisplayName(currency.displayName);
    setDecimalPlaces(currency.decimalPlaces);
    setFormError(null);
    setDialogOpen(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      try {
        if (editTarget) {
          const updated = await updateCurrency(editTarget.id, { symbol, displayName, decimalPlaces });
          setCurrencies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        } else {
          const created = await createCurrency({
            code: code.toUpperCase(),
            symbol,
            displayName,
            decimalPlaces,
          });
          setCurrencies((prev) => [...prev, created]);
        }
        setDialogOpen(false);
      } catch (err) {
        setFormError(extractErrorMessage(err));
      }
    });
  }

  function handleDelete(currency: Currency) {
    if (!confirm(`Delete currency "${currency.displayName}" (${currency.code})? This will fail if price lists reference it.`)) return;
    startTransition(async () => {
      try {
        await deleteCurrency(currency.id);
        setCurrencies((prev) => prev.filter((c) => c.id !== currency.id));
      } catch (err) {
        alert(extractErrorMessage(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Currencies define the monetary units used in your price lists. Use ISO 4217 codes.
        </p>
        {canEdit && (
          <Button size="sm" onClick={openCreate} disabled={isPending}>
            + Add Currency
          </Button>
        )}
      </div>

      {currencies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No currencies configured yet. Add a currency before creating price lists.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Decimal Places</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currencies.map((currency) => (
                <tr key={currency.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">{currency.code}</td>
                  <td className="px-4 py-3 text-slate-700">{currency.symbol}</td>
                  <td className="px-4 py-3 text-slate-800">{currency.displayName}</td>
                  <td className="px-4 py-3 text-slate-500">{currency.decimalPlaces}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(currency)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(currency)} disabled={isPending}>
                          <span className="text-red-600">Delete</span>
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AppDialog
        open={dialogOpen}
        title={editTarget ? `Edit Currency — ${editTarget.code}` : "Add Currency"}
        description={
          editTarget
            ? "Update the symbol, display name, or decimal places."
            : "Add a currency using its 3-letter ISO 4217 code (e.g. INR, USD, GBP)."
        }
        onClose={() => setDialogOpen(false)}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <InlineAlert tone="error" message={formError} />}

          {!editTarget && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Currency Code *</span>
              <input
                required
                pattern="[A-Za-z]{3}"
                title="3-letter ISO 4217 code (e.g. INR)"
                maxLength={3}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="INR"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Symbol *</span>
            <input
              required
              maxLength={8}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="₹"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Display Name *</span>
            <input
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Indian Rupee"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Decimal Places</span>
            <input
              type="number"
              min={0}
              max={6}
              value={decimalPlaces}
              onChange={(e) => setDecimalPlaces(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="text-xs text-slate-500">0 = whole units (JPY); 2 = standard (INR, USD); max 6</p>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isPending}>
              {editTarget ? "Save Changes" : "Create Currency"}
            </Button>
          </div>
        </form>
      </AppDialog>
    </div>
  );
}

// ── Price Lists panel ──────────────────────────────────────────────────────

interface PriceListsPanelProps {
  initialPriceLists: PriceList[];
  markets: Market[];
  currencies: Currency[];
  canEdit: boolean;
}

function PriceListsPanel({ initialPriceLists, markets, currencies, canEdit }: PriceListsPanelProps) {
  const [priceLists, setPriceLists] = useState<PriceList[]>(initialPriceLists);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PriceList | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // CSV import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importTargetId, setImportTargetId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<Map<string, PriceImportResult>>(new Map());
  const [importErrors, setImportErrors] = useState<Map<string, string>>(new Map());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [marketId, setMarketId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [status, setStatus] = useState<"active" | "inactive">("active");

  function openCreate() {
    setEditTarget(null);
    setName("");
    setMarketId(markets[0]?.id ?? "");
    setCurrencyId(currencies[0]?.id ?? "");
    setIsDefault(false);
    setStatus("active");
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(pl: PriceList) {
    setEditTarget(pl);
    setName(pl.name);
    setMarketId(pl.marketId);
    setCurrencyId(pl.currencyId);
    setIsDefault(pl.isDefault);
    setStatus(pl.status);
    setFormError(null);
    setDialogOpen(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      try {
        if (editTarget) {
          const updated = await updatePriceList(editTarget.id, { name, isDefault, status });
          setPriceLists((prev) =>
            prev.map((pl) =>
              pl.id === updated.id
                ? updated
                : isDefault
                ? { ...pl, isDefault: false }
                : pl,
            ),
          );
        } else {
          const created = await createPriceList({ name, marketId, currencyId, isDefault, status });
          setPriceLists((prev) =>
            isDefault
              ? [created, ...prev.map((pl) => ({ ...pl, isDefault: false }))]
              : [...prev, created],
          );
        }
        setDialogOpen(false);
      } catch (err) {
        setFormError(extractErrorMessage(err));
      }
    });
  }

  function handleDelete(pl: PriceList) {
    if (!confirm(`Delete price list "${pl.name}"? All associated product prices will be removed.`)) return;
    startTransition(async () => {
      try {
        await deletePriceList(pl.id);
        setPriceLists((prev) => prev.filter((p) => p.id !== pl.id));
      } catch (err) {
        alert(extractErrorMessage(err));
      }
    });
  }

  function handleDownloadTemplate(priceListId: string) {
    setDownloadingId(priceListId);
    void downloadPriceListTemplate(priceListId)
      .catch((err) => alert(extractErrorMessage(err)))
      .finally(() => setDownloadingId(null));
  }

  function triggerImport(priceListId: string) {
    setImportTargetId(priceListId);
    // Clear stale results for this list before re-importing
    setImportResults((prev) => {
      const next = new Map(prev);
      next.delete(priceListId);
      return next;
    });
    setImportErrors((prev) => {
      const next = new Map(prev);
      next.delete(priceListId);
      return next;
    });
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected if needed
    e.target.value = "";
    if (!file || !importTargetId) return;
    const priceListId = importTargetId;
    setImportingId(priceListId);
    void (async () => {
      try {
        const result = await importPriceListPricesCsv(priceListId, file);
        setImportResults((prev) => new Map(prev).set(priceListId, result));
      } catch (err) {
        setImportErrors((prev) =>
          new Map(prev).set(priceListId, extractErrorMessage(err)),
        );
      } finally {
        setImportingId(null);
        setImportTargetId(null);
      }
    })();
  }

  const noMarketsOrCurrencies = markets.length === 0 || currencies.length === 0;

  return (
    <div className="space-y-4">
      {/* Hidden file input — shared across all price list rows */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Price lists link a market + currency pair and hold the actual product prices. At least one
          market and currency must exist before creating a price list.
        </p>
        {canEdit && (
          <Button size="sm" onClick={openCreate} disabled={isPending || noMarketsOrCurrencies}>
            + Add Price List
          </Button>
        )}
      </div>

      {noMarketsOrCurrencies && (
        <InlineAlert
          tone="warning"
          title="Prerequisites missing"
          message="Configure at least one market and one currency before creating price lists."
        />
      )}

      {priceLists.length === 0 && !noMarketsOrCurrencies ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No price lists configured. Create one to start managing product prices across markets.
        </div>
      ) : priceLists.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Market</th>
                <th className="px-4 py-3 text-left">Currency</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Default</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {priceLists.map((pl) => (
                <tr key={pl.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{pl.name}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-500">{pl.market.code}</span>{" "}
                    <span className="text-slate-700">{pl.market.displayName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-500">{pl.currency.code}</span>{" "}
                    <span className="text-slate-500">{pl.currency.symbol}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip
                      label={pl.status}
                      tone={pl.status === "active" ? "success" : "neutral"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {pl.isDefault && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Default
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownloadTemplate(pl.id)}
                          disabled={downloadingId === pl.id}
                          title="Download a CSV template pre-filled with current prices"
                        >
                          {downloadingId === pl.id ? "Downloading…" : "Template"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => triggerImport(pl.id)}
                          disabled={importingId === pl.id}
                          title="Upload a CSV to set prices in bulk"
                        >
                          {importingId === pl.id ? "Importing…" : "Import CSV"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(pl)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(pl)} disabled={isPending}>
                          <span className="text-red-600">Delete</span>
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Per-price-list import result banners */}
      {priceLists.map((pl) => {
        const result = importResults.get(pl.id);
        const importErr = importErrors.get(pl.id);
        if (!result && !importErr) return null;
        return (
          <div key={`import-result-${pl.id}`} className="space-y-1">
            {importErr && (
              <InlineAlert
                tone="error"
                title={`Import failed — ${pl.name}`}
                message={importErr}
              />
            )}
            {result && (
              <InlineAlert
                tone={result.errors.length > 0 ? "warning" : "success"}
                title={`Import complete — ${pl.name}`}
                message={
                  `${result.imported} row${result.imported !== 1 ? "s" : ""} imported` +
                  (result.skipped > 0 ? `, ${result.skipped} skipped` : "") +
                  (result.errors.length > 0
                    ? `. ${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}: ` +
                      result.errors
                        .slice(0, 3)
                        .map((e) => `row ${e.row}${e.skuCode ? ` (${e.skuCode})` : ""}: ${e.message}`)
                        .join("; ") +
                      (result.errors.length > 3 ? ` …and ${result.errors.length - 3} more` : "")
                    : "")
                }
              />
            )}
          </div>
        );
      })}

      {/* CSV format hint */}
      {canEdit && priceLists.length > 0 && (
        <p className="text-xs text-slate-400">
          CSV import format: <span className="font-mono">sku_code,mrp,selling_price</span> — header row required; 15,000 rows / 10 MB max.
        </p>
      )}

      <AppDialog
        open={dialogOpen}
        title={editTarget ? `Edit Price List — ${editTarget.name}` : "Add Price List"}
        description={
          editTarget
            ? "Rename, change default status, or toggle activity."
            : "Create a price list by linking a market and a currency. The market+currency combination must be unique per tenant."
        }
        onClose={() => setDialogOpen(false)}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <InlineAlert tone="error" message={formError} />}

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Name *</span>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="India Default Price List"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>

          {!editTarget && (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Market *</span>
                <select
                  required
                  value={marketId}
                  onChange={(e) => setMarketId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Currency *</span>
                <select
                  required
                  value={currencyId}
                  onChange={(e) => setCurrencyId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.displayName} ({c.symbol})
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="flex items-center gap-3">
            <label className="block space-y-1 flex-1">
              <span className="text-sm font-medium text-slate-700">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="flex items-center gap-2 mt-5 cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Set as default</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isPending}>
              {editTarget ? "Save Changes" : "Create Price List"}
            </Button>
          </div>
        </form>
      </AppDialog>
    </div>
  );
}

// ── Root content component ─────────────────────────────────────────────────

export interface PricingSettingsContentProps {
  initialMarkets: Market[];
  initialCurrencies: Currency[];
  initialPriceLists: PriceList[];
  canEdit: boolean;
}

export function PricingSettingsContent({
  initialMarkets,
  initialCurrencies,
  initialPriceLists,
  canEdit,
}: PricingSettingsContentProps) {
  const [activeTab, setActiveTab] = useState<Tab>("markets");
  // Keep markets/currencies in sync so PriceListsPanel can access the latest state.
  // We lift state up from child panels via the initialXxx props; full sync on tab
  // switch is handled by the server page re-fetch (force-dynamic). For now, the
  // initial data is accurate at page-load and mutations update local state.
  const [markets] = useState<Market[]>(initialMarkets);
  const [currencies] = useState<Currency[]>(initialCurrencies);

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <div className="flex gap-6 border-b border-slate-200">
        <TabButton active={activeTab === "markets"} onClick={() => setActiveTab("markets")}>
          Markets{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            {initialMarkets.length}
          </span>
        </TabButton>
        <TabButton active={activeTab === "currencies"} onClick={() => setActiveTab("currencies")}>
          Currencies{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            {initialCurrencies.length}
          </span>
        </TabButton>
        <TabButton active={activeTab === "price-lists"} onClick={() => setActiveTab("price-lists")}>
          Price Lists{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            {initialPriceLists.length}
          </span>
        </TabButton>
      </div>

      {/* Tab panels */}
      {activeTab === "markets" && (
        <Card>
          <CardTitle>Markets</CardTitle>
          <MarketsPanel initialMarkets={initialMarkets} canEdit={canEdit} />
        </Card>
      )}
      {activeTab === "currencies" && (
        <Card>
          <CardTitle>Currencies</CardTitle>
          <CurrenciesPanel initialCurrencies={initialCurrencies} canEdit={canEdit} />
        </Card>
      )}
      {activeTab === "price-lists" && (
        <Card>
          <CardTitle>Price Lists</CardTitle>
          <PriceListsPanel
            initialPriceLists={initialPriceLists}
            markets={markets}
            currencies={currencies}
            canEdit={canEdit}
          />
        </Card>
      )}
    </div>
  );
}
