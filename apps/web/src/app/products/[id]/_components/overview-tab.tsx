import Link from "next/link";
import { purgeProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { formatDateTime } from "./product-detail-shared";
import { ArchiveProductButton } from "./archive-product-button";
import type { ProductDetailPageData } from "./product-detail-types";

export function OverviewTab({ data }: { data: ProductDetailPageData }) {
  if (data.activeTab !== "overview") {
    return null;
  }

  const mediaBlockerCount = data.imageAssetCount === 0 ? 1 : 0;
  const connectorBlocked = !data.mappingManagerInstallation || data.mappingManagerInstallation.status !== "ACTIVE";

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Product overview</CardTitle>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brand</dt>
              <dd className="mt-1 text-sm text-slate-900">{data.product.brand || "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</dt>
              <dd className="mt-1 text-sm text-slate-900">{data.product.category?.path ?? data.product.categoryId}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
              <dd className="mt-1">
                <StatusChip
                  label={data.product.status}
                  tone={data.product.status === "active" ? "success" : "neutral"}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</dt>
              <dd className="mt-1 text-sm text-slate-900">{formatDateTime(data.product.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completeness</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">{data.product.completenessScore ?? 0}% complete</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variants</dt>
              <dd className="mt-1 text-sm text-slate-900">{data.variants.length}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={data.tabHref("content")}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit content
            </Link>
            <Link
              href={data.tabHref("attributes")}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit attributes
            </Link>
            <Link
              href={data.tabHref("media")}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Review media
            </Link>
          </div>
        </Card>
        <Card>
          <CardTitle>Fix blockers before publish</CardTitle>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span>Product quality blockers</span>
              <StatusChip
                label={`${data.blockingIssueCount}`}
                tone={data.blockingIssueCount > 0 ? "danger" : "success"}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span>Warnings to review</span>
              <StatusChip
                label={`${data.warningIssueCount}`}
                tone={data.warningIssueCount > 0 ? "warning" : "neutral"}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span>Mapping or publish blockers</span>
              <StatusChip
                label={`${data.readinessBlockers.length}`}
                tone={data.readinessBlockers.length > 0 ? "danger" : "success"}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span>Media blockers</span>
              <StatusChip
                label={`${mediaBlockerCount}`}
                tone={mediaBlockerCount > 0 ? "danger" : "success"}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span>Connector account</span>
              <StatusChip
                label={connectorBlocked ? "Needs attention" : "Ready"}
                tone={connectorBlocked ? "warning" : "success"}
              />
            </div>
            <p className="text-xs text-slate-500">
              Publish blockers are grouped by source so you can decide whether to fix catalog quality, channel mapping, media, or connector setup first.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href={data.tabHref("quality")}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Fix issues
              </Link>
              <Link
                href={data.tabHref("channels")}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open channel readiness
              </Link>
            </div>
          </div>
        </Card>
      </div>
      {data.canWrite ? (
        <Card>
          <CardTitle>Delete product</CardTitle>
          <div className="mt-3 space-y-4 text-sm text-slate-700">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              {data.product.status === "archived" ? (
                <>
                  <p className="font-medium text-slate-900">Archived</p>
                  <p className="mt-1 text-xs text-slate-600">
                    This product is archived. Restore it to draft to resume editing and move it back through review.
                  </p>
                  <ArchiveProductButton
                    productId={data.productId}
                    expectedVersion={data.product.version}
                    mode="restore"
                  />
                </>
              ) : (
                <>
                  <p className="font-medium text-slate-900">Archive product</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Archiving removes the product from active workflows. It stays viewable and can be restored to
                    draft at any time.
                  </p>
                  <ArchiveProductButton
                    productId={data.productId}
                    expectedVersion={data.product.version}
                    mode="archive"
                  />
                </>
              )}
            </div>
            {data.actorRole === "admin" ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="font-medium text-red-900">Permanent delete (admin only)</p>
                <p className="mt-1 text-xs text-red-800">
                  This removes the product permanently. Type <span className="font-semibold">{data.deleteConfirmToken}</span> to confirm.
                </p>
                <form action={purgeProductAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input type="hidden" name="productId" value={data.productId} />
                  <input type="hidden" name="confirmDelete" value="yes" />
                  <input type="hidden" name="returnTo" value="/catalog/products" />
                  <Input
                    name="confirmToken"
                    placeholder={`Type ${data.deleteConfirmToken}`}
                    aria-label="Confirm permanent delete"
                  />
                  <Button type="submit" className="bg-red-700 text-white hover:bg-red-800">
                    Permanently delete
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </section>
  );
}
