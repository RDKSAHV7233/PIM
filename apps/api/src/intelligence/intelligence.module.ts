import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { PrismaModule } from "../prisma/prisma.module";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { IntelligenceController } from "./intelligence.controller";
import { FixtureIntelligenceAdapter } from "./intelligence-fixture.adapter";
import { IntelligenceService } from "./intelligence.service";

@Module({
  imports: [AccessPolicyModule, PrismaModule],
  controllers: [IntelligenceController],
  providers: [FixtureIntelligenceAdapter, IntelligenceCapabilityRegistry, IntelligenceService],
})
export class IntelligenceModule {}
