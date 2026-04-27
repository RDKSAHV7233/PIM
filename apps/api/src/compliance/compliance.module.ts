import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";
import { IssuesController } from "./issues.controller";

@Module({
  imports: [AccessPolicyModule],
  controllers: [ComplianceController, IssuesController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
