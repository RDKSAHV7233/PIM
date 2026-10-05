import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { PrismaModule } from "../prisma/prisma.module";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { IntelligenceController } from "./intelligence.controller";
import { FixtureIntelligenceAdapter } from "./intelligence-fixture.adapter";
import { INTELLIGENCE_PROVIDER_ADAPTER } from "./intelligence-adapter-boundary";
import { IntelligenceExecutionControlService } from "./intelligence-execution-control.service";
import { IntelligenceReservationMaintenanceService } from "./intelligence-reservation-maintenance.service";
import { IntelligenceService } from "./intelligence.service";

@Module({
  imports: [AccessPolicyModule, PrismaModule],
  controllers: [IntelligenceController],
  providers: [
    FixtureIntelligenceAdapter,
    { provide: INTELLIGENCE_PROVIDER_ADAPTER, useExisting: FixtureIntelligenceAdapter },
    IntelligenceCapabilityRegistry,
    IntelligenceExecutionControlService,
    IntelligenceReservationMaintenanceService,
    IntelligenceService,
  ],
})
export class IntelligenceModule {}
