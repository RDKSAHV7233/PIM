import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  cloneMappingTemplateAction,
  createMappingTemplateAction,
  deleteMappingTemplateAction,
  updateMappingTemplateAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  type AppRole,
  type ChannelMappingTemplate,
  type MarketplaceChannel,
  getConnectorPayloadPreview,
  getInstalledConnectors,
  getMarketplaceChannelMapping,
  getMarketplaceTemplates,
  getProducts,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

type SearchParams = {
  productId?: string;
  channel?: MarketplaceChannel;
  templateId?: string;
  hideTestData?: string;
};

interface MappingManagerPageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<SearchParams>;
}

function mapConnectorSlugToChannel(slugInput: string): MarketplaceChannel | null {
  const slug = String(slugInput ?? "").trim().toLowerCase();
  if (slug === "amazon-in") {
    return "amazon";
  }
  if (slug === "flipkart") {
    return "flipkart";
  }
  if (slug === "meesho") {
    return "meesho";
  }
  return null;
}

function parseHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !(normalized === "false" || normalized === "0" || normalized === "off");
}

function getTemplateDefaults(template: ChannelMappingTemplate | null, mapping: { requiredFields: string[]; fieldMap: Record<string, string> }) {
  if (!template) {
    return {
      requiredFields: JSON.stringify(mapping.requiredFields, null, 2),
      fieldMap: JSON.stringify(mapping.fieldMap, null, 2),
      version: 1,
    };
  }
  return {
    requiredFields: JSON.stringify(template.requiredFields, null, 2),
    fieldMap: JSON.stringify(template.fieldMap, null, 2),
    version: template.version ?? 1,
  };
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function MappingManagerPage({ params, searchParams }: MappingManagerPageProps) {
  const { installationId } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";
  const hideTestData = parseHideTestData(query.hideTestData);

  try {
    const [installations, productsRaw] = await Promise.all([
      getInstalledConnectors({ role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
    ]);

    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const connectorChannel = mapConnectorSlugToChannel(installation.slug);
    if (!connectorChannel) {
      return (
        <div className="space-y-4">
          <Link href="/" className="text-sm text-slate-600 underline">Back to dashboard</Link>
          <Card>
            <EmptyState
              icon="WARN"
              title="Mapping manager unavailable"
              description={`Connector '${installation.slug}' does not support catalog mapping previews.`}
            />
          </Card>
        </div>
      );
    }

    const products = filterTestData(productsRaw, hideTestData);
    const selectedProductId = String(query.productId ?? "").trim() || products[0]?.id || "";
    const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;

    const selectedChannel = query.channel && ["amazon", "flipkart", "meesho"].includes(query.channel)
      ? query.channel
      : connectorChannel;

    const templates = selectedProduct
      ? await getMarketplaceTemplates(selectedProduct.categoryId, selectedChannel, { role: actorRole, authHeader })
      : [];

    const selectedTemplateId = String(query.templateId ?? "").trim();
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;

    const mapping = selectedProduct
      ? await getMarketplaceChannelMapping(
        selectedChannel,
        selectedProduct.categoryId,
        selectedTemplate?.id,
        { role: actorRole, authHeader },
      )
      : null;

    const preview = selectedProduct
      ? await getConnectorPayloadPreview(
        installation.id,
        {
          productId: selectedProduct.id,
          templateId: selectedTemplate?.id,
          channel: selectedChannel,
        },
        { role: actorRole, authHeader },
      )
      : null;

    const defaults = getTemplateDefaults(selectedTemplate, mapping ?? { requiredFields: [], fieldMap: {} });
    const redirectTo = `/connectors/${encodeURIComponent(installation.id)}/mapping?productId=${encodeURIComponent(selectedProductId)}&channel=${encodeURIComponent(selectedChannel)}${selectedTemplate ? `&templateId=${encodeURIComponent(selectedTemplate.id)}` : ""}`;

    return (
      <div className="space-y-5">
        <header className="space-y-1">
          <Link href="/" className="text-sm text-slate-600 underline">Back to dashboard</Link>
          <h1 className="text-2xl font-semibold text-slate-900">Connector Mapping Manager</h1>
          <p className="text-sm text-slate-600">
            {installation.displayName} ({installation.accountAlias}) - installation <span className="font-mono text-xs">{installation.id}</span>
          </p>
        </header>

        <Card>
          <CardTitle>Scope</CardTitle>
          <form method="get" className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label htmlFor="mapping-product" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Product</label>
              <Select id="mapping-product" name="productId" defaultValue={selectedProductId}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.title}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="mapping-channel" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Channel</label>
              <Select id="mapping-channel" name="channel" defaultValue={selectedChannel}>
                <option value="amazon">Amazon</option>
                <option value="flipkart">Flipkart</option>
                <option value="meesho">Meesho</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="mapping-template" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Template</label>
              <Select id="mapping-template" name="templateId" defaultValue={selectedTemplate?.id ?? ""}>
                <option value="">System mapping</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}{template.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </Card>

        {!selectedProduct || !preview || !mapping ? (
          <Card>
            <EmptyState
              icon="INFO"
              title="Choose a product to load mapping"
              description="No product is currently selected for this connector installation."
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardTitle>Payload Preview</CardTitle>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase text-slate-500">Export Ready</p>
                  <p className="text-lg font-semibold">{preview.exportReady ? "Yes" : "No"}</p>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase text-slate-500">Missing Fields</p>
                  <p className="text-lg font-semibold">{preview.missingFields.length}</p>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase text-slate-500">Validation Source</p>
                  <p className="text-lg font-semibold uppercase">{preview.validationSource}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Mapping source: {preview.mappingSource}{preview.templateName ? ` (${preview.templateName})` : ""}
              </p>
              <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                {JSON.stringify(preview.mappedPayload, null, 2)}
              </pre>
            </Card>

            <Card>
              <CardTitle>Templates</CardTitle>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Version</th>
                      <th className="py-2 pr-3">Default</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => (
                      <tr key={template.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{template.name}</td>
                        <td className="py-2 pr-3">v{template.version ?? 1}</td>
                        <td className="py-2 pr-3">{template.isDefault ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">{template.isSystemPack ? "System" : "Custom"}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/connectors/${encodeURIComponent(installation.id)}/mapping?productId=${encodeURIComponent(selectedProduct.id)}&channel=${encodeURIComponent(selectedChannel)}&templateId=${encodeURIComponent(template.id)}`}
                              className="text-xs text-slate-700 underline"
                            >
                              Open
                            </Link>
                            <form action={cloneMappingTemplateAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input type="hidden" name="redirectTo" value={redirectTo} />
                              <Button type="submit">Clone</Button>
                            </form>
                            {canWrite && !template.isSystemPack ? (
                              <form action={deleteMappingTemplateAction}>
                                <RoleHiddenInput role={actorRole} />
                                <input type="hidden" name="templateId" value={template.id} />
                                <input type="hidden" name="redirectTo" value={redirectTo} />
                                <Button type="submit">Delete</Button>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {canWrite ? (
              <Card>
                <CardTitle>{selectedTemplate ? "Edit Selected Template" : "Create Template"}</CardTitle>
                {selectedTemplate ? (
                  selectedTemplate.isSystemPack ? (
                    <p className="text-sm text-slate-600">System templates are read-only. Clone to create an editable copy.</p>
                  ) : (
                    <form action={updateMappingTemplateAction} className="grid gap-3 md:grid-cols-2">
                      <RoleHiddenInput role={actorRole} />
                      <input type="hidden" name="templateId" value={selectedTemplate.id} />
                      <input type="hidden" name="version" value={defaults.version} />
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <div className="space-y-1">
                        <label htmlFor="template-edit-name" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Template Name</label>
                        <Input id="template-edit-name" name="name" defaultValue={selectedTemplate.name} required />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="template-edit-channel" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Channel</label>
                        <Select id="template-edit-channel" name="channel" defaultValue={selectedTemplate.channel}>
                          <option value="amazon">Amazon</option>
                          <option value="flipkart">Flipkart</option>
                          <option value="meesho">Meesho</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="template-edit-required" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Required Fields JSON</label>
                        <Textarea id="template-edit-required" name="requiredFields" rows={5} defaultValue={defaults.requiredFields} />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="template-edit-field-map" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Field Map JSON</label>
                        <Textarea id="template-edit-field-map" name="fieldMap" rows={5} defaultValue={defaults.fieldMap} />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="template-edit-default" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Default</label>
                        <Select id="template-edit-default" name="isDefault" defaultValue={selectedTemplate.isDefault ? "true" : "false"}>
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button type="submit">Update Template</Button>
                      </div>
                    </form>
                  )
                ) : (
                  <p className="text-sm text-slate-600">No template selected. Use “Create Template” below.</p>
                )}
              </Card>
            ) : null}

            {canWrite ? (
              <Card>
                <CardTitle>Create Template From Current Mapping</CardTitle>
                <form action={createMappingTemplateAction} className="grid gap-3 md:grid-cols-2">
                  <RoleHiddenInput role={actorRole} />
                  <input type="hidden" name="productId" value={selectedProduct.id} />
                  <input type="hidden" name="categoryId" value={selectedProduct.categoryId} />
                  <div className="space-y-1">
                    <label htmlFor="template-create-name" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Template Name</label>
                    <Input id="template-create-name" name="name" required />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="template-create-channel" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Channel</label>
                    <Select id="template-create-channel" name="channel" defaultValue={selectedChannel}>
                      <option value="amazon">Amazon</option>
                      <option value="flipkart">Flipkart</option>
                      <option value="meesho">Meesho</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="template-create-required" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Required Fields JSON</label>
                    <Textarea id="template-create-required" name="requiredFields" rows={5} defaultValue={JSON.stringify(mapping.requiredFields, null, 2)} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="template-create-field-map" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Field Map JSON</label>
                    <Textarea id="template-create-field-map" name="fieldMap" rows={5} defaultValue={JSON.stringify(mapping.fieldMap, null, 2)} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="template-create-default" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Default</label>
                    <Select id="template-create-default" name="isDefault" defaultValue="false">
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button type="submit">Create Template</Button>
                  </div>
                </form>
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-slate-600">Viewer role can inspect mappings but cannot modify templates.</p>
              </Card>
            )}
          </>
        )}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(
        buildLoginRedirect(`/connectors/${encodeURIComponent(installationId)}/mapping`, error.status),
      );
    }
    throw error;
  }
}

