import { Module } from "@nestjs/common";
import { AutoSuggestionsController } from "./auto-suggestions.controller";
import { AutoSuggestionsService } from "./auto-suggestions.service";

@Module({
  controllers: [AutoSuggestionsController],
  providers: [AutoSuggestionsService],
})
export class AutoSuggestionsModule {}
