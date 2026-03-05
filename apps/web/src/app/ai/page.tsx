import Link from "next/link";
import { redirect } from "next/navigation";
import { applyAiRepairAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  ApiHttpError,
  AppRole,
  getAiAttributeEnrichment,
  getAiCategorySuggestion,
  getAiTitleSuggestion,
  getProducts,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

interface AiPageProps {
  searchParams: Promise<{    productId?: string;
    repairStatus?: string;
  }>;
}

export default async function AiPage({ searchParams }: AiPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = actorRole !== "viewer";
  const productId = String(query.productId ?? "").trim();
  const repairStatus = String(query.repairStatus ?? "").trim();

  let products: Awaited<ReturnType<typeof getProducts>>;
  try {
    products = await getProducts({ role: actorRole, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/ai", error.status));
    }
    throw error;
  }
  const filteredProducts = filterTestData(products, true);
  const [titleSuggestion, attributeSuggestion, categorySuggestion] = productId
    ? await Promise.all([
        getAiTitleSuggestion(productId, { role: actorRole, authHeader }),
        getAiAttributeEnrichment(productId, { role: actorRole, authHeader }),
        getAiCategorySuggestion(productId, { role: actorRole, authHeader }),
      ])
    : [null, null, null];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">AI Optimization</h1>
        <p className="text-sm text-slate-600">
          Title optimization, attribute enrichment, smart category suggestion, and repair automation.
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
        <Link className="rounded-md border border-border px-3 py-2" href={`/ondc`}>
          ONDC Expansion
        </Link>
      </div>

      {repairStatus === "applied" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          AI repair automation applied successfully.
        </div>
      )}

      <Card>
        <CardTitle>Select Product</CardTitle>
        <form method="get" className="flex max-w-xl items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="ai-product-id">
              Product
            </label>
            <Select id="ai-product-id" name="productId" required defaultValue={productId}>
              <option value="" disabled>
                Select product
              </option>
              {filteredProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">Analyze</Button>
        </form>
      </Card>

      {productId && titleSuggestion && attributeSuggestion && categorySuggestion && (
        <>
          <Card>
            <CardTitle>AI Title Optimization</CardTitle>
            <p className="text-sm">
              <strong>Original:</strong> {titleSuggestion.originalTitle}
            </p>
            <p className="text-sm">
              <strong>Suggested:</strong> {titleSuggestion.optimizedTitle}
            </p>
            <p className="text-xs text-slate-500">Confidence: {titleSuggestion.confidence}</p>
          </Card>

          <Card>
            <CardTitle>AI Attribute Enrichment</CardTitle>
            <div className="grid gap-3 lg:grid-cols-2">
              <pre className="overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs">
                {JSON.stringify(attributeSuggestion.existingAttributes, null, 2)}
              </pre>
              <pre className="overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs">
                {JSON.stringify(attributeSuggestion.suggestedAttributes, null, 2)}
              </pre>
            </div>
            <p className="mt-2 text-xs text-slate-500">Confidence: {attributeSuggestion.confidence}</p>
          </Card>

          <Card>
            <CardTitle>Smart Categorization</CardTitle>
            <p className="text-sm">
              Suggested category: <strong>{categorySuggestion.suggestedCategoryPath ?? categorySuggestion.suggestedCategoryId}</strong>
            </p>
            <p className="text-xs text-slate-500">Confidence: {categorySuggestion.confidence}</p>
          </Card>

          <Card>
            <CardTitle>Catalog Repair Automation</CardTitle>
            {canWrite ? (
              <form action={applyAiRepairAction} className="space-y-2">
                <RoleHiddenInput role={actorRole} />
                <input type="hidden" name="productId" value={productId} />
                <Button type="submit">Apply AI repair</Button>
              </form>
            ) : (
              <p className="text-sm text-slate-600">Viewer role is read-only.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

