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
    // revalidateSeconds: 60 caches the upstream fetch in the Next.js Data Cache.
    const attributes = await getCategoryAttributes(categoryId, { authHeader, revalidateSeconds: 60 });
    return NextResponse.json(attributes, {
      headers: {
        // private: user-scoped tenant data; max-age=60 lets the browser skip repeated fetches.
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load category attributes." }, { status: 500 });
  }
}
