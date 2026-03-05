import { Module } from "@nestjs/common";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";
import { IssuesController } from "./issues.controller";

@Module({
  controllers: [ComplianceController, IssuesController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
