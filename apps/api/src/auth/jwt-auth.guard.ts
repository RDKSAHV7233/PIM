import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { extractApiKeyFromHeaders } from "../api-keys/api-key-auth";
import { ApiKeysService, type ResolvedApiKeyIdentity } from "../api-keys/api-keys.service";
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
  pimResolvedApiKey?: ResolvedApiKeyIdentity | null;
  pimAuthType?: "user_jwt" | "api_key";
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtBlocklistService: JwtBlocklistService,
    private readonly apiKeysService: ApiKeysService,
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
      if (claims.tokenType === "step_up") {
        throw new UnauthorizedException({ error: "STEP_UP_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN" });
      }
      const revoked = await this.jwtBlocklistService.isRevoked(claims.jti);
      if (revoked) {
        throw new UnauthorizedException({ error: "TOKEN_REVOKED" });
      }
      request.pimUserId = claims.sub;
      request.pimTenant = normalizeTenantKey(claims.tenantId);
      request.pimRole = claims.role ?? resolveDefaultRole();
      request.pimJwtClaims = claims;
      request.pimAuthType = "user_jwt";
      return true;
    }

    const apiKey = extractApiKeyFromHeaders(request.headers as Record<string, string | string[] | undefined>);
    if (apiKey) {
      const resolved = request.pimResolvedApiKey ?? await this.apiKeysService.resolveApiKey(apiKey);
      if (!resolved) {
        throw new UnauthorizedException({ error: "INVALID_API_KEY" });
      }
      request.pimUserId = resolved.actorId;
      request.pimTenant = normalizeTenantKey(resolved.tenantId);
      request.pimRole = resolved.role ?? resolveDefaultRole();
      request.pimAuthType = "api_key";
      void this.apiKeysService.touchLastUsed(resolved.keyId);
      return true;
    }

    throw new UnauthorizedException("Bearer token or API key is required.");
  }
}
