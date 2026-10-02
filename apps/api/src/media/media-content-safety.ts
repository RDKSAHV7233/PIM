/**
 * Upload and serving safety for media assets (prod-cert DEF-PC-002 and DEF-PC-014).
 *
 * Before: any client-declared `mimeType` was stored and later served inline from a public,
 * unauthenticated URL, so an uploaded text/html or image/svg+xml document ran as a live page,
 * and a filename with non-Latin characters threw ERR_INVALID_CHAR (HTTP 500) when the
 * Content-Disposition header was built.
 */

export const ALLOWED_MEDIA_MIME_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function normalizeMimeType(value: string): string {
  const base = String(value ?? "").split(";")[0].trim().toLowerCase();
  return base === "image/jpg" || base === "image/pjpeg" ? "image/jpeg" : base;
}

/** Identify a raster image by its magic bytes; returns null for anything else (HTML, SVG, scripts…). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") {
      return "image/gif";
    }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * Content-Disposition value that is always a valid header: ASCII-only `filename` fallback
 * with quotes/backslashes/control characters removed, plus RFC 5987 `filename*` for the
 * real name. Prevents ERR_INVALID_CHAR and parameter injection through a crafted filename.
 */
const BACKSLASH = String.fromCharCode(92);

/** Replace control characters, DEL, double quote, backslash and semicolon (explicit loop, no regex to mis-escape). */
function sanitizeFileNameForHeader(fileName: string): string {
  let out = "";
  for (const ch of String(fileName ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || ch === '"' || ch === BACKSLASH || ch === ";" ? "_" : ch;
  }
  return out.trim() || "file";
}

export function buildContentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const cleaned = sanitizeFileNameForHeader(fileName);
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  let encoded: string;
  try {
    encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    // encodeURIComponent throws URIError on a lone surrogate; fall back to the ASCII form.
    encoded = encodeURIComponent(ascii);
  }
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * The type to validate an upload against. A missing or generic declared type
 * (`application/octet-stream`, the default for bulk rows that carry only base64 content) is
 * resolved from the file's magic bytes; any other declared type is taken as declared and must
 * then match the bytes.
 */
export function resolveUploadMimeType(declaredMimeType: string, buffer: Buffer): string {
  const declared = normalizeMimeType(declaredMimeType);
  if (declared === "" || declared === "application/octet-stream") {
    return sniffImageMimeType(buffer) ?? declared;
  }
  return declared;
}

/**
 * How a stored asset may be delivered. Anything that is not an allowed raster image
 * (including legacy rows uploaded before the allowlist existed, e.g. text/html or svg)
 * is forced to a download with a neutral type so a browser never renders it.
 */
export function resolveServeHeaders(storedMimeType: string, fileName: string): { contentType: string; contentDisposition: string } {
  const mime = normalizeMimeType(storedMimeType);
  if (ALLOWED_MEDIA_MIME_TYPES.has(mime)) {
    return { contentType: mime, contentDisposition: buildContentDisposition("inline", fileName) };
  }
  return { contentType: "application/octet-stream", contentDisposition: buildContentDisposition("attachment", fileName) };
}
