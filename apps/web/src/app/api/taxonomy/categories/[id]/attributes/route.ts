import { NextRequest, NextResponse } from "next/server";
import { getCategoryAttributes } from "@/lib/api";
import { resolveBearerToken } from "../../../../_auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const categoryId = String(id ?? "").trim();
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!categoryId) {
    return NextResponse.json({ error: "Category id is required." }, { status: 400 });
  }

  try {
    const attributes = await getCategoryAttributes(categoryId, { authHeader });
    return NextResponse.json(attributes);
  } catch {
    return NextResponse.json({ error: "Unable to load category attributes." }, { status: 500 });
  }
}
