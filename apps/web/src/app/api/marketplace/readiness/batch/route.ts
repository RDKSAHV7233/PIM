import { NextRequest, NextResponse } from "next/server";
import type { MarketplaceChannel } from "@/lib/api";
import { postJson } from "@/lib/api";
import {
  buildUnknownReadiness,
  type ProductReadinessBatchResponse,
  READINESS_CHANNELS,
} from "@/lib/channel-readiness";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../../_auth";

function parseChannels(value: unknown): MarketplaceChannel[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...READINESS_CHANNELS];
  }

  const channels = value
    .filter((item): item is MarketplaceChannel => item === "amazon" || item === "flipkart" || item === "meesho");

  return channels.length > 0 ? channels : [...READINESS_CHANNELS];
}

function parseProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 250);
}

function unknownBatch(productIds: string[], channels: MarketplaceChannel[]): ProductReadinessBatchResponse {
  return {
    items: productIds.map((productId) => ({
      productId,
      readiness: channels.map((channel) => buildUnknownReadiness(channel)),
    })),
  };
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as
    | { productIds?: unknown; channels?: unknown }
    | null;
  const productIds = parseProductIds(payload?.productIds);
  const channels = parseChannels(payload?.channels);
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (productIds.length === 0) {
    return NextResponse.json(
      {
        error: "productIds is required.",
      },
      { status: 400 },
    );
  }

  try {
    const response = await postJson<ProductReadinessBatchResponse>(
      "/marketplace/readiness/batch",
      { productIds, channels },
      { role, authHeader },
    );
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(unknownBatch(productIds, channels), { status: 200 });
  }
}
