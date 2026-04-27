import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { AutoSuggestionsController } from "./auto-suggestions.controller";
import { AutoSuggestionsService } from "./auto-suggestions.service";

@Module({
  imports: [AccessPolicyModule],
  controllers: [AutoSuggestionsController],
  providers: [AutoSuggestionsService],
})
export class AutoSuggestionsModule {}
