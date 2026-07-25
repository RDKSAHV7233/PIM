import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, getPriceLists } from "@/lib/api";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../_auth";

function pricingErrorResponse(error: unknown) {
  if (error instanceof ApiHttpError) {
    if (error.status === 401) {
      return NextResponse.json(
        { error: "AUTH_REQUIRED", message: "Your session expired. Sign in again to view pricing." },
        { status: 401 },
      );
    }
    if (error.status === 403) {
      return NextResponse.json(
        { error: "PRICING_RESTRICTED", message: "Your role cannot view pricing data." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "PRICING_UNAVAILABLE", message: "Pricing data could not be loaded right now." },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "PRICING_PROXY_FAILED", message: "Pricing data could not be loaded right now." },
    { status: 502 },
  );
}

export async function GET(request: NextRequest) {
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;

  try {
    const priceLists = await getPriceLists({ role, authHeader });
    return NextResponse.json(priceLists);
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}
