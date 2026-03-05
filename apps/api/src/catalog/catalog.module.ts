import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CatalogController } from "./catalog.controller";
import { ProductsController } from "./products.controller";
import { CatalogService } from "./catalog.service";
import { ComplianceModule } from "../compliance/compliance.module";

@Module({
  imports: [ComplianceModule, AuditModule],
  controllers: [CatalogController, ProductsController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
