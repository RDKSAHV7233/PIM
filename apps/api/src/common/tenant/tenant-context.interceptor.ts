import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { decodePimJwtFromAuthHeader } from "../../auth/jwt";
import { runWithTenantContext } from "./tenant-context";
import { normalizeTenantKey } from "./tenant.constants";

type RequestWithTenant = {
  headers?: Record<string, string | string[] | undefined>;
  pimTenant?: string;
};

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<"http" | "rpc" | "ws">() !== "http") {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const claims = decodePimJwtFromAuthHeader(request.headers?.authorization);
    const tenantKey = normalizeTenantKey(request.pimTenant ?? claims?.tenantId);

    return new Observable((subscriber) => {
      const subscription = runWithTenantContext(tenantKey, () =>
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      );
      return () => subscription.unsubscribe();
    });
  }
}
