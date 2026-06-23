import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { applyAiRepairAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";
import {
  ApiHttpError,
  AppRole,
  getAiAttributeEnrichment,
  getAiCategorySuggestion,
  getBillingPlanProfile,
  getProductList,
  getAiTitleSuggestion,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
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
  const { authHeader, actorRole } = await getServerSession();
  if (actorRole !== "admin" || process.env.APP_ENV === "production") {
    notFound();
  }

  try {
    const planProfile = await getBillingPlanProfile({ role: actorRole, authHeader });
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();
    if (planTier === "TRIAL" || planTier === "STARTER") {
      return (
        <div className="space-y-5">
          <PageHeader
            title="AI Labs"
            description="Experimental enrichment tools for catalog operators."
            breadcrumb={<>Dashboard / <span className="font-semibold text-slate-700">AI Labs</span></>}
          />
          <Card>
            <CardTitle>Growth Plan Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              AI enrichment tools are available on the Growth plan and above. These features are
              experimental and intended for internal evaluation — not for production catalog
              operations.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/plan"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                View Plan &amp; Upgrade
              </Link>
            </div>
          </Card>
        </div>
      );
    }
  } catch {
    notFound();
  }

  const productId = String(query.productId ?? "").trim();
  const repairStatus = String(query.repairStatus ?? "").trim();

  let products: Awaited<ReturnType<typeof getProductList>>;
  try {
    products = await getProductList({ slim: true }, { role: actorRole, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/ai", error));
    }
    products = [];
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
        <h1 className="text-2xl font-semibold">Smart Suggestions</h1>
        <p className="text-sm text-slate-600">
          Rule-based title suggestions, attribute suggestions, category suggestions, and repair guidance.
        </p>
      </header>

      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Labs — Experimental.</strong> This feature is under active development and is not available to workspace users. Results are rule-based only and should not be presented as AI-powered enrichment. Not for production catalogues.
      </div>

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
          Suggested repair applied successfully.
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
            <CardTitle>Suggested Title Optimization</CardTitle>
            <p className="text-sm">
              <strong>Original:</strong> {titleSuggestion.originalTitle}
            </p>
            <p className="text-sm">
              <strong>Suggested:</strong> {titleSuggestion.optimizedTitle}
            </p>
            <p className="text-xs text-slate-500">Confidence: {titleSuggestion.confidence}</p>
          </Card>

          <Card>
            <CardTitle>Rule-based Attribute Suggestions</CardTitle>
            <div className="grid gap-3 lg:grid-cols-2">
              <JsonPreview value={JSON.stringify(attributeSuggestion.existingAttributes, null, 2)} className="border-border" />
              <JsonPreview value={JSON.stringify(attributeSuggestion.suggestedAttributes, null, 2)} className="border-border" />
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
            <CardTitle>Suggested Catalog Repair</CardTitle>
            <form action={applyAiRepairAction} className="space-y-2">
              <RoleHiddenInput role={actorRole} />
              <input type="hidden" name="productId" value={productId} />
              <Button type="submit">Apply suggested repair</Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}

