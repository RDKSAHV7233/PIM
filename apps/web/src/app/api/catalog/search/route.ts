import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, searchCatalogProducts } from "@/lib/api";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request) ?? undefined;
  const query = String(request.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "8");

  if (!query) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchCatalogProducts({ q: query, limit }, { authHeader });
    return NextResponse.json(results);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json({ error: "catalog_search_failed", message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "catalog_search_failed" }, { status: 500 });
  }
}
