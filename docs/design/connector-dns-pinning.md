# Connector DNS pinning

Credential-bearing requests to a tenant-supplied host (Odoo, WooCommerce, PrestaShop,
Shopware) go through one transport, `PinnedUndiciTransport`
(`apps/api/src/common/security/`), reached via `getConnectorTransport()`.

## Problem

`validateConnectorTargetUrl` resolved the hostname with c-ares (`resolve4`/`resolve6`) and
then `fetch` resolved it again with getaddrinfo to open the socket. Two resolvers and two
moments in time: a hostname could pass validation and connect to a different, internal
address (DNS rebinding), and `requireResolvable: false` let a name with no answer through
validation altogether.

## Invariant (per request attempt)

```
resolve A/AAAA once (getaddrinfo, the resolver the socket layer would use)
-> refuse the whole attempt if ANY candidate is unsafe
-> the socket may only dial addresses from that validated set
-> verify the connected peer address is a member of the set
```

Every redirect hop and every retry is a new attempt and repeats the full cycle. The request
URL is never rewritten: the original hostname stays in the `Host` header, the TLS SNI and the
certificate hostname check, and TLS verification is left at defaults.

## How

- `undici.fetch` and `Agent` come from the npm `undici` package (7.x) and are used together.
  An npm `Agent` paired with Node's bundled global `fetch` breaks across undici majors, so the
  transport never touches global fetch. CI runs the transport specs on Node 22 and Node 24
  (`connector-network-transport` job).
- The `Agent` has a custom `connect` hook. Per connection it resolves and validates, then
  builds an undici connector whose `lookup` returns only the validated candidates (honouring
  `all`/`family`, never calling DNS, erroring on a second call) and checks `socket.remoteAddress`.
- IP-literal URLs never reach `lookup`; the hook classifies them directly.
- A mixed answer (public + internal) is refused outright; the safe members are not used.
- Classification is the existing `isBlockedAddress` (IPv4-mapped, NAT64, 6to4, ... judged by
  the embedded IPv4). `PIM_UNSAFE_HTTP_WEBHOOK_TARGETS=true` (local fixtures only) keeps its
  current meaning and is read at call time.
- Keep-alive reuse is disabled (`pipelining: 0`): a reused socket skips the connect hook, so
  "validated for this attempt" would otherwise hold only for the attempt that opened it.
  Cost: one TLS handshake per call.

## Errors

| Condition | Result |
|---|---|
| any candidate unsafe | `CONNECTOR_TARGET_UNSAFE`, reason `PRIVATE_IP_RESOLVED` |
| unsafe IP literal | `CONNECTOR_TARGET_UNSAFE`, reason `PRIVATE_IP_LITERAL` |
| connected address not in the set | `CONNECTOR_TARGET_UNSAFE`, reason `CONNECTED_ADDRESS_NOT_VALIDATED` |
| no DNS answer | DNS network error (non-retryable), not a security error |

`ConnectorHttpClient` surfaces target-security errors immediately and never retries them.

## Known limits

- The post-connect address check is defence in depth. Where the platform does not expose the
  peer address it is skipped with a one-time warning (observed on Node 24.15 / Windows, where
  the value is an empty string; it is populated on Linux Node 22.23 and 24.21). The
  restriction that the socket can only dial validated addresses does not depend on it.
- Resolution moves from c-ares to getaddrinfo, so `/etc/hosts` and the system resolver
  configuration now apply.
- Not covered yet: outbound webhook dispatch (same transport, separate follow-up) and
  fixed-host connectors, which take no tenant URL.

## Tests

`pinned-undici-transport.spec.ts` runs the real transport against local TLS servers
(throwaway CA under `apps/api/test/fixtures/tls/`). For each refusal it asserts that a server
listening on the forbidden address (127.0.0.2) saw **zero connections**. It also covers the
SNI/Host/certificate checks, mixed answers, DNS flipping between attempts and between
redirect hops, IP literals, dead-first-address fallback, IPv6-only hosts, abort without leaked
sockets, and that `globalThis.fetch` is never called. `connector-transport.static.spec.ts`
bans TLS-verification overrides, URL rewriting and global-fetch use in the transport, and
bare `fetch(` in the four connectors. Set `REQUIRE_FULL_LOOPBACK=1` to fail instead of
skipping when 127.0.0.2 or `::1` is unavailable (the CI job does).
