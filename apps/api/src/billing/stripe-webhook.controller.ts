import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService } from "./plan-usage.service";
import { StripeService } from "./stripe.service";

const STRIPE_WEBHOOK_ACTOR = "stripe:webhook";
const GRACE_PERIOD_DAYS = 7;

type StripeEvent = ReturnType<StripeService["constructWebhookEvent"]>;

interface StripeInvoiceData {
  id: string;
  customer: string | { id: string } | null;
  lines?: { data: Array<{ period?: { end?: number } }> };
}

interface StripeSubscriptionData {
  id: string;
  customer: string | { id: string };
  status: string;
  current_period_end: number;
  items: { data: Array<{ id: string }> };
}

@Controller("billing/stripe")
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly planUsageService: PlanUsageService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
  ) {}

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() request: Request,
    @Headers("stripe-signature") signature: string,
  ): Promise<{ received: boolean }> {
    const rawBody: Buffer | string = Buffer.isBuffer(request.body)
      ? request.body
      : typeof request.body === "string"
        ? request.body
        : Buffer.from(JSON.stringify(request.body ?? "{}"));

    let event: StripeEvent;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature ?? "");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.warn(`Stripe webhook signature verification failed: ${message}`);
      return { received: false };
    }

    const reservation = await this.stripeService.reserveWebhookEvent(event.id, event.type);
    if (!reservation.accepted) {
      this.logger.log(`Stripe webhook duplicate skipped: event=${event.id} type=${event.type} reason=${reservation.reason ?? "duplicate"}`);
      return { received: true };
    }

    let tenantKey: string | null = null;
    try {
      tenantKey = await this.dispatch(event);
      await this.stripeService.markWebhookEventProcessed(event.id, tenantKey);
    } catch (error: unknown) {
      await this.stripeService.markWebhookEventFailed(event.id, error, tenantKey);
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Stripe webhook dispatch failed for event ${event.id} type=${event.type}: ${message}`);
      // Re-throw so Stripe sees HTTP 500 and retries — swallowing the error
      // would cause Stripe to mark the event as delivered even though billing
      // state was never updated.
      throw error;
    }

    return { received: true };
  }

  private async dispatch(event: StripeEvent): Promise<string | null> {
    const data = event.data.object as unknown;
    switch (event.type) {
      case "invoice.paid":
        return this.onInvoicePaid(data as StripeInvoiceData);
      case "invoice.payment_failed":
        return this.onInvoicePaymentFailed(data as StripeInvoiceData);
      case "customer.subscription.updated":
        return this.onSubscriptionUpdated(data as StripeSubscriptionData);
      case "customer.subscription.deleted":
        return this.onSubscriptionDeleted(data as StripeSubscriptionData);
      default:
        return null;
    }
  }

  private async onInvoicePaid(invoice: StripeInvoiceData): Promise<string | null> {
    const tenantKey = await this.resolveTenantKey(invoice);
    if (!tenantKey) {
      return null;
    }
    const paidThroughAt = this.resolveSubscriptionPeriodEnd(invoice);
    const profile = await this.planUsageService.updateCommercialStateForTenant(
      tenantKey,
      { billingStatus: "active_paid", paidThroughAt },
      STRIPE_WEBHOOK_ACTOR,
    );
    await this.commercialNotificationsService.notifyTenantAdmins({
      tenantKey,
      event: "tenant_billing_status_set",
      profile,
    });
    this.logger.log(`Stripe invoice.paid: tenantKey=${tenantKey} paidThroughAt=${paidThroughAt ?? "n/a"}`);
    return tenantKey;
  }

  private async onInvoicePaymentFailed(invoice: StripeInvoiceData): Promise<string | null> {
    const tenantKey = await this.resolveTenantKey(invoice);
    if (!tenantKey) {
      return null;
    }
    const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const profile = await this.planUsageService.updateCommercialStateForTenant(
      tenantKey,
      { billingStatus: "past_due", graceEndsAt },
      STRIPE_WEBHOOK_ACTOR,
    );
    await this.commercialNotificationsService.notifyPaymentFailed({ tenantKey, profile });
    this.logger.log(`Stripe invoice.payment_failed: tenantKey=${tenantKey} graceEndsAt=${graceEndsAt}`);
    return tenantKey;
  }

  private async onSubscriptionUpdated(subscription: StripeSubscriptionData): Promise<string | null> {
    const tenantKey = await this.resolveTenantKeyFromCustomer(subscription.customer);
    if (!tenantKey) {
      return null;
    }
    await this.stripeService.storeExternalIds(tenantKey, null, subscription.id);

    const billingStatus = this.mapStripeSubscriptionStatus(subscription.status);
    if (!billingStatus) {
      return tenantKey;
    }
    const paidThroughAt =
      subscription.status === "active" || subscription.status === "trialing"
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : undefined;

    await this.planUsageService.updateCommercialStateForTenant(
      tenantKey,
      { billingStatus, paidThroughAt },
      STRIPE_WEBHOOK_ACTOR,
    );
    this.logger.log(`Stripe customer.subscription.updated: tenantKey=${tenantKey} status=${subscription.status} -> billingStatus=${billingStatus}`);
    return tenantKey;
  }

  private async onSubscriptionDeleted(subscription: StripeSubscriptionData): Promise<string | null> {
    const tenantKey = await this.resolveTenantKeyFromCustomer(subscription.customer);
    if (!tenantKey) {
      return null;
    }
    const cancelledAt = new Date().toISOString();
    const profile = await this.planUsageService.updateCommercialStateForTenant(
      tenantKey,
      { billingStatus: "cancelled", cancelledAt },
      STRIPE_WEBHOOK_ACTOR,
    );
    await this.commercialNotificationsService.notifyTenantAdmins({
      tenantKey,
      event: "tenant_billing_status_set",
      profile,
    });
    this.logger.log(`Stripe customer.subscription.deleted: tenantKey=${tenantKey} cancelledAt=${cancelledAt}`);
    return tenantKey;
  }

  private async resolveTenantKey(invoice: StripeInvoiceData): Promise<string | null> {
    if (!invoice.customer) {
      this.logger.warn(`Stripe webhook: invoice ${invoice.id} has no customer`);
      return null;
    }
    return this.resolveTenantKeyFromCustomer(invoice.customer);
  }

  private async resolveTenantKeyFromCustomer(
    customer: string | { id: string },
  ): Promise<string | null> {
    const customerId = typeof customer === "string" ? customer : customer.id;
    const tenantKey = await this.stripeService.resolveTenantKeyFromCustomerId(customerId);
    if (!tenantKey) {
      this.logger.warn(`Stripe webhook: no tenant found for customer ${customerId}`);
      return null;
    }
    return tenantKey;
  }

  private resolveSubscriptionPeriodEnd(invoice: StripeInvoiceData): string | undefined {
    const lines = invoice.lines?.data ?? [];
    for (const line of lines) {
      if (line.period?.end) {
        return new Date(line.period.end * 1000).toISOString();
      }
    }
    return undefined;
  }

  private mapStripeSubscriptionStatus(status: string): string | null {
    switch (status) {
      case "active":
        return "active_paid";
      case "trialing":
        return "trial";
      case "past_due":
        return "past_due";
      case "canceled":
        return "cancelled";
      case "unpaid":
        return "past_due";
      default:
        return null;
    }
  }
}
