import { BadRequestException } from "@nestjs/common";

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

export function isMarketplaceChannel(value: string): value is MarketplaceChannel {
  return MARKETPLACE_CHANNELS.includes(value as MarketplaceChannel);
}

export function parseMarketplaceChannel(value: string): MarketplaceChannel {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (isMarketplaceChannel(normalized)) {
    return normalized;
  }
  throw new BadRequestException(
    `Unsupported channel. Allowed values: ${MARKETPLACE_CHANNELS.join(", ")}`,
  );
}

export function mapMarketplaceChannelToConnectorSlug(channelInput: string): string {
  const normalized = String(channelInput ?? "").trim().toLowerCase();
  if (isMarketplaceChannel(normalized)) {
    return MARKETPLACE_CHANNEL_TO_CONNECTOR_SLUG[normalized];
  }
  return normalized;
}

export function mapConnectorSlugToMarketplaceChannel(slugInput: string): MarketplaceChannel | null {
  const normalized = String(slugInput ?? "").trim().toLowerCase();
  return CONNECTOR_SLUG_TO_MARKETPLACE_CHANNEL[normalized] ?? null;
}
