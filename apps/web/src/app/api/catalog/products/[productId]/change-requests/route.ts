import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { getChangeRequests, createChangeRequest } from "@/lib/api/catalog";
import { resolveBearerToken, validateCsrf } from "../../../../_auth";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { productId } = await context.params;
  const authHeader = resolveBearerToken(request) ?? undefined;
  if (!productId?.trim()) {
    return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }
  try {
    const data = await getChangeRequests(productId, { authHeader });
    return NextResponse.json(data);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "change_requests_fetch_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "change_requests_fetch_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const { productId } = await context.params;
  const authHeader = resolveBearerToken(request) ?? undefined;
  if (!productId?.trim()) {
    return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }
  let body: { reason: string };
  try {
    body = (await request.json()) as { reason: string };
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  try {
    const result = await createChangeRequest(productId, body.reason, { authHeader });
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "change_request_create_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "change_request_create_failed" }, { status: 500 });
  }
}
