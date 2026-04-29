import { Module, forwardRef } from "@nestjs/common";
import { AuditModule } from "../../audit/audit.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { AccessPolicyService } from "./access-policy.service";

@Module({
  imports: [forwardRef(() => AuditModule), PrismaModule],
  providers: [AccessPolicyService],
  exports: [AccessPolicyService],
})
export class AccessPolicyModule {}
