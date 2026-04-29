import { Module, forwardRef } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [forwardRef(() => AccessPolicyModule)],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
