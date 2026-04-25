import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BulkImportController } from "./bulk-import.controller";
import { BulkImportService } from "./bulk-import.service";

@Module({
  imports: [ComplianceModule, NotificationsModule, AccessPolicyModule],
  controllers: [BulkImportController],
  providers: [BulkImportService],
  exports: [BulkImportService],
})
export class BulkImportModule {}
