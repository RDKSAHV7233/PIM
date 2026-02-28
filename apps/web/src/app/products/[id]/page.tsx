import Link from "next/link";
import { notFound } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AppRole,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getMarketplaceExportJobs,
  getMarketplaceSimulation,
  getMarketplaceTemplates,
  getProduct,
  getProductVariants,
  MarketplaceChannel,
  normalizeAppRole,
} from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    channel?: string;
    templateId?: string;
    role?: string;
    updateStatus?: string;
    currentVersion?: string;
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

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const actorRole = normalizeAppRole(query.role);
  const canWrite = actorRole !== "viewer";
  const selectedChannel = normalizeChannel(query.channel);
  const selectedTemplateId = normalizeTemplateId(query.templateId);
  const updateStatus = String(query.updateStatus ?? "").trim();
  const conflictVersion = String(query.currentVersion ?? "").trim();
  let product;
  try {
    product = await getProduct(id, { role: actorRole });
  } catch {
    notFound();
  }
  const [variants, channels, templates, mapping, simulation, exportJobs] = await Promise.all([
    getProductVariants(id, { role: actorRole }),
    getMarketplaceChannels({ role: actorRole }),
    getMarketplaceTemplates(product.categoryId, selectedChannel, { role: actorRole }),
    getMarketplaceChannelMapping(selectedChannel, product.categoryId, selectedTemplateId, {
      role: actorRole,
    }),
    getMarketplaceSimulation(id, selectedChannel, selectedTemplateId, { role: actorRole }),
    getMarketplaceExportJobs(id, { role: actorRole }),
  ]);
  const requiredFieldsDefault = JSON.stringify(mapping.requiredFields, null, 2);
  const fieldMapDefault = JSON.stringify(mapping.fieldMap, null, 2);

  return (
    <div className="space-y-5">
      <Link href={`/?role=${encodeURIComponent(actorRole)}`} className="text-sm">
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
          Version conflict detected. Another update was applied first.
          {conflictVersion ? ` Latest version is ${conflictVersion}.` : ""}
        </div>
      )}
      {updateStatus === "error" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Product update failed. Retry after reloading current data.
        </div>
      )}

      <Card>
        <CardTitle>Edit Product (Versioned)</CardTitle>
        {canWrite ? (
          <form action={updateProductAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={actorRole} />
            <input type="hidden" name="productId" value={id} />
            <input type="hidden" name="categoryId" value={product.categoryId} />
            <input type="hidden" name="expectedVersion" value={product.version} />
            <Input name="title" defaultValue={product.title} required />
            <Input name="brand" defaultValue={product.brand} />
            <Textarea
              name="description"
              rows={3}
              className="md:col-span-2"
              defaultValue={product.description}
            />
            <Input name="hsnCode" defaultValue={product.hsnCode ?? ""} placeholder="HSN code (optional)" />
            <Input
              name="gstRate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={product.gstRate ?? ""}
              placeholder="GST rate"
            />
            <Select name="status" defaultValue={product.status}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
            <p className="text-xs text-slate-500">Submitting with expected version: {product.version}</p>
            <Textarea
              name="attributes"
              rows={4}
              className="md:col-span-2"
              defaultValue={JSON.stringify(product.attributes ?? {}, null, 2)}
              placeholder='Product attributes JSON'
            />
            <Button type="submit" className="w-fit">
              Save product changes
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">Viewer role cannot update products.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Marketplace Rejection Simulator</CardTitle>
        <div className="space-y-3">
          <form method="get" className="flex max-w-xl items-end gap-3">
            <input type="hidden" name="role" value={actorRole} />
            <div className="flex-1">
              <p className="mb-1 text-xs uppercase text-slate-500">Channel</p>
              <Select name="channel" defaultValue={selectedChannel}>
                {channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>
                    {channel.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <p className="mb-1 text-xs uppercase text-slate-500">Template</p>
              <Select name="templateId" defaultValue={selectedTemplateId ?? ""}>
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

      <Card>
        <CardTitle>Channel Mapping Templates</CardTitle>
        <div className="space-y-3">
          {canWrite ? (
            <form action={createMappingTemplateAction} className="grid gap-3 md:grid-cols-2">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={id} />
              <input type="hidden" name="categoryId" value={product.categoryId} />
              <Input name="name" placeholder="Template name" required />
              <Select name="channel" defaultValue={selectedChannel}>
                {channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>
                    {channel.displayName}
                  </option>
                ))}
              </Select>
              <Textarea
                name="requiredFields"
                rows={4}
                placeholder='["title","brand","hsnCode"]'
                defaultValue={requiredFieldsDefault}
              />
              <Textarea
                name="fieldMap"
                rows={4}
                placeholder='{"title":"item_name","brand":"brand_name"}'
                defaultValue={fieldMapDefault}
              />
              <Select name="isDefault" defaultValue="false">
                <option value="false">save as non-default</option>
                <option value="true">save as default</option>
              </Select>
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
        <CardTitle>Pre-Export Jobs (Retry + DLQ)</CardTitle>
        <div className="space-y-3">
          {canWrite ? (
            <form action={createExportJobAction} className="grid gap-3 md:grid-cols-4">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={id} />
              <Select name="channel" defaultValue={selectedChannel}>
                {channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>
                    {channel.displayName}
                  </option>
                ))}
              </Select>
              <Select name="templateId" defaultValue={selectedTemplateId ?? ""}>
                <option value="">System mapping</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </Select>
              <Input name="maxRetries" type="number" min={1} max={10} defaultValue={3} />
              <Button type="submit">Queue export job</Button>
            </form>
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
                    <td className="py-2 capitalize">{job.status}</td>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Severity</th>
                    <th className="py-2">Rule</th>
                    <th className="py-2">Field</th>
                    <th className="py-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {product.validationIssues.map((issue) => (
                    <tr key={issue.id} className="border-t border-border">
                      <td className="py-2 capitalize">{issue.severity}</td>
                      <td className="py-2">{issue.ruleCode}</td>
                      <td className="py-2">{issue.fieldPath ?? "-"}</td>
                      <td className="py-2">{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No open validation issues.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Add Variant</CardTitle>
        {canWrite ? (
          <form action={createVariantAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={actorRole} />
            <input type="hidden" name="productId" value={id} />
            <Input name="skuCode" placeholder="SKU code" required />
            <Input name="inventoryQty" type="number" min={0} defaultValue={0} required />
            <Input name="mrp" type="number" min={0} step="0.01" placeholder="MRP" />
            <Input name="sellingPrice" type="number" min={0} step="0.01" placeholder="Selling price" />
            <Select name="status" defaultValue="draft">
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
            <div />
            <Textarea
              name="attributes"
              rows={4}
              className="md:col-span-2"
              placeholder='JSON attributes, e.g. {"size":"M","color":"Black"}'
            />
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
                  <td className="py-2">{variant.mrp ?? "-"}</td>
                  <td className="py-2">{variant.sellingPrice ?? "-"}</td>
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
