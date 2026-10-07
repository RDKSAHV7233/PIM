import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TenantDirectoryService } from "./tenant-directory.service";
import { TenantIterationService } from "./tenant-iteration.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TenantDirectoryService, TenantIterationService],
  exports: [TenantDirectoryService, TenantIterationService],
})
export class TenantDirectoryModule {}
