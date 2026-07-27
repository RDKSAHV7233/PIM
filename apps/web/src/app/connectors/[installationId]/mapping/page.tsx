import { notFound, redirect } from "next/navigation";
import {
  ApiHttpError,
  getConnectorMappingVersions,
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
import { getServerSession } from "@/lib/server-session";

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
  const { authHeader, actorRole } = await getServerSession();

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

    // If a live (published) mapping version already exists for this scope, land the operator
    // directly on the "review" step, where the version manager surfaces it — otherwise every
    // wizard open starts at "scope" and silently offers to build a mapping from nothing, even
    // when one already exists.
    if (product?.categoryId) {
      try {
        const versions = await getConnectorMappingVersions(
          installation.slug,
          { categoryScope: product.categoryId, installationId: installation.id },
          { role: actorRole, authHeader },
        );
        const hasLiveVersion = versions.some((version) => version.lifecycleState === "published");
        if (hasLiveVersion) {
          target.set("step", "review");
        }
      } catch {
        // Non-fatal: fall through to the wizard's default step if the version lookup fails.
      }
    }

    redirect(`/channels/mappings?${target.toString()}`);
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/connectors/${encodeURIComponent(installationId)}/mapping`, error));
    }
    redirect("/channels/mappings");
  }
}
