import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError } from "@/lib/api";
import { deleteProductRelationship } from "@/lib/api/catalog";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

interface RouteContext {
  params: Promise<{ relationshipId: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const { relationshipId } = await context.params;
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!relationshipId?.trim()) {
    return NextResponse.json({ error: "INVALID_RELATIONSHIP_ID" }, { status: 400 });
  }

  try {
    const result = await deleteProductRelationship(relationshipId, { authHeader });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json(
        error.body && typeof error.body === "object" ? error.body : { error: "relationship_delete_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "relationship_delete_failed" }, { status: 500 });
  }
}
