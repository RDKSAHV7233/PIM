import { ExecutionContext, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { PreAuthIpThrottlerGuard } from "./common/throttler/pre-auth-ip-throttler.guard";
import { IdentityThrottlerGuard } from "./common/throttler/identity-throttler.guard";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AutoSuggestionsModule } from "./auto-suggestions/auto-suggestions.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { AuditModule } from "./audit/audit.module";
import { ObservabilityModule } from "./common/observability/observability.module";
import { BillingModule } from "./billing/billing.module";
import { BulkEditModule } from "./bulk-edit/bulk-edit.module";
import { BulkImportModule } from "./bulk-import/bulk-import.module";
import { CatalogModule } from "./catalog/catalog.module";
import { AuditLogInterceptor } from "./common/audit/audit-log.interceptor";
import { AccessPolicyModule } from "./common/access-policy/access-policy.module";
import { CacheModule } from "./common/cache/cache.module";
import { LoggingModule } from "./common/logging/logging.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { AppController } from "./common/app.controller";
import { RbacGuard } from "./common/rbac/rbac.guard";
import { ReadAccessPolicyInterceptor } from "./common/rbac/read-access-policy.interceptor";
import { TenantDirectoryModule } from "./common/tenant/tenant-directory.module";
import { TenantContextMiddleware } from "./common/tenant/tenant-context.middleware";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ErrorAuthorityModule } from "./error-authority/error-authority.module";
import { InternalOpsAlertsModule } from "./internal-ops/internal-ops-alerts.module";
import { InternalOpsModule } from "./internal-ops/internal-ops.module";
import { ConnectorFrameworkModule } from "./connector-framework/connector-framework.module";
import { ConnectorInstallerModule } from "./connector-installer/connector-installer.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { MediaModule } from "./media/media.module";
import { MetricsModule } from "./metrics/metrics.module";
import { OndcModule } from "./ondc/ondc.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OutboundWebhooksModule } from "./outbound-webhooks/outbound-webhooks.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PlatformAdminModule } from "./platform-admin/platform-admin.module";
import { PricingModule } from "./pricing/pricing.module";
import { QueueModule } from "./queue/queue.module";
import { RejectionIntelligenceModule } from "./rejection-intelligence/rejection-intelligence.module";
import { ResendWebhookModule } from "./webhooks/resend/resend-webhook.module";
import { SignupModule } from "./signup/signup.module";
import { TaxonomyModule } from "./taxonomy/taxonomy.module";
import { WorkspaceUsersModule } from "./workspace-users/workspace-users.module";

const FEATURE_ONDC_ENABLED =
  String(process.env.FEATURE_ONDC_ENABLED ?? "false").trim().toLowerCase() === "true";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Two layers, in guard-registration order below:
    //  1. "ip" — pre-auth, IP-keyed, enforced by PreAuthIpThrottlerGuard before
    //     JwtAuthGuard runs, so unauthenticated abuse is bounded before it can
    //     force the more expensive auth path (JWT verify, blocklist check,
    //     API-key hash/DB lookup).
    //  2. "user"/"tenant"/"apiKey"/"tenantApi" — post-auth, identity-keyed,
    //     enforced by IdentityThrottlerGuard after JwtAuthGuard has resolved
    //     pimAuthType/pimTenant/pimUserId/pimApiKeyId. Each entry's skipIf
    //     scopes it to the matching auth type so a JWT session only ever
    //     contributes to user/tenant, and an API key only to apiKey/tenantApi.
    //     An API key gets its own tighter per-key limit (120/min) distinct
    //     from its tenant's aggregate ceiling so one automation credential
    //     can't starve the rest of that tenant's traffic, and a tenant with
    //     several keys isn't reduced to one key's worth of quota.
    //
    //     tenant/tenantApi are set well above the per-user/per-key limit
    //     (not a low multiple of it) because they're a single shared bucket
    //     across every user/key in that tenant: this guard was previously
    //     dead code (ran before identity was resolved, so it never actually
    //     enforced anything), and turning it on for real exposed that this
    //     app's own rbac-role-enforcement e2e suite alone drives one tenant
    //     well past 300 write/read calls within 60s during normal automated
    //     testing across several roles - a real multi-user tenant doing
    //     ordinary concurrent work would do the same. These are meant to
    //     catch runaway/abusive aggregate usage, not constrain normal
    //     multi-user or multi-key activity within one tenant.
    ThrottlerModule.forRoot([
      { name: "ip", ttl: 60_000, limit: 300 },
      {
        name: "user",
        ttl: 60_000,
        limit: 300,
        skipIf: (context: ExecutionContext) =>
          context.switchToHttp().getRequest().pimAuthType !== "user_jwt",
      },
      {
        name: "tenant",
        ttl: 60_000,
        limit: 2000,
        skipIf: (context: ExecutionContext) =>
          context.switchToHttp().getRequest().pimAuthType !== "user_jwt",
      },
      {
        name: "apiKey",
        ttl: 60_000,
        limit: 120,
        skipIf: (context: ExecutionContext) =>
          context.switchToHttp().getRequest().pimAuthType !== "api_key",
      },
      {
        name: "tenantApi",
        ttl: 60_000,
        limit: 600,
        skipIf: (context: ExecutionContext) =>
          context.switchToHttp().getRequest().pimAuthType !== "api_key",
      },
    ]),
    CacheModule,
    LoggingModule,
    ObservabilityModule,
    QueueModule,
    TenantDirectoryModule,
    ApiKeysModule,
    AuthModule,
    PrismaModule,
    AuditModule,
    AccessPolicyModule,
    BillingModule,
    TaxonomyModule,
    ComplianceModule,
    DashboardModule,
    InternalOpsAlertsModule,
    ErrorAuthorityModule,
    InternalOpsModule,
    ConnectorFrameworkModule,
    ConnectorInstallerModule,
    BulkImportModule,
    BulkEditModule,
    CatalogModule,
    MarketplaceModule,
    MediaModule,
    MetricsModule,
    OutboundWebhooksModule,
    NotificationsModule,
    PlatformAdminModule,
    PricingModule,
    RejectionIntelligenceModule,
    ResendWebhookModule,
    SignupModule,
    WorkspaceUsersModule,
    ...(FEATURE_ONDC_ENABLED ? [OndcModule] : []),
    AutoSuggestionsModule,
  ],
  providers: [
    TenantContextMiddleware,
    // Guard order matters: pre-auth IP throttle, then auth (resolves identity),
    // then identity-scoped throttle (reads what auth just resolved), then RBAC.
    {
      provide: APP_GUARD,
      useClass: PreAuthIpThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: IdentityThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ReadAccessPolicyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes("*");
  }
}
