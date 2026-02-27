import { Module } from "@nestjs/common";
import { ComplianceModule } from "../compliance/compliance.module";
import { BulkImportController } from "./bulk-import.controller";
import { BulkImportService } from "./bulk-import.service";

@Module({
  imports: [ComplianceModule],
  controllers: [BulkImportController],
  providers: [BulkImportService],
  exports: [BulkImportService],
})
export class BulkImportModule {}
