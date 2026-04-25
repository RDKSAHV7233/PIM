export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho", "shopify"] as const;
export type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];

export const DEFAULT_MARKETPLACE_CHANNEL: MarketplaceChannel = "amazon";

const MARKETPLACE_CHANNEL_TO_CONNECTOR_SLUG: Record<MarketplaceChannel, string> = {
  amazon: "amazon-in",
  flipkart: "flipkart",
  meesho: "meesho",
  shopify: "shopify",
};

const CONNECTOR_SLUG_TO_MARKETPLACE_CHANNEL: Record<string, MarketplaceChannel> = {
  amazon: "amazon",
  "amazon-in": "amazon",
  flipkart: "flipkart",
  meesho: "meesho",
  shopify: "shopify",
};

export const MARKETPLACE_CHANNEL_LABELS: Record<MarketplaceChannel, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  meesho: "Meesho",
  shopify: "Shopify",
};

export function isMarketplaceChannel(value: unknown): value is MarketplaceChannel {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MARKETPLACE_CHANNELS.includes(normalized as MarketplaceChannel);
}

export function normalizeMarketplaceChannel(
  value: unknown,
  allowedChannels: readonly MarketplaceChannel[] = MARKETPLACE_CHANNELS,
  fallback: MarketplaceChannel = allowedChannels[0] ?? DEFAULT_MARKETPLACE_CHANNEL,
): MarketplaceChannel {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (allowedChannels.includes(normalized as MarketplaceChannel)) {
    return normalized as MarketplaceChannel;
  }
  return fallback;
}

export function mapMarketplaceChannelToConnectorSlug(channel: MarketplaceChannel): string {
  return MARKETPLACE_CHANNEL_TO_CONNECTOR_SLUG[channel];
}

export function mapConnectorSlugToMarketplaceChannel(slugInput: string): MarketplaceChannel | null {
  const normalized = String(slugInput ?? "").trim().toLowerCase();
  return CONNECTOR_SLUG_TO_MARKETPLACE_CHANNEL[normalized] ?? null;
}

export function formatMarketplaceChannelLabel(channel: MarketplaceChannel): string {
  return MARKETPLACE_CHANNEL_LABELS[channel];
}
