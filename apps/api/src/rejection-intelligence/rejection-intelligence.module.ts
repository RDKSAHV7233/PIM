import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { RejectionIntelligenceController } from "./rejection-intelligence.controller";
import { RejectionIntelligenceService } from "./rejection-intelligence.service";

@Module({
  imports: [AccessPolicyModule],
  controllers: [RejectionIntelligenceController],
  providers: [RejectionIntelligenceService],
})
export class RejectionIntelligenceModule {}
