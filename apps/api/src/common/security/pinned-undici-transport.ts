import dns from "node:dns";
import net from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { ConnectorTargetUnsafeError, isConnectorTargetSecurityError } from "./connector-target-errors";
import type { ConnectorTransport, TransportRequestInit } from "./connector-transport";
import { isBlockedAddress } from "./url-safety";

// Production transport for credential-bearing requests to tenant-supplied hosts.
//
// Invariant, per request attempt (every redirect hop and every retry is a new one):
//   resolve A/AAAA once  ->  reject the attempt if ANY candidate is unsafe
//   ->  connect only to addresses from that validated set
//   ->  verify socket.remoteAddress is a member of the set before the connection is used.
// The request URL is never rewritten, so the original hostname stays in the Host
// header, the TLS SNI and the certificate hostname check. TLS verification is left
// at undici/Node defaults: nothing here may disable or override it.
//
// `undici.fetch` and the `Agent` come from the SAME npm package instance. Mixing an
// npm Agent with Node's bundled global fetch breaks across undici majors
// ("invalid onRequestStart"), so this file must never reference global fetch.

export type ValidatedCandidate = { address: string; family: 4 | 6 };

export interface PinnedTransportOptions {
  /** Classifier for "must not connect". Defaults to the canonical URL-safety classifier. */
  isBlockedAddress?: (address: string) => boolean;
  /** Resolver for a hostname. Defaults to getaddrinfo (dns.lookup, all, verbatim). */
  resolveHost?: (hostname: string) => Promise<ValidatedCandidate[]>;
  connectTimeoutMs?: number;
  /**
   * Trust anchors for the TLS handshake. Normal certificate and hostname verification
   * still applies; this only chooses which CAs are trusted. Tests use it for a
   * throwaway CA; production leaves it unset (default system trust).
   */
  trustedCa?: string | Buffer | Array<string | Buffer>;
  /**
   * What the refused URL is called in error messages, e.g. "Connector base URL" (default)
   * or "Webhook target URL". Wording only; it has no effect on what is refused.
   */
  targetLabel?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TARGET_LABEL = "Connector base URL";

async function defaultResolveHost(hostname: string): Promise<ValidatedCandidate[]> {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

// Same strictness as url-safety: PIM_UNSAFE_HTTP_WEBHOOK_TARGETS is for local
// integration fixtures only and is read at call time.
function defaultIsBlockedAddress(address: string): boolean {
  if (process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS === "true") return false;
  return isBlockedAddress(address);
}

/** Canonical comparable form of an IP: IPv4-mapped IPv6 collapses to dotted IPv4. */
export function canonicalAddress(address: string): string {
  const raw = String(address ?? "").trim().toLowerCase();
  if (net.isIPv4(raw)) return raw;
  if (!net.isIPv6(raw)) return raw;
  let host: string;
  try {
    host = new URL(`http://[${raw.split("%")[0]}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return raw;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return host;
}

/**
 * Post-connect defence in depth. The primary control is that the socket layer can only
 * dial addresses the per-attempt lookup returns (the validated set); this additionally
 * checks the peer address the OS reports. "unverifiable" means the platform did not
 * expose a peer address (observed on Node 24.15 / Windows, where it is an empty string;
 * it is populated on Linux Node 22.23 and 24.21). It is logged once and not treated as
 * a failure, because failing would break platforms the primary control already covers.
 */
export function verifyConnectedAddress(
  remoteAddress: string | undefined,
  allowed: ReadonlySet<string>,
): "verified" | "mismatch" | "unverifiable" {
  const remote = canonicalAddress(remoteAddress ?? "");
  if (!remote) return "unverifiable";
  return allowed.has(remote) ? "verified" : "mismatch";
}

let warnedUnverifiable = false;
function warnUnverifiableOnce(): void {
  if (warnedUnverifiable) return;
  warnedUnverifiable = true;
  console.warn(
    "[connector-transport] peer address not exposed by this platform; post-connect address verification skipped (the validated-lookup restriction still applies).",
  );
}

function findSecurityCause(error: unknown): Error | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (isConnectorTargetSecurityError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export class PinnedUndiciTransport implements ConnectorTransport {
  private readonly agent: Agent;
  private readonly isBlocked: (address: string) => boolean;
  private readonly resolveHost: (hostname: string) => Promise<ValidatedCandidate[]>;
  private readonly connectTimeoutMs: number;
  private readonly trustedCa: PinnedTransportOptions["trustedCa"];
  private readonly targetLabel: string;

  constructor(options: PinnedTransportOptions = {}) {
    if (typeof undiciFetch !== "function" || typeof Agent !== "function" || typeof buildConnector !== "function") {
      throw new Error(
        "PinnedUndiciTransport requires fetch, Agent and buildConnector from the npm 'undici' package. " +
          "Do not fall back to global fetch: an npm Agent and Node's bundled fetch can be different undici majors.",
      );
    }
    this.isBlocked = options.isBlockedAddress ?? defaultIsBlockedAddress;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.trustedCa = options.trustedCa;
    this.targetLabel = options.targetLabel ?? DEFAULT_TARGET_LABEL;
    this.agent = new Agent({
      // Per-connection validation and pinning (see connect()).
      connect: (opts, callback) => this.connect(opts, callback),
      // No connection reuse between attempts: a reused keep-alive socket would skip
      // the connect hook, so "validated for this attempt" would only hold for the
      // attempt that opened it.
      pipelining: 0,
      allowH2: false,
    });
  }

  async fetch(url: string, init: TransportRequestInit): Promise<Response> {
    const signals: AbortSignal[] = [AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)];
    if (init.signal) signals.push(init.signal);
    try {
      const response = await undiciFetch(url, {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        redirect: init.redirect,
        signal: AbortSignal.any(signals),
        dispatcher: this.agent,
      });
      return response as unknown as Response;
    } catch (error) {
      // undici wraps connect-hook failures as `TypeError: fetch failed` with a cause.
      const security = findSecurityCause(error);
      if (security) throw security;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  // ── per-connection validation and pinning ───────────────────────────────────

  private connect(opts: buildConnector.Options, callback: buildConnector.Callback): void {
    const hostname = opts.hostname;
    if (net.isIP(hostname)) {
      if (this.isBlocked(hostname)) {
        callback(
          new ConnectorTargetUnsafeError(`${this.targetLabel} points to a private or reserved IP address.`, "PRIVATE_IP_LITERAL"),
          null,
        );
        return;
      }
      this.dial(opts, [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }], callback);
      return;
    }
    this.resolveValidated(hostname).then(
      (candidates) => this.dial(opts, candidates, callback),
      (error: unknown) => callback(error as Error, null),
    );
  }

  private async resolveValidated(hostname: string): Promise<ValidatedCandidate[]> {
    const candidates = await this.resolveHost(hostname);
    if (candidates.length === 0) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    }
    // One unsafe candidate refuses the whole attempt: a mixed answer is itself a
    // rebinding signal, so the safe members are not used.
    if (candidates.some((c) => this.isBlocked(c.address))) {
      throw new ConnectorTargetUnsafeError(
        `${this.targetLabel} resolves to a private or reserved IP address.`,
        "PRIVATE_IP_RESOLVED",
      );
    }
    return candidates;
  }

  private dial(opts: buildConnector.Options, candidates: ValidatedCandidate[], callback: buildConnector.Callback): void {
    const allowed = new Set(candidates.map((c) => canonicalAddress(c.address)));
    let lookups = 0;
    // The only name resolution the socket layer may perform: it returns the
    // already-validated candidates and never touches DNS. Node's address-family
    // auto-selection calls it with { all: true }.
    const lookup = (
      _hostname: string,
      lookupOptions: dns.LookupOptions | undefined,
      done: (error: Error | null, address?: string | dns.LookupAddress[], family?: number) => void,
    ) => {
      lookups += 1;
      if (lookups > 1) {
        done(new Error("Unexpected second name resolution for a pinned connection attempt."));
        return;
      }
      const wantedFamily = lookupOptions?.family;
      const list = candidates.filter((c) => !wantedFamily || wantedFamily === 0 || c.family === Number(wantedFamily));
      if (list.length === 0) {
        done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${opts.hostname}`), { code: "ENOTFOUND" }));
        return;
      }
      if (lookupOptions?.all) {
        done(null, list.map((c) => ({ address: c.address, family: c.family })));
        return;
      }
      done(null, list[0].address, list[0].family);
    };

    const connector = buildConnector({
      lookup: lookup as never,
      timeout: this.connectTimeoutMs,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
      ...(this.trustedCa ? { ca: this.trustedCa } : {}),
    } as buildConnector.BuildOptions);

    connector(opts, (error, socket) => {
      if (error || !socket) {
        callback(error, null);
        return;
      }
      const verdict = verifyConnectedAddress(socket.remoteAddress, allowed);
      if (verdict === "mismatch") {
        socket.destroy();
        console.error(
          `[connector-transport] connected address ${canonicalAddress(socket.remoteAddress ?? "")} is not in the validated set for ${opts.hostname}; connection destroyed.`,
        );
        callback(
          new ConnectorTargetUnsafeError(
            "The connection was established to an address that was not validated for this request.",
            "CONNECTED_ADDRESS_NOT_VALIDATED",
          ),
          null,
        );
        return;
      }
      if (verdict === "unverifiable") warnUnverifiableOnce();
      callback(null, socket);
    });
  }
}
