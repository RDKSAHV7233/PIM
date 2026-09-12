import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { MetricsModule } from "../metrics/metrics.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BulkImportController } from "./bulk-import.controller";
import { BulkImportService } from "./bulk-import.service";
import { BulkImportRunService } from "./bulk-import-run.service";
import { BulkImportStaleRowRecoveryService } from "./bulk-import-stale-row-recovery.service";
import { BulkImportStorageService } from "./bulk-import-storage.service";

@Module({
  imports: [
    ComplianceModule,
    MetricsModule,
    NotificationsModule,
    AccessPolicyModule,
    // Enforce a module-level Multer size cap so the upload is rejected in the middleware
    // layer before the file is fully buffered into memory.  The service enforces the same
    // threshold (LARGE_IMPORT_MAX_FILE_SIZE_BYTES = 32 MB) but only after buffering is done.
    MulterModule.register({ storage: undefined, limits: { fileSize: 32 * 1024 * 1024 } }),
  ],
  controllers: [BulkImportController],
  providers: [BulkImportService, BulkImportRunService, BulkImportStorageService, BulkImportStaleRowRecoveryService],
  exports: [BulkImportService, BulkImportRunService, BulkImportStorageService],
})
export class BulkImportModule {}
