import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
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
import { LoggingModule } from "./common/logging/logging.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { AppController } from "./common/app.controller";
import { RbacGuard } from "./common/rbac/rbac.guard";
import { ReadAccessPolicyInterceptor } from "./common/rbac/read-access-policy.interceptor";
import { TenantThrottlerGuard } from "./common/throttler/tenant-throttler.guard";
import { TenantDirectoryModule } from "./common/tenant/tenant-directory.module";
import { TenantContextMiddleware } from "./common/tenant/tenant-context.middleware";
import { DashboardModule } from "./dashboard/dashboard.module";
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
import { QueueModule } from "./queue/queue.module";
import { RejectionIntelligenceModule } from "./rejection-intelligence/rejection-intelligence.module";
import { SignupModule } from "./signup/signup.module";
import { TaxonomyModule } from "./taxonomy/taxonomy.module";
import { WorkspaceUsersModule } from "./workspace-users/workspace-users.module";

const FEATURE_ONDC_ENABLED =
  String(process.env.FEATURE_ONDC_ENABLED ?? "false").trim().toLowerCase() === "true";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: "global", ttl: 60_000, limit: 300 },
      { name: "tenant", ttl: 60_000, limit: 1000 },
      { name: "user", ttl: 60_000, limit: 200 },
    ]),
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
    RejectionIntelligenceModule,
    SignupModule,
    WorkspaceUsersModule,
    ...(FEATURE_ONDC_ENABLED ? [OndcModule] : []),
    AutoSuggestionsModule,
  ],
  providers: [
    TenantContextMiddleware,
    {
      provide: APP_GUARD,
      useClass: TenantThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
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
