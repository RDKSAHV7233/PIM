import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  configureAmazonAction,
  deleteConnectorSyncScheduleAction,
  initiateOAuthAction,
  queueConnectorDeltaSyncAction,
  triggerBulkPublishAction,
  updateConnectorPublicationTargetsAction,
  upsertConnectorSyncScheduleAction,
} from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getCategoryAttributes,
  getConnectorPublications,
  getProduct,
  getProductListPage,
  getConnectorPermissions,
  getConnectorPayloadPreview,
  getConnectorSchedule,
  getDeltaSyncCandidates,
  getInstalledConnectors,
  getProductIssues,
  getProductVariants,
  getSubmissions,
  getMediaAssets,
  type ConnectorPublicationTarget,
  type ConnectorSyncSchedule,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { mapConnectorSlugToMarketplaceChannel } from "@/lib/marketplace-channels";
import { canManageConnectors } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime as fmtDT } from "@/lib/format";
import { StoreSwitcher } from "@/components/ui/store-switcher";
import { MeeshoExportPanel } from "@/components/ui/meesho-export-panel";
import { BulkPublishConfirmForm } from "./bulk-publish-confirm-form";

export const dynamic = "force-dynamic";

interface ChannelConnectorDetailPageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ tab?: string; status?: string; action?: string }>;
}

type DetailTab = "overview" | "credentials" | "catalog" | "mappings" | "issues" | "logs" | "access" | "sync" | "schedule" | "catalog-link";
type CatalogModuleId =
  | "products"
  | "variants"
  | "attributes"
  | "categories"
  | "media"
  | "publication"
  | "payload"
  | "readiness";

type ConnectorMaturity = "Live publish" | "Export/manual" | "Beta" | "Experimental";

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "credentials", label: "Credentials" },
  { id: "catalog", label: "Catalog" },
  { id: "mappings", label: "Mappings" },
  { id: "sync", label: "Sync" },
  { id: "schedule", label: "Schedule" },
  { id: "catalog-link", label: "Catalog Link" },
  { id: "issues", label: "Issues" },
  { id: "logs", label: "Logs" },
  { id: "access", label: "Access" },
];

const CATALOG_MODULES: Array<{
  id: CatalogModuleId;
  label: string;
  description: string;
  anchor: string;
}> = [
  {
    id: "products",
    label: "Products",
    description: "Submitted product coverage and latest account outcome.",
    anchor: "catalog-products",
  },
  {
    id: "variants",
    label: "Variants",
    description: "Variant footprint represented on this connector account.",
    anchor: "catalog-variants",
  },
  {
    id: "attributes",
    label: "Attributes",
    description: "Category attribute surface and missing-field pressure.",
    anchor: "catalog-attributes",
  },
  {
    id: "categories",
    label: "Categories",
    description: "Taxonomy context shaping mapping quality.",
    anchor: "catalog-categories",
  },
  {
    id: "media",
    label: "Media",
    description: "Media coverage tied to the focused product.",
    anchor: "catalog-media",
  },
  {
    id: "publication",
    label: "Publication Targets",
    description: "Targets persisted for this installation and publication guidance.",
    anchor: "catalog-publication",
  },
  {
    id: "payload",
    label: "Payload Preview",
    description: "Mapped payload readiness before export or publish.",
    anchor: "catalog-payload",
  },
  {
    id: "readiness",
    label: "Readiness & Issues",
    description: "Blocking issues, warnings, and the next operator queue.",
    anchor: "catalog-readiness",
  },
];

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

function submissionStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESS") {
    return "success";
  }
  if (normalized === "PENDING" || normalized === "RETRYING") {
    return "warning";
  }
  if (normalized === "ERROR" || normalized === "REJECTED" || normalized === "SUPPRESSED") {
    return "danger";
  }
  return "neutral";
}

function installationStatusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "success";
  }
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "FAILED" || normalized === "ERROR") {
    return "danger";
  }
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
    return "warning";
  }
  return "neutral";
}

function connectorLaunchTone(stage: string): "success" | "warning" | "info" {
  if (stage === "live") {
    return "success";
  }
  if (stage === "manual") {
    return "warning";
  }
  return "info";
}

function connectorLaunchLabel(
  stage: string,
  implementationStatus: string | undefined,
): ConnectorMaturity {
  if (stage === "live" && implementationStatus === "partial") {
    return "Beta";
  }
  if (stage === "manual") {
    return implementationStatus === "partial" ? "Export/manual" : "Beta";
  }
  if (stage === "planned") {
    return "Experimental";
  }
  if (implementationStatus === "stub") {
    return "Experimental";
  }
  return "Live publish";
}

function formatCapabilityLabel(capability: string): string {
  if (capability === "PUBLISH") {
    return "Publish";
  }
  if (capability === "VALIDATE") {
    return "Validate";
  }
  if (capability === "STATUS_SYNC") {
    return "Status sync";
  }
  if (capability === "WEBHOOK_RECEIVE") {
    return "Webhook receive";
  }
  if (capability === "EXCEL_EXPORT") {
    return "Excel export";
  }
  return capability.replace(/_/g, " ").toLowerCase();
}

function formatCapabilityList(capabilities: string[]): string {
  return capabilities.length > 0 ? capabilities.map(formatCapabilityLabel).join(", ") : "-";
}

// Amazon SP-API marketplace ID → friendly region label
const AMAZON_MARKETPLACE_LABELS: Record<string, string> = {
  A21TJRUUN4KGV: "Amazon India",
  ATVPDKIKX0DER: "Amazon US",
  A2EUQ1WTGCTBG2: "Amazon Canada",
  A1F83G8C2ARO7P: "Amazon UK",
  A1PA6795UKMFR9: "Amazon Germany",
  A13V1IB3VIYZZH: "Amazon France",
  APJ6JRA9NG5V4: "Amazon Italy",
  A1VC38T7YXB528: "Amazon Japan",
  A39IBJ37TRP1C6: "Amazon Australia",
  A2VIGQ35RCS4UG: "Amazon UAE",
};

function formatStatusSummary(status: string): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "Healthy";
  }
  if (normalized === "CREDENTIAL_EXPIRED") {
    return "Credentials need attention";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "Action required";
  }
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
    return "Paused";
  }
  return status;
}

function describePermissionRule(permission: {
  principalType: string;
  principalId: string;
  action: string;
  accountAlias: string;
}) {
  const subject =
    permission.principalType === "role"
      ? `${permission.principalId} role holders`
      : `user ${permission.principalId}`;
  const action = permission.action === "uninstall" ? "disable" : permission.action;
  const scope = permission.accountAlias === "*" ? "all aliases" : `alias "${permission.accountAlias}"`;
  return `${subject} can ${action} this connector for ${scope}.`;
}

function summarizeSubmissionOutcome(submission: {
  status: string;
  source: string;
  channelErrors: Array<{ sellerMessage: string }>;
  externalRef: string | null;
}) {
  const firstError = submission.channelErrors[0]?.sellerMessage?.trim();
  if (firstError) {
    return firstError;
  }
  if (submission.status === "SUCCESS") {
    return submission.externalRef ? `Published as ${submission.externalRef}.` : "Completed successfully.";
  }
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return `Waiting on ${submission.source.toLowerCase().replace(/_/g, " ")} processing.`;
  }
  if (submission.status === "SUPPRESSED") {
    return "Suppressed by connector rules or duplicate protection.";
  }
  if (submission.status === "REJECTED") {
    return "Rejected by the channel. Review the connector errors and product data.";
  }
  return "Needs operator review.";
}

function nextOperatorStep(submission: {
  status: string;
  channelErrors: Array<{ sellerMessage: string }>;
}) {
  if (submission.status === "SUCCESS") {
    return "No action needed.";
  }
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return "Monitor the queue and connector health.";
  }
  if (submission.status === "SUPPRESSED") {
    return "Check duplicate protection or connector gating.";
  }
  if (submission.channelErrors.length > 0) {
    return "Fix the product mapping or required catalog fields, then retry.";
  }
  return "Inspect connector logs and account credentials.";
}

function buildDetailHref(installationId: string, tab: DetailTab): string {
  const params = new URLSearchParams();
  if (tab !== "overview") {
    params.set("tab", tab);
  }
  const encoded = params.toString();
  return encoded
    ? `/channels/connectors/${encodeURIComponent(installationId)}?${encoded}`
    : `/channels/connectors/${encodeURIComponent(installationId)}`;
}

function resolveTab(value: string): DetailTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "credentials" ||
    normalized === "catalog" ||
    normalized === "mappings" ||
    normalized === "issues" ||
    normalized === "logs" ||
    normalized === "access" ||
    normalized === "sync" ||
    normalized === "schedule" ||
    normalized === "catalog-link"
  ) {
    return normalized;
  }
  return "overview";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not recorded";
  }
  return fmtDT(value);
}

function connectorDetailStatusMessage(status: string | undefined): {
  tone: "success" | "warning" | "danger";
  message: string;
} | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "publication-targets-saved") {
    return {
      tone: "success",
      message: "Shopify publication targets saved. Future publishes will use the selected targets.",
    };
  }
  if (normalized === "publication-targets-required") {
    return {
      tone: "warning",
      message: "Select at least one Shopify publication target before saving.",
    };
  }
  if (normalized === "publication-targets-invalid") {
    return {
      tone: "danger",
      message: "One or more selected Shopify publication targets were invalid. Refresh the page and try again.",
    };
  }
  if (normalized === "publication-targets-unsupported") {
    return {
      tone: "warning",
      message: "This connector account does not currently expose publication targets.",
    };
  }
  if (normalized === "publication-targets-error") {
    return {
      tone: "danger",
      message: "Unable to save Shopify publication targets right now. Try again after checking connector health.",
    };
  }
  if (normalized === "amazon-configured") {
    return {
      tone: "success",
      message: "Amazon marketplace configuration saved. The new settings will apply on the next validation and publish cycle.",
    };
  }
  if (normalized === "delta-sync-queued") {
    return {
      tone: "success",
      message: "Delta sync queued. Changed products will be picked up by the export worker shortly.",
    };
  }
  if (normalized === "delta-sync-error") {
    return {
      tone: "danger",
      message: "Unable to queue delta sync right now. Check connector health and try again.",
    };
  }
  if (normalized === "schedule-saved") {
    return {
      tone: "success",
      message: "Sync schedule saved. The cron job will trigger delta syncs at the configured interval.",
    };
  }
  if (normalized === "schedule-deleted") {
    return {
      tone: "success",
      message: "Sync schedule removed. Automated delta syncs will no longer run for this installation.",
    };
  }
  if (normalized === "schedule-error") {
    return {
      tone: "danger",
      message: "Unable to update the sync schedule. Check that the cron expression is valid and try again.",
    };
  }
  if (normalized === "bulk-publish-queued") {
    return {
      tone: "success",
      message: "Bulk publish submitted via Amazon Feeds API. Submissions are PENDING — poll status in the Jobs workspace.",
    };
  }
  if (normalized === "bulk-publish-error") {
    return {
      tone: "danger",
      message: "Bulk publish failed. Verify the BULK_PUBLISH capability is enabled and the connector is healthy.",
    };
  }
  return null;
}

function toneClassForBanner(tone: "success" | "warning" | "danger"): string {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-red-200 bg-red-50 text-red-800";
}

function catalogReadinessTone(product: {
  openValidationErrorCount?: number;
  openValidationWarningCount?: number;
  completenessScore?: number;
  status?: string;
} | undefined): "neutral" | "success" | "warning" | "danger" {
  if (!product) {
    return "neutral";
  }
  if ((product.openValidationErrorCount ?? 0) > 0) {
    return "danger";
  }
  if ((product.openValidationWarningCount ?? 0) > 0) {
    return "warning";
  }
  if ((product.completenessScore ?? 0) >= 80 || product.status === "active" || product.status === "approved") {
    return "success";
  }
  return "neutral";
}

function catalogReadinessLabel(product: {
  openValidationErrorCount?: number;
  openValidationWarningCount?: number;
  completenessScore?: number;
  status?: string;
} | undefined): string {
  if (!product) {
    return "Product lookup unavailable";
  }
  if ((product.openValidationErrorCount ?? 0) > 0) {
    return `${product.openValidationErrorCount} blocking issue${product.openValidationErrorCount === 1 ? "" : "s"}`;
  }
  if ((product.openValidationWarningCount ?? 0) > 0) {
    return `${product.openValidationWarningCount} warning${product.openValidationWarningCount === 1 ? "" : "s"}`;
  }
  if ((product.completenessScore ?? 0) > 0) {
    return `${product.completenessScore}% complete`;
  }
  return product.status ? `Catalog status: ${product.status}` : "Needs review";
}

function issueLaneLabel(submission: {
  status: string;
  channelErrors: Array<{ sellerMessage: string }>;
}): string {
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return "Queue monitoring";
  }
  if (submission.status === "SUPPRESSED") {
    return "Connector policy";
  }
  if (submission.channelErrors.length > 0) {
    return "Catalog mapping";
  }
  return "Connector account";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPublicationTargets(metadata: unknown): Array<{
  id: string;
  name: string;
  selected?: boolean;
  catalogTitle?: string | null;
}> {
  const raw = asRecord(metadata).publicationTargets;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id ?? ""),
        name: String(record.name ?? record.catalogTitle ?? "Publication target"),
        selected: Boolean(record.selected),
        catalogTitle: typeof record.catalogTitle === "string" ? record.catalogTitle : null,
      };
    })
    .filter((item) => item.id.length > 0);
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function summarizePublicationTargets(
  targets: Array<{
    id: string;
    name: string;
    selected?: boolean;
  }>,
): string {
  if (targets.length === 0) {
    return "No publication targets stored";
  }
  if (targets.length === 1) {
    return targets[0]?.name || targets[0]?.id || "Publication target";
  }
  return `${targets[0]?.name || targets[0]?.id || "Publication target"} +${targets.length - 1} more`;
}

function summarizeSelectedPublicationTargets(
  targets: Array<{
    id: string;
    name: string;
    selected?: boolean;
  }>,
): { count: number; label: string } {
  const selectedTargets = targets.filter((target) => target.selected !== false);
  const activeTargets = selectedTargets.length > 0 ? selectedTargets : targets;
  if (activeTargets.length === 0) {
    return { count: 0, label: "No publication targets selected" };
  }
  if (activeTargets.length === 1) {
    return {
      count: 1,
      label: activeTargets[0]?.name || activeTargets[0]?.id || "Publication target selected",
    };
  }
  return {
    count: activeTargets.length,
    label: `${activeTargets[0]?.name || activeTargets[0]?.id || "Publication target"} +${activeTargets.length - 1} more`,
  };
}

function shopifyReadinessTone(complete: boolean): "success" | "warning" {
  return complete ? "success" : "warning";
}

function shopifyManagedInstallStepTone(
  state: "complete" | "in_progress" | "pending",
): "success" | "info" | "warning" {
  if (state === "complete") {
    return "success";
  }
  if (state === "in_progress") {
    return "info";
  }
  return "warning";
}

function renderSubmissionRows(
  submissions: Array<{
    id: string;
    productId: string;
    status: string;
    channelErrors: Array<{ sellerMessage: string }>;
    source: string;
    externalRef: string | null;
    attemptNumber: number;
    submittedAt: string;
  }>,
  productsById: Map<string, { id: string; title: string; brand: string | null }>,
) {
  return submissions.map((submission) => {
    const product = productsById.get(submission.productId);
    return (
      <tr key={submission.id} className="border-t border-slate-200 hover:bg-slate-50/50">
        <td className="px-3 py-2.5">
          <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
            {product?.title || "Open product"}
          </Link>
          <p className="mt-1 text-xs text-slate-500">
            {product?.brand ? `${product.brand} | ` : ""}
            {submission.productId}
          </p>
        </td>
        <td className="px-3 py-2.5">
          <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
        </td>
        <td className="px-3 py-2.5 text-sm text-slate-700">
          <p>{summarizeSubmissionOutcome(submission)}</p>
          <p className="mt-1 text-xs text-slate-500">{nextOperatorStep(submission)}</p>
        </td>
        <td className="px-3 py-2.5">{submission.attemptNumber}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDT(submission.submittedAt)}</td>
      </tr>
    );
  });
}

export default async function ChannelConnectorDetailPage({
  params,
  searchParams,
}: ChannelConnectorDetailPageProps) {
  const { installationId } = await params;
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const selectedTab = resolveTab(String(query.tab ?? ""));
  const detailReturnPath = buildDetailHref(installationId, selectedTab);
  const statusMessage = connectorDetailStatusMessage(query.status);

  try {
    const installations = await getInstalledConnectors({ role: actorRole, authHeader });
    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const siblingStores = installations
      .filter((item) => item.slug === installation.slug)
      .map((item) => ({
        id: item.id,
        label: readMetadataValue(item.metadata, "shopName") || readMetadataValue(item.metadata, "shopDomain") || item.accountAlias,
      }));
    const metadataConnectionStage = readMetadataValue(installation.metadata, "connectionStage");
    const shopifyAwaitingManagedInstall =
      installation.slug === "shopify" && metadataConnectionStage === "awaiting_managed_install";

    const shopifyPublicationStatePromise =
      selectedTab === "credentials" && installation.slug === "shopify" && !shopifyAwaitingManagedInstall
        ? getConnectorPublications(installation.id, { role: actorRole, authHeader })
            .then((targets) => ({ targets, error: null as string | null }))
            .catch((error: unknown) => {
              if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
                throw error;
              }
              if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
                const payload = error.body as Record<string, unknown>;
                return {
                  targets: [] as ConnectorPublicationTarget[],
                  error: String(payload.message ?? payload.error ?? "Unable to load Shopify publication targets."),
                };
              }
              return {
                targets: [] as ConnectorPublicationTarget[],
                error: error instanceof Error ? error.message : "Unable to load Shopify publication targets.",
              };
            })
        : Promise.resolve({ targets: [] as ConnectorPublicationTarget[], error: null as string | null });

    const [permissions, submissionsRaw, products, shopifyPublicationState] = await Promise.all([
      getConnectorPermissions(installation.slug, { role: actorRole, authHeader }).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 403 || err.status === 401)) {
          return [] as Awaited<ReturnType<typeof getConnectorPermissions>>;
        }
        throw err;
      }),
      getSubmissions({ installationId: installation.id, limit: 100 }, { role: actorRole, authHeader }).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) {
          throw err;
        }
        return [] as Awaited<ReturnType<typeof getSubmissions>>;
      }),
      getProductListPage({ slim: true, limit: 200 }, { role: actorRole, authHeader }).then((page) => page.items).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) {
          throw err;
        }
        return [] as Awaited<ReturnType<typeof getProductListPage>>["items"];
      }),
      shopifyPublicationStatePromise,
    ]);
    const submissions = toItems(submissionsRaw);
    const productsById = new Map(products.map((product) => [product.id, product]));

    // Backfill submission-referenced products missing from the bounded first-page fetch.
    const missingProductIds = [...new Set(submissions.map((s) => s.productId))].filter((id) => !productsById.has(id));
    if (missingProductIds.length > 0) {
      const backfilled = await Promise.allSettled(
        missingProductIds.map((id) => getProduct(id, { role: actorRole, authHeader })),
      );
      for (const result of backfilled) {
        if (result.status === "fulfilled") {
          const p = result.value;
          productsById.set(p.id, {
            id: p.id,
            title: p.title,
            brand: p.brand,
            categoryId: p.categoryId,
            status: p.status,
            variantCount: p.variants?.length ?? 0,
            openValidationErrorCount: 0,
            openValidationWarningCount: 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          });
        }
      }
    }

    const failedSubmissions = submissions.filter(
      (item) => item.status === "ERROR" || item.status === "REJECTED" || item.status === "SUPPRESSED",
    );
    const pendingSubmissions = submissions.filter(
      (item) => item.status === "PENDING" || item.status === "RETRYING",
    );
    const latestSubmissionByProductId = new Map<
      string,
      (typeof submissions)[number]
    >();
    for (const submission of submissions) {
      const current = latestSubmissionByProductId.get(submission.productId);
      if (!current || new Date(submission.submittedAt).getTime() > new Date(current.submittedAt).getTime()) {
        latestSubmissionByProductId.set(submission.productId, submission);
      }
    }
    const catalogEntries = Array.from(latestSubmissionByProductId.entries())
      .map(([productId, latestSubmission]) => ({
        productId,
        product: productsById.get(productId),
        latestSubmission,
      }))
      .sort(
        (left, right) =>
          new Date(right.latestSubmission.submittedAt).getTime() - new Date(left.latestSubmission.submittedAt).getTime(),
      );
    const catalogVariantCount = catalogEntries.reduce((total, entry) => total + (entry.product?.variantCount ?? 0), 0);
    const catalogBlockingCount = catalogEntries.reduce(
      (total, entry) => total + (entry.product?.openValidationErrorCount ?? 0),
      0,
    );
    const catalogWarningCount = catalogEntries.reduce(
      (total, entry) => total + (entry.product?.openValidationWarningCount ?? 0),
      0,
    );
    const readinessEntries = catalogEntries.filter(
      (entry) => (entry.product?.openValidationErrorCount ?? 0) > 0 || (entry.product?.openValidationWarningCount ?? 0) > 0,
    );
    const focusCatalogEntry = catalogEntries[0] ?? null;
    const focusProductId = focusCatalogEntry?.productId ?? null;
    const focusProduct = focusCatalogEntry?.product ?? null;
    const focusCategoryId = focusProduct?.categoryId ?? null;
    const focusChannel = mapConnectorSlugToMarketplaceChannel(installation.slug);
    const mappingHref =
      focusChannel && focusProductId
        ? `/connectors/${encodeURIComponent(installation.id)}/mapping?productId=${encodeURIComponent(focusProductId)}&channel=${encodeURIComponent(focusChannel)}`
        : `/connectors/${encodeURIComponent(installation.id)}/mapping`;

    // Start the schedule / delta-sync fetch now — it only needs installation.id and selectedTab
    // (both already resolved from wave 1 + query params). Running it concurrently with wave 3
    // eliminates one full round-trip latency: by the time we finish wave 3's sync computation
    // the schedule fetch is already in flight.
    const scheduleAndDeltaPromise = Promise.allSettled([
      selectedTab === "schedule"
        ? getConnectorSchedule(installation.id, { role: actorRole, authHeader })
        : Promise.resolve(null as ConnectorSyncSchedule | null),
      selectedTab === "sync"
        ? getDeltaSyncCandidates(installation.id, { role: actorRole, authHeader })
        : Promise.resolve([] as Array<{ productId: string; version: number }>),
    ]);

    const [
      focusVariantsResult,
      focusIssuesResult,
      focusAttributesResult,
      focusMediaResult,
      focusPayloadPreviewResult,
    ] = await Promise.allSettled([
      focusProductId
        ? getProductVariants(focusProductId, { role: actorRole, authHeader })
        : Promise.resolve([]),
      focusProductId
        ? getProductIssues(focusProductId, { role: actorRole, authHeader })
        : Promise.resolve([]),
      focusCategoryId
        ? getCategoryAttributes(focusCategoryId, { role: actorRole, authHeader, revalidateSeconds: 60 })
        : Promise.resolve([]),
      focusProductId
        ? getMediaAssets(focusProductId, undefined, { role: actorRole, authHeader })
        : Promise.resolve([]),
      focusProductId && focusChannel
        ? getConnectorPayloadPreview(
            installation.id,
            { productId: focusProductId, channel: focusChannel },
            { role: actorRole, authHeader },
          )
        : Promise.resolve(null),
    ]);
    const focusVariants = focusVariantsResult.status === "fulfilled" ? focusVariantsResult.value : [];
    const focusIssues = focusIssuesResult.status === "fulfilled" ? focusIssuesResult.value : [];
    const focusAttributes = focusAttributesResult.status === "fulfilled" ? focusAttributesResult.value : [];
    const focusMedia = focusMediaResult.status === "fulfilled" ? focusMediaResult.value : [];
    const focusPayloadPreview =
      focusPayloadPreviewResult.status === "fulfilled" ? focusPayloadPreviewResult.value : null;
    const publicationTargets = readPublicationTargets(installation.metadata);
    const publicationTargetsUpdatedAt = readMetadataValue(
      installation.metadata,
      "publicationTargetsUpdatedAt",
    );
    const publicationTargetSummary = summarizePublicationTargets(publicationTargets);
    const metadataSellerId = readMetadataValue(installation.metadata, "sellerId");
    const metadataMarketplaceId = readMetadataValue(installation.metadata, "marketplaceId");
    const metadataDefaultProductType = readMetadataValue(installation.metadata, "defaultProductType");
    const metadataShopDomain = readMetadataValue(installation.metadata, "shopDomain");
    const metadataShopName = readMetadataValue(installation.metadata, "shopName");
    const metadataShopId = readMetadataValue(installation.metadata, "shopId");
    const metadataTokenMode = readMetadataValue(installation.metadata, "tokenMode");
    const metadataAuthMode = readMetadataValue(installation.metadata, "authMode");
    const shopifyConfigRaw = asRecord(installation.metadata).shopifyConfig;
    const shopifyConfig = shopifyConfigRaw && typeof shopifyConfigRaw === "object" && !Array.isArray(shopifyConfigRaw)
      ? shopifyConfigRaw as {
          metafields?: unknown[];
          collections?: unknown[];
          taxonomy?: unknown[];
          fetchedAt?: string;
        }
      : null;
    const shopifyConnectionComplete =
      installation.slug !== "shopify"
        ? true
        : metadataConnectionStage === "connected" ||
          (metadataConnectionStage === null && Boolean(metadataTokenMode || metadataAuthMode));
    const attributeSummary =
      focusAttributes.length === 0
        ? "No category attributes returned yet"
        : `${focusAttributes.length} attribute${focusAttributes.length === 1 ? "" : "s"} available`;
    const variantSummary =
      focusVariants.length === 0
        ? "No linked variants returned yet"
        : `${focusVariants.length} variant${focusVariants.length === 1 ? "" : "s"} returned`;
    const mediaSummary =
      focusMedia.length === 0
        ? "No media linked to the focused product"
        : `${focusMedia.length} asset${focusMedia.length === 1 ? "" : "s"} available`;
    const selectedPublicationTargetIds = new Set(
      publicationTargets.map((target) => target.id).filter(Boolean),
    );
    const availableShopifyTargets = shopifyPublicationState.targets.map((target) => ({
      ...target,
      selected: target.selected ?? selectedPublicationTargetIds.has(String(target.id ?? "").trim()),
    }));
    const selectedPublicationTargetSummary = summarizeSelectedPublicationTargets(
      availableShopifyTargets.length > 0 ? availableShopifyTargets : publicationTargets,
    );
    const shopifyReadinessSteps =
      installation.slug === "shopify"
        ? [
            {
              label: "Managed install token exchanged",
              complete: Boolean(metadataTokenMode || metadataAuthMode),
              detail:
                metadataTokenMode || metadataAuthMode
                  ? `${metadataAuthMode || "managed install"} / ${metadataTokenMode || "token mode recorded"}`
                  : "Reconnect Shopify with managed install to exchange and store tokens.",
            },
            {
              label: "Store identity recorded",
              complete: Boolean(metadataShopDomain && metadataShopId),
              detail:
                metadataShopDomain && metadataShopId
                  ? `${metadataShopName || metadataShopDomain} · ${metadataShopId}`
                  : "Shop domain and Shopify shop ID will appear after the store handshake completes.",
            },
            {
              label: "Publication targets selected",
              complete: selectedPublicationTargetSummary.count > 0,
              detail:
                selectedPublicationTargetSummary.count > 0
                  ? selectedPublicationTargetSummary.label
                  : "Select at least one Shopify publication target before Shopify publish.",
            },
            {
              label: "Publish ready",
              complete:
                Boolean(metadataTokenMode || metadataAuthMode) &&
                Boolean(metadataShopDomain && metadataShopId) &&
                selectedPublicationTargetSummary.count > 0,
              detail:
                Boolean(metadataTokenMode || metadataAuthMode) &&
                Boolean(metadataShopDomain && metadataShopId) &&
                selectedPublicationTargetSummary.count > 0
                  ? "This account has the minimum Shopify connection context required for Shopify publishing."
                  : "Finish the steps above before treating this Shopify account as publish-ready.",
            },
          ]
        : [];
    const completedShopifyReadinessSteps = shopifyReadinessSteps.filter((step) => step.complete).length;
    const shopifyManagedInstallSteps =
      installation.slug === "shopify"
        ? [
            {
              label: "Start managed install handoff",
              state:
                metadataAuthMode || metadataTokenMode || metadataShopDomain
                  ? ("complete" as const)
                  : ("pending" as const),
              detail:
                metadataAuthMode || metadataTokenMode || metadataShopDomain
                  ? "A Shopify handoff has already started for this account."
                  : "Use the Shopify install path in Vexa, then complete the managed-install handshake from Shopify admin before publishing.",
            },
            {
              label: "Complete managed install and token exchange",
              state:
                metadataTokenMode || metadataAuthMode
                  ? ("complete" as const)
                  : metadataShopDomain
                    ? ("in_progress" as const)
                    : ("pending" as const),
              detail:
                metadataTokenMode || metadataAuthMode
                  ? `${metadataAuthMode || "managed install"} / ${metadataTokenMode || "token mode recorded"}`
                  : "Finish the Shopify admin handoff so Vexa can exchange and persist the offline access token.",
            },
            {
              label: "Confirm shop identity and publish controls",
              state:
                metadataShopDomain && metadataShopId && selectedPublicationTargetSummary.count > 0
                  ? ("complete" as const)
                  : metadataShopDomain || metadataShopId || selectedPublicationTargetSummary.count > 0
                    ? ("in_progress" as const)
                    : ("pending" as const),
              detail:
                metadataShopDomain && metadataShopId && selectedPublicationTargetSummary.count > 0
                  ? `${metadataShopName || metadataShopDomain} is connected and ${selectedPublicationTargetSummary.label.toLowerCase()} configured.`
                  : "Return here after the handoff to verify shop identity and choose the publication targets Vexa should publish to.",
            },
          ]
        : [];

    // ─── Sprint G: Resolve schedule + delta sync (started concurrently above) ──
    const [connectorScheduleResult, deltaCandidatesResult] = await scheduleAndDeltaPromise;
    const connectorSchedule =
      connectorScheduleResult.status === "fulfilled" ? connectorScheduleResult.value : null;
    const deltaCandidates =
      deltaCandidatesResult.status === "fulfilled" ? deltaCandidatesResult.value : [];

    const catalogColumns: Column<(typeof catalogEntries)[number]>[] = [
      {
        key: "product",
        header: "Product",
        render: (entry) => (
          <div>
            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="text-blue-700 hover:underline">
              {entry.product?.title || "Open product"}
            </Link>
            <p className="mt-1 text-xs text-slate-500">
              {entry.product?.brand ? `${entry.product.brand} | ` : ""}
              {entry.productId}
            </p>
          </div>
        ),
      },
      {
        key: "category",
        header: "Category",
        render: (entry) => (
          <div className="text-slate-700">
            <p>{entry.product?.categoryName || "Uncategorized"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {entry.product?.categoryPath || entry.product?.categoryId || "-"}
            </p>
          </div>
        ),
      },
      { key: "variants", header: "Variants", render: (entry) => entry.product?.variantCount ?? 0 },
      {
        key: "readiness",
        header: "Readiness",
        render: (entry) => (
          <StatusChip label={catalogReadinessLabel(entry.product)} tone={catalogReadinessTone(entry.product)} />
        ),
      },
      {
        key: "latestStatus",
        header: "Latest Status",
        render: (entry) => (
          <StatusChip label={entry.latestSubmission.status} tone={submissionStatusTone(entry.latestSubmission.status)} />
        ),
      },
      {
        key: "latestOutcome",
        header: "Latest Outcome",
        render: (entry) => <span className="text-slate-700">{summarizeSubmissionOutcome(entry.latestSubmission)}</span>,
      },
      {
        key: "updated",
        header: "Updated",
        render: (entry) => (
          <span className="text-xs text-slate-600">
            {formatDateTime(entry.product?.updatedAt || entry.latestSubmission.submittedAt)}
          </span>
        ),
      },
    ];
    const issueQueueRows = [...failedSubmissions, ...pendingSubmissions].slice(0, 50);
    const issueQueueColumns: Column<(typeof issueQueueRows)[number]>[] = [
      {
        key: "product",
        header: "Product",
        render: (submission) => {
          const product = productsById.get(submission.productId);
          return (
            <div>
              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
                {product?.title || "Open product"}
              </Link>
              <p className="mt-1 text-xs text-slate-500">
                {product?.brand ? `${product.brand} | ` : ""}
                {submission.productId}
              </p>
            </div>
          );
        },
      },
      { key: "lane", header: "Lane", render: (submission) => <span className="text-slate-700">{issueLaneLabel(submission)}</span> },
      {
        key: "status",
        header: "Status",
        render: (submission) => (
          <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
        ),
      },
      { key: "issue", header: "Issue", render: (submission) => <span className="text-slate-700">{summarizeSubmissionOutcome(submission)}</span> },
      { key: "nextStep", header: "Next Step", render: (submission) => <span className="text-slate-700">{nextOperatorStep(submission)}</span> },
      { key: "submitted", header: "Submitted", render: (submission) => <span className="text-xs text-slate-600">{formatDateTime(submission.submittedAt)}</span> },
    ];
    const submissionActivityColumns: Column<(typeof submissions)[number]>[] = [
      {
        key: "product",
        header: "Product",
        render: (submission) => {
          const product = productsById.get(submission.productId);
          return (
            <div>
              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
                {product?.title || "Open product"}
              </Link>
              <p className="mt-1 text-xs text-slate-500">
                {product?.brand ? `${product.brand} | ` : ""}
                {submission.productId}
              </p>
            </div>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        render: (submission) => (
          <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
        ),
      },
      { key: "outcome", header: "Outcome", render: (submission) => summarizeSubmissionOutcome(submission) },
      { key: "attempt", header: "Attempt", render: (submission) => submission.attemptNumber },
      { key: "submitted", header: "Submitted", render: (submission) => <span className="text-xs text-slate-600">{fmtDT(submission.submittedAt)}</span> },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          title={`${installation.displayName} / ${installation.accountAlias}`}
          description="Account-scoped connector health, catalog publication context, and operator recovery actions for this installation only."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>{" "}
              /{" "}
              <Link href="/channels" className="hover:underline">
                Channels
              </Link>{" "}
              /{" "}
              <Link href="/channels/connectors" className="hover:underline">
                Connectors
              </Link>{" "}
              / <span className="font-semibold text-slate-700">Detail</span>
            </>
          }
          actions={
            <>
              <StoreSwitcher currentId={installationId} stores={siblingStores} currentTab={selectedTab !== "overview" ? selectedTab : undefined} />
              <StatusChip label={installation.status} tone={installationStatusTone(installation.status)} />
              <StatusChip
                label={connectorLaunchLabel(installation.launchStage, installation.implementationStatus)}
                tone={connectorLaunchTone(installation.launchStage)}
              />
              {failedSubmissions.length > 0 ? (
                <Link
                  href={`/channels/connectors/${encodeURIComponent(installationId)}/recovery`}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  Recovery ({failedSubmissions.length})
                </Link>
              ) : null}
              <Link
                href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open mapping workspace
              </Link>
            </>
          }
        />

        {statusMessage ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${toneClassForBanner(statusMessage.tone)}`}>
            {statusMessage.message}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Account health"
            value={formatStatusSummary(installation.status)}
            helper={installation.lastSyncAt ? `Last sync ${fmtDT(installation.lastSyncAt)}` : "No sync recorded yet"}
            tone={
              installationStatusTone(installation.status) === "danger"
                ? "danger"
                : installationStatusTone(installation.status) === "warning"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard label="Submissions" value={submissions.length} helper={`${pendingSubmissions.length} pending or retrying`} />
          <KpiCard
            label="Errors / Rejections"
            value={failedSubmissions.length}
            tone={failedSubmissions.length > 0 ? "danger" : "success"}
          />
          <KpiCard label="Access rules" value={permissions.length} helper="Role and user policy overrides" />
        </section>

        <Card>
          <div className="flex flex-wrap items-center gap-2">
            {DETAIL_TABS.map((tab) => {
              const isSelected = selectedTab === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={buildDetailHref(installation.id, tab.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                    isSelected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </Card>

        {selectedTab === "overview" ? (
          <div className="space-y-4">
            {installation.slug === "shopify" && !shopifyConnectionComplete ? (
              <div className={`rounded-lg border px-4 py-3 text-sm ${toneClassForBanner("warning")}`}>
                <p className="font-medium">Shopify OAuth is not yet complete.</p>
                <p className="mt-1">
                  This account is waiting for the managed install handoff. Publishing and channel refresh will not work until authorization finishes.{" "}
                  <a
                    href={buildDetailHref(installation.id, "credentials")}
                    className="underline hover:no-underline"
                  >
                    See the Managed Install Handoff checklist on the Credentials tab.
                  </a>
                </p>
                {shopifyAwaitingManagedInstall ? (
                  <form action={initiateOAuthAction} className="mt-2">
                    <input type="hidden" name="installationId" value={installation.id} />
                    <PendingSubmitButton
                      type="submit"
                      variant="secondary"
                      idleLabel="Authorize Shopify"
                      pendingLabel="Redirecting to Shopify..."
                    />
                  </form>
                ) : null}
              </div>
            ) : null}
            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Account Profile</CardTitle>
                <dl className="mt-2 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
                  <dt className="text-slate-500">Connector</dt>
                  <dd>{installation.displayName}</dd>
                  <dt className="text-slate-500">Maturity</dt>
                  <dd>{connectorLaunchLabel(installation.launchStage, installation.implementationStatus)}</dd>
                  <dt className="text-slate-500">Account alias</dt>
                  <dd>{installation.accountAlias}</dd>
                  <dt className="text-slate-500">Supported operations</dt>
                  <dd>{formatCapabilityList(installation.capabilities)}</dd>
                  <dt className="text-slate-500">Installation ID</dt>
                  <dd className="font-mono text-xs text-slate-700">{installation.id}</dd>
                  <dt className="text-slate-500">Slug</dt>
                  <dd>{installation.slug}</dd>
                  <dt className="text-slate-500">External Ref</dt>
                  <dd>{installation.externalAccountRef || "-"}</dd>
                  <dt className="text-slate-500">Installed At</dt>
                  <dd>{fmtDT(installation.installedAt)}</dd>
                  <dt className="text-slate-500">Last Sync</dt>
                  <dd>{installation.lastSyncAt ? fmtDT(installation.lastSyncAt) : "-"}</dd>
                </dl>
              </Card>

              <Card>
                <CardTitle>Operator Summary</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>
                    This account is currently{" "}
                    <span className="font-medium">{formatStatusSummary(installation.status).toLowerCase()}</span>.
                  </p>
                  <p>
                    Catalog coverage:{" "}
                    <span className="font-medium">{catalogEntries.length}</span> product
                    {catalogEntries.length === 1 ? "" : "s"} have submission history for this account.
                  </p>
                  <p>
                    Recent connector pressure:{" "}
                    <span className="font-medium">
                      {failedSubmissions.length} issue{failedSubmissions.length === 1 ? "" : "s"}
                    </span>{" "}
                    and{" "}
                    <span className="font-medium">
                      {pendingSubmissions.length} in flight
                    </span>
                    .
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={buildDetailHref(installation.id, "catalog")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review catalog coverage
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "issues")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open issue queue
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "logs")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Inspect submission logs
                    </Link>
                  </div>
                </div>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Catalog Snapshot</CardTitle>
                {catalogEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No catalog records have been submitted through this account yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {catalogEntries.slice(0, 5).map((entry) => (
                      <li key={entry.productId} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="font-medium text-blue-700 hover:underline">
                              {entry.product?.title || "Open product"}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.product?.brand ? `${entry.product.brand} | ` : ""}
                              Last submission {formatDateTime(entry.latestSubmission.submittedAt)}
                            </p>
                          </div>
                          <StatusChip
                            label={entry.latestSubmission.status}
                            tone={submissionStatusTone(entry.latestSubmission.status)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardTitle>Issue Snapshot</CardTitle>
                {failedSubmissions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No failed or rejected submissions are open for this account right now.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {failedSubmissions.slice(0, 5).map((submission) => {
                      const product = productsById.get(submission.productId);
                      return (
                        <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="font-medium text-blue-700 hover:underline">
                                {product?.title || "Open product"}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">{summarizeSubmissionOutcome(submission)}</p>
                            </div>
                            <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>

            {installation.slug === "meesho" ? (
              <Card>
                <CardTitle>Meesho Excel Export</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  Generate a ready-to-upload Excel file for Meesho Supplier Panel.
                  Each product variant becomes its own row. Columns match the Meesho category template.
                </p>
                <div className="mt-4">
                  <MeeshoExportPanel
                    installationId={installation.id}
                    productIds={products.map((p) => p.id)}
                  />
                </div>
              </Card>
            ) : null}

            {installation.slug === "shopify" ? (
              <>
                <Card>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Shopify Store Configuration</CardTitle>
                      {shopifyConfig ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Last imported {shopifyConfig.fetchedAt ? fmtDT(shopifyConfig.fetchedAt) : "—"} ·{" "}
                          {Array.isArray(shopifyConfig.metafields) ? shopifyConfig.metafields.length : 0} metafield definitions ·{" "}
                          {Array.isArray(shopifyConfig.collections) ? shopifyConfig.collections.length : 0} collections ·{" "}
                          {Array.isArray(shopifyConfig.taxonomy) ? shopifyConfig.taxonomy.length : 0} taxonomy nodes
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-amber-700">
                          Shopify configuration has not been imported yet. Import it to enable metafield mapping and collection assignment in the mapping editor.
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/channels/connectors/${encodeURIComponent(installation.id)}/import-config`}
                      className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      {shopifyConfig ? "Refresh config" : "Import config"}
                    </Link>
                  </div>
                </Card>
                <Card>
                  <CardTitle>Publication Targets</CardTitle>
                  {shopifyPublicationState.error ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {shopifyPublicationState.error}
                      <div className="mt-2">
                        <Link
                          href={buildDetailHref(installation.id, "credentials")}
                          className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Retry in Credentials tab →
                        </Link>
                      </div>
                    </div>
                  ) : availableShopifyTargets.length === 0 ? (
                    <div className="mt-2 space-y-3">
                      <p className="text-sm text-slate-600">
                        {publicationTargets.length > 0
                          ? "Saved targets are shown below. To change selection, refresh available channels in the Credentials tab."
                          : "No publication targets loaded yet. Open the Credentials tab to fetch available channels from your Shopify store."}
                      </p>
                      {publicationTargets.length > 0 ? (
                        <ul className="space-y-2 text-sm">
                          {publicationTargets.map((target) => (
                            <li key={target.id} className="rounded-md border border-slate-200 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-slate-800">{target.name}</span>
                                <StatusChip label={target.selected ? "selected" : "available"} tone={target.selected ? "success" : "neutral"} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {shopifyConnectionComplete ? (
                        <Link
                          href={buildDetailHref(installation.id, "credentials")}
                          className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Refresh publication channels →
                        </Link>
                      ) : (
                        <p className="text-xs text-amber-700">
                          Complete Shopify authorization before refreshing channels.
                        </p>
                      )}
                    </div>
                  ) : (
                    <form action={updateConnectorPublicationTargetsAction} className="mt-2 space-y-3">
                      <input type="hidden" name="installationId" value={installation.id} />
                      <input type="hidden" name="tenantKey" value={installation.tenantKey} />
                      <input type="hidden" name="returnTo" value={buildDetailHref(installation.id, "overview")} />
                      <div className="space-y-2 text-sm">
                        {availableShopifyTargets.map((target) => (
                          <label
                            key={target.id}
                            className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              name="publicationId"
                              value={target.id}
                              defaultChecked={Boolean(target.selected)}
                              disabled={!canManageConnectors(actorRole)}
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                            />
                            <span className="min-w-0">
                              <span className="block font-medium text-slate-800">{target.name}</span>
                              <span className="block text-xs text-slate-500">
                                {target.catalogTitle ?? target.catalogType ?? target.catalogId ?? target.id}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        type="submit"
                        disabled={!canManageConnectors(actorRole)}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        Save publication targets
                      </button>
                    </form>
                  )}
                  <p className="mt-3 text-xs text-slate-500">
                    {publicationTargetsUpdatedAt
                      ? `Last updated ${formatDateTime(publicationTargetsUpdatedAt)}.`
                      : "No update timestamp recorded yet."}
                  </p>
                </Card>
              </>
            ) : null}
          </div>
        ) : null}

        {selectedTab === "credentials" ? (
          <div className="space-y-4">
            {installation.slug === "shopify" && !shopifyConnectionComplete ? (
              <div className={`rounded-lg border px-4 py-3 text-sm ${toneClassForBanner("warning")}`}>
                <p className="font-medium">Shopify OAuth is not yet complete.</p>
                <p className="mt-1">
                  OAuth has not been finalized for this account. The Managed Install Handoff checklist below shows exactly which steps remain. Complete the handoff before refreshing publication channels or publishing products.
                </p>
                {shopifyAwaitingManagedInstall ? (
                  <form action={initiateOAuthAction} className="mt-2">
                    <input type="hidden" name="installationId" value={installation.id} />
                    <PendingSubmitButton
                      type="submit"
                      variant="secondary"
                      idleLabel="Authorize Shopify"
                      pendingLabel="Redirecting to Shopify..."
                    />
                  </form>
                ) : null}
              </div>
            ) : null}
            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Account Connection</CardTitle>
                <dl className="mt-2 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
                  <dt className="text-slate-500">Connector</dt>
                  <dd>{installation.displayName}</dd>
                  <dt className="text-slate-500">Account alias</dt>
                  <dd>{installation.accountAlias}</dd>
                  <dt className="text-slate-500">External ref</dt>
                  <dd>{installation.externalAccountRef || "-"}</dd>
                  <dt className="text-slate-500">Seller ID</dt>
                  <dd>{metadataSellerId || "-"}</dd>
                  <dt className="text-slate-500">Marketplace ID</dt>
                  <dd>{metadataMarketplaceId || "-"}</dd>
                  <dt className="text-slate-500">Shop domain</dt>
                  <dd>{metadataShopDomain || "-"}</dd>
                  <dt className="text-slate-500">Shop name</dt>
                  <dd>{metadataShopName || "-"}</dd>
                </dl>
              </Card>

              <Card>
                <CardTitle>Credential Safety</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>
                    Stored credentials are intentionally masked in Vexa. Use account health and reconnect actions to confirm whether this installation still has valid access.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600">
                    <li>Status: <span className="font-medium text-slate-800">{formatStatusSummary(installation.status)}</span></li>
                    <li>Last sync: <span className="font-medium text-slate-800">{installation.lastSyncAt ? formatDateTime(installation.lastSyncAt) : "Not recorded"}</span></li>
                    <li>Installed by: <span className="font-medium text-slate-800">{installation.installedBy}</span></li>
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href="/channels/connectors/setup"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open setup workspace
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "issues")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review account issues
                    </Link>
                  </div>
                </div>
              </Card>
            </section>

            <Card>
              <CardTitle>Connection Recovery Checklist</CardTitle>
              <div className="mt-2 space-y-3 text-sm text-slate-700">
                <p>
                  Use this checklist before you reconnect or escalate a connector account so retries happen only after the likely failure lane is clear.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-slate-600">
                  <li>Confirm the external account reference and alias still point to the marketplace account this team expects to manage.</li>
                  <li>Use account health, last sync, and issue queue evidence to decide whether the failure is credential drift, mapping pressure, or downstream processing.</li>
                  <li>Return to publication targets, logs, and governance once the account reconnects so publish traffic does not resume with stale access assumptions.</li>
                </ul>
              </div>
            </Card>

            {installation.slug === "amazon-in" ? (
              <Card>
                <CardTitle>Amazon Marketplace Configuration</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  Configure the target marketplace and optional default product type for this installation.
                  Changes apply on the next validation and publish cycle.
                </p>

                {/* Current configuration at a glance */}
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-[180px_1fr]">
                    <dt className="text-slate-500">Marketplace ID</dt>
                    <dd className="font-mono text-xs text-slate-700">
                      {metadataMarketplaceId
                        ? `${metadataMarketplaceId}${AMAZON_MARKETPLACE_LABELS[metadataMarketplaceId] ? ` — ${AMAZON_MARKETPLACE_LABELS[metadataMarketplaceId]}` : ""}`
                        : "A21TJRUUN4KGV — Amazon India (default)"}
                    </dd>
                    <dt className="text-slate-500">Default product type</dt>
                    <dd className="font-mono text-xs text-slate-700">
                      {metadataDefaultProductType || <span className="text-slate-400">Not set</span>}
                    </dd>
                  </dl>
                </div>

                {/* Edit form */}
                <form action={configureAmazonAction} className="mt-4 space-y-4">
                  <input type="hidden" name="installationId" value={installation.id} />
                  <input type="hidden" name="returnTo" value={buildDetailHref(installation.id, "credentials")} />

                  <div className="space-y-1">
                    <label htmlFor="amazon-configure-marketplace" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Marketplace ID
                    </label>
                    <datalist id="amazon-configure-marketplace-list">
                      <option value="A21TJRUUN4KGV" />
                      <option value="ATVPDKIKX0DER" />
                      <option value="A2EUQ1WTGCTBG2" />
                      <option value="A1F83G8C2ARO7P" />
                      <option value="A1PA6795UKMFR9" />
                      <option value="A13V1IB3VIYZZH" />
                      <option value="APJ6JRA9NG5V4" />
                      <option value="A1VC38T7YXB528" />
                      <option value="A39IBJ37TRP1C6" />
                      <option value="A2VIGQ35RCS4UG" />
                    </datalist>
                    <Input
                      id="amazon-configure-marketplace"
                      name="marketplaceId"
                      list="amazon-configure-marketplace-list"
                      defaultValue={metadataMarketplaceId || "A21TJRUUN4KGV"}
                      autoComplete="off"
                    />
                    <p className="text-xs text-slate-500">
                      IN: A21TJRUUN4KGV · US: ATVPDKIKX0DER · UK: A1F83G8C2ARO7P · DE: A1PA6795UKMFR9 · JP: A1VC38T7YXB528
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="amazon-configure-product-type" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Default Product Type <span className="font-normal text-slate-400">(optional — clears if left blank)</span>
                    </label>
                    <datalist id="amazon-configure-product-type-list">
                      <option value="SHIRT" />
                      <option value="DRESS" />
                      <option value="PANTS" />
                      <option value="SHOES" />
                      <option value="CONSUMER_ELECTRONICS" />
                      <option value="MOBILE_PHONE" />
                      <option value="HOME_FURNISHING" />
                      <option value="KITCHEN" />
                      <option value="BEAUTY" />
                      <option value="BOOKS" />
                      <option value="TOYS_AND_GAMES" />
                      <option value="BABY_PRODUCT" />
                      <option value="SPORTS" />
                    </datalist>
                    <Input
                      id="amazon-configure-product-type"
                      name="defaultProductType"
                      list="amazon-configure-product-type-list"
                      defaultValue={metadataDefaultProductType || ""}
                      placeholder="e.g. SHIRT"
                      autoComplete="off"
                    />
                    <p className="text-xs text-slate-500">
                      Used when no per-product type override is set. Leave blank for mixed-type catalogs.
                    </p>
                  </div>

                  <PendingSubmitButton idleLabel="Save Amazon configuration" />
                </form>
              </Card>
            ) : null}

            {installation.slug === "shopify" ? (
              <Card>
                <CardTitle>Shopify Readiness</CardTitle>
                <div className="mt-2 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip
                      label={`${completedShopifyReadinessSteps}/${shopifyReadinessSteps.length} steps complete`}
                      tone={completedShopifyReadinessSteps === shopifyReadinessSteps.length ? "success" : "warning"}
                    />
                    <StatusChip
                      label={
                        completedShopifyReadinessSteps === shopifyReadinessSteps.length
                          ? "publish ready"
                          : "setup still required"
                      }
                      tone={completedShopifyReadinessSteps === shopifyReadinessSteps.length ? "success" : "info"}
                    />
                  </div>
                  <ul className="space-y-2 text-sm">
                    {shopifyReadinessSteps.map((step) => (
                      <li key={step.label} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-800">{step.label}</p>
                            <p className="mt-1 text-xs text-slate-500">{step.detail}</p>
                          </div>
                          <StatusChip
                            label={step.complete ? "done" : "needs action"}
                            tone={shopifyReadinessTone(step.complete)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500">
                    This panel is operational guidance only. Shopify uses managed install, token exchange, and saved publication targets before publish traffic should be treated as healthy.
                  </p>
                </div>
              </Card>
            ) : null}

            {installation.slug === "shopify" ? (
              <Card>
                <CardTitle>Managed Install Handoff</CardTitle>
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-slate-700">
                    Shopify uses a coordinated managed-install handoff. Operators should treat this page as the source of truth for where the install, token exchange, and publication setup stand.
                  </p>
                  <ul className="space-y-2 text-sm">
                    {shopifyManagedInstallSteps.map((step) => (
                      <li key={step.label} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-800">{step.label}</p>
                            <p className="mt-1 text-xs text-slate-500">{step.detail}</p>
                          </div>
                          <StatusChip
                            label={
                              step.state === "complete"
                                ? "done"
                                : step.state === "in_progress"
                                  ? "in progress"
                                  : "pending"
                            }
                            tone={shopifyManagedInstallStepTone(step.state)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href="/channels/connectors"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open connector portfolio
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "credentials")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Refresh credential state
                    </Link>
                  </div>
                  <p className="text-xs text-slate-500">
                    Shopify is live for this workspace. This handoff keeps token exchange and publication controls visible before operators treat the account as publish-ready.
                  </p>
                </div>
              </Card>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Publication Targets</CardTitle>
                {installation.slug === "shopify" ? (
                  shopifyPublicationState.error ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {shopifyPublicationState.error}
                    </div>
                  ) : !shopifyConnectionComplete ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm text-slate-600">
                        Complete Shopify authorization before configuring publication channels. See the Managed Install Handoff checklist above.
                      </p>
                      <p className="text-xs text-amber-700">
                        Complete Shopify authorization before refreshing channels.
                      </p>
                    </div>
                  ) : availableShopifyTargets.length === 0 ? (
                    publicationTargets.length === 0 ? (
                      <div className="mt-2 space-y-3">
                        <p className="text-sm text-slate-600">
                          No publication channels were returned from your Shopify store. Each time this tab loads, Vexa fetches the latest channels directly from Shopify. If the list is still empty, check that your store has at least one sales channel or publication enabled in Shopify Admin.
                        </p>
                        <Link
                          href={buildDetailHref(installation.id, "credentials")}
                          className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Reload to refetch channels →
                        </Link>
                      </div>
                    ) : (
                      <ul className="mt-2 space-y-2 text-sm">
                        {publicationTargets.map((target) => (
                          <li key={target.id} className="rounded-md border border-slate-200 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-800">{target.name}</p>
                                <p className="mt-1 text-xs text-slate-500">{target.catalogTitle || target.id}</p>
                              </div>
                              <StatusChip label={target.selected ? "selected" : "available"} tone={target.selected ? "success" : "neutral"} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    <form action={updateConnectorPublicationTargetsAction} className="mt-2 space-y-3">
                      <input type="hidden" name="installationId" value={installation.id} />
                      <input type="hidden" name="tenantKey" value={installation.tenantKey} />
                      <input type="hidden" name="returnTo" value={buildDetailHref(installation.id, "credentials")} />
                      <div className="space-y-2 text-sm">
                        {availableShopifyTargets.map((target) => (
                          <label
                            key={target.id}
                            className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              name="publicationId"
                              value={target.id}
                              defaultChecked={Boolean(target.selected)}
                              disabled={!canManageConnectors(actorRole)}
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                            />
                            <span className="min-w-0">
                              <span className="block font-medium text-slate-800">{target.name}</span>
                              <span className="block text-xs text-slate-500">
                                {target.catalogTitle ?? target.catalogType ?? target.catalogId ?? target.id}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={!canManageConnectors(actorRole)}
                          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          Save publication targets
                        </button>
                        {!canManageConnectors(actorRole) ? (
                          <span className="text-xs text-slate-500">Your role can review targets but cannot change them.</span>
                        ) : null}
                      </div>
                    </form>
                  )
                ) : publicationTargets.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    This connector account does not currently expose saved publication targets in Vexa metadata.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {publicationTargets.map((target) => (
                      <li key={target.id} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-800">{target.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{target.catalogTitle || target.id}</p>
                          </div>
                          <StatusChip label={target.selected ? "selected" : "available"} tone={target.selected ? "success" : "neutral"} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  {publicationTargetsUpdatedAt
                    ? `Publication targets last updated ${formatDateTime(publicationTargetsUpdatedAt)}.`
                    : "No publication target update timestamp recorded yet."}
                </p>
              </Card>

              <Card>
                <CardTitle>Credential Operating Notes</CardTitle>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  <li>Credentials are never echoed back into this page once they are stored.</li>
                  <li>Use connector status, issue history, and reconnect flows to validate account access safely.</li>
                  <li>Publication targets appear here only when the connector runtime persists them for this installation.</li>
                </ul>
              </Card>
            </section>
          </div>
        ) : null}

        {selectedTab === "catalog" ? (
          <div className="space-y-4">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Products in scope" value={catalogEntries.length} helper="Products with submission history on this account" />
              <KpiCard label="Variants represented" value={catalogVariantCount} helper="Variant count from linked catalog products" />
              <KpiCard
                label="Blocking readiness issues"
                value={catalogBlockingCount}
                helper="Open product-level validation errors"
                tone={catalogBlockingCount > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="Warnings"
                value={catalogWarningCount}
                helper="Open validation warnings worth reviewing"
                tone={catalogWarningCount > 0 ? "warning" : "success"}
              />
            </section>

            <Card>
              <CardTitle>Catalog Module Framework</CardTitle>
              <p className="mt-2 text-sm text-slate-600">
                Move through the account cockpit the same way Vexa operators work: products first, then variants, attributes, categories, media, publication targets, payload preview, and readiness.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {CATALOG_MODULES.map((module) => (
                  <a
                    key={module.id}
                    href={`#${module.anchor}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{module.label}</p>
                    <p className="mt-2 text-sm text-slate-600">{module.description}</p>
                  </a>
                ))}
              </div>
            </Card>

            <Card id="catalog-products">
              <CardTitle>Catalog Modules</CardTitle>
              <p className="mt-2 text-sm text-slate-600">
                This account view stays PIM-focused: product coverage, variant footprint, category context, and readiness signals for publication.
              </p>
              {catalogEntries.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No submissions recorded for this account yet.</p>
              ) : (
                <DataGrid className="mt-3" columns={catalogColumns} rows={catalogEntries} getRowKey={(entry) => entry.productId} />
              )}
            </Card>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card id="catalog-readiness">
                <CardTitle>Readiness Queue</CardTitle>
                {readinessEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No product-level readiness blockers are visible for this connector account.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {readinessEntries.slice(0, 8).map((entry) => (
                      <li key={entry.productId} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="font-medium text-blue-700 hover:underline">
                              {entry.product?.title || "Open product"}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.product?.openValidationErrorCount ?? 0} errors | {entry.product?.openValidationWarningCount ?? 0} warnings
                            </p>
                          </div>
                          <StatusChip label={catalogReadinessLabel(entry.product)} tone={catalogReadinessTone(entry.product)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card id="catalog-publication">
                <CardTitle>Publication Guidance</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publication Targets</p>
                    <p className="mt-1 text-sm text-slate-700">{publicationTargetSummary}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {publicationTargetsUpdatedAt
                        ? `Last updated ${formatDateTime(publicationTargetsUpdatedAt)}`
                        : "No publication-target timestamp recorded yet"}
                    </p>
                  </div>
                  <p>Use this account view to answer three questions before you publish again:</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600">
                    <li>Is the product catalog complete enough for this channel account?</li>
                    <li>Are variants, taxonomy, and brand details present for the affected products?</li>
                    <li>Do readiness blockers need fixing before you retry publication?</li>
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open catalog mapping
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "issues")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review issue queue
                    </Link>
                  </div>
                </div>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card id="catalog-variants">
                <CardTitle>Focused Product Modules</CardTitle>
                {!focusCatalogEntry ? (
                  <p className="mt-2 text-sm text-slate-600">No submitted product is available yet for module-level connector context.</p>
                ) : (
                  <div className="mt-2 space-y-3 text-sm">
                    <div className="rounded-md border border-slate-200 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product</p>
                      <p className="mt-1 font-medium text-slate-900">{focusProduct?.title || focusCatalogEntry.productId}</p>
                      <p className="mt-1 text-xs text-slate-500">{focusCatalogEntry.productId}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variants</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{focusVariants.length}</p>
                        <p className="mt-1 text-xs text-slate-500">{variantSummary}</p>
                      </div>
                      <div id="catalog-media" className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Media assets</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{focusMedia.length}</p>
                        <p className="mt-1 text-xs text-slate-500">{mediaSummary}</p>
                      </div>
                      <div id="catalog-attributes" className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category attributes</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{focusAttributes.length}</p>
                        <p className="mt-1 text-xs text-slate-500">{attributeSummary}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open issues</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{focusIssues.length}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {focusIssues.length === 0 ? "No issue payloads for the focused product" : "Use the issue queue below for recovery guidance"}
                        </p>
                      </div>
                    </div>
                    <div id="catalog-categories" className="rounded-md border border-slate-200 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category and taxonomy</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {focusProduct?.categoryName || focusProduct?.categoryId || "Uncategorized"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{focusProduct?.categoryPath || "No category path recorded yet"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link
                        href={`/products/${encodeURIComponent(focusCatalogEntry.productId)}`}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open product
                      </Link>
                      <Link
                        href={`/catalog/media?productId=${encodeURIComponent(focusCatalogEntry.productId)}`}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open media
                      </Link>
                    </div>
                  </div>
                )}
              </Card>

              <Card id="catalog-payload">
                <CardTitle>Payload Preview Snapshot</CardTitle>
                {!focusPayloadPreview ? (
                  <p className="mt-2 text-sm text-slate-600">
                    No payload preview is available for this account and focused product yet.
                  </p>
                ) : (
                  <div className="mt-2 space-y-3 text-sm text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip label={focusPayloadPreview.exportReady ? "export ready" : "blocked"} tone={focusPayloadPreview.exportReady ? "success" : "danger"} />
                      <StatusChip label={focusPayloadPreview.mappingSource} tone="info" />
                      <StatusChip label={focusPayloadPreview.validationSource} tone="neutral" />
                    </div>
                    <p>
                      Preview channel: <span className="font-medium text-slate-900">{focusPayloadPreview.channel}</span>
                    </p>
                    <p>
                      Missing fields: <span className="font-medium text-slate-900">{focusPayloadPreview.missingFields.length}</span>
                    </p>
                    <p>
                      Channel issues: <span className="font-medium text-slate-900">{focusPayloadPreview.channelIssues.length}</span>
                    </p>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mapped payload keys</p>
                      <p className="mt-1 text-sm text-slate-700">
                        {Object.keys(focusPayloadPreview.mappedPayload ?? {}).slice(0, 8).join(", ") || "No mapped fields returned"}
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            </section>
          </div>
        ) : null}

        {selectedTab === "mappings" ? (
          <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Mapping Scope</CardTitle>
                {!focusCatalogEntry ? (
                  <p className="mt-2 text-sm text-slate-600">No submitted product is available yet to anchor a mapping scope for this account.</p>
                ) : (
                  <div className="mt-2 space-y-3 text-sm text-slate-700">
                    <p>
                      Channel scope: <span className="font-medium text-slate-900">{focusChannel || "Unavailable"}</span>
                    </p>
                    <p>
                      Focus product: <span className="font-medium text-slate-900">{focusProduct?.title || focusCatalogEntry.productId}</span>
                    </p>
                    <p>
                      Category: <span className="font-medium text-slate-900">{focusProduct?.categoryName || focusProduct?.categoryId || "Unavailable"}</span>
                    </p>
                    <p>
                      Attribute surface: <span className="font-medium text-slate-900">{focusAttributes.length}</span> known attributes
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link
                        href={mappingHref}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open mapping workspace
                      </Link>
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <CardTitle>Mapping Readiness</CardTitle>
                {!focusPayloadPreview ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Payload preview is not available yet for this installation. Use the mapping workspace to validate and publish when the connector supports preview generation.
                  </p>
                ) : (
                  <div className="mt-2 space-y-3 text-sm text-slate-700">
                    <p>
                      Export readiness: <span className="font-medium text-slate-900">{focusPayloadPreview.exportReady ? "Ready" : "Blocked"}</span>
                    </p>
                    <p>
                      Missing fields: <span className="font-medium text-slate-900">{focusPayloadPreview.missingFields.length}</span>
                    </p>
                    <p>
                      Channel issues: <span className="font-medium text-slate-900">{focusPayloadPreview.channelIssues.length}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      The mapping workbench remains the canonical edit surface. This tab exists to keep the account cockpit aligned with mapping state, not to replace the shared mapping editor.
                    </p>
                  </div>
                )}
              </Card>
            </section>

            <Card>
              <CardTitle>Why Mappings Stay Shared</CardTitle>
              <div className="mt-2 space-y-3 text-sm text-slate-700">
                <p>
                  Vexa keeps category and channel mapping in one shared workbench so operators do not end up with two competing mapping systems.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-slate-600">
                  <li>Use this account cockpit to confirm the affected channel, product, and readiness state.</li>
                  <li>Use the mapping workspace to edit templates, validate drafts, and publish mapping versions.</li>
                  <li>Return here to review whether the updated mapping clears account-specific issues.</li>
                </ul>
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "issues" ? (
          <div className="space-y-4">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Failed / rejected"
                value={failedSubmissions.length}
                helper="Items needing corrective action"
                tone={failedSubmissions.length > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="In flight"
                value={pendingSubmissions.length}
                helper="Pending or retrying connector work"
                tone={pendingSubmissions.length > 0 ? "warning" : "success"}
              />
              <KpiCard
                label="Catalog blockers"
                value={catalogBlockingCount}
                helper="Open product validation errors linked to this account"
                tone={catalogBlockingCount > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="Warnings"
                value={catalogWarningCount}
                helper="Non-blocking readiness findings"
                tone={catalogWarningCount > 0 ? "warning" : "success"}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardTitle>Recovery Playbook</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>Work through recovery in this order so we do not waste retries on unresolved catalog problems.</p>
                  <ol className="list-decimal space-y-1 pl-5 text-slate-600">
                    <li>Fix product mapping or required catalog fields when the issue lane is catalog mapping.</li>
                    <li>Check this account's credentials and status when items point to connector account review.</li>
                    <li>Use logs to confirm whether the queue is still processing before retrying pending items.</li>
                  </ol>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Fix mapping
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "logs")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open logs
                    </Link>
                    <Link
                      href="/admin/connectors"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review governance
                    </Link>
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle>Issue Buckets</CardTitle>
                {failedSubmissions.length === 0 && pendingSubmissions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No connector issues or in-flight items need attention for this account.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {[...failedSubmissions, ...pendingSubmissions].slice(0, 8).map((submission) => {
                      const product = productsById.get(submission.productId);
                      return (
                        <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="font-medium text-blue-700 hover:underline">
                                {product?.title || "Open product"}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">{issueLaneLabel(submission)}</p>
                              <p className="mt-2 text-sm text-slate-700">{nextOperatorStep(submission)}</p>
                            </div>
                            <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>

            <Card>
              <CardTitle>Issue Queue</CardTitle>
              {failedSubmissions.length === 0 && pendingSubmissions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No connector issues or in-flight items need attention for this account.</p>
              ) : (
                <DataGrid className="mt-2" columns={issueQueueColumns} rows={issueQueueRows} getRowKey={(submission) => submission.id} />
              )}
            </Card>
          </div>
        ) : null}

        {selectedTab === "logs" ? (
          <Card>
            <CardTitle>Submission Activity</CardTitle>
            {submissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No submissions recorded for this account yet.</p>
            ) : (
              <DataGrid className="mt-2" columns={submissionActivityColumns} rows={submissions.slice(0, 50)} getRowKey={(submission) => submission.id} />
            )}
          </Card>
        ) : null}

        {selectedTab === "access" ? (
          <Card>
            <CardTitle>Governance &amp; Access</CardTitle>
            {permissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No connector-specific permission overrides. Workspace defaults are currently in effect.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {permissions.map((permission) => (
                  <li key={permission.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">{describePermissionRule(permission)}</p>
                    <p className="text-xs text-slate-500">
                      Created by {permission.createdBy || "system"} | updated {fmtDT(permission.updatedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/admin/connectors"
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Manage connector access
              </Link>
              <Link
                href={buildDetailHref(installation.id, "overview")}
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to overview
              </Link>
            </div>
          </Card>
        ) : null}

        {/* ─── Sprint 8 / Sprint G: Sync tab ─── */}
        {selectedTab === "sync" ? (
          <Card>
            <CardTitle>Delta Sync</CardTitle>
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Delta sync</p>
                <p className="mt-1 text-slate-600">
                  Queues all approved products that have been updated since their last successful sync to this connector.
                  Only products with a version number higher than the last synced version are included.
                  Works for Shopify, Amazon, Flipkart, and all connectors that support the{" "}
                  <code className="font-mono text-xs bg-white border border-slate-200 px-1 rounded">PUBLISH</code>{" "}
                  capability.
                </p>
              </div>
              {deltaCandidates.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-medium">{deltaCandidates.length} product{deltaCandidates.length !== 1 ? "s" : ""} pending sync</span>
                  {" "}— version has advanced since last successful push.
                </div>
              ) : deltaCandidatesResult.status === "fulfilled" ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  All products are up to date. No delta sync candidates found.
                </div>
              ) : null}
              <form action={queueConnectorDeltaSyncAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="installationId" value={installation.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=sync`}
                />
                <PendingSubmitButton idleLabel="Queue delta sync" />
                <Link
                  href="/operations/jobs"
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  View sync jobs →
                </Link>
              </form>
              {installation.capabilities.includes("BULK_PUBLISH") ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">Amazon Feeds API — Bulk publish</p>
                  <p className="mt-1 text-xs text-amber-700">
                    Submit all approved products as a single{" "}
                    <code className="font-mono bg-white border border-amber-200 px-1 rounded">JSON_LISTINGS_FEED</code>{" "}
                    document. Each product gets an individual submission record you can track in the Jobs workspace.
                  </p>
                  <BulkPublishConfirmForm
                    installationId={installation.id}
                    returnTo={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=sync`}
                    action={triggerBulkPublishAction}
                  />
                </div>
              ) : null}
              <p className="text-xs text-slate-500">
                Sync jobs run through the standard export queue. Monitor progress in the{" "}
                <Link href="/operations/jobs" className="underline">Jobs workspace</Link>.
              </p>
            </div>
          </Card>
        ) : null}

        {/* ─── Sprint 9 / Sprint G: Schedule tab ─── */}
        {selectedTab === "schedule" ? (
          <Card>
            <CardTitle>Sync Schedule</CardTitle>
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Automated delta sync schedule</p>
                <p className="mt-1 text-slate-600">
                  Configure a recurring schedule to automatically queue delta syncs for this connector.
                  Works for Shopify, Amazon, Flipkart, and all connectors with the{" "}
                  <code className="font-mono text-xs bg-white border border-slate-200 px-1 rounded">PUBLISH</code>{" "}
                  capability. Use standard 5-field cron syntax (minute hour day month weekday).
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span><code className="font-mono bg-white border border-slate-200 px-1 rounded">0 2 * * *</code> — daily at 2 AM</span>
                  <span><code className="font-mono bg-white border border-slate-200 px-1 rounded">0 */12 * * *</code> — every 12 hours</span>
                  <span><code className="font-mono bg-white border border-slate-200 px-1 rounded">0 * * * *</code> — hourly</span>
                  <span><code className="font-mono bg-white border border-slate-200 px-1 rounded">0 9,17 * * 1-5</code> — weekdays 9 AM + 5 PM</span>
                </div>
              </div>

              {connectorSchedule ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <span className="font-medium">Active schedule:</span>{" "}
                  <code className="font-mono text-xs">{connectorSchedule.cronExpression}</code>
                  {connectorSchedule.scope ? (
                    <span className="ml-2 text-xs text-emerald-700">
                      · scope: {connectorSchedule.scope.replace(/_/g, " ")}
                    </span>
                  ) : null}
                  {connectorSchedule.status && connectorSchedule.status !== "active" ? (
                    <span className="ml-2 text-xs text-amber-700 font-medium">({connectorSchedule.status})</span>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  No schedule configured. This connector will only sync when manually triggered.
                </div>
              )}

              <form action={upsertConnectorSyncScheduleAction} className="grid gap-3 md:grid-cols-3">
                <input type="hidden" name="installationId" value={installation.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=schedule`}
                />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="sched-cron">
                    Cron expression
                  </label>
                  <input
                    id="sched-cron"
                    name="cronExpression"
                    placeholder="0 2 * * *"
                    defaultValue={connectorSchedule?.cronExpression ?? ""}
                    required
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="sched-scope">
                    Scope
                  </label>
                  <select
                    id="sched-scope"
                    name="scope"
                    defaultValue={connectorSchedule?.scope ?? "approved_only"}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="approved_only">Approved products only</option>
                    <option value="all">All active products</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <PendingSubmitButton idleLabel={connectorSchedule ? "Update schedule" : "Save schedule"} />
                </div>
              </form>

              {connectorSchedule ? (
                <form action={deleteConnectorSyncScheduleAction} className="flex items-center gap-2">
                  <input type="hidden" name="installationId" value={installation.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=schedule`}
                  />
                  <PendingSubmitButton idleLabel="Remove schedule" />
                  <span className="text-xs text-slate-500">Removes the automated trigger. Manual delta sync will still work.</span>
                </form>
              ) : null}

              <p className="text-xs text-slate-500">
                Schedule changes take effect on the next trigger. Use the{" "}
                <Link href="/operations/jobs" className="underline">Jobs workspace</Link>{" "}
                to monitor scheduled run history.
              </p>
            </div>
          </Card>
        ) : null}

        {/* ─── Sprint 10: Catalog link tab ─── */}
        {selectedTab === "catalog-link" ? (
          <Card>
            <CardTitle>Existing Catalog Linking</CardTitle>
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Link Vexa products to existing Shopify listings</p>
                <p className="mt-1 text-slate-600">
                  If you already have products in Shopify, scan to match them by SKU or barcode.
                  Confirmed links prevent duplicate Shopify listings on first sync.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Currently matches by submission history (products previously published from Vexa).
                  SKU and barcode matching will be added in a future update.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/channels/connectors/${encodeURIComponent(installation.id)}/catalog-link`}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Open catalog link workspace
                </Link>
              </div>
            </div>
          </Card>
        ) : null}

      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(detailReturnPath, error));
    }
    throw error;
  }
}

