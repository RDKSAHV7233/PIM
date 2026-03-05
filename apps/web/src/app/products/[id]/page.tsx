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
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ValidationIssuePanel } from "@/components/ui/validation-issue-panel";
import { ViewerEditTooltip } from "@/components/ui/viewer-edit-tooltip";
import {
  ApiHttpError,
  AppRole,
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

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    channel?: string;
    templateId?: string;    updateStatus?: string;
    currentVersion?: string;
    planLimit?: string;
    planResource?: string;
    planLimitValue?: string;
    planCurrent?: string;
    planUpgrade?: string;
  }>;
}

export const dynamic = "force-dynamic";

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

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";
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
  const [variants, channels, installedConnectors, templates, mapping, simulation, exportJobs, categoryAttributes] =
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
      <Link href={`/`} className="text-sm">
        Back to dashboard
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        <p className="text-sm text-slate-600">
          Brand: {product.brand || "-"} | Status: {product.status} | Category: {product.category?.path ?? product.categoryId}
        </p>
        <p className="text-sm text-slate-600">
          HSN: {product.hsnCode || "-"} | GST: {product.gstRate ?? "-"} | Open Issues: {product.validationIssues?.length ?? 0}
        </p>
        <p className="text-xs text-slate-500">Current role: {actorRole}</p>
      </header>

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

      <ProductReadinessSummaryBar productId={id} role={actorRole} />

      <Card>
        <CardTitle>Edit Product (Versioned)</CardTitle>
        {canWrite ? (
          <form action={updateProductAction} className="grid gap-3 md:grid-cols-2">
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

      <section id="channel-simulator-section">
      <Card>
        <CardTitle>Marketplace Rejection Simulator</CardTitle>
        <div className="space-y-3">
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
                Template
              </label>
              <Select id="simulator-template-id" name="templateId" defaultValue={selectedTemplateId ?? ""}>
                <option value="">System default mapping</option>
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
      </Card>
      </section>

      <Card>
        <CardTitle>Channel Mapping Templates</CardTitle>
        <div className="space-y-3">
          {mappingManagerInstallation ? (
            <p className="text-xs text-slate-500">
              Advanced editor:{" "}
              <Link
                href={`/connectors/${encodeURIComponent(mappingManagerInstallation.id)}/mapping?productId=${encodeURIComponent(id)}&channel=${encodeURIComponent(selectedChannel)}${selectedTemplateId ? `&templateId=${encodeURIComponent(selectedTemplateId)}` : ""}`}
                className="underline"
              >
                Open mapping manager
              </Link>
            </p>
          ) : null}
          {canWrite ? (
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
          ) : (
            <p className="text-sm text-slate-600">Viewer role cannot save mapping templates.</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Template</th>
                  <th className="py-2">Channel</th>
                  <th className="py-2">Default</th>
                  <th className="py-2">Required Fields</th>
                  <th className="py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-t border-border">
                    <td className="py-2">{template.name}</td>
                    <td className="py-2 capitalize">{template.channel}</td>
                    <td className="py-2">{template.isDefault ? "Yes" : "No"}</td>
                    <td className="py-2">{template.requiredFields.length}</td>
                    <td className="py-2">{new Date(template.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Pre-Export Jobs</CardTitle>
        <div className="space-y-3">
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
                  Template
                </label>
                <Select id="export-template-id" name="templateId" defaultValue={selectedTemplateId ?? ""}>
                  <option value="">System mapping</option>
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
              <Button type="submit">Queue export job</Button>
            </form>
          ) : canWrite ? (
            <p className="text-sm text-slate-600">
              No installed connector with publish capability is available for this tenant.
            </p>
          ) : (
            <p className="text-sm text-slate-600">Viewer role cannot queue or process export jobs.</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Job</th>
                  <th className="py-2">Channel</th>
                  <th className="py-2">Template</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Retry</th>
                  <th className="py-2">Failure</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exportJobs.map((job) => (
                  <tr key={job.id} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{job.id}</td>
                    <td className="py-2 capitalize">{job.channel}</td>
                    <td className="py-2">{job.template?.name ?? "-"}</td>
                    <td className="py-2">{translateExportStatus(job.status)}</td>
                    <td className="py-2">
                      {job.retryCount}/{job.maxRetries}
                    </td>
                    <td className="py-2">{job.failureReason ?? "-"}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {canWrite && (
                          <form action={processExportJobAction}>
                            <RoleHiddenInput role={actorRole} />
                            <input type="hidden" name="jobId" value={job.id} />
                            <input type="hidden" name="productId" value={id} />
                            <Button type="submit">Process</Button>
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
                              <Button type="submit">Requeue</Button>
                            </form>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Compliance Validation</CardTitle>
        <div className="space-y-3">
          {canWrite ? (
            <form action={validateProductAction}>
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
              icon="✅"
              title="No issues found"
              description="This product passes all compliance and channel checks."
            />
          )}
        </div>
      </Card>

      <Card>
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

      <Card>
        <CardTitle>Variants</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">SKU</th>
                <th className="py-2">Attributes</th>
                <th className="py-2">MRP</th>
                <th className="py-2">Selling Price</th>
                <th className="py-2">Inventory</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id} className="border-t border-border">
                  <td className="py-2">{variant.skuCode}</td>
                  <td className="py-2">
                    <pre className="max-w-[360px] overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(variant.attributes, null, 2)}
                    </pre>
                  </td>
                  <td className="py-2">{formatINR(variant.mrp)}</td>
                  <td className="py-2">{formatINR(variant.sellingPrice)}</td>
                  <td className="py-2">{variant.inventoryQty}</td>
                  <td className="py-2">{variant.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
