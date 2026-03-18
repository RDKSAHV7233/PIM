import { Injectable, NestMiddleware } from "@nestjs/common";
import { decodePimJwtFromAuthHeader } from "../../auth/jwt";
import { extractApiKeyFromHeaders } from "../../api-keys/api-key-auth";
import { ApiKeysService } from "../../api-keys/api-keys.service";
import { runWithTenantContext } from "./tenant-context";
import { DEFAULT_TENANT_KEY, normalizeTenantKey } from "./tenant.constants";

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

type RequestWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
  pimResolvedApiKey?: {
    keyId: string;
    actorId: string;
    tenantId: string;
    role: string;
    label: string;
  } | null;
};

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async use(req: RequestWithHeaders, _res: unknown, next: () => void): Promise<void> {
    const authHeader = firstHeaderValue(req.headers.authorization);
    const claims = decodePimJwtFromAuthHeader(authHeader);
    if (!claims) {
      const apiKey = extractApiKeyFromHeaders(req.headers);
      if (apiKey) {
        req.pimResolvedApiKey = await this.apiKeysService.resolveApiKey(apiKey);
      }
    }
    const tenantKey = normalizeTenantKey(
      claims?.tenantId ?? req.pimResolvedApiKey?.tenantId ?? process.env.PIM_DEFAULT_TENANT_KEY ?? DEFAULT_TENANT_KEY,
    );

    runWithTenantContext(tenantKey, next);
  }
}
