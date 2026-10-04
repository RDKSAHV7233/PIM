import { PinnedUndiciTransport, type PinnedTransportOptions } from "./pinned-undici-transport";

// The outbound seams for requests to tenant-supplied hosts: connectors (Odoo, WooCommerce,
// PrestaShop, Shopware) and outbound webhooks. Production uses PinnedUndiciTransport:
// the validated DNS result for a request attempt is the only set of addresses the
// socket may connect to. Callers always own redirect handling
// (fetchWithValidatedRedirects), so `redirect` is fixed at "manual".

export interface TransportRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect: "manual";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ConnectorTransport {
  fetch(url: string, init: TransportRequestInit): Promise<Response>;
}

const TEST_OVERRIDE = Symbol.for("pim.connectorTransport.testOverride");
let productionTransport: PinnedUndiciTransport | undefined;
let webhookTransport: PinnedUndiciTransport | undefined;

const WEBHOOK_TARGET_LABEL = "Webhook target URL";

/**
 * A pinned transport whose refusal messages use the webhook wording (the same text
 * validateWebhookTargetUrl produces). Options exist so specs can inject a resolver and
 * trust anchors; production calls it with none.
 */
export function createWebhookTransport(options: PinnedTransportOptions = {}): PinnedUndiciTransport {
  return new PinnedUndiciTransport({ ...options, targetLabel: WEBHOOK_TARGET_LABEL });
}

export function getConnectorTransport(): ConnectorTransport {
  if (process.env.NODE_ENV === "test") {
    const override = (globalThis as Record<symbol, unknown>)[TEST_OVERRIDE] as ConnectorTransport | undefined;
    if (override) return override;
  }
  productionTransport ??= new PinnedUndiciTransport();
  return productionTransport;
}

/** Transport for outbound webhook delivery (tenant-configured target URLs). */
export function getWebhookTransport(): ConnectorTransport {
  if (process.env.NODE_ENV === "test") {
    const override = (globalThis as Record<symbol, unknown>)[TEST_OVERRIDE] as ConnectorTransport | undefined;
    if (override) return override;
  }
  webhookTransport ??= createWebhookTransport();
  return webhookTransport;
}

/**
 * Test-only injection point. Refuses to run outside NODE_ENV=test so production
 * code can never swap the pinned transport out. Pass null to use the real one.
 */
export function setConnectorTransportForTesting(transport: ConnectorTransport | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setConnectorTransportForTesting is only available when NODE_ENV=test.");
  }
  (globalThis as Record<symbol, unknown>)[TEST_OVERRIDE] = transport ?? undefined;
}

export async function closeConnectorTransport(): Promise<void> {
  const transports = [productionTransport, webhookTransport];
  productionTransport = undefined;
  webhookTransport = undefined;
  await Promise.all(transports.map((transport) => transport?.close()));
}
