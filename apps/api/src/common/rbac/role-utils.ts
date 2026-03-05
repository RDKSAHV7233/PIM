import { APP_ROLES, AppRole } from "./roles";

export function normalizeAppRole(value: unknown): AppRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  return null;
}

export function resolveDefaultRole(): AppRole {
  return normalizeAppRole(process.env.PIM_DEFAULT_ROLE) ?? "viewer";
}
