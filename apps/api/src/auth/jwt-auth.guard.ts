import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { resolveDefaultRole } from "../common/rbac/role-utils";
import { AppRole } from "../common/rbac/roles";
import { normalizeTenantKey, TENANT_HEADER } from "../common/tenant/tenant.constants";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { PimJwtClaims, decodePimJwtFromAuthHeader } from "./jwt";
import { IS_PUBLIC_KEY } from "./public.decorator";

interface AuthenticatedRequest extends FastifyRequest {
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
  pimJwtClaims?: PimJwtClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtBlocklistService: JwtBlocklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roleHeader = request.headers["x-pim-role"];
    if (request.headers[TENANT_HEADER] || roleHeader) {
      throw new ForbiddenException("Legacy auth headers are disabled. Use Bearer token authentication.");
    }

    const claims = decodePimJwtFromAuthHeader(request.headers.authorization);
    if (claims) {
      const revoked = await this.jwtBlocklistService.isRevoked(claims.jti);
      if (revoked) {
        throw new UnauthorizedException({ error: "TOKEN_REVOKED" });
      }
      request.pimUserId = claims.sub;
      request.pimTenant = normalizeTenantKey(claims.tenantId);
      request.pimRole = claims.role ?? resolveDefaultRole();
      request.pimJwtClaims = claims;
      return true;
    }

    throw new UnauthorizedException("Bearer token is required.");
  }
}
