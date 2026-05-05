import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { MediaStorageService } from "./media-storage.service";

@Module({
  imports: [AccessPolicyModule],
  controllers: [MediaController],
  providers: [MediaService, MediaStorageService],
  exports: [MediaService, MediaStorageService],
})
export class MediaModule {}
