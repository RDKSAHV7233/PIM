import { Injectable, NestMiddleware } from "@nestjs/common";
import { decodePimJwtFromAuthHeader } from "../../auth/jwt";
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
};

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: RequestWithHeaders, _res: unknown, next: () => void): void {
    const authHeader = firstHeaderValue(req.headers.authorization);
    const claims = decodePimJwtFromAuthHeader(authHeader);
    const tenantKey = normalizeTenantKey(
      claims?.tenantId ?? process.env.PIM_DEFAULT_TENANT_KEY ?? DEFAULT_TENANT_KEY,
    );

    runWithTenantContext(tenantKey, next);
  }
}
