import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { PrismaModule } from "../prisma/prisma.module";
import { IntelligenceController } from "./intelligence.controller";
import { IntelligenceService } from "./intelligence.service";

@Module({
  imports: [AccessPolicyModule, PrismaModule],
  controllers: [IntelligenceController],
  providers: [IntelligenceService],
})
export class IntelligenceModule {}
