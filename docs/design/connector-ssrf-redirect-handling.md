# Connector SSRF: authenticated redirect handling

Status: implemented for **Odoo** (the worst path: its JSON-RPC body carries the database
password/API key). WooCommerce, PrestaShop and Shopware are not yet wired up; see
"Rollout". DNS pinning is a separate control and is not part of this change.

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

A refusal is a configuration problem, not a transient network failure: Odoo reports it as
`invalid` credential verification (`ODOO_REDIRECT_*` reason codes) and as a seller-facing
publish issue on field `odoo_url` asking the operator to reconnect with the canonical URL.
It is never classified as a retryable network error.

## Rollout

1. Odoo (done): single choke point `OdooConnector.httpFetch`.
2. WooCommerce, PrestaShop, Shopware: each wraps its own tenant-URL fetch the same way; they
   authenticate with headers, which fetch strips on a cross-origin hop, but body/query-borne
   values and the unvalidated destination remain. One connector per PR with its own tests.
3. Unauthenticated discovery calls (none implemented) could follow cross-origin hops with
   per-hop validation; that mode is intentionally absent until a caller needs it.

## Out of scope

- Pinning the validated IP for the actual connection (resolve once, connect to that address,
  keep TLS SNI/hostname verification): next PR.
- Dropping `requireResolvable: false` at dispatch time.
