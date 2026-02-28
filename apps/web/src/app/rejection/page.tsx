import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { getProducts, getRejectionIntelligenceScore, MarketplaceChannel, normalizeAppRole } from "@/lib/api";

export const dynamic = "force-dynamic";

interface RejectionPageProps {
  searchParams: Promise<{
    role?: string;
    productId?: string;
    channel?: MarketplaceChannel;
  }>;
}

export default async function RejectionPage({ searchParams }: RejectionPageProps) {
  const query = await searchParams;
  const actorRole = normalizeAppRole(query.role);
  const productId = String(query.productId ?? "").trim();
  const channel = (query.channel ?? "amazon") as MarketplaceChannel;
  const products = await getProducts({ role: actorRole });
  const score = productId
    ? await getRejectionIntelligenceScore(productId, channel, { role: actorRole })
    : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Phase 6: Rejection Intelligence</h1>
        <p className="text-sm text-slate-600">
          Heuristic rejection risk score, top patterns, and actionable fix suggestions.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={`/?role=${encodeURIComponent(actorRole)}`}>
          Dashboard
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/media?role=${encodeURIComponent(actorRole)}`}>
          Phase 5
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ondc?role=${encodeURIComponent(actorRole)}`}>
          Phase 7
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ai?role=${encodeURIComponent(actorRole)}`}>
          Phase 8
        </Link>
      </div>

      <Card>
        <CardTitle>Run Risk Score</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="role" value={actorRole} />
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
          <Select name="channel" defaultValue={channel}>
            <option value="amazon">amazon</option>
            <option value="flipkart">flipkart</option>
            <option value="meesho">meesho</option>
          </Select>
          <Button type="submit" className="w-fit">
            Evaluate
          </Button>
        </form>
      </Card>

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
