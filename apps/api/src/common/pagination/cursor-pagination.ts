export const DEFAULT_CURSOR_LIMIT = 50;
export const MAX_CURSOR_LIMIT = 200;

export interface CursorPaginationQuery {
  pagination?: string;
  limit?: number;
  cursor?: string;
}

export interface CursorPaginationToken {
  sort: string;
  id: string;
}

export interface CursorPaginatedResponse<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
}

export function isCursorPagination(query?: CursorPaginationQuery): boolean {
  return String(query?.pagination ?? "")
    .trim()
    .toLowerCase() === "cursor";
}

export function resolveCursorLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_CURSOR_LIMIT;
  }
  const parsed = Math.floor(Number(limit));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CURSOR_LIMIT;
  }
  return Math.max(1, Math.min(MAX_CURSOR_LIMIT, parsed));
}

export function encodeCursorToken(token: CursorPaginationToken): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

export function decodeCursorToken(cursor?: string): CursorPaginationToken | null {
  const value = String(cursor ?? "").trim();
  if (!value) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const sort = typeof decoded.sort === "string" ? decoded.sort.trim() : "";
    const id = typeof decoded.id === "string" ? decoded.id.trim() : "";
    if (!sort || !id) {
      return null;
    }
    return { sort, id };
  } catch {
    return null;
  }
}
