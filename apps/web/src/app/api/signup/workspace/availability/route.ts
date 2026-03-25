import { NextRequest } from "next/server";
import { forwardSignupRequest } from "../../_shared";

export async function GET(request: NextRequest) {
  const workspaceSlug = String(request.nextUrl.searchParams.get("workspaceSlug") ?? "").trim();
  const query = workspaceSlug ? `?workspaceSlug=${encodeURIComponent(workspaceSlug)}` : "";
  return forwardSignupRequest(request, `/signup/workspace/availability${query}`, { method: "GET" });
}
