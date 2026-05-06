import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BulkImportController } from "./bulk-import.controller";
import { BulkImportService } from "./bulk-import.service";
import { BulkImportRunService } from "./bulk-import-run.service";
import { BulkImportStorageService } from "./bulk-import-storage.service";

@Module({
  imports: [
    ComplianceModule,
    NotificationsModule,
    AccessPolicyModule,
    MulterModule.register({ storage: undefined }),
  ],
  controllers: [BulkImportController],
  providers: [BulkImportService, BulkImportRunService, BulkImportStorageService],
  exports: [BulkImportService, BulkImportRunService, BulkImportStorageService],
})
export class BulkImportModule {}
