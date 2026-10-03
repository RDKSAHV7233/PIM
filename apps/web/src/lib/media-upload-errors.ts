/**
 * True when the API rejected a media upload because the file is not an allowed image: either the declared
 * type is not on the allowlist or it does not match the file's actual bytes (INC-84-S3). The API answers
 * 400 with the standard validation envelope `{ error: "VALIDATION_FAILED", fields: [{ field: "mimeType", ... }] }`.
 *
 * Duck-typed on `status`/`body` (what `ApiHttpError` carries) so it can be used and tested without the API client.
 */
export function isMediaTypeRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 400 || !body || typeof body !== "object") {
    return false;
  }
  const { error: code, fields } = body as { error?: unknown; fields?: unknown };
  if (code !== "VALIDATION_FAILED" || !Array.isArray(fields)) {
    return false;
  }
  return fields.some((entry) => Boolean(entry) && typeof entry === "object" && (entry as { field?: unknown }).field === "mimeType");
}
