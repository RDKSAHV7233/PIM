import { redirect } from "next/navigation";
import { PricingSettingsContent } from "./_components/pricing-settings-content";
import { ApiHttpError, getCurrencies, getMarkets, getPriceLists } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  const { authHeader, actorRole } = await getServerSession();
  const canEdit = actorRole === "admin" || actorRole === "editor";
  const options = { role: actorRole, authHeader };

  try {
    const [markets, currencies, priceLists] = await Promise.all([
      getMarkets(options),
      getCurrencies(options),
      getPriceLists(options),
    ]);

    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Pricing Settings"
          description="Configure markets, currencies, and price lists used across your catalog and channel integrations."
          breadcrumb={
            <span>
              <a href="/admin" className="hover:underline">Admin</a>
              {" / "}
              Pricing
            </span>
          }
        />
        <PricingSettingsContent
          initialMarkets={markets}
          initialCurrencies={currencies}
          initialPriceLists={priceLists}
          canEdit={canEdit}
        />
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/settings/pricing", error));
    }
    throw error;
  }
}
