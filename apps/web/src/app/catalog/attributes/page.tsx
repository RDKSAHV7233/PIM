import Link from "next/link";
import { redirect } from "next/navigation";
import { createAttributeDefinitionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type AppRole,
  type AttributeDefinition,
  getCategoryTree,
  getCategoryAttributes,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface CatalogAttributesPageProps {
  searchParams: Promise<{
    categoryId?: string;
    hideTestData?: string;
  }>;
}

function resolveHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return true;
}

function asAllowedValues(definition: AttributeDefinition): string[] {
  const raw = definition.allowedValues;
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0);
  }
  if (raw && typeof raw === "object" && "values" in raw && Array.isArray((raw as { values?: unknown[] }).values)) {
    return ((raw as { values: unknown[] }).values ?? [])
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function CatalogAttributesPage({ searchParams }: CatalogAttributesPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canManageTaxonomy = actorRole === "admin";

  try {
    const categories = filterTestData(
      await getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      hideTestData,
    );
    const selectedCategoryId = String(query.categoryId ?? "").trim() || categories[0]?.id || "";
    const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;
    const definitions = selectedCategoryId
      ? await getCategoryAttributes(selectedCategoryId, { role: actorRole, authHeader })
      : [];

    const toggleHref = hideTestData
      ? `/catalog/attributes${selectedCategoryId ? `?categoryId=${encodeURIComponent(selectedCategoryId)}&hideTestData=false` : "?hideTestData=false"}`
      : `/catalog/attributes${selectedCategoryId ? `?categoryId=${encodeURIComponent(selectedCategoryId)}` : ""}`;
    const definitionColumns: Column<(typeof definitions)[number]>[] = [
      { key: "label", header: "Label", render: (definition) => definition.name },
      {
        key: "key",
        header: "Key",
        render: (definition) => <span className="font-mono text-xs text-slate-700">{definition.key}</span>,
      },
      { key: "type", header: "Type", render: (definition) => definition.dataType },
      { key: "scope", header: "Scope", render: (definition) => definition.appliesTo },
      {
        key: "required",
        header: "Required",
        render: (definition) => (
          <StatusChip
            label={definition.required ? "Required" : "Optional"}
            tone={definition.required ? "warning" : "neutral"}
          />
        ),
      },
      {
        key: "allowedValues",
        header: "Allowed Values",
        render: (definition) => {
          const values = asAllowedValues(definition);
          return <span className="text-xs text-slate-600">{values.length > 0 ? values.join(", ") : "-"}</span>;
        },
      },
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          title="Attributes"
          description="Manage category-level attribute definitions, required flags, and allowed values."
          breadcrumb={
            <>
              Dashboard / Catalog / <span className="font-semibold text-slate-700">Attributes</span>
            </>
          }
          actions={
            <Link
              href={toggleHref}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {hideTestData ? "Show test data" : "Hide test data"}
            </Link>
          }
        />

        <Card>
          <CardTitle>Scope</CardTitle>
          <form method="get" className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-category-filter">
                Category
              </label>
              <Select id="attribute-category-filter" name="categoryId" defaultValue={selectedCategoryId}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.path}
                  </option>
                ))}
              </Select>
            </div>
            <input type="hidden" name="hideTestData" value={hideTestData ? "true" : "false"} />
            <div className="flex items-end gap-2">
              <Button type="submit">Apply</Button>
            </div>
          </form>
          {selectedCategory ? (
            <p className="mt-2 text-xs text-slate-500">
              Selected category: <span className="font-medium text-slate-700">{selectedCategory.path}</span>
            </p>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Attribute Definitions</CardTitle>
          {definitions.length > 0 ? (
            <DataGrid className="mt-3" columns={definitionColumns} rows={definitions} getRowKey={(definition) => definition.id} />
          ) : (
            <div className="mt-3 rounded-lg border border-slate-200 px-3 py-6 text-sm text-slate-500">
              No attribute definitions found for this category.
            </div>
          )}
        </Card>

        {canManageTaxonomy && selectedCategoryId ? (
          <Card>
            <CardTitle>Add Attribute Definition</CardTitle>
            <form action={createAttributeDefinitionAction} className="mt-3 grid gap-3 md:grid-cols-2">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="categoryId" value={selectedCategoryId} />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-name">
                  Display Name
                </label>
                <input
                  id="attribute-name"
                  name="name"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-key">
                  Key
                </label>
                <input
                  id="attribute-key"
                  name="key"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-data-type">
                  Data Type
                </label>
                <Select id="attribute-data-type" name="dataType" defaultValue="text">
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="select">select</option>
                  <option value="json">json</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-applies-to">
                  Applies To
                </label>
                <Select id="attribute-applies-to" name="appliesTo" defaultValue="product">
                  <option value="product">product</option>
                  <option value="variant">variant</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-required">
                  Required
                </label>
                <Select id="attribute-required" name="required" defaultValue="false">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="attribute-allowed-values">
                  Allowed Values (JSON array)
                </label>
                <textarea
                  id="attribute-allowed-values"
                  name="allowedValues"
                  rows={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder='["cotton","silk"]'
                />
              </div>
              <Button type="submit" className="w-fit">
                Add attribute
              </Button>
            </form>
          </Card>
        ) : (
          <Card>
            <CardTitle>Attribute Governance</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Only admins can add or change attribute definitions.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle>Related Workspaces</CardTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/catalog/categories" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open Categories
            </Link>
            <Link href="/catalog/products" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open Products
            </Link>
          </div>
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/catalog/attributes", error));
    }
    throw error;
  }
}
