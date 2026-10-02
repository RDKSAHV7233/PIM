import type { NextFunction, Request, Response } from "express";
import { VALIDATION_FAILED_CODE } from "./validation-exception.factory";

const NUL = "\u0000";

/** Iterative walk (no depth cap, no recursion) so deeply nested JSON cannot slip past the scan. */
function containsNul(root: unknown): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      if (value.includes(NUL)) {
        return true;
      }
      continue;
    }
    if (value === null || typeof value !== "object") {
      continue;
    }
    // Raw webhook bodies are Buffers; binary payloads are not text fields.
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        stack.push(entry);
      }
      continue;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes(NUL)) {
        return true;
      }
      stack.push(entry);
    }
  }
  return false;
}

/**
 * PostgreSQL text columns cannot store U+0000, so a NUL anywhere in a text field makes the
 * query fail and the API answers HTTP 500 (prod-cert DEF-PC-010: reproduced on live with
 * `GET /api/catalog/search?q=a%00b`, and locally on category names and media filenames).
 * This is the cheap early check for JSON/query/URL input. Values that only appear after the
 * body parsers (multipart files, CSV cells) are covered by the global exception filter, which
 * maps the database's own "invalid byte sequence ... 0x00" error to the same 400.
 * Mount AFTER helmet, CORS and the correlation middleware so the 400 carries their headers.
 * Note: at app level `req.params` is not populated yet; a NUL in a path segment is caught by
 * the percent-encoded check on the raw URL.
 */
export function rejectNulBytesMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawUrl = String(req.originalUrl ?? req.url ?? "");
  if (/%00/i.test(rawUrl) || containsNul(req.query) || containsNul(req.body)) {
    res.status(400).json({
      error: VALIDATION_FAILED_CODE,
      message: "Request contains a NUL (U+0000) character, which is not allowed.",
      fields: [],
    });
    return;
  }
  next();
}
