import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { BulkEditController } from "./bulk-edit.controller";
import { BulkEditService } from "./bulk-edit.service";

@Module({
  imports: [ComplianceModule, AccessPolicyModule],
  controllers: [BulkEditController],
  providers: [BulkEditService],
})
export class BulkEditModule {}
