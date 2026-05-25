import { Global, Module } from "@nestjs/common";
import { CacheService } from "./cache.service";

/**
 * Global module — imported once in AppModule; CacheService is available
 * everywhere without each feature module importing CacheModule explicitly.
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
