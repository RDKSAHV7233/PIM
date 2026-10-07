# Signed media URL activation runbook

Date: 2026-10-07
Baseline: `origin/main` at `24bf1451`
Type: **documentation only.** This runbook sets no key, changes no variable and runs nothing. **Setting `MEDIA_URL_SIGNING_KEY` is a human production change** (SEC-DB-RLS-001 D1, #1211 and #1212).
Status: **proposal / awaiting human approval.** Written by Stream B as preparation; the RLS stream (Stream A) owns the cutover that depends on it.

## 1. Why this exists

The public route `GET /media/assets/:id/file` is unauthenticated on purpose. With no tenant known in that handler, a restricted database role sees only the default tenant, so after the role cutover every non-default tenant's images would 404. D1 added a signed, tenant-bound, expiring token; the code is merged and deployed, and **the key is deliberately unset**, so today the route serves unsigned exactly as before and logs one warning per process.

**Activating the key, and verifying signed URLs, is a prerequisite of the restricted database-role cutover** (reconciliation note #1215, section 5). This runbook is how to do that safely.

| State | Route behaviour |
|---|---|
| key **unset** (today) | serves unsigned; a supplied token is ignored (the tenant is never taken from something that cannot be verified); one warning per process |
| key **set** | **an unsigned request is refused with 401, even for the default tenant**; a valid token serves the asset as the token's tenant; every failure gives the identical `401 {"error":"MEDIA_TOKEN_INVALID"}` |

Token: `v1.<payload>.<signature>`; binds tenant, asset, purpose `media-read` and expiry; HMAC-SHA256 with the key (at least 32 characters). `MEDIA_URL_SIGNING_KEY_PREVIOUS` is accepted for verification only. `MEDIA_URL_TTL_SECONDS` sets the lifetime (default 7 days, clamped to 60 seconds to 30 days).

## 2. Hard rules

1. **No agent or script generates, receives, reads, pastes or stores the key.** A human generates it and enters it into the variable store. Verification is by variable **name present**, never by value.
2. The key lives in **one place**: a variable on the **Vexa API service**. The web service needs **no** key (it forwards the token the API's authenticated listing returns). Not in the repository, GitHub secrets, `.env` files, tickets, chat, logs or screenshots with the value visible.
3. Do not set the key until the pre-flight in section 3 is complete.
4. Smoke-test records contain **no token values**: names, status codes and booleans only.

## 3. Pre-flight (all by a human; each recorded with who and when)

- [ ] **The code is live.** The deployed API includes #1211 (`2aa5d430`) and the web app includes #1212 (`fee87db5`): check the last successful "Deploy Staging" run for each service. The web thumbnails must forward the token **before** the key is set, or they break (D1 evidence document, section 4).
- [ ] **Production storage mode is known.** Read the `storage.mode` field of the media-integrity scan result (`filesystem` or `object_storage`; `MediaStorageService.storageSnapshot`). This decides section 3.2.
- [ ] **Who holds unsigned URLs is known (section 3.2).**
- [ ] **TTL decided (section 3.3).**
- [ ] **Window and people:** a change window outside peak use; on-call notified; a named rollback owner; a named second person for verification.
- [ ] **Baseline recorded in unsigned mode:** the smoke tests S2, S3 and S7 below pass **before** the key is set, so a later failure is attributable.

### 3.1 What a token changes for each consumer

| Consumer | How it gets an image URL | Effect of activation |
|---|---|---|
| Web app thumbnails (`/api/media/assets/:id/file`) | the authenticated asset listing returns `fileToken`; the web proxy forwards it (#1212) | works once the web change is live; tokens are regenerated on every listing |
| Connector and marketplace payloads, **local filesystem storage** | `buildPublicMediaFileUrl` appends `?t=<token>` to the API route URL | new payloads carry a token; **URLs generated earlier are unsigned and will 401** |
| Connector and marketplace payloads, **object storage** | the R2 public URL (`R2_PUBLIC_URL/<path>`), which does **not** go through this route | unaffected by the key |
| Anyone holding a bookmarked or pasted unsigned API-route URL | n/a | 401 |

### 3.2 The risk to check: previously issued unsigned URLs

If production storage is **object storage**, marketplace payloads use R2 URLs and the key does not touch them; the remaining consumers are the web app and any hand-shared route URLs. If it is **filesystem**, every marketplace listing or export that embedded an API-route URL holds an unsigned URL that stops working at activation, and a marketplace that re-fetches the image later would lose it. A human with product and connector knowledge must list which systems received route URLs (marketplace listings, exports, emails, documents), and decide whether to re-export before activation. **Do not assume none exist.**

### 3.3 The risk to check: token expiry for external consumers

Tokens expire (default 7 days, at most 30). An external system that fetches once at publish time is fine; one that re-fetches an image after the token expired will get 401. Decide, with the connector owners, whether the default is acceptable, whether `MEDIA_URL_TTL_SECONDS` should be raised (the cap is 30 days), or whether exports are regenerated on a cadence shorter than the TTL. A longer TTL widens the window for a leaked URL; record the trade-off.

## 4. Activation

1. A human generates the key on their own machine with a cryptographically secure generator (at least 32 characters; for example `openssl rand -base64 48`), and keeps it out of any shared channel.
2. Enter it as `MEDIA_URL_SIGNING_KEY` on the **Vexa API service** in the single Railway environment. Optionally set `MEDIA_URL_TTL_SECONDS` per section 3.3.
3. Changing a Railway variable restarts the single API replica: expect a brief API-wide interruption, not only a media blip.
4. Confirm by **name** that the variable is present, the API is healthy, and the startup warning `MEDIA_URL_SIGNING_KEY is not configured ...` no longer appears for the new process.
5. Run the smoke tests (section 5) immediately.

## 5. Smoke tests (record status codes and booleans only)

Use two assets: one in the default tenant and one in a **non-default** tenant. Never record a token value.

| # | Test | Expected after activation |
|---|---|---|
| S1 | request the route with **no** token | `401`, body `MEDIA_TOKEN_INVALID`, no bytes (for the default tenant too) |
| S2 | the authenticated asset listing for each asset | `fileToken` is present and non-null for both |
| S3 | request the route with that asset's token | `200`, the image bytes (compare a hash with the baseline) |
| S4 | the same token with one character changed | `401`, same body as S1 |
| S5 | a valid token for asset A used on asset B's URL | `401`, same body |
| S6 | a token naming one tenant used for another tenant's asset id | `401` or `404`, never the bytes |
| S7 | the web app: the media library and a product's media tab, as a default-tenant user and as a non-default-tenant user | thumbnails render for both |
| S8 | (filesystem storage only) generate a connector payload and inspect the image URL | ends in `?t=...` and S3 passes against it |
| S9 | the API log after restart | no `MEDIA_URL_SIGNING_KEY is not configured` warning |
| S10 | the same S3 request again after a few minutes | still `200` (the token has not been invalidated by the restart) |

Any failure of S1 to S7 is a rollback trigger (section 6). S6 and S5 are the isolation checks: a valid token must never serve another asset or tenant.

## 6. Rollback

**Trigger:** S1 to S7 failing; web thumbnails broken for any tenant; marketplace image fetch failures traced to the route; a 5xx spike on the route.

1. Remove (or blank) `MEDIA_URL_SIGNING_KEY` on the API service. The replica restarts.
2. Result: the route returns to unsigned compatibility mode; tokens already issued are ignored; unsigned URLs work again. **No data change is involved**, so rollback has no cleanup.
3. Record the failure, fix the cause, and re-run section 3 before trying again.

## 7. Key rotation (after activation)

1. Set `MEDIA_URL_SIGNING_KEY_PREVIOUS` to the **old** key and `MEDIA_URL_SIGNING_KEY` to the **new** key (a restart). Tokens signed with the old key still verify; new tokens use the new key.
2. Keep the previous key at least as long as the longest TTL in use (30 days at most), then remove it.
3. Re-run S1 to S4 after each change. Treat suspected exposure as an immediate rotation with a short TTL window.

## 8. After activation: what must be re-proven at the role cutover

Under the **current** production role (a superuser), activation proves the token mechanism but **cannot** prove that non-default tenants' images survive row level security, because the role bypasses it. The RLS-5 rehearsal and the first post-cutover check must run **S3 and S7 for a non-default tenant under the restricted runtime role**. Only then is media closed on the cutover checklist.

Separately, activation has an immediate security benefit independent of the cutover: the unauthenticated route stops serving any asset to a caller who merely knows or guesses an asset id.

## 9. Evidence record (names, status codes and booleans only)

| Field | Value |
|---|---|
| Authorised by / performed by / verified by (names), window (UTC) | |
| Deployed API and web SHAs (confirming #1211 and #1212) | |
| Production storage mode | |
| Inventory of external holders of route URLs; re-export done (yes / no / not applicable) | |
| TTL chosen and rationale | |
| S1 to S10 results (pass / fail, status codes) | |
| Rollback used (yes / no) | |
| Post-cutover S3 and S7 for a non-default tenant under the restricted role | to be completed at RLS-5 |

## 10. Sign-off block (blank)

| Item | Decision | Name and date |
|---|---|---|
| Activation approved (CTO) | [ ] | |
| Pre-flight 3.2 and 3.3 reviewed (connector owner) | [ ] | |
| Key owner and verifier named | [ ] | |

## 11. What this runbook does not do

It generates and sets no key, changes no variable, deploys nothing and changes no code. It does not decide the TTL or the re-export question; those are named for humans. It does not close the media item on the cutover checklist; that needs section 8.
