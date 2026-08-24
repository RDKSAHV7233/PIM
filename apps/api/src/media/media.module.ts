import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { MediaController } from "./media.controller";
import { MediaIntegritySchedulerService } from "./media-integrity-scheduler.service";
import { MediaIntegrityService } from "./media-integrity.service";
import { MediaService } from "./media.service";
import { MediaStorageService } from "./media-storage.service";

@Module({
  imports: [AccessPolicyModule],
  controllers: [MediaController],
  providers: [MediaService, MediaStorageService, MediaIntegrityService, MediaIntegritySchedulerService],
  exports: [MediaService, MediaStorageService, MediaIntegrityService],
})
export class MediaModule {}
