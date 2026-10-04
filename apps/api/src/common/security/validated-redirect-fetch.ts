import { validateConnectorTargetUrl } from "./url-safety";

// Credential-bearing requests to a tenant-supplied host must never be handed to
// fetch's default `redirect: "follow"`: a validated public host can answer
// `30x Location: <internal or attacker address>` and the client would replay the
// request (including a JSON-RPC body that carries the password) to a target that
// never passed validation. This wrapper issues every hop with `redirect:
// "manual"`, re-validates each `Location`, and only follows a same-origin hop.
//
// Policy for authenticated requests (the only mode implemented):
//   - target fails the canonical SSRF validation   -> fail closed
//   - target is a different origin (incl. apex->www) -> fail closed, telling the
//     operator to save the canonical URL. Credentials are never forwarded.
//   - same origin, GET/HEAD                         -> follow 301/302/303/307/308
//   - same origin, request with a body              -> follow 307/308 only (method
//     and body preserved); 301/302/303 would silently turn an RPC call into a
//     body-less GET, so they fail closed instead of being delegated to fetch.
//   - more than `maxRedirects` hops or a repeated URL -> fail closed

export type ConnectorRedirectErrorCode =
  | "REDIRECT_UNSAFE_TARGET"
  | "REDIRECT_CROSS_ORIGIN"
  | "REDIRECT_INVALID_LOCATION"
  | "REDIRECT_TOO_MANY"
  | "REDIRECT_LOOP"
  | "REDIRECT_METHOD_UNSUPPORTED"
  | "REDIRECT_NOT_ENFORCED";

export class ConnectorRedirectError extends Error {
  constructor(
    public readonly code: ConnectorRedirectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorRedirectError";
  }
}

export interface RedirectHopInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect: "manual";
}

/** Performs exactly one HTTP request. Must honour `redirect: "manual"`. */
export type RedirectHopFetch = (url: string, init: RedirectHopInit) => Promise<Response>;

export interface ValidatedRedirectOptions {
  /** Maximum number of redirect hops followed. Default 3. */
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 3;

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Releasing the socket is best-effort.
  }
}

export async function fetchWithValidatedRedirects(
  hop: RedirectHopFetch,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  options: ValidatedRedirectOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const method = (init.method ?? "GET").toUpperCase();
  const hasBody = init.body !== undefined && init.body !== null;
  const visited = new Set<string>([url]);

  let currentUrl = url;
  for (let hops = 0; ; hops++) {
    const response = await hop(currentUrl, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: "manual",
    });

    // The hop implementation must not follow redirects itself; if it did, the
    // request already reached a destination this wrapper never validated.
    if (response.redirected === true) {
      await discardBody(response);
      throw new ConnectorRedirectError(
        "REDIRECT_NOT_ENFORCED",
        "The HTTP client followed a redirect on a credential-bearing request; refusing to use the response.",
      );
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    await discardBody(response);

    if (hops >= maxRedirects) {
      throw new ConnectorRedirectError(
        "REDIRECT_TOO_MANY",
        `The server redirected more than ${maxRedirects} times. Save the canonical store URL in the connector settings.`,
      );
    }

    const location = response.headers.get("location");
    let target: URL;
    try {
      if (!location || !location.trim()) throw new Error("missing Location");
      target = new URL(location.trim(), currentUrl);
    } catch {
      throw new ConnectorRedirectError(
        "REDIRECT_INVALID_LOCATION",
        `The server answered ${response.status} with a missing or malformed Location header.`,
      );
    }
    target.hash = "";

    // Same canonical validation as install time, applied to every hop. The
    // rejected target is deliberately not echoed back.
    try {
      await validateConnectorTargetUrl(target.toString(), { requireResolvable: false });
    } catch {
      throw new ConnectorRedirectError(
        "REDIRECT_UNSAFE_TARGET",
        "The server redirected to an address that is not allowed (private, reserved or non-HTTPS).",
      );
    }

    if (target.origin !== new URL(currentUrl).origin) {
      throw new ConnectorRedirectError(
        "REDIRECT_CROSS_ORIGIN",
        `The server redirected to a different origin (${target.origin}). Credentials are never sent to a redirect target; save the canonical store URL (${target.origin}) in the connector settings instead.`,
      );
    }

    if (hasBody && method !== "GET" && method !== "HEAD" && response.status !== 307 && response.status !== 308) {
      throw new ConnectorRedirectError(
        "REDIRECT_METHOD_UNSUPPORTED",
        `The server answered ${response.status} to a ${method} request, which would drop the request body. Save the canonical store URL in the connector settings.`,
      );
    }

    const next = target.toString();
    if (visited.has(next)) {
      throw new ConnectorRedirectError("REDIRECT_LOOP", "The server redirected in a loop.");
    }
    visited.add(next);
    currentUrl = next;
  }
}
