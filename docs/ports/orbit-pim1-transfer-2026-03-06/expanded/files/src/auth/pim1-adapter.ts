import { authConfig } from "./config";
import type { OrbitRequest } from "./types";

export class PimAdapterNotConfiguredError extends Error {
  constructor() {
    super("pim_adapter_not_configured");
  }
}

export class PimAdapterUpstreamError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super("pim_adapter_upstream_error");
    this.status = status;
    this.body = body;
  }
}

export function isPimAdapterConfigured(): boolean {
  return Boolean(authConfig.pimAdapterBaseUrl);
}

function adapterBaseUrl(): string {
  const base = authConfig.pimAdapterBaseUrl.trim();
  if (!base) throw new PimAdapterNotConfiguredError();
  return base;
}

function toSearchParams(input: OrbitRequest["query"] | URLSearchParams | undefined): URLSearchParams {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) return input;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const part of value) {
        if (part === undefined || part === null) continue;
        params.append(key, String(part));
      }
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

function buildUrl(pathname: string, query?: OrbitRequest["query"] | URLSearchParams): string {
  const base = new URL(adapterBaseUrl());
  const url = new URL(pathname, base);
  const params = toSearchParams(query);
  const queryText = params.toString();
  if (queryText) url.search = queryText;
  return url.toString();
}

export async function proxyPim1Request(params: {
  req: OrbitRequest;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: OrbitRequest["query"] | URLSearchParams;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  const url = buildUrl(params.path, params.query);
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("x-orbit-tenant-id", params.req.tenantId ?? params.req.principal?.tenant_id ?? "");
  headers.set("x-orbit-actor-id", params.req.userId ?? params.req.principal?.sub ?? "");
  headers.set("x-orbit-actor-role", params.req.principal?.role ?? "");
  headers.set("x-orbit-auth-type", params.req.principal?.auth_type ?? "");

  const authHeader = params.req.headers.authorization;
  if (authConfig.pimAdapterForwardAuth && typeof authHeader === "string" && authHeader.trim().length > 0) {
    headers.set("authorization", authHeader);
  }

  let body: string | undefined;
  if (params.body !== undefined && params.method !== "GET") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(params.body);
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), authConfig.pimAdapterTimeoutMs);
  try {
    const response = await fetch(url, {
      method: params.method,
      headers,
      body,
      signal: abort.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let parsed: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }
    }
    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

