# SEC-DB-RLS-001 D1b: the web thumbnails forward the signed media token

Date: 2026-10-07
Baseline: `origin/main` at `b2d61b87`. Companion to the API change in #1211 (D1); independent of it for merging, because the field is optional.
Type: **web change, no behaviour change until the API's `MEDIA_URL_SIGNING_KEY` is configured.** No production access, credential or role change.

## Why

The API's public file route (`GET /media/assets/:id/file`) requires a signed, tenant-bound token once its signing key is set (D1, #1211). The web app's thumbnails load `/api/media/assets/<id>/file`, which proxies to that route. Without this change they would 401 for every tenant the moment the key is provisioned.

## Change

- `lib/media-file-url.ts`: `mediaFileUrl(asset)` returns the plain proxy path, plus `?t=<token>` when the asset carries a well-formed `fileToken`; `MEDIA_FILE_TOKEN_PATTERN` (`[A-Za-z0-9._-]{1,2048}`) is the single definition of "well-formed".
- `MediaAsset` (API client type) gains the optional `fileToken?: string | null`, which the authenticated asset listing returns.
- The two thumbnail sites (`app/media/page.tsx`, `products/[id]/_components/media-tab.tsx`) build their URL with `mediaFileUrl`.
- The proxy route reads `?t=`, forwards it upstream **only if it matches the pattern**, and otherwise drops it (no raw query value reaches the upstream URL).

## Evidence

`media-file-token-forwarding.test.cjs` (registered in the web integration coverage list): runs the real helper (transpiled) for no/null/empty/whitespace tokens (plain path, as before), a valid token appended, an encoded id, a malformed and an over-long token dropped, and the pattern's accept/reject set; and checks by source that both components use the helper and not the bare path, `MediaAsset` declares the field, and the route validates before forwarding. **Mutations:** a bare path in the product media tab fails it; the route forwarding the raw query value fails it.

## Limits

- The web workspace's dependencies (`next`, React types) are not installed in my sandbox, so I could not run the web type-check; the files I touched have no errors of their own in that run, and CI's `build` job runs the web lint with dependencies installed.
- It is a source-and-helper test, not a browser test: the proxy route itself is not executed.
- **Order of rollout:** merge both PRs, deploy, then set `MEDIA_URL_SIGNING_KEY`. With the key unset nothing changes.
