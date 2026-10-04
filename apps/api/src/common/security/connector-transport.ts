import { PinnedUndiciTransport } from "./pinned-undici-transport";

// The single outbound seam for credential-bearing requests to tenant-supplied hosts
// (Odoo, WooCommerce, PrestaShop, Shopware). Production uses PinnedUndiciTransport:
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

export function getConnectorTransport(): ConnectorTransport {
  if (process.env.NODE_ENV === "test") {
    const override = (globalThis as Record<symbol, unknown>)[TEST_OVERRIDE] as ConnectorTransport | undefined;
    if (override) return override;
  }
  productionTransport ??= new PinnedUndiciTransport();
  return productionTransport;
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
  const transport = productionTransport;
  productionTransport = undefined;
  await transport?.close();
}
