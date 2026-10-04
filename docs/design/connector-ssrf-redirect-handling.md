# Connector SSRF: authenticated redirect handling

Status: implemented for **Odoo** (its JSON-RPC body carries the database password/API key),
**WooCommerce**, **PrestaShop** and **Shopware** (its OAuth token exchange carries the
client_secret in the body), one PR each. DNS pinning is a separate control and is not part
of this change.

## Problem

`validateConnectorTargetUrl` validates the URL the tenant typed. Connector requests to that
host used fetch's default `redirect: "follow"`, so a validated public host could answer
`30x Location: <internal or attacker address>` and the request was replayed there, with any
credential carried in the body, query string or headers. Only outbound webhook dispatch
used `redirect: "manual"`.

## Invariant

```
tenant-controlled URL validated
  -> every hop is sent with redirect: "manual"
  -> 3xx: resolve Location against the current URL, re-run validateConnectorTargetUrl
  -> authenticated request:
       same origin   -> follow only where the method/body semantics are explicit
       cross origin  -> fail closed (apex -> www included); never forward credentials
```

## Implementation

`common/security/validated-redirect-fetch.ts` exports `fetchWithValidatedRedirects(hop, url,
init, { maxRedirects = 3 })`. `hop` performs exactly one request and must honour
`redirect: "manual"`; `ConnectorHttpClient.fetch` accepts and forwards a `redirect` option
for this.

| Situation | Result |
|---|---|
| Not a 301/302/303/307/308 | response returned untouched |
| `Location` missing, empty or unparseable | `REDIRECT_INVALID_LOCATION` |
| Target fails canonical SSRF validation (private/metadata/IPv4-mapped IPv6/non-HTTPS/...) | `REDIRECT_UNSAFE_TARGET` (target not echoed) |
| Target is a different origin (scheme, host or port) | `REDIRECT_CROSS_ORIGIN`, message names the canonical origin to save |
| Same origin, GET/HEAD | 301/302/303/307/308 followed |
| Same origin, request with a body | 307/308 followed (method and body preserved); 301/302/303 -> `REDIRECT_METHOD_UNSUPPORTED` rather than letting fetch silently turn the RPC call into a body-less GET |
| Repeated URL | `REDIRECT_LOOP` |
| More than `maxRedirects` hops | `REDIRECT_TOO_MANY` |
| Hop response has `redirected === true` | `REDIRECT_NOT_ENFORCED` (the client followed on its own) |

A refusal is a configuration problem, not a transient network failure, and is never
classified as a retryable network error. Two provider-neutral errors
(`common/security/connector-target-errors.ts`) carry it:

| Public code | Thrown by | `reason` values |
|---|---|---|
| `CONNECTOR_REDIRECT_BLOCKED` | `fetchWithValidatedRedirects` (`ConnectorRedirectError`) | the `REDIRECT_*` values in the table above |
| `CONNECTOR_TARGET_UNSAFE` | `validateConnectorTargetUrl` (`ConnectorTargetUnsafeError`, a `BadRequestException` subclass so existing handling is unchanged) | `URL_REQUIRED`, `URL_INVALID`, `HTTPS_REQUIRED`, `BLOCKED_HOST`, `PRIVATE_IP_LITERAL`, `PRIVATE_IP_RESOLVED`, `UNRESOLVABLE` |

- Credential verification maps either to `invalid` with a connector-prefixed reason code
  (for example `WOOCOMMERCE_REDIRECT_CROSS_ORIGIN`).
- Publish/update propagate the error unwrapped and the marketplace layer records it as a
  channel error with the neutral code, `reason` and `provider` (the connector slug), never as
  `CONNECTOR_PUBLISH_FAILED`/`CONNECTOR_UPDATE_FAILED` and never as an expired credential.
- Webhook target validation is unchanged (plain `BadRequestException`).

## Rollout

1. Odoo (done): single choke point `OdooConnector.httpFetch`.
2. WooCommerce (`callApi`), PrestaShop and Shopware (`fetchWithTimeout`) (done): each wraps
   its connector's single outbound choke point the same way. Their write bodies (product
   JSON/XML, Shopware's token-exchange `client_secret`) and the unvalidated destination were
   exposed even where the auth header would have been stripped cross-origin.
3. These four are the only connectors that read a tenant-supplied URL credential
   (`odoo_url`, `site_url`, `store_url` x2). Shopify's shop domain is pinned by regex to
   `*.myshopify.com`; the other connectors use fixed provider hosts. Any connector that later
   accepts a tenant URL must adopt the wrapper.
4. Unauthenticated discovery calls (none implemented) could follow cross-origin hops with
   per-hop validation; that mode is intentionally absent until a caller needs it.

## Out of scope

- Connection-time address pinning is a separate control: see `connector-dns-pinning.md`.
- Dropping `requireResolvable: false` at dispatch time (the URL pre-check still soft-allows a
  name with no DNS answer; the pinned transport fails closed at connection time).
