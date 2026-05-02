import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, getMarketplaceSimulation, MarketplaceChannel } from "@/lib/api";
import { READINESS_CHANNELS, summarizeSimulation } from "@/lib/channel-readiness";
import { isMarketplaceChannel } from "@/lib/marketplace-channels";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../_auth";

function parseChannel(value: string | null): MarketplaceChannel | null {
  if (!isMarketplaceChannel(value)) {
    return null;
  }
  return READINESS_CHANNELS.includes(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const productId = String(params.get("productId") ?? "").trim();
  const templateId = String(params.get("templateId") ?? "").trim() || undefined;
  const channel = parseChannel(params.get("channel"));
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!productId || !channel) {
    return NextResponse.json(
      {
        error: "productId and channel are required.",
      },
      { status: 400 },
    );
  }

  try {
    const simulation = await getMarketplaceSimulation(productId, channel, templateId, {
      role,
      authHeader,
    });
    const summary = summarizeSimulation(channel, simulation);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        {
          channel,
          status: "unknown",
          error: "READINESS_UPSTREAM_FAILED",
          details: error.body,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        channel,
        status: "unknown",
        error: "READINESS_PROXY_FAILED",
        errorCount: 0,
        warningCount: 0,
      },
      { status: 502 },
    );
  }
}
