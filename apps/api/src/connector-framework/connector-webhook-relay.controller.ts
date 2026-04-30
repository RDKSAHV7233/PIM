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
import type { Request } from "express";
import { AuditService } from "../audit/audit.service";
import { Public } from "../auth/public.decorator";
import { requireInternalToken } from "../common/security/internal-token";
import { ConnectorWebhookProcessingService } from "./connector-webhook-processing.service";

@Controller("connector-webhooks")
export class ConnectorWebhookRelayController {
  constructor(
    private readonly processingService: ConnectorWebhookProcessingService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Post("relay/:tenantKey/installations/:installationId")
  @HttpCode(202)
  async relayWebhook(
    @Param("tenantKey") tenantKey: string,
    @Param("installationId") installationId: string,
    @Headers("x-pim-connector-relay-token") relayToken: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const expectedToken = String(process.env.PIM_CONNECTOR_WEBHOOK_RELAY_TOKEN ?? "").trim();
    const normalizedTenantKey = String(tenantKey ?? "").trim();
    const normalizedInstallationId = String(installationId ?? "").trim();
    try {
      await requireInternalToken({
        routeKey: "connector_webhooks.relay",
        expectedToken,
        submittedToken: relayToken,
        request,
        onFailure: (event) =>
          this.auditService.record({
            actorId: "internal-token",
            actorRole: "system",
            action: "CONNECTOR_WEBHOOK_RELAY_TOKEN_REJECTED",
            resource: "CONNECTOR_WEBHOOK_RELAY",
            resourceId: normalizedInstallationId || "unknown",
            tenantKey: normalizedTenantKey || undefined,
            metadata: {
              event: "connector_webhook_relay_token_rejected",
              routeKey: event.routeKey,
              reason: event.reason,
              remoteAddress: event.remoteAddress,
              retryAfterSeconds: event.retryAfterSeconds ?? null,
            },
          }),
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException({ error: "CONNECTOR_WEBHOOK_RELAY_TOKEN_REQUIRED" });
      }
      throw error;
    }

    const canonicalBody = this.serialiseRelayBody(body);
    await this.processingService.enqueue({
      tenantKey: normalizedTenantKey,
      installationId: normalizedInstallationId,
      rawBodyBase64: canonicalBody.toString("base64"),
      headers: this.normalizeHeaders(request.headers as Record<string, string | string[] | undefined>),
    });
    await this.auditService.record({
      actorId: "connector-webhook-relay",
      actorRole: "system",
      action: "CONNECTOR_WEBHOOK_RELAY_ACCEPTED",
      resource: "CONNECTOR_WEBHOOK_RELAY",
      resourceId: normalizedInstallationId,
      tenantKey: normalizedTenantKey,
      metadata: {
        event: "connector_webhook_relay_accepted",
        adapter: "relay_http",
      },
    });

    return {
      queued: true,
      tenantKey: normalizedTenantKey,
      installationId: normalizedInstallationId,
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
