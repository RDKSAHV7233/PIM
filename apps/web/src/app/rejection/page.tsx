import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import {
  ApiHttpError,
  getProducts,
  getRejectionIntelligenceScore,
  MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface RejectionPageProps {
  searchParams: Promise<{    productId?: string;
    channel?: MarketplaceChannel;
  }>;
}

export default async function RejectionPage({ searchParams }: RejectionPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const productId = String(query.productId ?? "").trim();
  const channel = (query.channel ?? "amazon") as MarketplaceChannel;
  let products: Awaited<ReturnType<typeof getProducts>>;
  try {
    products = await getProducts({ role: actorRole, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/rejection", error.status));
    }
    throw error;
  }
  const filteredProducts = filterTestData(products, true);
  const score = productId
    ? await getRejectionIntelligenceScore(productId, channel, { role: actorRole, authHeader })
    : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Rejection Intelligence</h1>
        <p className="text-sm text-slate-600">
          Heuristic rejection risk score, top patterns, and actionable fix suggestions.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={`/`}>
          Dashboard
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/media`}>
          Media Validation
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ondc`}>
          ONDC Expansion
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ai`}>
          AI Optimization
        </Link>
      </div>

      <Card>
        <CardTitle>Run Risk Score</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="rejection-product-id">
              Product
            </label>
            <Select id="rejection-product-id" name="productId" required defaultValue={productId}>
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
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="rejection-channel">
              Channel
            </label>
            <Select id="rejection-channel" name="channel" defaultValue={channel}>
              <option value="amazon">amazon</option>
              <option value="flipkart">flipkart</option>
              <option value="meesho">meesho</option>
            </Select>
          </div>
          <Button type="submit" className="w-fit">
            Evaluate
          </Button>
        </form>
      </Card>

      {!productId && (
        <EmptyState
          icon="RADAR"
          title="Select a product to check channel readiness"
          description="Open any product and use the Channel Readiness section to check if it is ready for Amazon, Flipkart, or Meesho."
          action={{ label: "Go to product list", href: `/` }}
        />
      )}

      {score && (
        <Card>
          <CardTitle>Risk Result</CardTitle>
          <div className="space-y-3 text-sm">
            <p>
              Product: <strong>{score.productId}</strong> | Channel: <strong>{score.channel}</strong>
            </p>
            <p>
              Risk Score: <strong>{score.riskScore}</strong> ({score.riskBand})
            </p>
            <p>
              Missing fields: {score.summary.missingCoreFields.length} | Compliance errors:{" "}
              {score.summary.complianceErrors} | Media issues: {score.summary.mediaIssueCount}
            </p>
            <div>
              <p className="font-medium">Top patterns</p>
              <ul className="list-disc pl-5">
                {score.topPatterns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Fix suggestions</p>
              <ul className="list-disc pl-5">
                {score.suggestions.map((item) => (
                  <li key={`${item.field}-${item.suggestion}`}>{item.suggestion}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

