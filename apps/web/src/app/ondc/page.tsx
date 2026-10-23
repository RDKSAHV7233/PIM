import Link from "@/components/ui/app-link";
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
  getCategoryTree,
  getOndcMappings,
  getOndcSimulation,
  getOndcVersions,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";

type SharedReadResult<T> = {
  state: SharedReadState;
  data: T | null;
};

function isOndcApiUnavailable(error: unknown) {
  return error instanceof ApiHttpError && error.status !== 401 && error.status !== 403;
}

async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>> {
  try {
    return { state: "available", data: await promise };
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      throw error;
    }
    if (error instanceof ApiHttpError && error.status === 403) {
      return { state: "restricted", data: null };
    }
    if (isOndcApiUnavailable(error)) {
      return { state: "unavailable", data: null };
    }
    return { state: "unavailable", data: null };
  }
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
  const { authHeader, actorRole } = await getServerSession();
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

  let categoriesResult: SharedReadResult<Awaited<ReturnType<typeof getCategoryTree>>>;
  let productsResult: SharedReadResult<Awaited<ReturnType<typeof getProductList>>>;
  let versionsResult: SharedReadResult<Awaited<ReturnType<typeof getOndcVersions>>>;
  let mappingsResult: SharedReadResult<Awaited<ReturnType<typeof getOndcMappings>>>;
  let simulationResult: SharedReadResult<Awaited<ReturnType<typeof getOndcSimulation>>> | null = null;
  try {
    [categoriesResult, productsResult, versionsResult, mappingsResult] = await Promise.all([
      loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })),
      loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader })),
      loadSharedRead(getOndcVersions({ role: actorRole, authHeader })),
      loadSharedRead(
        getOndcMappings(
          {
            nodeType: nodeType || undefined,
            version: version || undefined,
            categoryId: categoryId || undefined,
          },
          { role: actorRole, authHeader },
        ),
      ),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/ondc", error));
    }
    throw error;
  }
  try {
    simulationResult =
      productId && nodeType && version
        ? await loadSharedRead(
            getOndcSimulation(productId, nodeType, version, mappingId || undefined, {
              role: actorRole,
              authHeader,
            }),
          )
        : null;
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/ondc", error));
    }
    throw error;
  }

  const categories = categoriesResult.data ? filterTestData(categoriesResult.data, true) : [];
  const products = productsResult.data ? filterTestData(productsResult.data, true) : [];
  const versions = versionsResult.data ?? [];
  const mappings = mappingsResult.data ?? [];
  const simulation = simulationResult?.data ?? null;
  const hasUnavailableCoreData = [categoriesResult, productsResult, versionsResult, mappingsResult].some(
    (result) => result.state === "unavailable",
  );
  const hasRestrictedCoreData = [categoriesResult, productsResult, versionsResult, mappingsResult].some(
    (result) => result.state === "restricted",
  );
  const categorySelectionMessage =
    categoriesResult.state === "restricted"
      ? "Category selection is limited for your role."
      : categoriesResult.state === "unavailable"
        ? "Category selection is temporarily unavailable."
        : null;
  const versionSelectionMessage =
    versionsResult.state === "restricted"
      ? "Version selection is limited for your role."
      : versionsResult.state === "unavailable"
        ? "Version selection is temporarily unavailable."
        : null;
  const productSelectionMessage =
    productsResult.state === "restricted"
      ? "Product selection is limited for your role."
      : productsResult.state === "unavailable"
        ? "Product selection is temporarily unavailable."
        : null;
  const mappingSelectionMessage =
    mappingsResult.state === "restricted"
      ? "Mapping selection is limited for your role."
      : mappingsResult.state === "unavailable"
        ? "Mapping selection is temporarily unavailable."
        : null;
  const mappingTableMessage =
    mappingsResult.state === "restricted"
      ? "ONDC mappings are restricted for your role."
      : mappingsResult.state === "unavailable"
        ? "ONDC mappings are temporarily unavailable."
        : null;
  const simulationStateMessage =
    simulationResult?.state === "restricted"
      ? "ONDC simulation is restricted for your role."
      : simulationResult?.state === "unavailable"
        ? "ONDC simulation is temporarily unavailable."
        : null;
  const mappingFormDisabled = categoriesResult.state !== "available" || versionsResult.state !== "available";
  const simulationDisabled = productsResult.state !== "available" || versionsResult.state !== "available";
  const mappingColumns: Column<(typeof mappings)[number]>[] = [
    { key: "name", header: "Name", render: (mapping) => mapping.name },
    { key: "node", header: "Node", render: (mapping) => mapping.nodeType },
    { key: "version", header: "Version", mobileHide: true, render: (mapping) => mapping.version },
    { key: "category", header: "Category", render: (mapping) => mapping.categoryId },
    { key: "required", header: "Required", mobileHide: true, render: (mapping) => mapping.requiredFields.length },
    { key: "default", header: "Default", mobileHide: true, render: (mapping) => (mapping.isDefault ? "Yes" : "No") },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ONDC Expansion</h1>
        <p className="text-sm text-slate-600">
          Node-specific mappings, discovery metadata, and protocol-version simulation.
        </p>
      </header>

      {(hasUnavailableCoreData || hasRestrictedCoreData) && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">
            {hasUnavailableCoreData
              ? "Some ONDC admin data is temporarily unavailable"
              : "Some ONDC admin data is restricted"}
          </p>
          <p className="mt-1">
            Unavailable mapping, category, product, or version feeds are held back instead of defaulting
            to empty ONDC forms or simulations.
          </p>
        </div>
      )}

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
            <Select
              id="ondc-category-id"
              name="categoryId"
              required
              defaultValue={categoryId}
              disabled={categoriesResult.state !== "available"}
            >
              <option value="" disabled>
                {categorySelectionMessage ?? "Select category"}
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
            {categorySelectionMessage ? <p className="text-xs text-slate-500">{categorySelectionMessage}</p> : null}
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
            <Select
              id="ondc-version"
              name="version"
              defaultValue={version}
              disabled={versionsResult.state !== "available"}
            >
              {versionsResult.state === "available" ? (
                versions.map((entry) => (
                  <option key={entry.version} value={entry.version}>
                    {entry.version} ({entry.status})
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  {versionSelectionMessage}
                </option>
              )}
            </Select>
            {versionSelectionMessage ? <p className="text-xs text-slate-500">{versionSelectionMessage}</p> : null}
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
          <Button type="submit" className="w-fit" disabled={mappingFormDisabled}>
            Save mapping
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>ONDC Mappings</CardTitle>
        {mappingTableMessage ? (
          <p className="text-sm text-slate-600">{mappingTableMessage}</p>
        ) : (
          <DataGrid columns={mappingColumns} rows={mappings} getRowKey={(mapping) => mapping.id} />
        )}
      </Card>

      <Card>
        <CardTitle>Simulate ONDC Payload</CardTitle>
        <form action={runOndcSimulationAction} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-product-id">
              Product
            </label>
            <Select
              id="ondc-sim-product-id"
              name="productId"
              required
              defaultValue={productId}
              disabled={productsResult.state !== "available"}
            >
              <option value="" disabled>
                {productSelectionMessage ?? "Select product"}
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
            {productSelectionMessage ? <p className="text-xs text-slate-500">{productSelectionMessage}</p> : null}
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
            <Select
              id="ondc-sim-version"
              name="version"
              defaultValue={version}
              disabled={versionsResult.state !== "available"}
            >
              {versionsResult.state === "available" ? (
                versions.map((entry) => (
                  <option key={entry.version} value={entry.version}>
                    {entry.version}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  {versionSelectionMessage}
                </option>
              )}
            </Select>
            {versionSelectionMessage ? <p className="text-xs text-slate-500">{versionSelectionMessage}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ondc-sim-mapping-id">
              Mapping
            </label>
            <Select
              id="ondc-sim-mapping-id"
              name="mappingId"
              defaultValue={mappingId}
              disabled={mappingsResult.state !== "available"}
            >
              {mappingsResult.state === "available" ? (
                <>
                  <option value="">Use default mapping</option>
                  {mappings.map((mapping) => (
                    <option key={mapping.id} value={mapping.id}>
                      {mapping.name}
                    </option>
                  ))}
                </>
              ) : (
                <option value="" disabled>
                  {mappingSelectionMessage}
                </option>
              )}
            </Select>
            {mappingSelectionMessage ? <p className="text-xs text-slate-500">{mappingSelectionMessage}</p> : null}
          </div>
          <Button type="submit" className="w-fit" disabled={simulationDisabled}>
            Run simulation
          </Button>
        </form>

        {simulationStateMessage ? <p className="mt-4 text-sm text-slate-600">{simulationStateMessage}</p> : null}
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

