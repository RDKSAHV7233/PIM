import { NextRequest } from "next/server";
import { forwardSignupRequest } from "../_shared";

export async function POST(request: NextRequest) {
  const body = await request.json();
  return forwardSignupRequest(request, "/signup/resend-verification", { method: "POST", body });
}
