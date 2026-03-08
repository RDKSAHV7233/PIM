import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createExportJobAction,
  createMappingTemplateAction,
  updateProductAction,
  createVariantAction,
  processExportJobAction,
  requeueExportJobAction,
  validateProductAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProductReadinessSummaryBar } from "@/components/channel/product-readiness-summary-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { Select } from "@/components/ui/select";
import { SideRailCard } from "@/components/ui/side-rail-card";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { ValidationIssuePanel } from "@/components/ui/validation-issue-panel";
import { ViewerEditTooltip } from "@/components/ui/viewer-edit-tooltip";
import {
  ApiHttpError,
  AppRole,
  evaluateConnectorPublishReadiness,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getMarketplaceExportJobs,
  getInstalledConnectors,
  getMarketplaceSimulation,
  getMarketplaceTemplates,
  getCategoryAttributes,
  getProduct,
  getProductVariants,
  MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { translateError, translateExportStatus } from "@/lib/errors";
import { formatINR } from "@/lib/format";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

type DetailTab =
  | "overview"
  | "content"
  | "attributes"
  | "variants"
  | "media"
  | "channels"
  | "quality"
  | "activity";

const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "attributes", label: "Attributes" },
  { key: "variants", label: "Variants" },
  { key: "media", label: "Media" },
  { key: "channels", label: "Channels" },
  { key: "quality", label: "Quality" },
  { key: "activity", label: "Activity" },
];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    channel?: string;
    templateId?: string;
    tab?: string;
    updateStatus?: string;
    currentVersion?: string;
    planLimit?: string;
    planResource?: string;
    planLimitValue?: string;
    planCurrent?: string;
    planUpgrade?: string;
  }>;
}

export const dynamic = "force-dynamic";

function normalizeDetailTab(value: string | undefined): DetailTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = DETAIL_TABS.find((tab) => tab.key === normalized);
  return matched?.key ?? "overview";
}

function normalizeChannel(value: string | undefined): MarketplaceChannel {
  if (value === "flipkart" || value === "meesho") {
    return value;
  }
  return "amazon";
}

function normalizeTemplateId(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function lifecycleStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "ready" || normalized === "accepted") {
    return "success";
  }
  if (normalized === "failed" || normalized === "dead_letter" || normalized === "rejected") {
    return "danger";
  }
  if (normalized === "retrying" || normalized === "queued" || normalized === "in_review") {
    return "warning";
  }
  if (normalized === "draft") {
    return "info";
  }
  return "neutral";
}

function mapMarketplaceChannelToConnectorSlug(channel: MarketplaceChannel): string {
  if (channel === "amazon") {
    return "amazon-in";
  }
  return channel;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getAllowedValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0);
  }
  if (value && typeof value === "object" && "values" in value && Array.isArray((value as { values: unknown[] }).values)) {
    return (value as { values: unknown[] }).values
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function formatDateTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return timestamp.toLocaleString();
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";
  const activeTab = normalizeDetailTab(query.tab);
  const selectedChannel = normalizeChannel(query.channel);
  const selectedTemplateId = normalizeTemplateId(query.templateId);
  const updateStatus = String(query.updateStatus ?? "").trim();
  const conflictVersion = String(query.currentVersion ?? "").trim();
  const showPlanLimitModal =
    String(query.planLimit ?? "").trim() === "1" &&
    String(query.planResource ?? "").trim().length > 0 &&
    Number.isFinite(Number(query.planLimitValue)) &&
    Number.isFinite(Number(query.planCurrent)) &&
    String(query.planUpgrade ?? "").trim().length > 0;
  const planLimitResource = String(query.planResource ?? "").trim();
  const planLimitValue = Number(query.planLimitValue);
  const planCurrent = Number(query.planCurrent);
  const planUpgrade = String(query.planUpgrade ?? "").trim();
  const dismissPlanLimitHref = (() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, raw]) => {
      if (
        key === "planLimit" ||
        key === "planResource" ||
        key === "planLimitValue" ||
        key === "planCurrent" ||
        key === "planUpgrade"
      ) {
        return;
      }
      const value = String(raw ?? "").trim();
      if (value.length > 0) {
        params.set(key, value);
      }
    });
    const encoded = params.toString();
    return encoded
      ? `/products/${encodeURIComponent(id)}?${encoded}`
      : `/products/${encodeURIComponent(id)}`;
  })();
  let product;
  try {
    product = await getProduct(id, { role: actorRole, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/products/${encodeURIComponent(id)}`, error.status));
    }
    notFound();
  }
  const [variants, channels, installedConnectors, templates, mapping, simulation, exportJobs, categoryAttributes, readiness] =
    await Promise.all([
    getProductVariants(id, { role: actorRole, authHeader }),
    getMarketplaceChannels({ role: actorRole, authHeader }),
    getInstalledConnectors({ role: actorRole, authHeader }),
    getMarketplaceTemplates(product.categoryId, selectedChannel, { role: actorRole, authHeader }),
    getMarketplaceChannelMapping(selectedChannel, product.categoryId, selectedTemplateId, {
      role: actorRole,
      authHeader,
    }),
    getMarketplaceSimulation(id, selectedChannel, selectedTemplateId, { role: actorRole, authHeader }),
    getMarketplaceExportJobs(id, { role: actorRole, authHeader }),
    getCategoryAttributes(product.categoryId, { role: actorRole, authHeader }),
    evaluateConnectorPublishReadiness(
      mapMarketplaceChannelToConnectorSlug(selectedChannel),
      {
        categoryScope: product.categoryId,
        productId: id,
        fallbackAcknowledged: false,
      },
      { role: actorRole, authHeader },
    ),
  ]);
  const publishCapableConnectorSlugs = new Set(
    installedConnectors
      .filter(
        (connector) =>
          connector.status === "ACTIVE" && connector.capabilities.some((capability) => capability === "PUBLISH"),
      )
      .map((connector) => connector.slug),
  );
  const publishableChannels = channels.filter((channel) =>
    publishCapableConnectorSlugs.has(mapMarketplaceChannelToConnectorSlug(channel.channel)),
  );
  const defaultExportChannel =
    publishableChannels.find((channel) => channel.channel === selectedChannel)?.channel ??
    publishableChannels[0]?.channel ??
    selectedChannel;
  const mappingManagerInstallation =
    installedConnectors.find(
      (connector) =>
        connector.status === "ACTIVE" &&
        connector.slug === mapMarketplaceChannelToConnectorSlug(selectedChannel),
    ) ?? null;
  const productAttributes = asRecord(product.attributes);
  const productAttributeDefinitions = categoryAttributes.filter((definition) => definition.appliesTo !== "variant");
  const requiredFieldsDefault = JSON.stringify(mapping.requiredFields, null, 2);
  const fieldMapDefault = JSON.stringify(mapping.fieldMap, null, 2);
  const blockingIssueCount =
    product.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0;
  const warningIssueCount =
    product.validationIssues?.filter((issue) => issue.severity === "warning").length ?? 0;
  const recentJobs = exportJobs.slice(0, 5);
  const readinessBlockers = readiness.blockers ?? [];
  const readinessWarnings = readiness.warnings ?? [];
  const fallbackAckRequired = readinessBlockers.includes("fallback_ack_required");
  const blockersExcludingFallbackAck = readinessBlockers.filter(
    (item) => item !== "fallback_acknowledgement_required",
  );
  const canQueueExportWithAck = blockersExcludingFallbackAck.length === 0;
  const tabHref = (tab: DetailTab): string => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (selectedChannel) {
      params.set("channel", selectedChannel);
    }
    if (selectedTemplateId) {
      params.set("templateId", selectedTemplateId);
    }
    return `/products/${encodeURIComponent(id)}?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PlanLimitModal
        isOpen={showPlanLimitModal}
        resource={planLimitResource}
        limit={planLimitValue}
        current={planCurrent}
        upgradeUrl={planUpgrade}
        dismissHref={dismissPlanLimitHref}
      />
      <PageHeader
        className="sticky top-[4.5rem] z-20"
        title={product.title}
        description={`SKU ${product.id.slice(0, 8)} | ${product.category?.path ?? product.categoryId}`}
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>{" "}
            /{" "}
            <Link href="/catalog/products" className="hover:underline">
              Catalog
            </Link>{" "}
            / <span className="font-semibold text-slate-700">Product Detail</span>
          </>
        }
        actions={
          <>
            <StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} />
            <StatusChip label={`${product.completenessScore ?? 0}% complete`} tone="info" />
            {canWrite ? (
              <button
                type="submit"
                form="product-edit-form"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Save
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="submit"
                form="product-validate-form"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Validate
              </button>
            ) : null}
            {canWrite ? (
              <Link
                href={tabHref("channels")}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Submit
              </Link>
            ) : null}
          </>
        }
      />

      <nav className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <ul className="flex min-w-max gap-2">
          {DETAIL_TABS.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tabHref(tab.key)}
                className={`inline-flex rounded-md px-3 py-2 text-sm font-medium transition ${
                  activeTab === tab.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="space-y-5">

      {updateStatus === "updated" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Product updated successfully.
        </div>
      )}
      {updateStatus === "conflict" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {translateError("VERSION_CONFLICT").title}. {translateError("VERSION_CONFLICT").description}
          {conflictVersion ? ` Latest version is ${conflictVersion}.` : ""}
        </div>
      )}
      {updateStatus === "error" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Product update failed. Retry after reloading current data.
        </div>
      )}

      {activeTab === "overview" ? (
        <section className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Card>
              <CardTitle>Product overview</CardTitle>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brand</dt>
                  <dd className="mt-1 text-sm text-slate-900">{product.brand || "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</dt>
                  <dd className="mt-1 text-sm text-slate-900">{product.category?.path ?? product.categoryId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                  <dd className="mt-1">
                    <StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</dt>
                  <dd className="mt-1 text-sm text-slate-900">{formatDateTime(product.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completeness</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{product.completenessScore ?? 0}% complete</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variants</dt>
                  <dd className="mt-1 text-sm text-slate-900">{variants.length}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={tabHref("content")}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit content
                </Link>
                <Link
                  href={tabHref("attributes")}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit attributes
                </Link>
                <Link
                  href={tabHref("media")}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Review media
                </Link>
              </div>
            </Card>
            <Card>
              <CardTitle>Fix blockers before publish</CardTitle>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <span>Blocking issues</span>
                  <StatusChip label={`${blockingIssueCount}`} tone={blockingIssueCount > 0 ? "danger" : "success"} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <span>Warnings to review</span>
                  <StatusChip label={`${warningIssueCount}`} tone={warningIssueCount > 0 ? "warning" : "neutral"} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <span>Publish blockers</span>
                  <StatusChip label={`${readinessBlockers.length}`} tone={readinessBlockers.length > 0 ? "danger" : "success"} />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={tabHref("quality")}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Fix issues
                  </Link>
                  <Link
                    href={tabHref("channels")}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open channel readiness
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </section>
      ) : null}

      {activeTab === "overview" || activeTab === "channels" || activeTab === "quality" ? (
        <ProductReadinessSummaryBar productId={id} role={actorRole} />
      ) : null}

      <Card hidden={!(activeTab === "content" || activeTab === "attributes")}>
        <CardTitle>Edit Product (Versioned)</CardTitle>
        {canWrite ? (
          <form id="product-edit-form" action={updateProductAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={actorRole} />
            <input type="hidden" name="productId" value={id} />
            <input type="hidden" name="categoryId" value={product.categoryId} />
            <input type="hidden" name="expectedVersion" value={product.version} />
            <input type="hidden" name="attributesBase" value={JSON.stringify(productAttributes)} />
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-title">
                Product Title
              </label>
              <Input id="product-title" name="title" data-field="title" defaultValue={product.title} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-brand">
                Brand
              </label>
              <Input id="product-brand" name="brand" data-field="brand" defaultValue={product.brand} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label
                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                htmlFor="product-description"
              >
                Description
              </label>
              <Textarea
                id="product-description"
                name="description"
                data-field="description"
                rows={3}
                className="md:col-span-2"
                defaultValue={product.description}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-hsn-code">
                HSN Code
              </label>
              <Input id="product-hsn-code" name="hsnCode" data-field="hsnCode" defaultValue={product.hsnCode ?? ""} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-gst-rate">
                GST Rate
              </label>
              <Input
                id="product-gst-rate"
                name="gstRate"
                data-field="gstRate"
                type="number"
                min={0}
                step="0.01"
                defaultValue={product.gstRate ?? ""}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-status">
                Status
              </label>
              <Select id="product-status" name="status" data-field="status" defaultValue={product.status}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </Select>
            </div>
            <p className="text-xs text-slate-500">Submitting with expected version: {product.version}</p>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Additional Attributes</label>
              {productAttributeDefinitions.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  No additional attributes required for this category.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {productAttributeDefinitions.map((definition) => {
                    const inputName = `attr__${definition.key}`;
                    const inputTypeName = `attrType__${definition.key}`;
                    const inputId = `product-attribute-${definition.key}`;
                    const currentValue = productAttributes[definition.key];
                    const dataType = String(definition.dataType ?? "text").toLowerCase();
                    const allowedValues = getAllowedValues(definition.allowedValues);
                    const defaultTextValue =
                      currentValue === null || currentValue === undefined
                        ? ""
                        : typeof currentValue === "string"
                          ? currentValue
                          : String(currentValue);

                    if (dataType === "boolean") {
                      return (
                        <div key={definition.id} className="space-y-1">
                          <input type="hidden" name={inputTypeName} value={dataType} />
                          <label
                            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                            htmlFor={inputId}
                          >
                            {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                          </label>
                          <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                            <input type="hidden" name={inputName} value="false" />
                            <input
                              id={inputId}
                              name={inputName}
                              type="checkbox"
                              value="true"
                              defaultChecked={Boolean(currentValue)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span className="text-sm text-slate-700">Enabled</span>
                          </div>
                        </div>
                      );
                    }

                    if (dataType === "select" && allowedValues.length > 0) {
                      return (
                        <div key={definition.id} className="space-y-1">
                          <input type="hidden" name={inputTypeName} value={dataType} />
                          <label
                            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                            htmlFor={inputId}
                          >
                            {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                          </label>
                          <Select id={inputId} name={inputName} defaultValue={defaultTextValue}>
                            <option value="">Select {definition.name}</option>
                            {allowedValues.map((allowedValue) => (
                              <option key={allowedValue} value={allowedValue}>
                                {allowedValue}
                              </option>
                            ))}
                          </Select>
                        </div>
                      );
                    }

                    return (
                      <div key={definition.id} className="space-y-1">
                        <input type="hidden" name={inputTypeName} value={dataType} />
                        <label
                          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                          htmlFor={inputId}
                        >
                          {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                        </label>
                        <Input
                          id={inputId}
                          name={inputName}
                          type={dataType === "number" ? "number" : "text"}
                          step={dataType === "number" ? "0.01" : undefined}
                          defaultValue={defaultTextValue}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Button type="submit" className="w-fit">
              Save product changes
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">You can review product data in read-only mode.</p>
            <div className="rounded-md border border-dashed border-slate-300 p-3">
              <ViewerEditTooltip>
                <div className="h-10 w-40 rounded-md border border-slate-200 bg-slate-50" />
              </ViewerEditTooltip>
            </div>
          </div>
        )}
      </Card>

      <Card hidden={activeTab !== "channels"}>
        <CardTitle>Channel readiness and publish</CardTitle>
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Publish readiness</p>
            <p className="mt-1">
              <span className={readiness.ok ? "text-emerald-700" : "text-red-700"}>
                {readiness.ok ? "Ready to publish" : "Blocked until fixes are complete"}
              </span>
            </p>
            {readinessBlockers.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {readinessBlockers.map((blocker) => (
                  <li key={`readiness-blocker-${blocker}`}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No preflight blockers.</p>
            )}
            {readinessWarnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                {readinessWarnings.map((warning) => (
                  <li key={`readiness-warning-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/channels/mappings?categoryId=${encodeURIComponent(product.categoryId)}&channel=${encodeURIComponent(selectedChannel)}&productId=${encodeURIComponent(id)}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Fix mapping
              </Link>
              <Link
                href={tabHref("quality")}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Review quality blockers
              </Link>
            </div>
          </div>
          {canWrite && publishableChannels.length > 0 ? (
            <form action={createExportJobAction} className="grid gap-3 md:grid-cols-4">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={id} />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-channel">
                  Channel
                </label>
                <Select id="export-channel" name="channel" defaultValue={defaultExportChannel}>
                  {publishableChannels.map((channel) => (
                    <option key={channel.channel} value={channel.channel}>
                      {channel.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-template-id">
                  Mapping
                </label>
                <Select id="export-template-id" name="templateId" defaultValue={selectedTemplateId ?? ""}>
                  <option value="">Live mapping</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                      {template.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-max-retries">
                  Max Retries
                </label>
                <Input id="export-max-retries" name="maxRetries" type="number" min={1} max={10} defaultValue={3} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-fallback-ack">
                  Fallback confirmation
                </label>
                <Select
                  id="export-fallback-ack"
                  name="fallbackAcknowledged"
                  defaultValue={fallbackAckRequired ? "false" : "true"}
                >
                  <option value="false">Not acknowledged</option>
                  <option value="true">Acknowledge fallback usage</option>
                </Select>
              </div>
              <Button type="submit" disabled={!canQueueExportWithAck}>
                Publish to a channel
              </Button>
            </form>
          ) : canWrite ? (
            <p className="text-sm text-slate-600">
              No installed connector with publish capability is available for this tenant.
            </p>
          ) : (
            <p className="text-sm text-slate-600">Viewer role cannot queue publish actions.</p>
          )}
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              Advanced channel diagnostics
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-4 py-4">
              <form method="get" className="flex max-w-xl items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs uppercase text-slate-500" htmlFor="simulator-channel">
                    Channel
                  </label>
                  <Select id="simulator-channel" name="channel" defaultValue={selectedChannel}>
                    {channels.map((channel) => (
                      <option key={channel.channel} value={channel.channel}>
                        {channel.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs uppercase text-slate-500" htmlFor="simulator-template-id">
                    Mapping
                  </label>
                  <Select id="simulator-template-id" name="templateId" defaultValue={selectedTemplateId ?? ""}>
                    <option value="">Live mapping</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {template.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit">Run simulator</Button>
              </form>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Export Ready</p>
                  <p className="text-lg font-semibold">{simulation.exportReady ? "Yes" : "No"}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Risk Score</p>
                  <p className="text-lg font-semibold">
                    {simulation.riskScore} ({simulation.riskBand})
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Missing Required Fields</p>
                  <p className="text-lg font-semibold">{simulation.missingFields.length}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Compliance (Errors/Warnings)</p>
                  <p className="text-lg font-semibold">
                    {simulation.complianceSummary.errorCount}/{simulation.complianceSummary.warningCount}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Mapping source: {simulation.mappingSource}
                {simulation.templateName ? ` (${simulation.templateName})` : ""}
              </p>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase text-slate-500">Missing Fields</p>
                  {simulation.missingFields.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {simulation.missingFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-600">No required field gaps for this channel.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase text-slate-500">Mapped Payload Preview</p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs">
                    {JSON.stringify(simulation.mappedPayload, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={activeTab !== "channels"}>
        <CardTitle>{mappingManagerInstallation ? "Channel Mapping" : "Channel Mapping Templates"}</CardTitle>
        <div className="space-y-3">
          {mappingManagerInstallation ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                Lifecycle mapping manager is the canonical edit path for this connector.
              </p>
                <p className="text-xs text-slate-500">
                  Use the channel mapping workspace to fix live mapping blockers. Legacy templates remain below as reference-only transition inventory.
                </p>
                <Link
                  href={`/channels/mappings?categoryId=${encodeURIComponent(product.categoryId)}&channel=${encodeURIComponent(selectedChannel)}&productId=${encodeURIComponent(id)}`}
                  className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Open channel mapping workspace
                </Link>
              </div>
          ) : null}
          {!mappingManagerInstallation && canWrite ? (
            <form action={createMappingTemplateAction} className="grid gap-3 md:grid-cols-2">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={id} />
              <input type="hidden" name="categoryId" value={product.categoryId} />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-name">
                  Template Name
                </label>
                <Input id="template-name" name="name" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-channel">
                  Channel
                </label>
                <Select id="template-channel" name="channel" defaultValue={selectedChannel}>
                  {channels.map((channel) => (
                    <option key={channel.channel} value={channel.channel}>
                      {channel.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-required-fields">
                  Required Fields
                </label>
                <Textarea id="template-required-fields" name="requiredFields" rows={4} defaultValue={requiredFieldsDefault} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-field-map">
                  Field Mapping
                </label>
                <Textarea id="template-field-map" name="fieldMap" rows={4} defaultValue={fieldMapDefault} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-default">
                  Default Template
                </label>
                <Select id="template-default" name="isDefault" defaultValue="false">
                  <option value="false">save as non-default</option>
                  <option value="true">save as default</option>
                </Select>
              </div>
              <div />
              <Button type="submit" className="w-fit">
                Save template
              </Button>
            </form>
          ) : !mappingManagerInstallation ? (
            <p className="text-sm text-slate-600">Viewer role cannot save mapping templates.</p>
          ) : null}

          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              Legacy template inventory (transition only)
            </summary>
            <div className="overflow-x-auto border-t border-slate-200 rounded-b-lg">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Default</th>
                  <th className="px-3 py-2">Required Fields</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.length > 0 ? (
                  templates.map((template) => (
                    <tr key={template.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">{template.name}</td>
                      <td className="px-3 py-2.5 capitalize">{template.channel}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={template.isDefault ? "Default" : "Custom"}
                          tone={template.isDefault ? "success" : "neutral"}
                        />
                      </td>
                      <td className="px-3 py-2.5">{template.requiredFields.length}</td>
                      <td className="px-3 py-2.5 text-slate-600">{new Date(template.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>
                      No mapping templates found for this category and channel.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={activeTab !== "channels"}>
        <CardTitle>Publish attempts and recovery</CardTitle>
        <div className="space-y-3">
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              View publish attempts and recovery actions
            </summary>
            <div className="overflow-x-auto border-t border-slate-200 rounded-b-lg">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Retry</th>
                  <th className="px-3 py-2">Failure</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exportJobs.length > 0 ? (
                  exportJobs.map((job) => (
                    <tr key={job.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{job.id}</td>
                      <td className="px-3 py-2.5 capitalize">{job.channel}</td>
                      <td className="px-3 py-2.5">{job.template?.name ?? "-"}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip label={translateExportStatus(job.status)} tone={lifecycleStatusTone(job.status)} />
                      </td>
                      <td className="px-3 py-2.5">
                        {job.retryCount}/{job.maxRetries}
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5 text-slate-600">{job.failureReason ?? "-"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-2">
                          {canWrite && (
                            <form action={processExportJobAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="jobId" value={job.id} />
                              <input type="hidden" name="productId" value={id} />
                              <Button type="submit" className="px-2.5 py-1.5 text-xs">
                                Process
                              </Button>
                            </form>
                          )}
                          {canWrite &&
                            (job.status === "dead_letter" ||
                              job.status === "retrying" ||
                              job.status === "failed") && (
                              <form action={requeueExportJobAction}>
                                <RoleHiddenInput role={actorRole} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="productId" value={id} />
                                <Button type="submit" variant="secondary" className="px-2.5 py-1.5 text-xs">
                                  Requeue
                                </Button>
                              </form>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-6 text-sm text-slate-500" colSpan={7}>
                      No submission jobs created yet. Queue an export job to start channel processing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={activeTab !== "quality"}>
        <CardTitle>Compliance Validation</CardTitle>
        <div className="space-y-3">
          {canWrite ? (
            <form id="product-validate-form" action={validateProductAction}>
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={id} />
              <Button type="submit">Run validation</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600">Viewer role cannot trigger validation.</p>
          )}
          {product.validationIssues && product.validationIssues.length > 0 ? (
            <ValidationIssuePanel issues={product.validationIssues} />
          ) : (
            <EmptyState
              icon="CHECK"
              title="No issues found"
              description="This product passes all compliance and channel checks."
            />
          )}
        </div>
      </Card>

      <Card hidden={activeTab !== "variants"}>
        <CardTitle>Add Variant</CardTitle>
        {canWrite ? (
          <form action={createVariantAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={actorRole} />
            <input type="hidden" name="productId" value={id} />
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-sku-code">
                SKU Code
              </label>
              <Input id="variant-sku-code" name="skuCode" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-inventory-qty">
                Inventory Quantity
              </label>
              <Input id="variant-inventory-qty" name="inventoryQty" type="number" min={0} defaultValue={0} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-mrp">
                MRP
              </label>
              <Input id="variant-mrp" name="mrp" type="number" min={0} step="0.01" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-selling-price">
                Selling Price
              </label>
              <Input id="variant-selling-price" name="sellingPrice" type="number" min={0} step="0.01" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-status">
                Status
              </label>
              <Select id="variant-status" name="status" defaultValue="draft">
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </Select>
            </div>
            <div />
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-attributes">
                Variant Attributes
              </label>
              <Textarea id="variant-attributes" name="attributes" rows={4} className="md:col-span-2" />
              <p className="text-xs text-slate-500">Optional details to describe this variant.</p>
            </div>
            <Button type="submit" className="w-fit">
              Create variant
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">Viewer role cannot create variants.</p>
        )}
      </Card>

      <Card hidden={activeTab !== "variants"}>
        <CardTitle>Variants</CardTitle>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Attributes</th>
                <th className="px-3 py-2">MRP</th>
                <th className="px-3 py-2">Selling Price</th>
                <th className="px-3 py-2">Inventory</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {variants.length > 0 ? (
                variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                    <td className="px-3 py-2.5">{variant.skuCode}</td>
                    <td className="px-3 py-2.5">
                      <pre className="max-w-[360px] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                        {JSON.stringify(variant.attributes, null, 2)}
                      </pre>
                    </td>
                    <td className="px-3 py-2.5">{formatINR(variant.mrp)}</td>
                    <td className="px-3 py-2.5">{formatINR(variant.sellingPrice)}</td>
                    <td className="px-3 py-2.5">{variant.inventoryQty}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip label={variant.status} tone={lifecycleStatusTone(variant.status)} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-slate-200">
                  <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                    No variants yet. Add the first variant to enable inventory and price differentiation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card hidden={activeTab !== "media"}>
        <CardTitle>Media</CardTitle>
        <p className="text-sm text-slate-600">
          Use the Media library for uploads, validation checks, and asset linkage.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/catalog/media?productId=${encodeURIComponent(id)}`}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open Media Library
          </Link>
          <Link
            href="/channels/health"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Channel Media Health
          </Link>
        </div>
      </Card>

      <Card hidden={activeTab !== "activity"}>
        <CardTitle>Activity</CardTitle>
        {recentJobs.length === 0 ? (
          <p className="text-sm text-slate-600">No submission activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentJobs.map((job) => (
              <li key={job.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <p className="font-mono text-xs text-slate-700">{job.id}</p>
                <p className="text-slate-600">
                  {job.channel} | {translateExportStatus(job.status)} | {new Date(job.updatedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-24 xl:h-fit">
          <SideRailCard title="Completeness">
            <p className="text-2xl font-semibold text-slate-900">{product.completenessScore ?? 0}%</p>
            <p className="text-xs text-slate-500">Status: {product.status}</p>
          </SideRailCard>
          <SideRailCard title="Blocking Issues">
            <p>{blockingIssueCount} blocking</p>
            <p>{warningIssueCount} warnings</p>
            <Link href={tabHref("quality")} className="text-sm font-medium text-blue-700 hover:underline">
              Open quality tab
            </Link>
          </SideRailCard>
          <SideRailCard title="Channel Readiness">
            <StatusChip label={simulation.exportReady ? "Ready" : "Blocked"} tone={simulation.exportReady ? "success" : "danger"} />
            <p className="text-xs text-slate-500">{simulation.missingFields.length} required fields missing</p>
          </SideRailCard>
          <SideRailCard title="Next actions">
            <div className="space-y-2 text-sm">
              <Link href={tabHref("content")} className="block font-medium text-blue-700 hover:underline">
                Update product content
              </Link>
              <Link href={tabHref("quality")} className="block font-medium text-blue-700 hover:underline">
                Fix quality blockers
              </Link>
              <Link href={tabHref("channels")} className="block font-medium text-blue-700 hover:underline">
                Review channel readiness
              </Link>
            </div>
          </SideRailCard>
        </aside>
      </div>
    </div>
  );
}

