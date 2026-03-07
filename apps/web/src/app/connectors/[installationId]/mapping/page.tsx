import { notFound, redirect } from "next/navigation";
import {
  ApiHttpError,
  getInstalledConnectors,
  getProduct,
  type MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
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

function mapConnectorSlugToChannel(slugInput: string): MarketplaceChannel | null {
  const slug = String(slugInput ?? "").trim().toLowerCase();
  if (slug === "amazon-in") {
    return "amazon";
  }
  if (slug === "flipkart") {
    return "flipkart";
  }
  if (slug === "meesho") {
    return "meesho";
  }
  return null;
}

function normalizeChannel(channel: string | undefined, fallback: MarketplaceChannel | null): MarketplaceChannel {
  if (channel === "amazon" || channel === "flipkart" || channel === "meesho") {
    return channel;
  }
  return fallback ?? "amazon";
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
    target.set("channel", normalizeChannel(query.channel, mapConnectorSlugToChannel(installation.slug)));
    if (productId) {
      target.set("productId", productId);
    }
    if (product?.categoryId) {
      target.set("categoryId", product.categoryId);
    }

    redirect(`/channels/mappings?${target.toString()}`);
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/connectors/${encodeURIComponent(installationId)}/mapping`, error.status));
    }
    throw error;
  }
}
