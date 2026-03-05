import { Global, Module } from "@nestjs/common";
import { PrismaDirectService } from "./prisma-direct.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, PrismaDirectService],
  exports: [PrismaService, PrismaDirectService],
})
export class PrismaModule {}
