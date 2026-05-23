import { Module } from "@nestjs/common";
import { JwtBlocklistService } from "./jwt-blocklist.service";

@Module({
  providers: [JwtBlocklistService],
  exports: [JwtBlocklistService],
})
export class JwtBlocklistModule {}
