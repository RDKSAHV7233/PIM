import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ConnectorInstallation, MarketplaceChannel } from "@/lib/api";
import type { ConnectorTaxonomyOption } from "@/lib/channel-mappings";

export function MappingsFilterCard({
  categories,
  channels,
  selectedCategoryId,
  selectedChannel,
  installations,
  selectedInstallationId,
  taxonomyQ,
  selectedProductId,
  preserveFlags,
}: {
  categories: Array<{ id: string; path: string }>;
  channels: Array<{ channel: MarketplaceChannel; displayName: string }>;
  selectedCategoryId: string;
  selectedChannel: MarketplaceChannel;
  installations: ConnectorInstallation[];
  selectedInstallationId?: string;
  taxonomyQ: string;
  selectedProductId?: string;
  preserveFlags?: Partial<Record<"showContext" | "showTaxonomy" | "showResolved" | "showHistory", boolean>>;
}) {
  const hasMultipleAccounts = installations.length > 1;
  const accountRequired = hasMultipleAccounts && !selectedInstallationId;

  return (
    <FilterBar>
      <form
        method="get"
        className={`grid gap-3 ${hasMultipleAccounts ? "md:grid-cols-[220px_220px_minmax(0,1fr)_minmax(0,1fr)_auto]" : "md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)_auto]"}`}
      >
        {selectedProductId ? <input type="hidden" name="productId" value={selectedProductId} /> : null}
        {Object.entries(preserveFlags ?? {}).map(([key, enabled]) =>
          enabled ? <input key={key} type="hidden" name={key} value="1" /> : null,
        )}
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-channel">
            Channel
          </label>
          <Select id="mapping-channel" name="channel" defaultValue={selectedChannel}>
            {channels.map((channel) => (
              <option key={channel.channel} value={channel.channel}>
                {channel.displayName}
              </option>
            ))}
          </Select>
        </div>
        {hasMultipleAccounts ? (
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-installation">
              Connector account
              {accountRequired ? <span className="ml-1 text-red-500" aria-hidden="true">*</span> : null}
            </label>
            <Select
              id="mapping-installation"
              name="installationId"
              defaultValue={selectedInstallationId || ""}
              required={accountRequired}
            >
              <option value="">Choose connector account</option>
              {installations.map((installation) => {
                const connectorLabel = installation.externalAccountRef
                  ? `${installation.accountAlias} - ${installation.externalAccountRef}`
                  : installation.accountAlias;
                return (
                  <option key={installation.id} value={installation.id}>
                    {connectorLabel}
                  </option>
                );
              })}
            </Select>
            <p className="text-xs text-slate-500">
              Readiness and publish gates are evaluated per account.
            </p>
          </div>
        ) : null}
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category">
            Category
          </label>
          <Select id="mapping-category" name="categoryId" defaultValue={selectedCategoryId}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-taxonomy-q">
            Taxonomy search
          </label>
          <Input
            id="mapping-taxonomy-q"
            name="taxonomyQ"
            defaultValue={taxonomyQ}
            placeholder="Search category path..."
            aria-describedby="mapping-taxonomy-q-help"
          />
          <p id="mapping-taxonomy-q-help" className="text-xs text-slate-500">
            Search the target channel taxonomy when you need a better publish category match before saving the draft.
          </p>
        </div>
        <div className="flex items-end">
          <Button type="submit">Apply</Button>
        </div>
      </form>
    </FilterBar>
  );
}

export function TaxonomyAlignmentCard({
  connectorSlug,
  taxonomyMatches,
  unmappedCategories,
}: {
  connectorSlug: string;
  taxonomyMatches: ConnectorTaxonomyOption[];
  unmappedCategories: ConnectorTaxonomyOption[];
}) {
  return (
    <Card>
      <CardTitle>Taxonomy Alignment</CardTitle>
      <div className="mt-2 space-y-2 text-sm text-slate-700">
        <p>Search result categories: {taxonomyMatches.length}</p>
        <p>Unmapped categories for {connectorSlug}: {unmappedCategories.length}</p>
      </div>
      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Show taxonomy search results</summary>
        <div role="region" aria-label="Taxonomy search results" className="mt-2">
        <ul className="space-y-2 text-sm text-slate-700">
          {taxonomyMatches.map((item) => (
            <li key={item.id} className="rounded border border-slate-200 p-2">
              <p className="font-medium">{item.path}</p>
              <p className="text-xs text-slate-500">Required attrs: {item.requiredAttributes.join(", ") || "-"}</p>
            </li>
          ))}
        </ul>
        </div>
      </details>
      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Show unmapped categories</summary>
        <div role="region" aria-label="Unmapped categories" className="mt-2">
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-slate-700">
          {unmappedCategories.map((item) => (
            <li key={item.id} className="rounded border border-slate-200 p-2">
              <p className="font-medium">{item.path}</p>
              <p className="text-xs text-slate-500">Required attrs: {item.requiredAttributes.join(", ") || "-"}</p>
            </li>
          ))}
        </ul>
        </div>
      </details>
    </Card>
  );
}
