import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { APP_ROLES, AppRole, DEFAULT_WRITE_ROLES, ROLES_KEY } from "./roles";
import { resolveDefaultRole } from "./role-utils";
import { IS_PUBLIC_KEY } from "../../auth/public.decorator";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      FastifyRequest & { pimRole?: AppRole; pimTenant?: string; pimUserId?: string }
    >();
    const handlerRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!request.pimRole) {
      request.pimRole = resolveDefaultRole();
    }
    const actorRole = request.pimRole;

    if (!request.pimTenant) {
      throw new ForbiddenException("Tenant context is required.");
    }

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
    if (!DEFAULT_WRITE_ROLES.includes(actorRole as (typeof APP_ROLES)[number])) {
      throw new ForbiddenException(`Role ${actorRole} cannot perform write operations.`);
    }
    return true;
  }
}
