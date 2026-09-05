import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from "class-validator";

export class TriggerBulkPublishDto {
  // Bulk-Publish Goes Async, Story 8: this used to be the DTO-level twin of the
  // service's now-removed NON_BULK_PUBLISH_BATCH_CEILING=50 (marketplace.service.ts) —
  // 200 was already Amazon's native-feed ceiling, so raising it here only changes
  // behavior for the non-native (Shopify/WooCommerce) path, which no longer runs
  // synchronously (see createBulkPublishRun) and so no longer scales against the
  // 20s web-request timeout that #545/TC-06 hit. 2000 is a sanity bound against a
  // single oversized request/DB write, not a re-derived architectural limit — raise
  // further only from measured evidence, same rule as before.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  productIds!: string[];
}
