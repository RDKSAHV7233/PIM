import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "../../auth/public.decorator";
import { DEFAULT_TENANT_KEY } from "../../common/tenant/tenant.constants";
import { MetricsService } from "../../metrics/metrics.service";
import { verifyResendSignature } from "./resend-signature";

/**
 * Receiver for Resend delivery webhooks (Svix-signed).
 *
 * Auth email (signup verification, password reset, account unlock) is sent
 * fire-and-forget through a BullMQ job; a downstream Resend failure was only
 * ever logged. This endpoint closes the loop: every delivery lifecycle event
 * Resend emits is turned into a `auth.email.delivery` metric so bounce /
 * complaint / delay rates are observable and alertable.
 *
 * Route: POST /api/v1/webhooks/resend
 * - 200 + `{ received: true }` on success (including unrecognised event types)
 * - 401 on signature verification failure
 * - 503 when `RESEND_WEBHOOK_SECRET` is not configured (self-guards, no crash)
 */

const DELIVERY_EVENT_TYPES = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
]);
const WARN_EVENT_TYPES = new Set(["email.bounced", "email.complained"]);

interface ResendWebhookEvent {
  type?: string;
  created_at?: string;
  data?: {
    to?: string | string[];
    tags?: Array<{ name?: string; value?: string }> | Record<string, unknown>;
    [key: string]: unknown;
  };
}

function maskRecipient(recipient: string): string {
  const trimmed = String(recipient ?? "").trim();
  if (!trimmed) {
    return "***";
  }
  if (trimmed.includes("@")) {
    const [local, domain] = trimmed.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${trimmed.slice(0, 2)}***`;
}

@Controller("webhooks/resend")
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() request: Request,
    @Headers("svix-id") svixId: string,
    @Headers("svix-timestamp") svixTimestamp: string,
    @Headers("svix-signature") svixSignature: string,
  ): Promise<{ received: boolean }> {
    const secret = String(process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
    if (!secret) {
      this.logger.error("RESEND_WEBHOOK_SECRET not configured — Resend webhook cannot be verified");
      throw new ServiceUnavailableException("RESEND_WEBHOOK_SECRET not configured");
    }

    const rawBody: Buffer | string = Buffer.isBuffer(request.body)
      ? request.body
      : typeof request.body === "string"
        ? request.body
        : Buffer.from(JSON.stringify(request.body ?? "{}"));

    const verification = verifyResendSignature(
      rawBody,
      { svixId: svixId ?? "", svixTimestamp: svixTimestamp ?? "", svixSignature: svixSignature ?? "" },
      secret,
    );
    if (!verification.valid) {
      this.logger.warn(`Resend webhook signature rejected: ${verification.reason}`);
      throw new UnauthorizedException("Invalid Resend webhook signature");
    }

    let event: ResendWebhookEvent;
    try {
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
      event = JSON.parse(text) as ResendWebhookEvent;
    } catch {
      this.logger.warn("Resend webhook body was not valid JSON after signature check");
      return { received: true };
    }

    const type = String(event.type ?? "").trim();
    if (!DELIVERY_EVENT_TYPES.has(type)) {
      return { received: true };
    }

    const category = this.readCategory(event.data);
    await this.metricsService.emit({
      tenantKey: DEFAULT_TENANT_KEY,
      metricKey: "auth.email.delivery",
      metricValue: 1,
      tags: { event: type, category },
    });

    if (WARN_EVENT_TYPES.has(type)) {
      this.logger.warn(
        `Resend ${type} for auth email category=${category} recipient=${maskRecipient(this.readRecipient(event.data))}`,
      );
    }

    return { received: true };
  }

  private readCategory(data: ResendWebhookEvent["data"]): string {
    const tags = data?.tags;
    if (Array.isArray(tags)) {
      const match = tags.find((tag) => String(tag?.name ?? "").toLowerCase() === "category");
      const value = String(match?.value ?? "").trim();
      return value || "unknown";
    }
    if (tags && typeof tags === "object") {
      const value = String((tags as Record<string, unknown>).category ?? "").trim();
      return value || "unknown";
    }
    return "unknown";
  }

  private readRecipient(data: ResendWebhookEvent["data"]): string {
    const to = data?.to;
    if (Array.isArray(to)) {
      return String(to[0] ?? "");
    }
    return String(to ?? "");
  }
}
