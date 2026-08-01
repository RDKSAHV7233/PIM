/**
 * ShopifyApiClient — Shopify HTTP transport layer.
 *
 * Owns: GraphQL execution, OAuth token exchange, URL resolution, app credentials.
 * Does NOT own: credential persistence, product mapping, webhook parsing.
 *
 * Extracted from ShopifyConnector to make the transport layer independently
 * testable and to reduce connector size (~73KB -> ~50KB).
 */
import { Injectable } from "@nestjs/common";
import { LoggerService } from "../../common/logging/logger.service";
import { ConnectorContext } from "../../connector-framework/connector.interface";

// ─── Shopify API constants ────────────────────────────────────────────────────

// Shopify deprecates each API version ~12 months after release.
// 2026-04 releases 2026-04-01; earliest deprecation: 2027-04-01.
// Review quarterly: https://shopify.dev/docs/api/usage/versioning
// Override at runtime via PIM_SHOPIFY_ADMIN_API_VERSION env var.
export const SHOPIFY_DEFAULT_ADMIN_API_VERSION = "2026-04";
export const SHOPIFY_ADMIN_API_VERSION_DEPRECATE_AFTER = new Date("2027-04-01");
export const SHOPIFY_HTTP_TIMEOUT_MS = 30_000;

// GraphQL throttle retry ceiling — prevents runaway waits on severely degraded stores.
const MAX_THROTTLE_WAIT_MS = 60_000;
const GRAPHQL_MAX_RETRIES = 3;

/**
 * Thrown when Shopify's HTTP layer itself rejects a request (non-2xx response),
 * as distinct from a network failure or a THROTTLED/GraphQL-body-level error.
 * Carries the HTTP status so callers (e.g. connector install) can distinguish
 * a user-fixable problem (404 bad domain, 401/403 bad token) from a genuine
 * Shopify-side outage, instead of surfacing every failure as a generic 500.
 */
export class ShopifyApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly shopDomain: string,
    message: string,
  ) {
    super(message);
    this.name = "ShopifyApiHttpError";
  }
}

// ─── Shopify API response types ───────────────────────────────────────────────

export type ShopifyTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

export type ShopifyGraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{
    message?: string;
    extensions?: { code?: string };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: {
        maximumAvailable?: number;
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };
  };
};

// ─── Service ─────────────────────────────────────────────────────────────────

export interface GraphqlRequestOptions {
  /**
   * Called once when a 401 response is received (before the retry).
   * Typically expires the stored access token so ctx.getAccessToken()
   * triggers a fresh OAuth exchange via refreshAccessToken().
   * If omitted, 401 causes an immediate throw without retry.
   */
  onTokenExpired?: (ctx: ConnectorContext) => Promise<void>;
}

@Injectable()
export class ShopifyApiClient {
  constructor(private readonly logger: LoggerService) {}

  // ─── GraphQL ──────────────────────────────────────────────────────────────

  /**
   * Execute a Shopify Admin GraphQL request.
   *
   * HTTP layer  (429 / 503 / network errors): handled by ctx.fetch() token bucket + backoff.
   * Application layer (GraphQL THROTTLED): cost-aware wait, retried up to GRAPHQL_MAX_RETRIES.
   * Auth layer  (401): token expired via options.onTokenExpired, refreshed, retried once.
   */
  async graphqlRequest<T>(
    ctx: ConnectorContext,
    input: {
      shopDomain: string;
      accessToken: string;
      query: string;
      variables?: Record<string, unknown>;
    },
    options: GraphqlRequestOptions = {},
  ): Promise<T> {
    const endpoint = `${this.resolveAdminApiBaseUrl(input.shopDomain)}/admin/api/${this.resolveAdminApiVersion()}/graphql.json`;
    let accessToken = input.accessToken;

    for (let attempt = 0; attempt <= GRAPHQL_MAX_RETRIES; attempt++) {
      // ctx.fetch() owns HTTP-level rate limiting (token bucket) and 429/503 backoff.
      const response = await ctx.fetch!(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: input.query,
          variables: input.variables ?? {},
        }),
      });

      // HTTP 401 — token revoked (app uninstall / Shopify Partner dashboard rotation).
      // Expire the stored token, get a fresh one, then retry once.
      if (response.status === 401 && attempt === 0) {
        if (options.onTokenExpired) {
          await options.onTokenExpired(ctx);
        }
        accessToken = await ctx.getAccessToken();
        this.logger.warn("connector.shopify.graphql.token_refreshed_on_401", {
          shopDomain: input.shopDomain,
          installationId: ctx.installationId,
        });
        continue;
      }

      const text = await response.text();
      let parsed: ShopifyGraphQlEnvelope<T> = {};
      try {
        parsed = text ? (JSON.parse(text) as ShopifyGraphQlEnvelope<T>) : {};
      } catch {
        parsed = {};
      }

      // GraphQL THROTTLED (HTTP 200, body-level error) — query cost exceeded leaky bucket.
      // Wait for the bucket to restore the needed cost units, then retry.
      const isThrottled =
        Array.isArray(parsed.errors) &&
        parsed.errors.some((e) => e?.extensions?.code === "THROTTLED");
      if (isThrottled) {
        const bucket = parsed.extensions?.cost?.throttleStatus;
        const restoreRate = bucket?.restoreRate ?? 50;
        const needed = parsed.extensions?.cost?.requestedQueryCost ?? 0;
        const available = bucket?.currentlyAvailable ?? 0;
        const waitMs = Math.min(
          Math.ceil(((needed - available) / restoreRate) * 1000) + 200,
          MAX_THROTTLE_WAIT_MS,
        );
        this.logger.warn("connector.shopify.graphql.throttled", {
          shopDomain: input.shopDomain,
          attempt,
          requestedQueryCost: needed,
          currentlyAvailable: available,
          restoreRate,
          waitMs,
        });
        if (attempt < GRAPHQL_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new Error(
          `Shopify API query cost throttled after ${GRAPHQL_MAX_RETRIES} retries. ` +
          `Bucket available: ${available}/${bucket?.maximumAvailable ?? "?"}, requested: ${needed}. ` +
          `Reduce concurrent exports or wait before retrying.`,
        );
      }

      // Warn when the cost bucket is running low (< 20% remaining).
      const throttleStatus = parsed.extensions?.cost?.throttleStatus;
      if (throttleStatus) {
        const { currentlyAvailable = 0, maximumAvailable = 1 } = throttleStatus;
        if (currentlyAvailable / maximumAvailable < 0.2) {
          this.logger.warn("connector.shopify.graphql.bucket_low", {
            shopDomain: input.shopDomain,
            currentlyAvailable,
            maximumAvailable,
            restoreRate: throttleStatus.restoreRate,
          });
        }
      }

      if (!response.ok) {
        throw new ShopifyApiHttpError(
          response.status,
          input.shopDomain,
          `Shopify GraphQL request failed with status ${response.status}.`,
        );
      }
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const message = parsed.errors
          .map((issue) => String(issue?.message ?? "").trim())
          .filter((value) => value.length > 0)
          .join(" | ");
        throw new Error(message || "Shopify GraphQL request returned errors.");
      }
      if (!parsed.data) {
        throw new Error("Shopify GraphQL response did not include data.");
      }

      return parsed.data;
    }

    throw new Error("Shopify GraphQL request failed: exhausted retry attempts.");
  }

  // ─── OAuth token exchange ─────────────────────────────────────────────────

  /**
   * Exchange an authorization code or refresh token for an access token.
   * Uses raw fetch (not ctx.fetch) — OAuth endpoint is separate from the
   * Admin API and has different rate limits.
   */
  async exchangeToken(
    shopDomain: string,
    payload: Record<string, string>,
  ): Promise<ShopifyTokenResponse> {
    const endpoint = `${this.resolveTokenBaseUrl(shopDomain)}/admin/oauth/access_token`;
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(SHOPIFY_HTTP_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload),
    });

    const text = await response.text();
    let parsed: ShopifyTokenResponse | Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as ShopifyTokenResponse) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new ShopifyApiHttpError(
        response.status,
        shopDomain,
        `Shopify token exchange failed with status ${response.status}.`,
      );
    }

    this.logger.info("connector.shopify.token_exchange.completed", {
      shopDomain,
      grantType: payload.grant_type ?? "unknown",
      statusCode: response.status,
    });
    return parsed as ShopifyTokenResponse;
  }

  // ─── App credentials ──────────────────────────────────────────────────────

  requireClientId(): string {
    const value = String(process.env.PIM_SHOPIFY_CLIENT_ID ?? "").trim();
    if (!value) throw new Error("PIM_SHOPIFY_CLIENT_ID is not configured.");
    return value;
  }

  requireClientSecret(): string {
    const value = String(process.env.PIM_SHOPIFY_CLIENT_SECRET ?? "").trim();
    if (!value) throw new Error("PIM_SHOPIFY_CLIENT_SECRET is not configured.");
    return value;
  }

  // ─── URL resolution ───────────────────────────────────────────────────────

  resolveTokenBaseUrl(shopDomain: string): string {
    const explicit = String(process.env.PIM_SHOPIFY_TOKEN_BASE_URL ?? "").trim().replace(/\/+$/, "");
    return explicit.length > 0 ? explicit : `https://${shopDomain}`;
  }

  resolveAdminApiBaseUrl(shopDomain: string): string {
    const explicit = String(process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
    return explicit.length > 0 ? explicit : `https://${shopDomain}`;
  }

  resolveAdminApiVersion(): string {
    return (
      String(process.env.PIM_SHOPIFY_ADMIN_API_VERSION ?? "").trim() ||
      SHOPIFY_DEFAULT_ADMIN_API_VERSION
    );
  }
}
