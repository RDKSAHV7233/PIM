import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, previewShopifyProductChanges } from "@/lib/api";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../_auth";

export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const installationId = String(params.get("installationId") ?? "").trim();
  const productId = String(params.get("productId") ?? "").trim();
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;

  if (!installationId || !productId) {
    return NextResponse.json({ error: "installationId and productId are required." }, { status: 400 });
  }

  try {
    const preview = await previewShopifyProductChanges(installationId, productId, { role, authHeader });
    return NextResponse.json({
      ...preview,
      resolvedInstallationId: preview.resolvedInstallationId ?? installationId,
    });
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json({ error: "PREVIEW_UPSTREAM_FAILED" }, { status: error.status });
    }
    return NextResponse.json({ error: "PREVIEW_PROXY_FAILED" }, { status: 502 });
  }
}
