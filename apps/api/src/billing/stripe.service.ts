import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";

type StripeClient = InstanceType<typeof Stripe>;

export const STRIPE_API_VERSION = "2026-05-27.dahlia";
const STRIPE_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const STRIPE_WEBHOOK_ERROR_LIMIT = 1_000;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaDirect: PrismaDirectService,
  ) {}

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
    idempotencyKey?: string;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const planTier = String(input.planTier ?? "TRIAL").toUpperCase();
    if (planTier === "TRIAL") {
      return;
    }
    const tenantKey = normalizeTenantKey(input.tenantKey);
    // Idempotency (H-3): running provisioning twice — e.g. a retry after a Stripe
    // timeout — must yield exactly one customer + one subscription. Stripe de-dupes
    // create calls that carry the same idempotency key; we also short-circuit once
    // both ids are already persisted so a retry becomes a no-op.
    const idempotencyKey = String(input.idempotencyKey ?? `signup-trial:${tenantKey}`).trim();
    try {
      const stripe = this.getClient();

      const existing = await this.getStoredIds(tenantKey);
      if (existing.externalCustomerId && existing.externalSubscriptionId) {
        return;
      }
      let customerId = existing.externalCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create(
          {
            email: input.adminEmail,
            name: input.displayName,
            metadata: { tenantKey },
          },
          { idempotencyKey: `${idempotencyKey}:customer` },
        );
        customerId = customer.id;
      }

      const priceIdEnvKey = PLAN_TIER_TO_PRICE_ID_ENV[planTier] ?? PLAN_TIER_TO_PRICE_ID_ENV["STARTER"];
      const priceId = String(process.env[priceIdEnvKey] ?? "").trim();

      let subscriptionId = existing.externalSubscriptionId;

      if (!subscriptionId && priceId) {
        const subscription = await stripe.subscriptions.create(
          {
            customer: customerId,
            items: [{ price: priceId }],
            trial_period_days: Number(process.env.PIM_COMMERCIAL_TRIAL_DAYS ?? "90"),
            metadata: { tenantKey },
          },
          { idempotencyKey: `${idempotencyKey}:subscription` },
        );
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

  /**
   * Which tenant owns a Stripe customer id. Called from webhook handling before any tenant context is known.
   *
   * SEC-DB-RLS-001: TenantPlanProfile is tenant-keyed and row-level-secured. A single lookup with no tenant context sees only the
   * default tenant's profile under a restricted role, so every other tenant's invoice and subscription events would resolve to
   * "no tenant" and be acknowledged without updating billing state. The lookup is therefore taken per tenant (forEachTenant: one
   * short transaction per tenant, tenant context set inside it, the query also filtered by that tenant) and the match is the tenant
   * whose profile carries the id.
   *
   * - Exactly one match: that tenant. More than one is a data fault and throws (never pick one).
   * - No match while every tenant was readable: null (an unknown customer), as before.
   * - No match while some tenant could not be read: throws, so the webhook fails (HTTP 500) and Stripe retries; an unreadable tenant
   *   must never turn into "no tenant found".
   * Limit: a tenant with a profile but no directory row is not covered by the iteration; the previous context-free lookup is kept
   * as a last, best-effort step so today's deployment (whose role bypasses row level security) still finds such a tenant.
   */
  async resolveTenantKeyFromCustomerId(customerId: string): Promise<string | null> {
    const id = String(customerId ?? "").trim();
    if (!id) {
      return null;
    }
    const matches: string[] = [];
    const summary = await forEachTenant(
      this.prismaDirect.getClient(),
      async (tx, tenantKey) => {
        // RLS-BYPASS: manual tenant filter — "tenantKey" = ${tenantKey} on a transaction whose tenant context is that tenant.
        const rows = await tx.$queryRaw<{ tenantKey: string }[]>(Prisma.sql`
          SELECT "tenantKey" FROM "TenantPlanProfile"
          WHERE "tenantKey" = ${tenantKey} AND "externalCustomerId" = ${id}
          LIMIT 1
        `);
        const own = rows.filter((row) => row.tenantKey === tenantKey);
        if (own.length > 0) {
          matches.push(tenantKey);
        }
        return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
      },
      { timeoutMs: 3_000 },
    );
    if (matches.length > 1) {
      throw new Error(`STRIPE_CUSTOMER_TENANT_AMBIGUOUS ${matches.length} tenants carry the same customer id`);
    }
    if (matches.length === 1) {
      return matches[0];
    }
    if (summary.tenantsFailed > 0) {
      const failures = summary.results.filter((result) => result.status === "failed").map((result) => `${result.tenantKey}:${result.errorCode ?? "UNKNOWN"}`);
      throw new Error(`STRIPE_CUSTOMER_TENANT_READ_FAILED ${summary.tenantsFailed}/${summary.tenantsEvaluated} [${failures.join(", ")}]`);
    }
    try {
      // RLS-BYPASS: best-effort last step for a tenant with a profile but no directory row; correctness for directory tenants does not
      // depend on it, and under a restricted role it sees the default tenant only (already covered above) and adds nothing.
      const rows = await this.prisma.tenant().$queryRaw<{ tenantKey: string }[]>(Prisma.sql`
        SELECT "tenantKey" FROM "TenantPlanProfile"
        WHERE "externalCustomerId" = ${id}
        LIMIT 1
      `);
      return rows[0]?.tenantKey ?? null;
    } catch {
      return null;
    }
  }

  constructWebhookEvent(payload: Buffer | string, signature: string): ReturnType<StripeClient["webhooks"]["constructEvent"]> {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED");
    }
    return this.getClient().webhooks.constructEvent(payload, signature, secret);
  }

  async reserveWebhookEvent(eventId: string, eventType: string): Promise<{ accepted: boolean; reason?: "processed" | "in_progress" }> {
    const normalizedEventId = String(eventId ?? "").trim();
    const normalizedEventType = String(eventType ?? "").trim() || "unknown";
    if (!normalizedEventId) {
      throw new Error("STRIPE_WEBHOOK_EVENT_ID_MISSING");
    }
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + STRIPE_WEBHOOK_PROCESSING_LEASE_MS);
    // RLS-BYPASS: intentional cross-tenant — stripe_webhook_events is keyed on
    // Stripe's own globally-unique external_event_id, not per-tenant, and this
    // whole reservation step runs *before* the event's tenant is even determined
    // (a webhook can arrive for a customer this process hasn't resolved yet).
    return this.prisma.tenant().$transaction(async (tx) => {
      // pg_advisory_xact_lock() returns SQL void, which @prisma/client's queryRaw
      // cannot deserialize ("Failed to deserialize column of type 'void'"). Use
      // executeRaw, which discards the result set, to take the lock.
      // RLS-BYPASS: advisory lock, not a tenant-table query — no rows read or written.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedEventId}, 0)::bigint)`);
      // RLS-BYPASS: intentional cross-tenant — see reserveWebhookEvent's comment above;
      // stripe_webhook_events is keyed on Stripe's globally-unique external_event_id.
      const existing = await tx.$queryRaw<
        Array<{ id: string; processingStatus: string; processedAt: Date | null; processingLeaseUntil: Date | null }>
      >(Prisma.sql`
        SELECT
          id,
          processing_status AS "processingStatus",
          processed_at AS "processedAt",
          processing_lease_until AS "processingLeaseUntil"
        FROM stripe_webhook_events
        WHERE external_event_id = ${normalizedEventId}
        LIMIT 1
      `);
      const row = existing[0];
      if (row?.processedAt || row?.processingStatus === "processed") {
        return { accepted: false, reason: "processed" };
      }
      if (
        row?.processingStatus === "processing" &&
        row.processingLeaseUntil &&
        row.processingLeaseUntil.getTime() > now.getTime()
      ) {
        return { accepted: false, reason: "in_progress" };
      }
      if (row) {
        // RLS-BYPASS: intentional cross-tenant — stripe_webhook_events row, see
        // reserveWebhookEvent's comment above.
        await tx.$executeRaw(Prisma.sql`
          UPDATE stripe_webhook_events
          SET
            event_type = ${normalizedEventType},
            processing_status = 'processing',
            processing_attempt_count = processing_attempt_count + 1,
            processing_lease_until = ${leaseUntil},
            last_error = NULL,
            updated_at = NOW()
          WHERE id = ${row.id}
        `);
      } else {
        // RLS-BYPASS: intentional cross-tenant — stripe_webhook_events row, see
        // reserveWebhookEvent's comment above.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO stripe_webhook_events (
            id,
            external_event_id,
            event_type,
            processing_status,
            processing_attempt_count,
            processing_lease_until,
            received_at,
            created_at,
            updated_at
          ) VALUES (
            ${randomUUID()},
            ${normalizedEventId},
            ${normalizedEventType},
            'processing',
            1,
            ${leaseUntil},
            NOW(),
            NOW(),
            NOW()
          )
        `);
      }
      return { accepted: true };
    });
  }

  async markWebhookEventProcessed(eventId: string, tenantKey: string | null): Promise<void> {
    // RLS-BYPASS: intentional cross-tenant — WHERE targets stripe_webhook_events by
    // Stripe's globally-unique external_event_id, see reserveWebhookEvent's comment.
    // tenantKey here is the value being WRITTEN (resolved elsewhere), not a filter.
    await this.prisma.tenant().$executeRaw(Prisma.sql`
      UPDATE stripe_webhook_events
      SET
        tenant_key = ${tenantKey},
        processing_status = 'processed',
        processing_lease_until = NULL,
        processed_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE external_event_id = ${eventId}
    `);
  }

  async markWebhookEventFailed(eventId: string, error: unknown, tenantKey: string | null = null): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, STRIPE_WEBHOOK_ERROR_LIMIT);
    // RLS-BYPASS: intentional cross-tenant — WHERE targets stripe_webhook_events by
    // Stripe's globally-unique external_event_id, see reserveWebhookEvent's comment.
    // tenantKey here is the value being WRITTEN (resolved elsewhere), not a filter.
    await this.prisma.tenant().$executeRaw(Prisma.sql`
      UPDATE stripe_webhook_events
      SET
        tenant_key = ${tenantKey},
        processing_status = 'failed',
        processing_lease_until = NULL,
        last_error = ${message},
        updated_at = NOW()
      WHERE external_event_id = ${eventId}
    `);
  }

  private async getStoredIds(
    tenantKey: string,
  ): Promise<{ externalCustomerId: string | null; externalSubscriptionId: string | null }> {
    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
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
    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
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
