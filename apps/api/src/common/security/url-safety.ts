import { BadRequestException } from "@nestjs/common";
import { resolve4, resolve6 } from "node:dns/promises";
import { ConnectorTargetUnsafeError, type ConnectorTargetUnsafeReason } from "./connector-target-errors";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

// A trailing dot is a valid, equivalent FQDN spelling ("localhost." resolves to
// the same address as "localhost") that the WHATWG URL parser preserves, so it
// must be stripped before any name comparison or the suffix checks are bypassed.
function stripTrailingDots(hostname: string): string {
  return hostname.replace(/\.+$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  const lower = stripTrailingDots(hostname.toLowerCase());
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (
    lower.endsWith(".internal") ||
    lower.endsWith(".local") ||
    lower.endsWith(".localhost")
  ) {
    return true;
  }
  return false;
}

function parseIpV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function ipV4ToInt(ip: string): number {
  const bytes = parseIpV4(ip);
  if (!bytes) return -1;
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

function isInCidr4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  const ipInt = ipV4ToInt(ip);
  const baseInt = ipV4ToInt(base);
  if (ipInt < 0 || baseInt < 0) return false;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24", // IETF protocol assignments (includes Oracle metadata 192.0.0.192)
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved + limited broadcast
];

function isBlockedIpV4(ip: string): boolean {
  // Fail closed: an address we cannot parse is never treated as public.
  if (ipV4ToInt(ip) < 0) return true;
  return BLOCKED_IPV4_CIDRS.some((cidr) => isInCidr4(ip, cidr));
}

function normalizeIpV6(ip: string): string {
  return ip.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

// Expands any textual IPv6 form (compressed "::", embedded dotted IPv4 tail,
// zone id) to its eight 16-bit groups, or null when it is not a valid address.
function parseIpV6(ip: string): number[] | null {
  let text = normalizeIpV6(ip);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  const dotted = text.lastIndexOf(".");
  if (dotted !== -1) {
    const lastColon = text.lastIndexOf(":");
    const v4 = parseIpV4(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function embeddedIpV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isBlockedIpV6(ip: string): boolean {
  const g = parseIpV6(ip);
  // Fail closed on anything that is not a well-formed address.
  if (!g) return true;

  const upperZero = g.slice(0, 5).every((x) => x === 0);

  // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 address in disguise: judge it by
  // the IPv4 rules, otherwise ::ffff:7f00:1 reaches loopback past the IPv4 list.
  if (upperZero && g[5] === 0xffff) return isBlockedIpV4(embeddedIpV4(g[6], g[7]));

  // NAT64 well-known prefix 64:ff9b::/96 translates to the embedded IPv4;
  // the local-use prefix 64:ff9b:1::/48 has no public meaning.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((x) => x === 0)) return isBlockedIpV4(embeddedIpV4(g[6], g[7]));
    return true;
  }

  // 6to4 (2002::/16) embeds the IPv4 the tunnel endpoint will contact.
  if (g[0] === 0x2002) return isBlockedIpV4(embeddedIpV4(g[1], g[2]));

  // Everything outside global unicast 2000::/3 is non-public: ::, ::1,
  // IPv4-compatible ::a.b.c.d, discard 100::/64, unique-local fc00::/7,
  // link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
  if ((g[0] & 0xe000) !== 0x2000) return true;

  // Carve-outs inside 2000::/3.
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // 2001::/23 IETF assignments incl. Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // documentation 3fff::/20

  return false;
}

function isBlockedIp(address: string): boolean {
  return address.includes(":") ? isBlockedIpV6(address) : isBlockedIpV4(address);
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export interface WebhookTargetUrlValidationOptions {
  allowUnsafeHttp?: boolean;
  /**
   * Whether a hostname whose A/AAAA lookup returns zero records is rejected
   * ("must resolve to a public address"). Defaults to true (fail closed).
   *
   * Dispatch time keeps the default: a target that no longer resolves must not
   * be contacted. Registration time passes `false` so a transient resolver
   * failure — or an offline CI box — cannot permanently block a legitimate
   * public target; the URL is logged and passed through, and dispatch
   * re-validates. The hard blocks for resolved private/loopback/link-local/
   * CGNAT/metadata IPs and for blocked hostnames still apply in both modes.
   */
  requireResolvable?: boolean;
}

// Per-caller wording so a thrown message names the field the operator/tenant
// actually typed in (a webhook target vs. a connector's store/instance URL),
// while every caller shares the exact same private-IP/blocked-host logic
// below. Keep this list's error substrings stable — url-safety.spec.ts and
// each connector's own spec assert on them.
interface TargetUrlErrorLabels {
  /** Connector callers get the typed, provider-neutral error; webhooks keep BadRequestException. */
  typedError: boolean;
  required: string;
  invalidUrl: string;
  httpsRequired: string;
  blockedHost: string;
  blockedIpLiteral: string;
  blockedResolved: string;
  mustResolve: string;
  logPrefix: string;
}

const WEBHOOK_TARGET_LABELS: TargetUrlErrorLabels = {
  typedError: false,
  required: "Webhook target URL is required.",
  invalidUrl: "Webhook target URL is not a valid URL.",
  httpsRequired: "Webhook target URL must use HTTPS.",
  blockedHost: "Webhook target URL points to a blocked host.",
  blockedIpLiteral: "Webhook target URL points to a private or reserved IP address.",
  blockedResolved: "Webhook target URL resolves to a private or reserved IP address.",
  mustResolve: "Webhook target URL must resolve to a public address.",
  logPrefix: "Webhook target",
};

const CONNECTOR_TARGET_LABELS: TargetUrlErrorLabels = {
  typedError: true,
  required: "Connector base URL is required.",
  invalidUrl: "Connector base URL is not a valid URL.",
  httpsRequired: "Connector base URL must use HTTPS.",
  blockedHost: "Connector base URL points to a blocked host.",
  blockedIpLiteral: "Connector base URL points to a private or reserved IP address.",
  blockedResolved: "Connector base URL resolves to a private or reserved IP address.",
  mustResolve: "Connector base URL must resolve to a public address.",
  logPrefix: "Connector base URL",
};

const TARGET_URL_REASON_MESSAGE_KEY: Record<ConnectorTargetUnsafeReason, keyof TargetUrlErrorLabels> = {
  URL_REQUIRED: "required",
  URL_INVALID: "invalidUrl",
  HTTPS_REQUIRED: "httpsRequired",
  BLOCKED_HOST: "blockedHost",
  PRIVATE_IP_LITERAL: "blockedIpLiteral",
  PRIVATE_IP_RESOLVED: "blockedResolved",
  UNRESOLVABLE: "mustResolve",
};

// ConnectorTargetUnsafeError extends BadRequestException, so existing
// instanceof / message-substring handling of the connector flavor is unchanged.
function targetUrlError(labels: TargetUrlErrorLabels, reason: ConnectorTargetUnsafeReason): BadRequestException {
  const message = String(labels[TARGET_URL_REASON_MESSAGE_KEY[reason]]);
  return labels.typedError ? new ConnectorTargetUnsafeError(message, reason) : new BadRequestException(message);
}

async function validateOutboundTargetUrl(
  value: string,
  options: WebhookTargetUrlValidationOptions,
  labels: TargetUrlErrorLabels,
): Promise<string> {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw targetUrlError(labels, "URL_REQUIRED");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw targetUrlError(labels, "URL_INVALID");
  }

  // Skip HTTPS and SSRF checks only for explicit local integration fixtures.
  // PIM_UNSAFE_HTTP_WEBHOOK_TARGETS must never be set in production. Shared
  // across both callers deliberately — there is no separate unsafe-http
  // escape hatch for connectors; the same one flag governs both.
  if (options.allowUnsafeHttp === true || process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS === "true") {
    return parsed.toString();
  }

  if (parsed.protocol !== "https:") {
    throw targetUrlError(labels, "HTTPS_REQUIRED");
  }

  const hostname = parsed.hostname;

  if (isBlockedHostname(hostname)) {
    throw targetUrlError(labels, "BLOCKED_HOST");
  }

  if (isIpLiteral(hostname)) {
    if (isBlockedIp(hostname)) {
      throw targetUrlError(labels, "PRIVATE_IP_LITERAL");
    }
    return parsed.toString();
  }

  const resolvedAddresses: string[] = [];
  const [ipv4, ipv6] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  if (ipv4.status === "fulfilled") resolvedAddresses.push(...ipv4.value);
  if (ipv6.status === "fulfilled") resolvedAddresses.push(...ipv6.value);

  if (resolvedAddresses.length === 0) {
    if (options.requireResolvable !== false) {
      throw targetUrlError(labels, "UNRESOLVABLE");
    }
    // Registration time: DNS returned no records. Could be a transient resolver
    // failure or an offline box — do not permanently block a valid public
    // target. Allow through; dispatch re-validates (requireResolvable defaults
    // to true) and fails closed if it still does not resolve.
    console.warn(
      `[url-safety] ${labels.logPrefix} host "${hostname}" returned no DNS records; allowing at registration time. Dispatch will re-validate and fail closed if it still does not resolve.`,
    );
    return parsed.toString();
  }

  for (const addr of resolvedAddresses) {
    if (isBlockedIp(addr)) {
      throw targetUrlError(labels, "PRIVATE_IP_RESOLVED");
    }
  }

  return parsed.toString();
}

export async function validateWebhookTargetUrl(
  value: string,
  options: WebhookTargetUrlValidationOptions = {},
): Promise<string> {
  return validateOutboundTargetUrl(value, options, WEBHOOK_TARGET_LABELS);
}

// PIM#890: self-hosted connectors (WooCommerce site_url, Odoo odoo_url,
// PrestaShop store_url) take a tenant-supplied base URL and make an
// authenticated server-side request to it on every publish/status-sync call
// — the exact SSRF shape validateWebhookTargetUrl already exists to block for
// outbound webhook targets, just never wired up here. Reuses the identical
// private/loopback/link-local/CGNAT/metadata-IP and blocked-hostname checks.
//
// requireResolvable is left false at BOTH the connector's install-time
// candidate-verification call and its per-dispatch resolveCredentials() call
// (unlike the webhook pattern's registration-vs-dispatch split) — these
// connectors' own existing unit tests exercise many methods per connector
// against synthetic non-resolving *.example.com fixture hosts, and requiring
// resolution at dispatch would need each of those rewritten against a real,
// CI-resolvable domain. This does not weaken the actual protection: a
// resolved address that IS in a blocked private/reserved range is still
// rejected in both modes (the flag only governs the zero-DNS-records case),
// so the real attack this closes — a malicious or DNS-rebound hostname
// resolving to an internal IP or the cloud metadata endpoint — is blocked
// exactly the same as it would be with requireResolvable: true.
export async function validateConnectorTargetUrl(
  value: string,
  options: WebhookTargetUrlValidationOptions = {},
): Promise<string> {
  return validateOutboundTargetUrl(value, options, CONNECTOR_TARGET_LABELS);
}
