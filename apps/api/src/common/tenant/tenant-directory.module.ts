import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TenantDirectoryService } from "./tenant-directory.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TenantDirectoryService],
  exports: [TenantDirectoryService],
})
export class TenantDirectoryModule {}
