import { NextRequest, NextResponse } from "next/server";
import { getMarketplaceSimulation, MarketplaceChannel, normalizeAppRole } from "@/lib/api";
import { summarizeSimulation } from "@/lib/channel-readiness";

function parseChannel(value: string | null): MarketplaceChannel | null {
  if (value === "amazon" || value === "flipkart" || value === "meesho") {
    return value;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const productId = String(params.get("productId") ?? "").trim();
  const templateId = String(params.get("templateId") ?? "").trim() || undefined;
  const channel = parseChannel(params.get("channel"));
  const role = normalizeAppRole(params.get("role"));

  if (!productId || !channel) {
    return NextResponse.json(
      {
        error: "productId and channel are required.",
      },
      { status: 400 },
    );
  }

  try {
    const simulation = await getMarketplaceSimulation(productId, channel, templateId, { role });
    const summary = summarizeSimulation(channel, simulation);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(
      {
        channel,
        status: "unknown",
        errorCount: 0,
        warningCount: 0,
      },
      { status: 200 },
    );
  }
}
