import { Module } from "@nestjs/common";
import { OndcController } from "./ondc.controller";
import { OndcService } from "./ondc.service";

@Module({
  controllers: [OndcController],
  providers: [OndcService],
})
export class OndcModule {}
