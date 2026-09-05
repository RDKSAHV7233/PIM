import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from "class-validator";

export class TriggerBulkPublishDto {
  // Bulk-Publish Goes Async, Story 8: this used to be the DTO-level twin of the
  // service's now-removed NON_BULK_PUBLISH_BATCH_CEILING=50 (marketplace.service.ts).
  // Raising it changes behavior for the non-native (Shopify/WooCommerce) path, which no
  // longer runs synchronously (see createBulkPublishRun) and so no longer scales against
  // the 20s web-request timeout that #545/TC-06 hit. 2000 is a sanity bound against a
  // single oversized request/DB write, not a re-derived architectural limit — raise
  // further only from measured evidence, same rule as before.
  //
  // CTO review follow-up (PR #719, 2026-09-05): this field is shared with the native
  // (Amazon) BULK_PUBLISH path, which is still fully synchronous in-request and does NOT
  // scale to 2000 the way the async path does. Its own bound is enforced separately in
  // triggerBulkPublish (NATIVE_BULK_PUBLISH_CEILING, marketplace.service.ts) — do not
  // assume this DTO-level max is a safe request size for every connector type.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  productIds!: string[];
}
