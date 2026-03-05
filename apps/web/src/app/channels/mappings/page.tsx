import Link from "next/link";
import { redirect } from "next/navigation";
import {
  cloneMappingTemplateAction,
  createMappingTemplateAction,
  deleteMappingTemplateAction,
  updateMappingTemplateAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  type AppRole,
  type MarketplaceChannel,
  getCategories,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getMarketplaceTemplates,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelsMappingsPageProps {
  searchParams: Promise<{
    categoryId?: string;
    channel?: MarketplaceChannel;
  }>;
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

function normalizeChannel(
  value: string | undefined,
  channels: Array<{ channel: MarketplaceChannel }>,
): MarketplaceChannel {
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = channels.find((entry) => entry.channel === normalized);
  return matched?.channel ?? channels[0]?.channel ?? "amazon";
}

export default async function ChannelsMappingsPage({ searchParams }: ChannelsMappingsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";

  try {
    const [channels, categoriesRaw] = await Promise.all([
      getMarketplaceChannels({ role: actorRole, authHeader }),
      getCategories({ role: actorRole, authHeader }),
    ]);

    const categories = filterTestData(categoriesRaw, true);
    const selectedCategoryId = String(query.categoryId ?? "").trim() || categories[0]?.id || "";
    const selectedChannel = normalizeChannel(query.channel, channels);

    const [mapping, templates] = await Promise.all([
      getMarketplaceChannelMapping(selectedChannel, selectedCategoryId || undefined, undefined, {
        role: actorRole,
        authHeader,
      }),
      selectedCategoryId
        ? getMarketplaceTemplates(selectedCategoryId, selectedChannel, {
            role: actorRole,
            authHeader,
          })
        : Promise.resolve([]),
    ]);

    const redirectTo = `/channels/mappings?categoryId=${encodeURIComponent(selectedCategoryId)}&channel=${encodeURIComponent(selectedChannel)}`;

  return (
      <div className="space-y-5">
        <PageHeader
          title="Mappings"
          description="Manage channel mapping templates, required fields, and default assignment by category."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Mappings</span>
            </>
          }
          actions={
            <Link
              href="/channels/connectors"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Connector Detail
            </Link>
          }
        />

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
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
            <div className="flex items-end">
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </FilterBar>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>System Mapping Snapshot</CardTitle>
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              <p>
                Channel: <span className="font-medium capitalize">{mapping.channel}</span>
              </p>
              <p>
                Mapping Source:{" "}
                <StatusChip label={mapping.source === "saved_template" ? "Saved template" : "System pack"} tone={mapping.source === "saved_template" ? "info" : "neutral"} />
              </p>
              <p>Required fields: {mapping.requiredFields.length}</p>
            </div>
            <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced: current field map JSON</summary>
              <pre className="mt-2 max-h-60 overflow-auto text-xs text-slate-700">
                {JSON.stringify(mapping.fieldMap, null, 2)}
              </pre>
            </details>
          </Card>

          <Card>
            <CardTitle>Create Template</CardTitle>
            {canWrite ? (
              <form action={createMappingTemplateAction} className="mt-3 grid gap-3">
                <RoleHiddenInput role={actorRole} />
                <input type="hidden" name="categoryId" value={selectedCategoryId} />
                <input type="hidden" name="channel" value={selectedChannel} />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-template-name">
                    Template Name
                  </label>
                  <Input id="mapping-template-name" name="name" required />
                </div>
                <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced mapping fields</summary>
                  <div className="mt-3 grid gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-required-fields">
                        Required Fields (JSON array)
                      </label>
                      <Textarea id="mapping-required-fields" name="requiredFields" rows={3} defaultValue={JSON.stringify(mapping.requiredFields, null, 2)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-field-map">
                        Field Map (JSON object)
                      </label>
                      <Textarea id="mapping-field-map" name="fieldMap" rows={4} defaultValue={JSON.stringify(mapping.fieldMap, null, 2)} />
                    </div>
                  </div>
                </details>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="mapping-is-default">
                    Set as default
                  </label>
                  <Select id="mapping-is-default" name="isDefault" defaultValue="false">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </Select>
                </div>
                <Button type="submit" className="w-fit">
                  Save template
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Viewer role is read-only for template management.</p>
            )}
          </Card>
        </section>

        <Card>
          <CardTitle>Saved Templates</CardTitle>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Default</th>
                  <th className="px-3 py-2">Required Fields</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.length > 0 ? (
                  templates.map((template) => (
                    <tr key={template.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-900">{template.name}</p>
                        <p className="text-xs text-slate-500">{template.id}</p>
                      </td>
                      <td className="px-3 py-2.5 capitalize">{template.channel}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip label={template.isDefault ? "Default" : "Custom"} tone={template.isDefault ? "success" : "neutral"} />
                      </td>
                      <td className="px-3 py-2.5">{template.requiredFields.length}</td>
                      <td className="px-3 py-2.5 text-slate-600">{new Date(template.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2.5">
                        {canWrite ? (
                          <div className="flex flex-wrap gap-2">
                            <form action={updateMappingTemplateAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input type="hidden" name="redirectTo" value={redirectTo} />
                              <input type="hidden" name="isDefault" value={template.isDefault ? "false" : "true"} />
                              <Button type="submit" variant="secondary" className="text-xs">
                                {template.isDefault ? "Unset default" : "Set default"}
                              </Button>
                            </form>
                            <form action={cloneMappingTemplateAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input type="hidden" name="redirectTo" value={redirectTo} />
                              <input type="hidden" name="name" value={`${template.name} (Copy)`} />
                              <Button type="submit" variant="secondary" className="text-xs">
                                Clone
                              </Button>
                            </form>
                            <form action={deleteMappingTemplateAction}>
                              <RoleHiddenInput role={actorRole} />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input type="hidden" name="redirectTo" value={redirectTo} />
                              <Button type="submit" className="text-xs">
                                Delete
                              </Button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                      No templates found for this category/channel scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/catalog/products" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open product simulator
            </Link>
            <Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open connectors
            </Link>
          </div>
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/mappings", error.status));
    }
    throw error;
  }
}
