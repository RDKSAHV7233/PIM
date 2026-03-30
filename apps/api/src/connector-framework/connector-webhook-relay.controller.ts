import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../auth/public.decorator";
import { ConnectorWebhookProcessingService } from "./connector-webhook-processing.service";

@Controller("connector-webhooks")
export class ConnectorWebhookRelayController {
  constructor(private readonly processingService: ConnectorWebhookProcessingService) {}

  @Public()
  @Post("relay/:tenantKey/installations/:installationId")
  @HttpCode(202)
  async relayWebhook(
    @Param("tenantKey") tenantKey: string,
    @Param("installationId") installationId: string,
    @Headers("x-pim-connector-relay-token") relayToken: string | undefined,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const expectedToken = String(process.env.PIM_CONNECTOR_WEBHOOK_RELAY_TOKEN ?? "").trim();
    if (!expectedToken || relayToken !== expectedToken) {
      throw new UnauthorizedException({ error: "CONNECTOR_WEBHOOK_RELAY_TOKEN_REQUIRED" });
    }

    const canonicalBody = this.serialiseRelayBody(body);
    await this.processingService.enqueue({
      tenantKey: String(tenantKey ?? "").trim(),
      installationId: String(installationId ?? "").trim(),
      rawBodyBase64: canonicalBody.toString("base64"),
      headers: this.normalizeHeaders(request.headers as Record<string, string | string[] | undefined>),
    });

    return {
      queued: true,
      tenantKey: String(tenantKey ?? "").trim(),
      installationId: String(installationId ?? "").trim(),
      adapter: "relay_http",
    };
  }

  private serialiseRelayBody(body: unknown): Buffer {
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (typeof body === "string") {
      return Buffer.from(body, "utf8");
    }
    return Buffer.from(JSON.stringify(body ?? {}), "utf8");
  }

  private normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (typeof value === "string") {
        normalized[key.toLowerCase()] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        normalized[key.toLowerCase()] = value.join(",");
      }
    }
    return normalized;
  }
}
