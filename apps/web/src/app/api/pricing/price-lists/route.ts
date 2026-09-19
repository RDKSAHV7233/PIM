import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, getPriceLists } from "@/lib/api";
import { createPriceList, type CreatePriceListDto } from "@/lib/api/pricing";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken, validateCsrf } from "../../_auth";

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

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const dto = (await request.json().catch(() => null)) as CreatePriceListDto | null;
  if (!dto) {
    return NextResponse.json({ error: "INVALID_BODY", message: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const priceList = await createPriceList(dto, { role, authHeader });
    return NextResponse.json(priceList);
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}
