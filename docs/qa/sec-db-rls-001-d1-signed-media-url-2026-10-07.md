# SEC-DB-RLS-001 D1: the public media file route reads the asset as the tenant named by a signed token

Date: 2026-10-07
Baseline: `origin/main` at `b2d61b87` (`CI` and `Deploy Staging` green; #1204 and #1206 merged)
Issue: #1189. Decision D1, approved 2026-10-07: "signed token carrying tenant context; verify the signature and expiry before any asset lookup; no unsigned tenant-parameter fallback".
Type: **application change. Before the signing key is provisioned nothing changes for anyone** (the route keeps its previous behaviour, the new token field is `null`, generated URLs are unchanged). No production access, credential or role change, no AI provider path.

## 1. The failure

`GET /media/assets/:id/file` is deliberately unauthenticated so external systems can fetch an image (a marketplace pulling a product image; the web app's thumbnails also go through it). It looked the asset up by id with the context-free database client. No tenant is known in that handler, so **under row level security the lookup sees only the default tenant and every other tenant's images would 404** after the role cutover. This was found while migrating the connector files (M1b): the inventory had classed it as a mechanical swap, and it is not one, because there is no tenant to swap in.

Reproduced under the restricted role (scenario A of the integration test): with no signing key the default tenant's image is served (200) and a non-default tenant's image is a **404**.

## 2. Design

A token, `v1.<payload>.<signature>` (base64url), carries **tenant, asset, purpose `media-read`, expiry**; the signature is HMAC-SHA256 over `v1.<payload>` with `MEDIA_URL_SIGNING_KEY` (at least 32 characters). `MEDIA_URL_SIGNING_KEY_PREVIOUS` is accepted for verification only, for rotation. `MEDIA_URL_TTL_SECONDS` sets the lifetime (default 7 days, clamped to 60 s .. 30 days).

- **Verified before any database access, in this order:** shape, signature (constant-time), purpose, asset id, expiry. Every failure gets the identical `401 {"error":"MEDIA_TOKEN_INVALID"}`; the specific reason goes to the log only.
- **No unsigned tenant parameter** exists. The tenant comes only from a verified token.
- The lookup then runs through `prisma.tenant(<token tenant>)`: an asset id that belongs to another tenant is simply **not found** (404), whatever the token says.
- **Who gets tokens:** the authenticated asset listing (`presentAsset`) adds `fileToken` for a tenant's own assets; the marketplace/connector image URL generator appends `?t=<token>`. Both emit nothing until the key is configured.

### Rollout compatibility (a deliberate, visible exception)
Until `MEDIA_URL_SIGNING_KEY` is configured the route serves unsigned exactly as before, reads with no tenant, and logs one loud warning per process (`MEDIA_URL_SIGNING_KEY is not configured ... resolve only the default tenant once row level security is enforced`). **Once the key is set, an unsigned request is refused, even for the default tenant.** A token supplied while no key is configured is ignored (the tenant is never taken from something that cannot be verified). This keeps the deploy from breaking existing feeds while making the end state strict. **Provisioning the key is a prerequisite of the role cutover** and is added to the RLS-5 checklist.

## 3. Evidence

- **Token (21 unit tests):** round trip; tenant and asset binding; expiry boundary to the second; tampered payload (a caller cannot switch the tenant) and tampered signature; wrong key; wrong purpose; eight missing/malformed shapes; no key and a too-short key are both "not configured"; key rotation (previous key verifies old tokens, a removed previous key stops verifying); TTL clamping.
- **Route, service and listing (16 tests):** a valid token reads **as the token's tenant**; six refusal cases (no token, empty, garbage, another asset, expired, another key) give the **same answer and never touch the database**; with a key set, an unsigned request is refused even for the default tenant; without a key it behaves as before and warns once per process, not per request; the service uses the tenant's client and never the context-free client, and another tenant's asset id is not found; `fileToken` verifies for the asset's own tenant, is `null` without a key, and is never guessed for a row with no tenant; the connector URL is the plain path before the key and carries a verifying token after. **Mutations:** skipping verification fails 8; ignoring the tenant in the service fails 2.
- **Real PostgreSQL, restricted role, two real API processes, own throwaway database (`media-public-file-token.test.cjs`):** (A) no key: default tenant 200, non-default tenant **404**; (B) with the key: a valid token serves the **non-default** tenant's image and the **bytes are compared**; no token, a token for another asset, an expired token and garbage are 401 with no bytes; a token naming **another tenant** finds nothing (404); the default tenant works with its own token; the API connected as `vexa_runtime_ci`. **Built-code mutation** (service back on the context-free client): the valid-token request returns 404 and the test fails.
- 979 unit tests across `media`, `marketplace` and `common` pass; type-check and the ratchet pass; **OpenAPI regeneration produces no diff**.
- **Restricted-role lane (local PostgreSQL 16, API as `vexa_runtime_ci`): 28 pass, 0 expected failures, 0 unexpected failures, 0 unexpected passes.**

## 4. Limits and what a human must do

- **Provision `MEDIA_URL_SIGNING_KEY`** (a long random secret, in the API service's variables) before the role cutover. Merging this PR does not require it. After it is set, unsigned public URLs stop working, so any system holding an old unsigned URL must have fetched it already or be given a new one (tokens are regenerated on every export and every authenticated listing).
- **The web app is not changed here.** Its thumbnails use `/api/media/assets/<id>/file`, which proxies to this route; once the key is set they need to forward the `fileToken` from the asset listing (a small follow-up PR in `apps/web`, a different risk domain). Because the key is unset until then, nothing breaks in the meantime. **Do not set the key before that web change is deployed.**
- Orphans and other cross-tenant concerns are unchanged. The token TTL is a trade-off: long enough for an external system to fetch (default 7 days), short enough to bound a leaked URL.
- The legacy unsigned branch (and the context-free client in `media.service.ts`) is removed in a later PR once the key is provisioned everywhere.

## 5. Next

Web follow-up (forward `fileToken` in the two thumbnail components and the proxy), then add `MEDIA_URL_SIGNING_KEY` to the cutover checklist. Pending in parallel: #1208 (I-5a) and #1210 (I-3a) need labels.
