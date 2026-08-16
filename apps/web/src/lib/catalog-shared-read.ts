import { ApiHttpError } from "./api/core";

/**
 * Extracted from apps/web/src/app/catalog/products/page.tsx (byte-for-byte behavior
 * preserved at extraction time) so it can be exercised directly by an executable
 * behavioral regression test — see
 * apps/web/test/integration/catalog-shared-read-timeout-classification.test.ts.
 *
 * This module has no React/Next.js dependency and no side effects, by design: that's
 * what makes it possible to run it under plain ts-node in CI without a browser or a
 * Next.js request context. Imports directly from ./api/core (not the @/lib/api barrel
 * or the @/ tsconfig path alias) so this file has zero dependency on Next.js-specific
 * module resolution and can be loaded by a plain `ts-node`/`tsc` process. Investigation
 * for PIM#578.
 */

export type SharedReadState = "available" | "restricted" | "unavailable";
export type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

export function isCatalogProductsApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

export async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>> {
  try {
    return {
      state: "available",
      value: await promise,
    };
  } catch (error) {
    if (error instanceof ApiHttpError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.status === 403) {
        return { state: "restricted" };
      }
    }
    if (isCatalogProductsApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}
