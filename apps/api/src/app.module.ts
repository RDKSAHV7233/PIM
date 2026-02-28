import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuditModule } from "./audit/audit.module";
import { BulkEditModule } from "./bulk-edit/bulk-edit.module";
import { BulkImportModule } from "./bulk-import/bulk-import.module";
import { CatalogModule } from "./catalog/catalog.module";
import { AuditLogInterceptor } from "./common/audit/audit-log.interceptor";
import { ComplianceModule } from "./compliance/compliance.module";
import { AppController } from "./common/app.controller";
import { RbacGuard } from "./common/rbac/rbac.guard";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TaxonomyModule } from "./taxonomy/taxonomy.module";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    TaxonomyModule,
    ComplianceModule,
    BulkImportModule,
    BulkEditModule,
    CatalogModule,
    MarketplaceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
