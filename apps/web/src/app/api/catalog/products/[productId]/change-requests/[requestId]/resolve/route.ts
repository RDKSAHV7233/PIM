import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { resolveChangeRequest } from "@/lib/api/catalog";
import { resolveBearerToken, validateCsrf } from "../../../../../../_auth";

interface RouteContext {
  params: Promise<{ productId: string; requestId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const { productId, requestId } = await context.params;
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!productId?.trim() || !requestId?.trim()) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }
  try {
    const result = await resolveChangeRequest(productId, requestId, { authHeader });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "resolve_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }
}
