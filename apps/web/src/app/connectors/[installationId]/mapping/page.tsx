import { notFound, redirect } from "next/navigation";
import {
  ApiHttpError,
  getInstalledConnectors,
  getProduct,
  type MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  mapConnectorSlugToMarketplaceChannel,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type SearchParams = {
  productId?: string;
  channel?: MarketplaceChannel;
};

interface MappingManagerRedirectPageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<SearchParams>;
}

function normalizeChannel(channel: string | undefined, fallback: MarketplaceChannel | null): MarketplaceChannel {
  return normalizeMarketplaceChannel(channel, undefined, fallback ?? DEFAULT_MARKETPLACE_CHANNEL);
}

export default async function MappingManagerRedirectPage({
  params,
  searchParams,
}: MappingManagerRedirectPageProps) {
  const { installationId } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const installations = await getInstalledConnectors({ role: actorRole, authHeader });
    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const productId = String(query.productId ?? "").trim();
    const product = productId ? await getProduct(productId, { role: actorRole, authHeader }) : null;
    const target = new URLSearchParams();
    target.set(
      "channel",
      normalizeChannel(query.channel, mapConnectorSlugToMarketplaceChannel(installation.slug)),
    );
    target.set("installationId", installation.id);
    if (productId) {
      target.set("productId", productId);
    }
    if (product?.categoryId) {
      target.set("categoryId", product.categoryId);
    }

    redirect(`/channels/mappings?${target.toString()}`);
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/connectors/${encodeURIComponent(installationId)}/mapping`, error));
    }
    throw error;
  }
}
