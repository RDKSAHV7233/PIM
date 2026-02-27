import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CatalogModule } from "./catalog/catalog.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { AppController } from "./common/app.controller";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TaxonomyModule } from "./taxonomy/taxonomy.module";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TaxonomyModule,
    ComplianceModule,
    CatalogModule,
    MarketplaceModule,
  ],
})
export class AppModule {}
