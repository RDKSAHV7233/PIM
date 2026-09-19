import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { deletePriceList, updatePriceList, type UpdatePriceListDto } from "@/lib/api/pricing";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

interface RouteContext {
  params: Promise<{
    priceListId: string;
  }>;
}

function pricingErrorResponse(error: unknown) {
  if (error instanceof ApiHttpError) {
    if (error.status === 401) {
      return NextResponse.json(
        { error: "AUTH_REQUIRED", message: "Your session expired. Sign in again to manage pricing." },
        { status: 401 },
      );
    }
    if (error.status === 403) {
      return NextResponse.json(
        { error: "PRICING_RESTRICTED", message: "Your role cannot manage pricing data." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "PRICING_UNAVAILABLE", message: error.message || "Pricing data could not be saved right now." },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "PRICING_PROXY_FAILED", message: "Pricing data could not be saved right now." },
    { status: 502 },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const { priceListId } = await context.params;
  const dto = (await request.json().catch(() => null)) as UpdatePriceListDto | null;
  if (!dto) {
    return NextResponse.json({ error: "INVALID_BODY", message: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const priceList = await updatePriceList(priceListId, dto, { role, authHeader });
    return NextResponse.json(priceList);
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const { priceListId } = await context.params;

  try {
    await deletePriceList(priceListId, { role, authHeader });
    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    return pricingErrorResponse(error);
  }
}
