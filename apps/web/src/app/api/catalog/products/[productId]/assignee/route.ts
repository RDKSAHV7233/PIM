import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { assignProduct } from "@/lib/api/catalog";
import { resolveBearerToken, validateCsrf } from "../../../../_auth";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const { productId } = await context.params;
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!productId?.trim()) {
    return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }
  let body: { assigneeId: string | null };
  try {
    body = (await request.json()) as { assigneeId: string | null };
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  try {
    const result = await assignProduct(productId, body.assigneeId ?? null, { authHeader });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "assignee_update_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "assignee_update_failed" }, { status: 500 });
  }
}
