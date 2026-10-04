# Connector SSRF: redirect handling (design, not yet implemented)

Status: proposal. The IP-classification bypasses in `validateConnectorTargetUrl` /
`validateWebhookTargetUrl` are fixed separately; this document covers the two gaps that
remain after that fix and are deliberately **not** changed in the same PR.

## Current behavior (verified by code read)

- `validateConnectorTargetUrl` validates the URL the tenant typed, once, at install time
  and at each `resolveCredentials()` call. It does not see what the HTTP client later does.
- No tenant-URL call path sets `redirect:`. WooCommerce, Odoo, PrestaShop and Shopware use
  `fetch` (raw, or `ctx.fetch` -> `ConnectorHttpClient`) with the default `redirect: "follow"`.
  The only `redirect: "manual"` in `apps/api/src` is outbound webhook dispatch
  (`outbound-webhooks.service.ts`).
- Consequence: a public, validated host can answer `30x Location: https://10.0.0.5/...` (or
  any internal/metadata address) and the request is followed to the unvalidated target.
  The fetch spec strips `Authorization` on a cross-origin hop, but request bodies that are
  preserved by 307/308 (Odoo JSON-RPC carries the password in the body), query-string
  credentials, and the response body are not protected.
- Separate, smaller gap: DNS is resolved once for validation and again by `fetch`
  (rebinding window). `requireResolvable: false` at connector call sites also lets a
  non-resolving name through at validation time.

## Why not just `redirect: "manual"` everywhere

Real stores commonly redirect (`http`->`https`, apex->`www`, `/wp-json` slash
normalization). A blanket manual mode would break installs that work today.

## Proposed design

1. One helper, `fetchWithValidatedRedirects(url, init, { maxHops = 3 })`, in
   `common/security`, used by `ConnectorHttpClient` and by the connectors' raw-fetch
   wrappers for tenant-supplied hosts.
2. It sends every hop with `redirect: "manual"`; on a 301/302/303/307/308 it resolves
   `Location` against the current URL and runs `validateConnectorTargetUrl` on the result
   **before** issuing the next request. A blocked hop aborts with the same
   `BadRequestException` family and a stable reason code.
3. Credential-bearing requests additionally require the redirect target to keep the same
   origin (scheme + host + port). Cross-origin redirects are refused for authenticated
   calls rather than followed with credentials stripped, because body- and query-borne
   credentials cannot be reliably stripped.
4. Unauthenticated discovery calls may follow cross-origin hops, still revalidated per hop.
5. Method/body rules follow the spec (301/302 POST->GET, 303 -> GET, 307/308 preserve);
   a hop that would replay a body to a different origin is refused.
6. Rollout: ship behind the existing connector call sites one connector at a time,
   starting with Odoo (password in body), with a per-hop log line including the validated
   host so regressions on legitimate redirecting stores are visible.

## Tests required for the implementation PR

- Public host 302 -> `https://169.254.169.254/`, `https://[::ffff:7f00:1]/`, `http://...`:
  second request is never issued.
- Same-origin redirect (`http`->`https` is a scheme change and is treated as cross-origin
  for authenticated calls; apex->`www` likewise) behavior is pinned explicitly either way.
- Redirect loop and `maxHops` exhaustion.
- 307 with body to a different origin is refused; credentials never sent to hop N+1.

## Out of scope / follow-ups

- Pinning the validated IP for the actual connection (undici `connect` lookup hook) to
  close the rebinding window.
- Dropping `requireResolvable: false` at dispatch time, which needs the connector specs'
  synthetic `*.example.com` hosts rewritten.
