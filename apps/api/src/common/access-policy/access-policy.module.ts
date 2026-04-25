import { Module } from "@nestjs/common";
import { AuditModule } from "../../audit/audit.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { AccessPolicyService } from "./access-policy.service";

@Module({
  imports: [AuditModule, PrismaModule],
  providers: [AccessPolicyService],
  exports: [AccessPolicyService],
})
export class AccessPolicyModule {}
