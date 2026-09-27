/**
 * Strips tenant product data and session credentials from Sentry events before
 * they leave this process. Multi-tenant PIM boundary: request bodies can contain
 * product titles, prices, and SKUs; headers can carry auth tokens and cookies.
 *
 * Used as the `beforeSend` callback in Sentry.init() in main.ts.
 */
export function sentryBeforeSend(event: unknown): unknown {
  if (event && typeof event === "object") {
    const e = event as Record<string, unknown>;
    if (e.request && typeof e.request === "object") {
      const req = e.request as Record<string, unknown>;
      delete req.data;
      delete req.cookies;
      if (req.headers && typeof req.headers === "object") {
        const h = req.headers as Record<string, unknown>;
        delete h["authorization"];
        delete h["cookie"];
        delete h["x-api-key"];
      }
    }
  }
  return event;
}
