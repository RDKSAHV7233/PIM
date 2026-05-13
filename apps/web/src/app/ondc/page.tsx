import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createOndcMappingAction, runOndcSimulationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  AppRole,
  getCategoryTree,
  getOndcMappings,
  getOndcSimulation,
  getOndcVersions,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

interface OndcPageProps {
  searchParams: Promise<{    nodeType?: string;
    version?: string;
    categoryId?: string;
    productId?: string;
    mappingId?: string;
  }>;
}

export default async function OndcPage({ searchParams }: OndcPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const ondcEnabled =
    String(process.env.FEATURE_ONDC_ENABLED ?? "false").trim().toLowerCase() === "true";
  if (actorRole !== "admin" || process.env.APP_ENV === "production" || !ondcEnabled) {
    notFound();
  }
  const nodeType = String(query.nodeType ?? "seller_app").trim();
  const version = String(query.version ?? "1.2.0").trim();
  const categoryId = String(query.categoryId ?? "").trim();
  const productId = String(query.productId ?? "").trim();
  const mappingId = String(query.mappingId ?? "").trim();

  let rawCategories: Awaited<ReturnType<typeof getCategoryTree>>;
  let rawProducts: Awaited<ReturnType<typeof getProductList>>;
  let versions: Awaited<ReturnType<typeof getOndcVersions>>;
  let mappings: Awaited<ReturnType<typeof getOndcMappings>>;
  try {
    [rawCategories, rawProducts, versions, mappings] = await Promise.all([
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
      getOndcVersions({ role: actorRole, authHeader }),
      getOndcMappings(
        {
          nodeType: nodeType || undefined,
          version: version || undefined,
          categoryId: categoryId || undefined,
        },
        { role: actorRole, authHeader },
      ),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/ondc", error));
    }
    throw error;
  }
  const categories = filterTestData(rawCategories, true);
  const products = filterTestData(rawProducts, true);

  const simulation =
    productId && nodeType && version
      ? await getOndcSimulation(productId, nodeType, version, mappingId || undefined, {
          role: actorRole,
          authHeader,
        }).catch(() => null)
      : null;
  const mappingColumns: Column<(typeof mappings)[number]>[] = [
    { key: "name", header: "Name", render: (mapping) => mapping.name },
    { key: "node", header: "Node", render: (mapping) => mapping.nodeType },
    { key: "version", header: "Version", render: (mapping) => mapping.version },
    { key: "category", header: "Category", render: (mapping) => mapping.categoryId },
    { key: "required", header: "Required", render: (mapping) => mapping.requiredFields.length },
    { key: "default", header: "Default", render: (mapping) => (mapping.isDefault ? "Yes" : "No") },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ONDC Expansion</h1>
        <p className="text-sm text-slate-600">
          Node-specific mappings, discovery metadata, and protocol-version simulation.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={`/`}>
          Dashboard
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/media`}>
          Media Validation
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/rejection`}>
          Rejection Intelligence
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ai`}>
          Smart Suggestions
        </Link>
      </div>

      <Card>
        <CardTitle>Create ONDC Mapping</CardTitle>
        <form action={createOndcMappingAction} className="grid gap-3 md:grid-cols-2">
          <RoleHiddenInput role={actorRole} />
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-mapping-name">
              Mapping Name
            </label>
            <Input id="ondc-mapping-name" name="name" placeholder="e.g. ONDC Apparel Mapping" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-category-id">
              Category
            </label>
            <Select id="ondc-category-id" name="categoryId" required defaultValue={categoryId}>
              <option value="" disabled>
                Select category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-node-type">
              Node Type
            </label>
            <Select id="ondc-node-type" name="nodeType" defaultValue={nodeType}>
              <option value="seller_app">seller_app</option>
              <option value="buyer_app">buyer_app</option>
              <option value="gateway">gateway</option>
              <option value="logistics">logistics</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-version">
              Version
            </label>
            <Select id="ondc-version" name="version" defaultValue={version}>
              {versions.map((entry) => (
                <option key={entry.version} value={entry.version}>
                  {entry.version} ({entry.status})
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-required-fields">
              Required Fields
            </label>
            <Textarea
              id="ondc-required-fields"
              name="requiredFields"
              rows={3}
              className="md:col-span-2"
              defaultValue='["title","brand","hsnCode","gstRate","attributes.color"]'
              placeholder='["title","brand"]'
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-field-map">
              Field Mapping
            </label>
            <Textarea
              id="ondc-field-map"
              name="fieldMap"
              rows={4}
              className="md:col-span-2"
              defaultValue='{"title":"descriptor.name","brand":"descriptor.brand","hsnCode":"item.hsn_code"}'
              placeholder='{"title":"descriptor.name"}'
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-discovery-metadata">
              Discovery Metadata
            </label>
            <Textarea
              id="ondc-discovery-metadata"
              name="discoveryMetadata"
              rows={3}
              className="md:col-span-2"
              defaultValue='{"domain":"ONDC:RET10","ttl":"P1D"}'
              placeholder='{"domain":"ONDC:RET10"}'
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-is-default">
              Default Mapping
            </label>
            <Select id="ondc-is-default" name="isDefault" defaultValue="false">
              <option value="false">non-default</option>
              <option value="true">default</option>
            </Select>
          </div>
          <Button type="submit" className="w-fit">
            Save mapping
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>ONDC Mappings</CardTitle>
        <DataGrid columns={mappingColumns} rows={mappings} getRowKey={(mapping) => mapping.id} />
      </Card>

      <Card>
        <CardTitle>Simulate ONDC Payload</CardTitle>
        <form action={runOndcSimulationAction} className="grid gap-3 md:grid-cols-2">
          <RoleHiddenInput role={actorRole} />
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-product-id">
              Product
            </label>
            <Select id="ondc-sim-product-id" name="productId" required defaultValue={productId}>
              <option value="" disabled>
                Select product
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-node-type">
              Node Type
            </label>
            <Select id="ondc-sim-node-type" name="nodeType" defaultValue={nodeType}>
              <option value="seller_app">seller_app</option>
              <option value="buyer_app">buyer_app</option>
              <option value="gateway">gateway</option>
              <option value="logistics">logistics</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-version">
              Version
            </label>
            <Select id="ondc-sim-version" name="version" defaultValue={version}>
              {versions.map((entry) => (
                <option key={entry.version} value={entry.version}>
                  {entry.version}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-mapping-id">
              Mapping
            </label>
            <Select id="ondc-sim-mapping-id" name="mappingId" defaultValue={mappingId}>
              <option value="">Use default mapping</option>
              {mappings.map((mapping) => (
                <option key={mapping.id} value={mapping.id}>
                  {mapping.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="w-fit">
            Run simulation
          </Button>
        </form>

        {simulation && (
          <div className="mt-4 space-y-2 text-sm">
            <p>
              Publish ready: <strong>{simulation.publishReady ? "Yes" : "No"}</strong>
            </p>
            <p>
              Mapping: {simulation.mappingId} | Node: {simulation.nodeType} | Version: {simulation.version}
            </p>
            {simulation.missingFields.length > 0 && (
              <ul className="list-disc pl-5">
                {simulation.missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            )}
            <JsonPreview value={JSON.stringify(simulation.payload, null, 2)} className="max-h-72 border-border" />
          </div>
        )}
      </Card>
    </div>
  );
}

