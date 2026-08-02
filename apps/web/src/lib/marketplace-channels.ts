export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho", "myntra", "shopify", "woocommerce"] as const;
export type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];

export const DEFAULT_MARKETPLACE_CHANNEL: MarketplaceChannel = "amazon";

const MARKETPLACE_CHANNEL_TO_CONNECTOR_SLUG: Record<MarketplaceChannel, string> = {
  amazon: "amazon-in",
  flipkart: "flipkart",
  meesho: "meesho",
  myntra: "myntra",
  shopify: "shopify",
  woocommerce: "woocommerce",
};

const CONNECTOR_SLUG_TO_MARKETPLACE_CHANNEL: Record<string, MarketplaceChannel> = {
  amazon: "amazon",
  "amazon-in": "amazon",
  flipkart: "flipkart",
  meesho: "meesho",
  myntra: "myntra",
  shopify: "shopify",
  woocommerce: "woocommerce",
};

export const MARKETPLACE_CHANNEL_LABELS: Record<MarketplaceChannel, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  meesho: "Meesho",
  myntra: "Myntra",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
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

// Channels whose connectors are present in source but not yet ready for customer use.
// Surfaces that show these channels must visibly mark them and disable destructive actions.
// WooCommerce: mapped meta_data execution exists (marketplace.service.ts), but there is no
// accessible WooCommerce tenant/store in this environment and no real end-to-end publish has
// been verified by a human — see vexa_pim_mapping_review.md, Increment 3.
const IN_DEVELOPMENT_CHANNELS = new Set<MarketplaceChannel>(["woocommerce"]);

export function isChannelInDevelopment(channel: MarketplaceChannel): boolean {
  return IN_DEVELOPMENT_CHANNELS.has(channel);
}

export const IN_DEVELOPMENT_CHANNEL_NOTICE =
  "This channel is in development. Export and publish are not available in the current release.";
