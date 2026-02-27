import { Module } from "@nestjs/common";
import { ComplianceModule } from "../compliance/compliance.module";
import { BulkEditController } from "./bulk-edit.controller";
import { BulkEditService } from "./bulk-edit.service";

@Module({
  imports: [ComplianceModule],
  controllers: [BulkEditController],
  providers: [BulkEditService],
})
export class BulkEditModule {}
