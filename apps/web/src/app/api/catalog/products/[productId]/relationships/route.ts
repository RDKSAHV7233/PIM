import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { getProductRelationships, createProductRelationship } from "@/lib/api/catalog";
import type { CreateRelationshipInput } from "@/lib/api/catalog";
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
    const data = await getProductRelationships(productId, { authHeader });
    return NextResponse.json(data);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "relationships_fetch_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "relationships_fetch_failed" }, { status: 500 });
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

  let body: CreateRelationshipInput;
  try {
    body = (await request.json()) as CreateRelationshipInput;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  if (!body.targetProductId || !body.type) {
    return NextResponse.json({ error: "targetProductId and type are required" }, { status: 400 });
  }

  try {
    const rel = await createProductRelationship(productId, body, { authHeader });
    return NextResponse.json(rel, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "relationship_create_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "relationship_create_failed" }, { status: 500 });
  }
}
