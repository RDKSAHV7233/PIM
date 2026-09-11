import { NextRequest } from "next/server";
import { forwardSignupRequest } from "../_shared";

export async function POST(request: NextRequest) {
  const secPurpose = request.headers.get("sec-purpose") ?? "";
  if (secPurpose.toLowerCase().includes("prefetch")) {
    return new Response(null, { status: 204 });
  }
  const body = await request.json();
  return forwardSignupRequest(request, "/signup/verify", { method: "POST", body });
}
