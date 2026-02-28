import { Module } from "@nestjs/common";
import { RejectionIntelligenceController } from "./rejection-intelligence.controller";
import { RejectionIntelligenceService } from "./rejection-intelligence.service";

@Module({
  controllers: [RejectionIntelligenceController],
  providers: [RejectionIntelligenceService],
})
export class RejectionIntelligenceModule {}
