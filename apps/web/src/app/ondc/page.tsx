import Link from "next/link";
import { createOndcMappingAction, runOndcSimulationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AppRole,
  getCategories,
  getOndcMappings,
  getOndcSimulation,
  getOndcVersions,
  getProducts,
  normalizeAppRole,
} from "@/lib/api";

export const dynamic = "force-dynamic";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

interface OndcPageProps {
  searchParams: Promise<{
    role?: string;
    nodeType?: string;
    version?: string;
    categoryId?: string;
    productId?: string;
    mappingId?: string;
  }>;
}

export default async function OndcPage({ searchParams }: OndcPageProps) {
  const query = await searchParams;
  const actorRole = normalizeAppRole(query.role);
  const nodeType = String(query.nodeType ?? "seller_app").trim();
  const version = String(query.version ?? "1.2.0").trim();
  const categoryId = String(query.categoryId ?? "").trim();
  const productId = String(query.productId ?? "").trim();
  const mappingId = String(query.mappingId ?? "").trim();

  const [categories, products, versions, mappings] = await Promise.all([
    getCategories({ role: actorRole }),
    getProducts({ role: actorRole }),
    getOndcVersions({ role: actorRole }),
    getOndcMappings(
      {
        nodeType: nodeType || undefined,
        version: version || undefined,
        categoryId: categoryId || undefined,
      },
      { role: actorRole },
    ),
  ]);

  const simulation =
    productId && nodeType && version
      ? await getOndcSimulation(productId, nodeType, version, mappingId || undefined, {
          role: actorRole,
        }).catch(() => null)
      : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Phase 7: ONDC Native Expansion</h1>
        <p className="text-sm text-slate-600">
          Node-specific mappings, discovery metadata, and protocol-version simulation.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={`/?role=${encodeURIComponent(actorRole)}`}>
          Dashboard
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/media?role=${encodeURIComponent(actorRole)}`}>
          Phase 5
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/rejection?role=${encodeURIComponent(actorRole)}`}>
          Phase 6
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ai?role=${encodeURIComponent(actorRole)}`}>
          Phase 8
        </Link>
      </div>

      <Card>
        <CardTitle>Create ONDC Mapping</CardTitle>
        <form action={createOndcMappingAction} className="grid gap-3 md:grid-cols-2">
          <RoleHiddenInput role={actorRole} />
          <Input name="name" placeholder="Mapping name" required />
          <Select name="categoryId" required defaultValue={categoryId}>
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
          <Select name="nodeType" defaultValue={nodeType}>
            <option value="seller_app">seller_app</option>
            <option value="buyer_app">buyer_app</option>
            <option value="gateway">gateway</option>
            <option value="logistics">logistics</option>
          </Select>
          <Select name="version" defaultValue={version}>
            {versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version} ({entry.status})
              </option>
            ))}
          </Select>
          <Textarea
            name="requiredFields"
            rows={3}
            className="md:col-span-2"
            defaultValue='["title","brand","hsnCode","gstRate","attributes.color"]'
            placeholder='["title","brand"]'
          />
          <Textarea
            name="fieldMap"
            rows={4}
            className="md:col-span-2"
            defaultValue='{"title":"descriptor.name","brand":"descriptor.brand","hsnCode":"item.hsn_code"}'
            placeholder='{"title":"descriptor.name"}'
          />
          <Textarea
            name="discoveryMetadata"
            rows={3}
            className="md:col-span-2"
            defaultValue='{"domain":"ONDC:RET10","ttl":"P1D"}'
            placeholder='{"domain":"ONDC:RET10"}'
          />
          <Select name="isDefault" defaultValue="false">
            <option value="false">non-default</option>
            <option value="true">default</option>
          </Select>
          <Button type="submit" className="w-fit">
            Save mapping
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>ONDC Mappings</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Node</th>
                <th className="py-2">Version</th>
                <th className="py-2">Category</th>
                <th className="py-2">Required</th>
                <th className="py-2">Default</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id} className="border-t border-border">
                  <td className="py-2">{mapping.name}</td>
                  <td className="py-2">{mapping.nodeType}</td>
                  <td className="py-2">{mapping.version}</td>
                  <td className="py-2">{mapping.categoryId}</td>
                  <td className="py-2">{mapping.requiredFields.length}</td>
                  <td className="py-2">{mapping.isDefault ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Simulate ONDC Payload</CardTitle>
        <form action={runOndcSimulationAction} className="grid gap-3 md:grid-cols-2">
          <RoleHiddenInput role={actorRole} />
          <Select name="productId" required defaultValue={productId}>
            <option value="" disabled>
              Select product
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title}
              </option>
            ))}
          </Select>
          <Select name="nodeType" defaultValue={nodeType}>
            <option value="seller_app">seller_app</option>
            <option value="buyer_app">buyer_app</option>
            <option value="gateway">gateway</option>
            <option value="logistics">logistics</option>
          </Select>
          <Select name="version" defaultValue={version}>
            {versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
              </option>
            ))}
          </Select>
          <Select name="mappingId" defaultValue={mappingId}>
            <option value="">Use default mapping</option>
            {mappings.map((mapping) => (
              <option key={mapping.id} value={mapping.id}>
                {mapping.name}
              </option>
            ))}
          </Select>
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
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs">
              {JSON.stringify(simulation.payload, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
