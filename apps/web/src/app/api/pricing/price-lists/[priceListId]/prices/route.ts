import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { getPriceListPrices, upsertPriceListPrices } from "@/lib/api/pricing";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken, validateCsrf } from "../../../../_auth";

interface RouteContext {
  params: Promise<{
    priceListId: string;
  }>;
}

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
        { error: "PRICING_RESTRICTED", message: "Your role cannot update pricing data." },
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

function parsePrices(value: unknown): Array<{ variantId: string; mrp?: number | null; sellingPrice?: number | null }> {
  if (!value || typeof value !== "object" || !Array.isArray((value as { prices?: unknown }).prices)) {
    return [];
  }
  return (value as { prices: unknown[] }).prices
    .filter((price): price is Record<string, unknown> => Boolean(price) && typeof price === "object")
    .map((price) => ({
      variantId: String(price.variantId ?? "").trim(),
      mrp: price.mrp === null || typeof price.mrp === "number" ? price.mrp : undefined,
      sellingPrice:
        price.sellingPrice === null || typeof price.sellingPrice === "number"
          ? price.sellingPrice
          : undefined,
    }))
    .filter((price) => price.variantId.length > 0);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const { priceListId } = await context.params;

  try {
    const prices = await getPriceListPrices(priceListId, { role, authHeader });
    return NextResponse.json(prices);
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const { priceListId } = await context.params;
  const body = await request.json().catch(() => null);
  const prices = parsePrices(body);

  try {
    const result = await upsertPriceListPrices(priceListId, prices, { role, authHeader });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}
