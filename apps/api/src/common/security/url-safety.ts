import { BadRequestException } from "@nestjs/common";
import { resolve4, resolve6 } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".internal") || lower.endsWith(".local")) return true;
  return false;
}

function ipV4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return -1;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return -1;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function isInCidr4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = (~0 << (32 - Number(bits))) >>> 0;
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
  "192.168.0.0/16",
];

function isBlockedIpV4(ip: string): boolean {
  return BLOCKED_IPV4_CIDRS.some((cidr) => isInCidr4(ip, cidr));
}

function normalizeIpV6(ip: string): string {
  return ip.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

const BLOCKED_IPV6_PREFIXES = ["fe80:", "fc", "fd"];

function isBlockedIpV6(ip: string): boolean {
  const normalized = normalizeIpV6(ip);
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  return BLOCKED_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
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

export async function validateWebhookTargetUrl(
  value: string,
  options: WebhookTargetUrlValidationOptions = {},
): Promise<string> {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new BadRequestException("Webhook target URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException("Webhook target URL is not a valid URL.");
  }

  // Skip HTTPS and SSRF checks only for explicit local integration fixtures.
  // PIM_UNSAFE_HTTP_WEBHOOK_TARGETS must never be set in production.
  if (options.allowUnsafeHttp === true || process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS === "true") {
    return parsed.toString();
  }

  if (parsed.protocol !== "https:") {
    throw new BadRequestException("Webhook target URL must use HTTPS.");
  }

  const hostname = parsed.hostname;

  if (isBlockedHostname(hostname)) {
    throw new BadRequestException("Webhook target URL points to a blocked host.");
  }

  if (isIpLiteral(hostname)) {
    if (isBlockedIpV4(hostname) || isBlockedIpV6(hostname)) {
      throw new BadRequestException("Webhook target URL points to a private or reserved IP address.");
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
      throw new BadRequestException("Webhook target URL must resolve to a public address.");
    }
    // Registration time: DNS returned no records. Could be a transient resolver
    // failure or an offline box — do not permanently block a valid public
    // target. Allow through; dispatch re-validates (requireResolvable defaults
    // to true) and fails closed if it still does not resolve.
    console.warn(
      `[url-safety] Webhook target host "${hostname}" returned no DNS records; allowing at registration time. Dispatch will re-validate and fail closed if it still does not resolve.`,
    );
    return parsed.toString();
  }

  for (const addr of resolvedAddresses) {
    if (isBlockedIpV4(addr) || isBlockedIpV6(addr)) {
      throw new BadRequestException("Webhook target URL resolves to a private or reserved IP address.");
    }
  }

  return parsed.toString();
}
