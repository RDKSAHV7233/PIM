import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ConnectorInstallation, MarketplaceChannel } from "@/lib/api";
import { buildMappingRoute, type ConnectorTaxonomyOption, type MappingWizardState } from "@/lib/channel-mappings";

type ScopeBaseState = Partial<MappingWizardState>;

function selectedInstallLabel(installation: ConnectorInstallation): string {
  return installation.externalAccountRef
    ? `${installation.accountAlias} - ${installation.externalAccountRef}`
    : installation.accountAlias;
}

export function MappingsFilterCard({
  categories,
  channels,
  selectedCategoryId,
  selectedChannel,
  installations,
  selectedInstallationId,
  taxonomyQ,
  selectedProductId,
  selectedProductLabel,
  selectedPublishCategoryId,
  selectedPublishCategoryLabel,
  selectedCategoryPath,
  baseState,
  invalidChannel,
  invalidCategory,
  invalidInstallation,
  productWarning,
  continueHref,
  preserveFlags,
}: {
  categories: Array<{ id: string; path: string }>;
  channels: Array<{ channel: MarketplaceChannel; displayName: string }>;
  selectedCategoryId: string;
  selectedChannel: string;
  installations: ConnectorInstallation[];
  selectedInstallationId?: string;
  taxonomyQ: string;
  selectedProductId?: string;
  selectedProductLabel?: string | null;
  selectedPublishCategoryId?: string;
  selectedPublishCategoryLabel?: string;
  selectedCategoryPath?: string;
  baseState: ScopeBaseState;
  invalidChannel?: string;
  invalidCategory?: string;
  invalidInstallation?: string;
  productWarning?: string;
  continueHref?: string;
  preserveFlags?: Record<string, boolean>;
}) {
  const hasMultipleAccounts = installations.length > 1;
  const accountRequired = hasMultipleAccounts && !selectedInstallationId;

  return (
    <Card id="mapping-scope">
      <CardTitle>Step 1: Choose Channel & Category</CardTitle>
      <p className="mt-2 text-sm text-slate-600">
        Start by choosing the publish lane, the source category, and the target publish category. The mapping draft only opens after scope is explicit.
      </p>
      <FilterBar className="mt-4">
        <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px_minmax(0,1fr)_auto]">
          <input type="hidden" name="step" value="scope" />
          {selectedProductId ? <input type="hidden" name="productId" value={selectedProductId} /> : null}
          {selectedPublishCategoryId ? <input type="hidden" name="publishCategoryId" value={selectedPublishCategoryId} /> : null}
          {Object.entries(preserveFlags ?? {}).map(([key, enabled]) =>
            enabled ? <input key={key} type="hidden" name={key} value="1" /> : null,
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-channel">
              Channel
            </label>
            <Select id="mapping-channel" name="channel" defaultValue={selectedChannel}>
              <option value="">Choose a channel</option>
              {channels.map((channel) => (
                <option key={channel.channel} value={channel.channel}>
                  {channel.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-category">
              Source category
            </label>
            <Select id="mapping-category" name="categoryId" defaultValue={selectedCategoryId}>
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
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
                <option value="">
                  {installations.length > 0 ? "Choose connector account" : "No installed connector account"}
                </option>
                {installations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {selectedInstallLabel(installation)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                Readiness and publish gates are evaluated per account.
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-taxonomy-q">
              Publish category filter
            </label>
            <Input
              id="mapping-taxonomy-q"
              name="taxonomyQ"
              defaultValue={taxonomyQ}
              placeholder="Filter target category path..."
              aria-describedby="mapping-taxonomy-q-help"
            />
            <p id="mapping-taxonomy-q-help" className="text-xs text-slate-500">
              Apply the category path filter, then use a result below to lock the publish category for this mapping.
            </p>
          </div>
          <div className="flex items-end">
            <Button type="submit">Apply scope</Button>
          </div>
        </form>
      </FilterBar>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2 text-sm text-slate-700">
          {invalidChannel ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{invalidChannel}</div>
          ) : null}
          {invalidCategory ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{invalidCategory}</div>
          ) : null}
          {invalidInstallation ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{invalidInstallation}</div>
          ) : null}
          {productWarning ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{productWarning}</div>
          ) : null}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current scope</p>
            <dl className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</dt>
                <dd className="mt-1">{selectedChannel || "Not selected"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source category</dt>
                <dd className="mt-1">{selectedCategoryPath || "Not selected"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connector account</dt>
                <dd className="mt-1">
                  {selectedInstallationId
                    ? selectedInstallLabel(installations.find((installation) => installation.id === selectedInstallationId) ?? installations[0]!)
                    : installations.length === 0
                      ? "No installed connector account"
                      : "Not selected"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publish category</dt>
                <dd className="mt-1">{selectedPublishCategoryLabel || selectedPublishCategoryId || "Not selected"}</dd>
              </div>
              {selectedProductId ? (
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product context</dt>
                  <dd className="mt-1">
                    {selectedProductLabel || selectedProductId}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
        <div className="flex items-start">
          {continueHref ? (
            <Link
              href={continueHref}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continue to required fields
            </Link>
          ) : (
            <Button type="button" disabled>
              Choose channel, category, and publish category first
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function TaxonomyAlignmentCard({
  connectorSlug,
  taxonomyMatches,
  unmappedCategories,
  selectedPublishCategoryId,
  baseState,
}: {
  connectorSlug: string;
  taxonomyMatches: ConnectorTaxonomyOption[];
  unmappedCategories: ConnectorTaxonomyOption[];
  selectedPublishCategoryId?: string;
  baseState: ScopeBaseState;
}) {
  const categories = taxonomyMatches.length > 0 ? taxonomyMatches : unmappedCategories;

  return (
    <Card>
      <CardTitle>Publish Category Options</CardTitle>
      <p className="mt-2 text-sm text-slate-600">
        Pick the target category for {connectorSlug}. The required channel attributes below will shape the draft you create next.
      </p>
      <div className="mt-4 space-y-3">
        {categories.length > 0 ? (
          categories.map((item) => {
            const href = buildMappingRoute({
              ...baseState,
              step: "scope",
              publishCategoryId: item.id,
            });
            const isSelected = selectedPublishCategoryId === item.id;
            return (
              <div key={item.id} className={`rounded-lg border p-3 ${isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.path}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Required attributes: {item.requiredAttributes.join(", ") || "None"}
                    </p>
                  </div>
                  <Link
                    href={href}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${isSelected ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                  >
                    {isSelected ? "Selected publish category" : "Use this category"}
                  </Link>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            Search the target taxonomy to choose the publish category for this mapping.
          </div>
        )}
      </div>
    </Card>
  );
}
