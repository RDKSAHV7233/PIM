import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { APP_ROLES, AppRole, DEFAULT_WRITE_ROLES, ROLES_KEY } from "./roles";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeRole(value: unknown): AppRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  return null;
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const handlerRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const headerRoleValue = Array.isArray(request.headers["x-pim-role"])
      ? request.headers["x-pim-role"][0]
      : request.headers["x-pim-role"];
    const headerRole = normalizeRole(headerRoleValue);
    if (headerRoleValue && !headerRole) {
      throw new ForbiddenException("Invalid role in x-pim-role header.");
    }

    const envDefaultRole = normalizeRole(process.env.PIM_DEFAULT_ROLE);
    const actorRole = headerRole ?? envDefaultRole ?? "admin";
    (request as FastifyRequest & { pimRole?: AppRole }).pimRole = actorRole;

    if (handlerRoles && handlerRoles.length > 0) {
      if (!handlerRoles.includes(actorRole)) {
        throw new ForbiddenException(`Role ${actorRole} cannot access this endpoint.`);
      }
      return true;
    }

    const method = (request.method ?? "GET").toUpperCase();
    if (READ_METHODS.has(method)) {
      return true;
    }
    if (!DEFAULT_WRITE_ROLES.includes(actorRole)) {
      throw new ForbiddenException(`Role ${actorRole} cannot perform write operations.`);
    }
    return true;
  }
}
