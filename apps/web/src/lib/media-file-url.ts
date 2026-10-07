/**
 * SEC-DB-RLS-001 D1: the URL a browser uses to load a media asset's file through the web app's proxy.
 *
 * The API's public file route requires a signed, tenant-bound token once MEDIA_URL_SIGNING_KEY is configured. The authenticated asset
 * listing hands each of the tenant's own assets a `fileToken`; this appends it as `?t=`. Before the key is configured the field is
 * null and the URL is the plain path, exactly as before.
 */

/** A token is base64url segments joined by dots; anything else is not forwarded upstream. */
export const MEDIA_FILE_TOKEN_PATTERN = /^[A-Za-z0-9._-]{1,2048}$/;

export function mediaFileUrl(asset: { id: string; fileToken?: string | null }): string {
  const base = `/api/media/assets/${encodeURIComponent(asset.id)}/file`;
  const token = typeof asset.fileToken === "string" ? asset.fileToken.trim() : "";
  return token && MEDIA_FILE_TOKEN_PATTERN.test(token) ? `${base}?t=${encodeURIComponent(token)}` : base;
}
