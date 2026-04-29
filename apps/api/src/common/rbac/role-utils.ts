import {
  ADMIN_BOUNDARY_ROLES,
  APP_ROLE_PRECEDENCE,
  APP_ROLES,
  BLOCKED_FOUNDATION_ROLES,
  type AdminBoundaryRole,
  type AppRole,
  type BlockedFoundationRole,
  type FoundationRole,
} from "./roles";

export type PrincipalType = "human" | "api_client" | "system";
export type AdminBoundaryCapability =
  | "manage_product_data"
  | "manage_users"
  | "manage_security"
  | "manage_support_access"
  | "manage_platform";

export const ADMIN_BOUNDARY_MATRIX: Record<
  AdminBoundaryRole,
  Record<AdminBoundaryCapability, boolean> & { internalOnly: boolean }
> = {
  product_admin: {
    manage_product_data: true,
    manage_users: false,
    manage_security: false,
    manage_support_access: false,
    manage_platform: false,
    internalOnly: false,
  },
  system_admin: {
    manage_product_data: false,
    manage_users: true,
    manage_security: true,
    manage_support_access: true,
    manage_platform: false,
    internalOnly: false,
  },
  super_admin: {
    manage_product_data: true,
    manage_users: true,
    manage_security: true,
    manage_support_access: true,
    manage_platform: true,
    internalOnly: true,
  },
};

export type EffectiveRoleResolution = {
  primaryAppRole: AppRole;
  appRoles: AppRole[];
  adminBoundaryRoles: AdminBoundaryRole[];
  blockedFoundationRoles: BlockedFoundationRole[];
  foundationRoles: FoundationRole[];
};

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

export function normalizeAdminBoundaryRole(value: unknown): AdminBoundaryRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (ADMIN_BOUNDARY_ROLES.includes(normalized as AdminBoundaryRole)) {
    return normalized as AdminBoundaryRole;
  }
  return null;
}

export function normalizeFoundationRole(value: unknown): FoundationRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  if (ADMIN_BOUNDARY_ROLES.includes(normalized as AdminBoundaryRole)) {
    return normalized as AdminBoundaryRole;
  }
  if (BLOCKED_FOUNDATION_ROLES.includes(normalized as BlockedFoundationRole)) {
    return normalized as BlockedFoundationRole;
  }
  return null;
}

export function resolveEffectiveRoles(input: {
  legacyRole?: unknown;
  assignedRoles?: unknown;
  principalType?: PrincipalType;
}): EffectiveRoleResolution {
  const principalType = input.principalType === "api_client" || input.principalType === "system"
    ? input.principalType
    : "human";
  const assignedRoles = Array.isArray(input.assignedRoles)
    ? input.assignedRoles.map((value) => normalizeFoundationRole(value)).filter(Boolean) as FoundationRole[]
    : [];
  const legacyRole = normalizeFoundationRole(input.legacyRole);
  const requestedRoles = dedupeRoles([...(legacyRole ? [legacyRole] : []), ...assignedRoles]);

  const appRoles = principalType === "api_client"
    ? dedupeRoles(
        [normalizeAppRole(input.legacyRole) ?? resolveDefaultRole()].filter(Boolean) as AppRole[],
      )
    : dedupeRoles(
        requestedRoles.filter((role): role is AppRole => APP_ROLES.includes(role as AppRole)),
      );

  const effectiveAppRoles = appRoles.length > 0 ? appRoles : [resolveDefaultRole()];
  const adminBoundaryRoles = principalType === "human"
    ? dedupeRoles(
        requestedRoles.filter((role): role is AdminBoundaryRole => ADMIN_BOUNDARY_ROLES.includes(role as AdminBoundaryRole)),
      )
    : [];
  const blockedFoundationRoles = principalType === "human"
    ? dedupeRoles(
        requestedRoles.filter(
          (role): role is BlockedFoundationRole => BLOCKED_FOUNDATION_ROLES.includes(role as BlockedFoundationRole),
        ),
      )
    : [];

  const primaryAppRole =
    APP_ROLE_PRECEDENCE.find((role) => effectiveAppRoles.includes(role)) ?? resolveDefaultRole();
  const foundationRoles = principalType === "api_client"
    ? [...effectiveAppRoles]
    : dedupeRoles([...effectiveAppRoles, ...adminBoundaryRoles, ...blockedFoundationRoles]);

  return {
    primaryAppRole,
    appRoles: effectiveAppRoles,
    adminBoundaryRoles,
    blockedFoundationRoles,
    foundationRoles,
  };
}

export function hasAdminBoundaryCapability(
  roles: Iterable<unknown>,
  capability: AdminBoundaryCapability,
): boolean {
  const normalized = Array.from(roles)
    .map((role) => normalizeAdminBoundaryRole(role))
    .filter((role): role is AdminBoundaryRole => Boolean(role));
  return normalized.some((role) => ADMIN_BOUNDARY_MATRIX[role][capability] === true);
}

export function hasAdminBoundaryRole(
  roles: Iterable<unknown>,
  allowedRoles: readonly AdminBoundaryRole[],
): boolean {
  const normalized = new Set(
    Array.from(roles)
      .map((role) => normalizeAdminBoundaryRole(role))
      .filter((role): role is AdminBoundaryRole => Boolean(role)),
  );
  return allowedRoles.some((role) => normalized.has(role));
}

export function resolveDefaultRole(): AppRole {
  return normalizeAppRole(process.env.PIM_DEFAULT_ROLE) ?? "viewer";
}

function dedupeRoles<T extends string>(roles: T[]): T[] {
  return Array.from(new Set(roles));
}
