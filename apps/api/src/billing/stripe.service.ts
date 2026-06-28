import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";

type StripeClient = InstanceType<typeof Stripe>;

const STRIPE_API_VERSION = Stripe.API_VERSION;
const PLAN_TIER_TO_PRICE_ID_ENV: Record<string, string> = {
  STARTER: "STRIPE_PRICE_ID_STARTER",
  GROWTH: "STRIPE_PRICE_ID_GROWTH",
  BUSINESS: "STRIPE_PRICE_ID_BUSINESS",
  ENTERPRISE: "STRIPE_PRICE_ID_ENTERPRISE",
};

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripeClient: StripeClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }
    const missingPriceIds: string[] = [];
    for (const [tier, envKey] of Object.entries(PLAN_TIER_TO_PRICE_ID_ENV)) {
      const value = String(process.env[envKey] ?? "").trim();
      if (!value) {
        missingPriceIds.push(`${tier} (${envKey})`);
      }
    }
    if (missingPriceIds.length > 0) {
      this.logger.warn(
        `Stripe billing is enabled but missing price IDs for: ${missingPriceIds.join(", ")}. ` +
          `Self-serve checkout will fail for these tiers. Set the env vars to fix.`,
      );
    }
  }

  isEnabled(): boolean {
    const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
    const flag = String(process.env.FEATURE_STRIPE_BILLING_ENABLED ?? "false").trim().toLowerCase();
    return flag === "true" && key.length > 0;
  }

  getClient(): StripeClient {
    if (!this.stripeClient) {
      const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
      if (!key) {
        throw new Error("STRIPE_SECRET_KEY_NOT_CONFIGURED");
      }
      this.stripeClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    }
    return this.stripeClient;
  }

  async createCustomerAndSubscription(input: {
    tenantKey: string;
    adminEmail: string;
    displayName: string;
    planTier?: string;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const planTier = String(input.planTier ?? "TRIAL").toUpperCase();
    if (planTier === "TRIAL") {
      return;
    }
    const tenantKey = normalizeTenantKey(input.tenantKey);
    try {
      const stripe = this.getClient();

      const existing = await this.getStoredIds(tenantKey);
      let customerId = existing.externalCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: input.adminEmail,
          name: input.displayName,
          metadata: { tenantKey },
        });
        customerId = customer.id;
      }

      const priceIdEnvKey = PLAN_TIER_TO_PRICE_ID_ENV[planTier] ?? PLAN_TIER_TO_PRICE_ID_ENV["STARTER"];
      const priceId = String(process.env[priceIdEnvKey] ?? "").trim();

      let subscriptionId = existing.externalSubscriptionId;

      if (!subscriptionId && priceId) {
        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId }],
          trial_period_days: Number(process.env.PIM_COMMERCIAL_TRIAL_DAYS ?? "14"),
          metadata: { tenantKey },
        });
        subscriptionId = subscription.id;
      }

      await this.storeExternalIds(tenantKey, customerId, subscriptionId ?? null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.warn(`Stripe customer/subscription creation failed for ${tenantKey}: ${message}`);
    }
  }

  async createCheckoutSession(input: {
    tenantKey: string;
    planTier: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const stripe = this.getClient();
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const planTier = String(input.planTier ?? "STARTER").toUpperCase();
    const priceIdEnvKey = PLAN_TIER_TO_PRICE_ID_ENV[planTier] ?? PLAN_TIER_TO_PRICE_ID_ENV["STARTER"];
    const priceId = String(process.env[priceIdEnvKey] ?? "").trim();
    if (!priceId) {
      throw new Error(`STRIPE_PRICE_ID_NOT_CONFIGURED_FOR_PLAN_${planTier}`);
    }

    const { externalCustomerId } = await this.getStoredIds(tenantKey);
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { tenantKey },
    };
    if (externalCustomerId) {
      sessionParams.customer = externalCustomerId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      throw new Error("STRIPE_CHECKOUT_SESSION_URL_MISSING");
    }
    return { url: session.url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.isEnabled() || !subscriptionId) {
      return;
    }
    try {
      await this.getClient().subscriptions.cancel(subscriptionId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.warn(`Stripe subscription cancellation failed for ${subscriptionId}: ${message}`);
    }
  }

  async updateSubscription(subscriptionId: string, planTier: string): Promise<void> {
    if (!this.isEnabled() || !subscriptionId) {
      return;
    }
    const tier = String(planTier ?? "STARTER").toUpperCase();
    const priceIdEnvKey = PLAN_TIER_TO_PRICE_ID_ENV[tier] ?? PLAN_TIER_TO_PRICE_ID_ENV["STARTER"];
    const priceId = String(process.env[priceIdEnvKey] ?? "").trim();
    if (!priceId) {
      this.logger.warn(`Cannot update Stripe subscription ${subscriptionId}: no price ID configured for ${tier}`);
      return;
    }
    try {
      const stripe = this.getClient();
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = subscription.items.data[0]?.id;
      if (!itemId) {
        return;
      }
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "always_invoice",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.warn(`Stripe subscription update failed for ${subscriptionId}: ${message}`);
    }
  }

  async resolveTenantKeyFromCustomerId(customerId: string): Promise<string | null> {
    const rows = await this.prisma.tenant().$queryRaw<{ tenantKey: string }[]>(Prisma.sql`
      SELECT "tenantKey" FROM "TenantPlanProfile"
      WHERE "externalCustomerId" = ${customerId}
      LIMIT 1
    `);
    return rows[0]?.tenantKey ?? null;
  }

  constructWebhookEvent(payload: Buffer | string, signature: string): ReturnType<StripeClient["webhooks"]["constructEvent"]> {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED");
    }
    return this.getClient().webhooks.constructEvent(payload, signature, secret);
  }

  private async getStoredIds(
    tenantKey: string,
  ): Promise<{ externalCustomerId: string | null; externalSubscriptionId: string | null }> {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<
      { externalCustomerId: string | null; externalSubscriptionId: string | null }[]
    >(Prisma.sql`
      SELECT "externalCustomerId", "externalSubscriptionId"
      FROM "TenantPlanProfile"
      WHERE "tenantKey" = ${tenantKey}
      LIMIT 1
    `);
    return rows[0] ?? { externalCustomerId: null, externalSubscriptionId: null };
  }

  async storeExternalIds(
    tenantKey: string,
    customerId: string | null,
    subscriptionId: string | null,
  ): Promise<void> {
    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      UPDATE "TenantPlanProfile"
      SET
        "externalCustomerId" = COALESCE(${customerId}, "externalCustomerId"),
        "externalSubscriptionId" = COALESCE(${subscriptionId}, "externalSubscriptionId"),
        "updatedAt" = NOW()
      WHERE "tenantKey" = ${tenantKey}
    `);
  }
}
