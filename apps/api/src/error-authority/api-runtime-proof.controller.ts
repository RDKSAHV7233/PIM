import { Controller, Headers, NotFoundException, Post, Req } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { requireInternalToken } from "../common/security/internal-token";

@Controller("error-authority")
export class ApiRuntimeProofController {
  @Public()
  @ApiExcludeEndpoint()
  @Post("runtime-proof/api")
  async triggerApiRuntimeProof(
    @Headers("x-error-authority-ingest-token") ingestToken: string | undefined,
    @Req() request: Request,
  ): Promise<never> {
    if (!isRuntimeProofAvailable()) {
      throw new NotFoundException({ error: "NOT_FOUND" });
    }

    await requireInternalToken({
      routeKey: "error_authority.api_runtime_proof",
      expectedToken: process.env.ERROR_AUTHORITY_INGEST_TOKEN,
      submittedToken: ingestToken,
      request,
      maxInvalidAttempts: 20,
    });

    const error = new Error("ERR_920_API_RUNTIME_PROOF");
    error.name = "Err920ApiRuntimeProof";
    throw error;
  }
}

function isRuntimeProofAvailable(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (appEnv === "production") {
    return false;
  }
  return String(process.env.ERROR_AUTHORITY_ENABLED ?? "").trim().toLowerCase() === "true";
}
