import { Controller, Get, Param, Query } from "@nestjs/common";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { RejectionIntelligenceService } from "./rejection-intelligence.service";

@Controller("rejection-intelligence")
export class RejectionIntelligenceController {
  constructor(private readonly rejectionIntelligenceService: RejectionIntelligenceService) {}

  @Get("products/:id/score")
  scoreProduct(@Param("id") productId: string, @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL) {
    return this.rejectionIntelligenceService.scoreProduct(productId, channel);
  }
}
