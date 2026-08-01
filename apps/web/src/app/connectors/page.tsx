import Link from "next/link";
import { redirect } from "next/navigation";
import {
  deleteConnectorInstallationAction,
  initiateOAuthAction,
  reconnectConnectorAction,
  uninstallConnectorAction,
} from "@/app/actions";
import { ConnectorAccountQuickView } from "@/app/connectors/_components/connector-account-quick-view";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type ConnectorDefinition,
  type ConnectorInstallation,
  getConnectorDefinitions,
  getInstalledConnectors,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { mapConnectorSlugToMarketplaceChannel } from "@/lib/marketplace-channels";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { filterTestData } from "@/lib/test-data-filter";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

interface ConnectorsPageProps {
  searchParams: Promise<{
    status?: string;
    connectorSlug?: string;
    installError?: string;
    q?: string;
  }>;
}

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type ConnectorMaturity = "Live publish" | "Export/manual" | "Beta" | "Experimental";

const CONNECTOR_CAPABILITY_BADGES = [
  { label: "Publish", capability: "PUBLISH" },
  { label: "Validate", capability: "VALIDATE" },
  { label: "Status sync", capability: "STATUS_SYNC" },
  { label: "Webhooks", capability: "WEBHOOK_RECEIVE" },
  { label: "Excel export", capability: "EXCEL_EXPORT" },
] as const;

function formatStatusMessage(raw: string): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "installed") {
    return "Connector installation created.";
  }
  if (value === "reconnected") {
    return "Connector reconnected and marked active.";
  }
  if (value === "uninstalled" || value === "disabled") {
    return "Connector disabled.";
  }
  if (value === "deleted") {
    return "Connector installation record deleted.";
  }
  if (value === "oauth_complete") {
    return "Shopify OAuth authorization completed successfully.";
  }
  if (value === "oauth_error") {
    return "Shopify OAuth authorization failed — check connector credentials and retry.";
  }
  if (value === "oauth_initiate_failed") {
    return "Could not start OAuth authorization — check connector configuration.";
  }
  if (value === "oauth_not_supported") {
    return "This connector does not support OAuth authorization.";
  }
  return null;
}

const ERROR_STATUSES = new Set(["oauth_error", "oauth_initiate_failed", "oauth_not_supported"]);

function isErrorStatus(raw: string): boolean {
  return ERROR_STATUSES.has(String(raw ?? "").trim().toLowerCase());
}

function formatInstallErrorMessage(raw: string, connectorSlug?: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) {
    return null;
  }
  const connectorLabel =
    connectorSlug === "flipkart"
      ? "Flipkart"
      : connectorSlug === "amazon-in"
      ? "Amazon India"
      : connectorSlug === "meesho"
      ? "Meesho"
      : connectorSlug === "myntra"
      ? "Myntra"
      : connectorSlug === "nykaa"
      ? "Nykaa"
      : connectorSlug === "woocommerce"
      ? "WooCommerce"
      : "connector";

  if (value === "FLIPKART_CREDENTIALS_INCOMPLETE") {
    return `${connectorLabel} install requires client ID, client secret, and refresh token together.`;
  }
  if (value === "FLIPKART_CREDENTIALS_INVALID") {
    return `${connectorLabel} credentials could not be validated. Check the client ID, client secret, and refresh token.`;
  }
  if (value === "AMAZON_CREDENTIALS_INCOMPLETE") {
    return `${connectorLabel} install requires seller ID, client ID, client secret, and refresh token together.`;
  }
  if (value === "AMAZON_CREDENTIALS_INVALID") {
    return `${connectorLabel} credentials could not be validated. Check the seller ID, client ID, client secret, and refresh token.`;
  }
  if (value === "MYNTRA_CREDENTIALS_INCOMPLETE") {
    return `${connectorLabel} install requires Merchant ID, Secret Key, and Warehouse ID together.`;
  }
  if (value === "MYNTRA_CREDENTIALS_INVALID") {
    return `${connectorLabel} credentials could not be validated. Check the Merchant ID, Secret Key, and Warehouse ID from your Myntra account manager.`;
  }
  if (value === "WOOCOMMERCE_CREDENTIALS_INCOMPLETE") {
    return `${connectorLabel} install requires Site URL, Consumer Key, and Consumer Secret together.`;
  }
  if (value === "WOOCOMMERCE_CREDENTIALS_INVALID") {
    return `${connectorLabel} credentials could not be validated. Check the Site URL, Consumer Key, and Consumer Secret in WooCommerce → Settings → Advanced → REST API.`;
  }
  if (value === "WOOCOMMERCE_SITE_URL_NOT_HTTPS") {
    return `${connectorLabel} Site URL must use HTTPS. Update the store URL and retry.`;
  }
  return `${connectorLabel} install failed: ${value}`;
}

function isPlanBlockedReason(reason: string | null | undefined): boolean {
  return (
    reason === "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED" ||
    reason === "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED"
  );
}

function formatActionBlockedReason(reason: string | null | undefined): string {
  if (!reason) {
    return "Action blocked by server policy.";
  }
  if (reason === "CONNECTOR_PERMISSION_REQUIRED") {
    return "Action requires connector permission for your user or role.";
  }
  if (reason === "ALREADY_INSTALLED") {
    return "Connector is already installed for this account alias.";
  }
  if (reason === "INSTALLATION_REQUIRED") {
    return "Install this connector before using this action.";
  }
  if (reason === "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED") {
    return "Plan limit reached for connector installations.";
  }
  if (reason === "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED") {
    return "Plan limit reached for accounts per connector.";
  }
  return `Action blocked: ${reason}`;
}

function connectorStatusNote(
  slug: string,
  implementationStatus: string | undefined,
): string | null {
  if (implementationStatus === "stub") {
    return "Credential validation and publish are not yet available for this connector. Seller self-serve install remains hidden until the connector is fully implemented.";
  }
  if (implementationStatus === "partial") {
    if (slug === "meesho") {
      return "Meesho is an export-only connector. Download a category-specific Excel file and upload it to Meesho Supplier Panel. Credential validation is pending API access. Direct publish is not supported by Meesho.";
    }
    if (slug === "nykaa") {
      return "Nykaa is an export-only connector. Download a category-specific Excel file and upload it to seller.nykaa.com → Catalogue Management → Catalogue Upload. Nykaa reviews listings within 7–10 business days. Direct API publishing requires Nykaa platform-partner credentials (not yet available).";
    }
    if (slug === "myntra") {
      return "Myntra API access is account-manager gated. Credentials are issued by your Myntra account manager. Beta — live credential validation enabled after AM kickoff.";
    }
    return "This connector has limited functionality. Check the channel guide for details.";
  }
  return null;
}

function installationStatusTone(status: string): StatusTone {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "success";
  }
  if (normalized === "PAUSED" || normalized === "INACTIVE") {
    return "warning";
  }
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "ERROR" || normalized === "FAILED") {
    return "danger";
  }
  return "neutral";
}

function isInstallationAttentionStatus(status: string): boolean {
  return installationStatusTone(status) === "warning" || installationStatusTone(status) === "danger";
}

function isActiveInstallation(installation: ConnectorInstallation): boolean {
  return String(installation.status ?? "").trim().toUpperCase() === "ACTIVE";
}

function isDisabledInstallation(installation: ConnectorInstallation): boolean {
  return String(installation.status ?? "").trim().toUpperCase() === "DISABLED";
}

function connectorLaunchTone(stage: string): StatusTone {
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

function isConnectorPortfolioStage(stage: string): boolean {
  return stage === "live" || stage === "manual" || stage === "code_complete" || stage === "qa_validation" || stage === "po_review" || stage === "early_access";
}

function resolveInstalledStatusPresentation(
  status: string,
  implementationStatus: string | undefined,
): { label: string; tone: StatusTone } {
  const normalizedStatus = String(status ?? "").trim().toUpperCase();
  if (normalizedStatus === "ACTIVE" && implementationStatus === "stub") {
    return {
      label: "CONNECTED (limited)",
      tone: "warning",
    };
  }
  return {
    label: status,
    tone: installationStatusTone(status),
  };
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

function formatInstallFootprint(installations: ConnectorInstallation[]): string {
  const activeCount = installations.filter(isActiveInstallation).length;
  const disabledCount = installations.filter(isDisabledInstallation).length;
  const attentionCount = installations.filter(
    (installation) => !isDisabledInstallation(installation) && isInstallationAttentionStatus(installation.status),
  ).length;

  if (activeCount > 0) {
    return `${activeCount} active account${activeCount === 1 ? "" : "s"}`;
  }
  if (attentionCount > 0) {
    return `${attentionCount} account${attentionCount === 1 ? "" : "s"} need follow-up`;
  }
  if (disabledCount > 0) {
    return `0 active accounts (${disabledCount} disabled)`;
  }
  return "0 accounts installed";
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "Sync not recorded yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Sync time unavailable";
  }
  const deltaMs = Date.now() - parsed.getTime();
  if (deltaMs < 60_000) {
    return "Last synced just now";
  }
  const units = [
    { label: "day", ms: 24 * 60 * 60 * 1000 },
    { label: "hour", ms: 60 * 60 * 1000 },
    { label: "minute", ms: 60 * 1000 },
  ];
  for (const unit of units) {
    if (deltaMs >= unit.ms) {
      const count = Math.floor(deltaMs / unit.ms);
      return `Last synced ${count} ${unit.label}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "Sync time unavailable";
}

function capabilityBadges(capabilities: string[]): Array<{ label: string; supported: boolean }> {
  return CONNECTOR_CAPABILITY_BADGES.map((badge) => ({
    label: badge.label,
    supported: capabilities.includes(badge.capability),
  }));
}

function capabilityMatrixValue(
  capabilities: string[],
  capability: (typeof CONNECTOR_CAPABILITY_BADGES)[number]["capability"],
): boolean {
  return capabilities.includes(capability);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPublicationTargets(metadata: unknown): Array<{
  id: string;
  name: string;
  selected?: boolean;
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
      };
    })
    .filter((item) => item.id.length > 0);
}

function summarizePublicationTargets(
  targets: Array<{
    id: string;
    name: string;
    selected?: boolean;
  }>,
): string {
  const selectedTargets = targets.filter((target) => target.selected !== false);
  const activeTargets = selectedTargets.length > 0 ? selectedTargets : targets;
  if (activeTargets.length === 0) {
    return "No publication targets selected";
  }
  if (activeTargets.length === 1) {
    return activeTargets[0]?.name || activeTargets[0]?.id || "Publication target";
  }
  return `${activeTargets[0]?.name || activeTargets[0]?.id || "Publication target"} +${activeTargets.length - 1} more`;
}

function resolveShopifyPortfolioContext(installation: ConnectorInstallation): {
  shopName: string | null;
  shopDomain: string | null;
  shopId: string | null;
  publicationTargetSummary: string;
  publicationTargetCount: number;
} | null {
  if (installation.slug !== "shopify") {
    return null;
  }
  const publicationTargets = readPublicationTargets(installation.metadata);
  return {
    shopName: readMetadataValue(installation.metadata, "shopName"),
    shopDomain: readMetadataValue(installation.metadata, "shopDomain"),
    shopId: readMetadataValue(installation.metadata, "shopId"),
    publicationTargetSummary: summarizePublicationTargets(publicationTargets),
    publicationTargetCount: publicationTargets.filter((target) => target.selected !== false).length || publicationTargets.length,
  };
}

function connectorMatchesQuery(
  query: string,
  definition: ConnectorDefinition,
  installedForDefinition: ConnectorInstallation[],
): boolean {
  if (!query) {
    return true;
  }
  const searchable = [
    definition.displayName,
    definition.slug,
    definition.authType,
    definition.connectorVersion,
    definition.launchStage,
    definition.launchNote ?? "",
    definition.implementationStatus ?? "",
    ...definition.capabilities,
    ...installedForDefinition.flatMap((installation) => [
      installation.accountAlias,
      installation.externalAccountRef ?? "",
      installation.status,
      ...installation.capabilities,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

function installationMatchesQuery(query: string, installation: ConnectorInstallation): boolean {
  if (!query) {
    return true;
  }
  const searchable = [
    installation.displayName,
    installation.slug,
    installation.accountAlias,
    installation.externalAccountRef ?? "",
    installation.status,
    installation.launchStage,
    installation.launchNote ?? "",
    installation.implementationStatus ?? "",
    ...installation.capabilities,
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

function summarizeDefinitionWorkspace(
  definition: ConnectorDefinition,
  installedForDefinition: ConnectorInstallation[],
): { label: string; tone: StatusTone; description: string } {
  const activeAccounts = installedForDefinition.filter(isActiveInstallation).length;
  const disabledAccounts = installedForDefinition.filter(isDisabledInstallation).length;
  const attentionAccounts = installedForDefinition.filter(
    (installation) => !isDisabledInstallation(installation) && isInstallationAttentionStatus(installation.status),
  ).length;

  if (activeAccounts > 0) {
    return {
      label: "Connected",
      tone: "success",
      description: `${activeAccounts} active account${activeAccounts === 1 ? "" : "s"} already using this connector.`,
    };
  }
  if (attentionAccounts > 0) {
    return {
      label: "Needs attention",
      tone: "warning",
      description: `${attentionAccounts} account${attentionAccounts === 1 ? "" : "s"} need follow-up before the lane is healthy.`,
    };
  }
  if (definition.launchStage === "manual") {
    return {
      label: "Export/manual",
      tone: "warning",
      description: "Manual export workflow. This connector supports file/export-based operations and does not enable direct live publish yet.",
    };
  }
  if (definition.launchStage === "planned") {
    return {
      label: "Experimental",
      tone: "info",
      description: "Visible for roadmap awareness only. This connector is not open for seller self-serve install.",
    };
  }
  if (definition.actions?.install.allowed) {
    return {
      label: "Needs setup",
      tone: "info",
      description:
        disabledAccounts > 0
          ? `${disabledAccounts} disabled account${disabledAccounts === 1 ? "" : "s"} retained in history. Ready for a new account connection and downstream mapping work.`
          : "Ready for the first account connection and downstream mapping work.",
    };
  }
  if (isPlanBlockedReason(definition.actions?.install.reason)) {
    return {
      label: "Plan blocked",
      tone: "warning",
      description: formatActionBlockedReason(definition.actions?.install.reason),
    };
  }
  return {
    label: "Action blocked",
    tone: "danger",
    description: formatActionBlockedReason(definition.actions?.install.reason),
  };
}

export default async function ConnectorsPage({ searchParams }: ConnectorsPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const rawStatus = String(query.status ?? "");
  const actionStatusMessage = formatStatusMessage(rawStatus);
  const actionIsError = isErrorStatus(rawStatus);
  const installErrorMessage = formatInstallErrorMessage(
    String(query.installError ?? ""),
    String(query.connectorSlug ?? "").trim().toLowerCase(),
  );
  const searchValue = String(query.q ?? "").trim();
  const normalizedSearch = searchValue.toLowerCase();

  try {
    const [definitions, installations, productsRaw] = await Promise.all([
      getConnectorDefinitions({ role: actorRole, authHeader, revalidateSeconds: 60 }).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 403 || err.status === 401)) return [] as Awaited<ReturnType<typeof getConnectorDefinitions>>;
        throw err;
      }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      // Only firstProductId is used from this list — cache for 60s to avoid
      // a full catalogue round-trip on every connector page load.
      getProductList({ slim: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 403 || err.status === 401)) return [] as Awaited<ReturnType<typeof getProductList>>;
        throw err;
      }),
    ]);

    const visibleProducts = filterTestData(productsRaw, true);
    const firstProductId = visibleProducts[0]?.id ?? "";
    const definitionModels = definitions
      .map((definition) => {
        const installedForDefinition = installations.filter(
          (installation) => installation.connectorId === definition.id,
        );
        return {
          definition,
          installedForDefinition,
          statusNote: connectorStatusNote(definition.slug, definition.implementationStatus),
          workspaceState: summarizeDefinitionWorkspace(definition, installedForDefinition),
        };
      })
      .filter((item) => isConnectorPortfolioStage(item.definition.launchStage))
      .filter((item) => !item.definition.slug.startsWith("diag-"))
      .filter((item) => connectorMatchesQuery(normalizedSearch, item.definition, item.installedForDefinition))
      .sort((left, right) => {
        const installedDelta = right.installedForDefinition.length - left.installedForDefinition.length;
        if (installedDelta !== 0) {
          return installedDelta;
        }
        return left.definition.displayName.localeCompare(right.definition.displayName);
      });
    const liveDefinitions = definitionModels.filter((item) => item.definition.launchStage === "live");
    const channelCatalogDefinitions = liveDefinitions;
    const manualDefinitions = definitionModels.filter(
      (item) => item.definition.launchStage === "manual",
    );
    const needsSetupDefinitions = definitionModels.filter(
      (item) => item.workspaceState.label === "Needs setup",
    );
    const filteredInstallations = installations
      .filter((installation) => !installation.slug.startsWith("diag-"))
      .filter((installation) => installationMatchesQuery(normalizedSearch, installation))
      .sort((left, right) => {
        const leftActive = String(left.status ?? "").trim().toUpperCase() === "ACTIVE" ? 0 : 1;
        const rightActive = String(right.status ?? "").trim().toUpperCase() === "ACTIVE" ? 0 : 1;
        if (leftActive !== rightActive) {
          return leftActive - rightActive;
        }
        return `${left.displayName} ${left.accountAlias}`.localeCompare(
          `${right.displayName} ${right.accountAlias}`,
        );
      });
    const connectedAccountsCount = filteredInstallations.length;
    const activeAccountsCount = filteredInstallations.filter(
      (installation) => String(installation.status ?? "").trim().toUpperCase() === "ACTIVE",
    ).length;
    const attentionAccountsCount = filteredInstallations.filter(
      (installation) => !isDisabledInstallation(installation) && isInstallationAttentionStatus(installation.status),
    ).length;
    const attentionInstallations = filteredInstallations.filter(
      (installation) => !isDisabledInstallation(installation) && isInstallationAttentionStatus(installation.status),
    );
    const portfolioContext = searchValue ? ` for "${searchValue}"` : "";
    const channelCatalogColumns: Column<(typeof channelCatalogDefinitions)[number]>[] = [
      {
        key: "connector",
        header: "Connector",
        render: (item) => (
          <>
            <p className="font-medium text-slate-900">{item.definition.displayName}</p>
            <p className="mt-1 font-mono text-xs text-slate-500">{item.definition.slug}</p>
          </>
        ),
      },
      {
        key: "maturity",
        header: "Maturity",
        render: (item) => (
          <StatusChip
            label={connectorLaunchLabel(item.definition.launchStage, item.definition.implementationStatus)}
            tone={connectorLaunchTone(item.definition.launchStage)}
          />
        ),
      },
      {
        key: "footprint",
        header: "Footprint",
        cellClassName: "text-slate-700",
        render: (item) => formatInstallFootprint(item.installedForDefinition),
      },
      ...CONNECTOR_CAPABILITY_BADGES.map((badge) => ({
        key: badge.capability,
        header: badge.label,
        // key={`matrix-head-${badge.capability}`}
        render: (item: (typeof channelCatalogDefinitions)[number]) => (
          <StatusChip
            label={capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "Yes" : "No"}
            tone={capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "success" : "neutral"}
          />
        ),
      })),
    ];

    return (
      <div className="space-y-6">
        <PageHeader
          className="overflow-hidden border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.98),rgba(255,247,237,0.98))]"
          title="Connections"
          description="Run your catalog channel portfolio like a connector workspace: see what is live, what needs setup, which accounts need attention, and where to jump next."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/channels" className="hover:underline">Channels</Link>{" / "}<span className="font-semibold text-slate-700">Connectors</span>
            </>
          }
          actions={
            <>
              <Link
                href="/channels/mappings"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Mappings
              </Link>
              <Link
                href="/admin/connectors"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Connector Access
              </Link>
            </>
          }
        />

        {actionStatusMessage ? (
          <div className={`rounded-md border px-3 py-2 text-sm ${actionIsError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {actionStatusMessage}
          </div>
        ) : null}
        {installErrorMessage ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {installErrorMessage}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
          <Card className="border-slate-200 bg-white">
            <CardTitle>Search connections</CardTitle>
            <form method="GET" action="/channels/connectors" className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1 space-y-2">
                <label htmlFor="connector-search" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Search connections
                </label>
                <Input
                  id="connector-search"
                  name="q"
                  defaultValue={searchValue}
                  placeholder="Search channels, aliases, capabilities, or launch notes"
                />
                <p className="text-xs text-slate-500">
                  Filter the workspace by channel, account alias, capability, or launch note.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit">Apply filters</Button>
                {searchValue ? (
                  <Link
                    href="/channels/connectors"
                    className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.98))]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Action rail</CardTitle>
                <p className="mt-2 text-sm text-slate-600">
                  Start setup, resolve account health, or review rollout limits without scanning every channel card.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={`${connectedAccountsCount} connected`} tone="neutral" />
                <StatusChip label={`${attentionAccountsCount} attention`} tone="warning" />
                <StatusChip label={`${liveDefinitions.length} live`} tone="info" />
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <Link
                href="/channels/connectors/setup"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Start setup</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-slate-900">{needsSetupDefinitions.length}</p>
                  <StatusChip label="setup lane" tone="info" />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Open the dedicated setup workspace to install the first healthy account for each live catalog channel.
                </p>
              </Link>
              <a
                href="#connected-accounts"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Accounts needing attention</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-slate-900">{attentionInstallations.length}</p>
                  <StatusChip label="operator follow-up" tone="warning" />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Reconnect, disable, or clean up accounts that are not currently healthy.
                </p>
              </a>
              <a
                href="#connector-catalog"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export / manual connectors</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-slate-900">{manualDefinitions.length}</p>
                  <StatusChip label="portfolio review" tone="info" />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Review operationally limited and roadmap-only connectors before promising coverage.
                </p>
              </a>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]">
          <Card id="connector-catalog" className="border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Channel catalog</CardTitle>
                <p className="text-sm text-slate-600">
                  Review live connector lanes first so operators can install, map, and manage each Vexa connector from the same catalog workspace{portfolioContext}. Maturity labels distinguish live publish lanes from export/manual and experimental connectors.
                </p>
              </div>
              <StatusChip
                label={`${
                  channelCatalogDefinitions.filter((item) => item.installedForDefinition.some(isActiveInstallation)).length
                } with active footprint`}
                tone="info"
              />
            </div>

            {channelCatalogDefinitions.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon="PLUG"
                  title={searchValue ? "No catalog channels match this search" : "No catalog channels available"}
                  description={
                    searchValue
                      ? "Try a broader search term or clear the filter to see the full connector portfolio."
                      : "Catalog connector definitions have not been seeded for this environment."
                  }
                />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">Connector capability matrix</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Compare live connector lanes by install footprint, maturity label, and shipped operator capabilities before promising channel coverage.
                      </p>
                    </div>
                    <StatusChip label={`${channelCatalogDefinitions.length} live lanes`} tone="info" />
                  </div>
                  {/* key={`matrix-row-${item.definition.id}`} */}
                  <DataGrid
                    className="mt-4 hidden lg:block"
                    columns={channelCatalogColumns}
                    rows={channelCatalogDefinitions}
                    getRowKey={(item) => item.definition.id}
                    caption="Connector capability matrix"
                  />
                  <div className="mt-4 grid gap-3 lg:hidden">
                    {channelCatalogDefinitions.map((item) => (
                      <div key={`matrix-card-${item.definition.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">{item.definition.displayName}</p>
                            <p className="mt-1 font-mono text-xs text-slate-500">{item.definition.slug}</p>
                          </div>
                          <StatusChip
                            label={connectorLaunchLabel(item.definition.launchStage, item.definition.implementationStatus)}
                            tone={connectorLaunchTone(item.definition.launchStage)}
                          />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{formatInstallFootprint(item.installedForDefinition)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {CONNECTOR_CAPABILITY_BADGES.map((badge) => (
                            <StatusChip
                              key={`matrix-mobile-${item.definition.id}-${badge.capability}`}
                              label={`${badge.label} ${capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "Yes" : "No"}`}
                              tone={capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "success" : "neutral"}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                {channelCatalogDefinitions.map((item) => {
                  const { definition, installedForDefinition, statusNote, workspaceState } = item;
                  const primaryInstallation = installedForDefinition[0] ?? null;
                  const mappedChannel = primaryInstallation
                    ? mapConnectorSlugToMarketplaceChannel(primaryInstallation.slug)
                    : mapConnectorSlugToMarketplaceChannel(definition.slug);
                  const mappingHref =
                    primaryInstallation && mappedChannel && firstProductId
                      ? `/connectors/${encodeURIComponent(primaryInstallation.id)}/mapping?productId=${encodeURIComponent(firstProductId)}&channel=${encodeURIComponent(mappedChannel)}`
                      : primaryInstallation
                      ? `/connectors/${encodeURIComponent(primaryInstallation.id)}/mapping`
                      : "/channels/mappings";

                  return (
                    <section
                      key={definition.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">{definition.displayName}</h3>
                          <p className="mt-1 font-mono text-xs text-slate-500">{definition.slug}</p>
                        </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label={workspaceState.label} tone={workspaceState.tone} />
                        <StatusChip
                          label={connectorLaunchLabel(definition.launchStage, definition.implementationStatus)}
                          tone={connectorLaunchTone(definition.launchStage)}
                        />
                      </div>
                    </div>

                      <p className="mt-3 text-sm text-slate-600">{workspaceState.description}</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supported operations</p>
                          <p className="mt-2 text-sm text-slate-700">{formatCapabilityList(definition.capabilities)}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {capabilityBadges(definition.capabilities).map((badge) => (
                              <StatusChip
                                key={`${definition.id}-${badge.label}`}
                                label={badge.label}
                                tone={badge.supported ? "success" : "neutral"}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Install footprint</p>
                          <p className="mt-2 text-sm text-slate-700">{formatInstallFootprint(installedForDefinition)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Auth {definition.authType} | Version {definition.connectorVersion}
                          </p>
                        </div>
                      </div>

                      {definition.launchNote ? (
                        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          {definition.launchNote}
                        </p>
                      ) : null}
                      {statusNote ? (
                        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          {statusNote}
                        </p>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/channels/connectors/setup?slug=${encodeURIComponent(definition.slug)}`}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {installedForDefinition.length > 0 ? "Open setup" : "Start setup"}
                        </Link>
                        <Link
                          href={mappingHref}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Open catalog mapping
                        </Link>
                        {primaryInstallation ? (
                          <Link
                            href={`/channels/connectors/${encodeURIComponent(primaryInstallation.id)}`}
                            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            View account details
                          </Link>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
                </div>
              </div>
            )}
          </Card>

        </div>

        {manualDefinitions.length > 0 ? (
          <Card className="border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Export / manual</CardTitle>
                <p className="text-sm text-slate-600">
                  Connectors with partial or coordinated manual operating paths that still matter for account planning.
                </p>
              </div>
              <StatusChip label={`${manualDefinitions.length} connectors`} tone="warning" />
            </div>
            <div className="mt-4 space-y-3">
              {manualDefinitions.map((item) => (
                <div key={item.definition.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{item.definition.displayName}</h3>
                      <p className="mt-1 font-mono text-xs text-slate-500">{item.definition.slug}</p>
                    </div>
                    <StatusChip
                      label={connectorLaunchLabel(item.definition.launchStage, item.definition.implementationStatus)}
                      tone={connectorLaunchTone(item.definition.launchStage)}
                    />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{item.workspaceState.description}</p>
                  {item.definition.launchNote ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {item.definition.launchNote}
                    </p>
                  ) : null}
                  {item.statusNote ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {item.statusNote}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500 cursor-default">
                      Review manual export
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <Card className="border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Connected accounts</CardTitle>
              <p className="text-sm text-slate-600">
                Review account health, sync recency, connector metadata, and the actions operators take most often{portfolioContext}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={`${activeAccountsCount} active`} tone="success" />
              <StatusChip label={`${attentionAccountsCount} attention`} tone="warning" />
            </div>
          </div>

          {filteredInstallations.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon="PLUG"
                title={searchValue ? "No connected accounts match this search" : "No connectors installed"}
                description={
                  searchValue
                    ? "Try a broader search term or clear the filter to inspect the full account portfolio."
                    : "Install at least one connector to enable mapping previews and export flows."
                }
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {filteredInstallations.map((installation) => {
                const mappedChannel = mapConnectorSlugToMarketplaceChannel(installation.slug);
                const statusNote = connectorStatusNote(
                  installation.slug,
                  installation.implementationStatus,
                );
                const displayStatus = resolveInstalledStatusPresentation(
                  installation.status,
                  installation.implementationStatus,
                );
                const mappingHref =
                  mappedChannel && firstProductId
                    ? `/connectors/${encodeURIComponent(installation.id)}/mapping?productId=${encodeURIComponent(firstProductId)}&channel=${encodeURIComponent(mappedChannel)}`
                    : `/connectors/${encodeURIComponent(installation.id)}/mapping`;
                const shopifyContext = resolveShopifyPortfolioContext(installation);
                const shopifyAwaitingOAuth =
                  installation.slug === "shopify" &&
                  readMetadataValue(installation.metadata, "connectionStage") === "awaiting_managed_install";

                return (
                  <section
                    key={installation.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          {installation.displayName} / {installation.accountAlias}
                        </h3>
                        <p className="mt-1 font-mono text-xs text-slate-500">{installation.slug}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label={displayStatus.label} tone={displayStatus.tone} />
                        <StatusChip
                          label={connectorLaunchLabel(installation.launchStage, installation.implementationStatus)}
                          tone={connectorLaunchTone(installation.launchStage)}
                        />
                      </div>
                    </div>

                    {installation.launchNote ? (
                      <p className="mt-3 max-w-3xl text-sm text-slate-600">{installation.launchNote}</p>
                    ) : null}
                    {statusNote ? (
                      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        {statusNote}
                      </p>
                    ) : null}

                    {isInstallationAttentionStatus(installation.status) && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                        <p className="flex-1 text-sm font-medium text-red-800">
                          This account needs attention — credentials may be expired or the connection has errors.
                        </p>
                        {installation.actions?.reconnect.allowed ? (
                          <form action={reconnectConnectorAction}>
                            <input type="hidden" name="installationId" value={installation.id} />
                            <PendingSubmitButton
                              type="submit"
                              variant="secondary"
                              idleLabel="Reconnect"
                              pendingLabel="Reconnecting..."
                            />
                          </form>
                        ) : (
                          <Link
                            href={`/channels/connectors/${encodeURIComponent(installation.id)}`}
                            className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
                          >
                            Review recovery
                          </Link>
                        )}
                      </div>
                    )}

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">External reference</p>
                        <p className="mt-2 text-sm text-slate-700">{installation.externalAccountRef || "Not recorded"}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supported operations</p>
                        <p className="mt-2 text-sm text-slate-700">{formatCapabilityList(installation.capabilities)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {capabilityBadges(installation.capabilities).map((badge) => (
                            <StatusChip
                              key={`${installation.id}-${badge.label}`}
                              label={badge.label}
                              tone={badge.supported ? "success" : "neutral"}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Installed</p>
                        <p className="mt-2 text-sm text-slate-700">{formatDateTime(installation.installedAt)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last synced</p>
                        <p className="mt-2 text-sm text-slate-700">
                          {installation.lastSyncAt ? formatDateTime(installation.lastSyncAt) : "No sync recorded yet"}
                        </p>
                        {installation.lastSyncAt ? (
                          <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(installation.lastSyncAt)}</p>
                        ) : (
                          <Link
                            href={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=sync`}
                            className="mt-2 inline-flex items-center text-xs font-medium text-blue-700 hover:underline"
                          >
                            Set up first sync →
                          </Link>
                        )}
                      </div>
                    </div>

                    {shopifyContext ? (
                      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                              Shopify connection context
                            </p>
                            <p className="mt-1 text-sm text-slate-700">
                              {shopifyContext.shopName || shopifyContext.shopDomain || "Shop context not recorded yet"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {shopifyContext.shopDomain
                                ? `Store domain: ${shopifyContext.shopDomain}`
                                : "Shop domain will appear after the managed install completes."}
                            </p>
                          </div>
                          <StatusChip
                            label={
                              shopifyContext.publicationTargetCount > 0
                                ? `${shopifyContext.publicationTargetCount} publication target${shopifyContext.publicationTargetCount === 1 ? "" : "s"}`
                                : "targets not set"
                            }
                            tone={shopifyContext.publicationTargetCount > 0 ? "info" : "warning"}
                          />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-blue-100 bg-white/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Store identity</p>
                            <p className="mt-2 text-sm text-slate-700">
                              {shopifyContext.shopName || shopifyContext.shopDomain || "Waiting for Shopify shop identity"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {shopifyContext.shopId || "Shop ID will be recorded after the managed install handshake."}
                            </p>
                          </div>
                          <div className="rounded-xl border border-blue-100 bg-white/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publication targets</p>
                            <p className="mt-2 text-sm text-slate-700">{shopifyContext.publicationTargetSummary}</p>
                            {shopifyContext.publicationTargetCount > 0 ? (
                              <p className="mt-1 text-xs text-slate-500">Selected targets will be used during Shopify publish.</p>
                            ) : (
                              <Link
                                href={`/channels/connectors/${encodeURIComponent(installation.id)}?tab=credentials`}
                                className="mt-2 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                              >
                                Set publication targets →
                              </Link>
                            )}
                          </div>
                        </div>
                        {shopifyAwaitingOAuth ? (
                          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-100/60 px-4 py-3">
                            <p className="flex-1 text-sm font-medium text-blue-800">
                              This Shopify connection is awaiting OAuth authorization to complete setup.
                            </p>
                            <form action={initiateOAuthAction}>
                              <input type="hidden" name="installationId" value={installation.id} />
                              <PendingSubmitButton
                                type="submit"
                                variant="secondary"
                                idleLabel="Authorize Shopify"
                                pendingLabel="Redirecting to Shopify..."
                              />
                            </form>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <ConnectorAccountQuickView
                        title={`${installation.displayName} / ${installation.accountAlias}`}
                        statusLabel={displayStatus.label}
                        statusTone={displayStatus.tone}
                        maturityLabel={connectorLaunchLabel(installation.launchStage, installation.implementationStatus)}
                        maturityTone={connectorLaunchTone(installation.launchStage)}
                        externalReference={installation.externalAccountRef || "Not recorded"}
                        installedAt={formatDateTime(installation.installedAt)}
                        lastSyncAt={installation.lastSyncAt ? formatDateTime(installation.lastSyncAt) : "No sync recorded yet"}
                        lastSyncRelative={formatRelativeTime(installation.lastSyncAt)}
                        capabilities={installation.capabilities.map(formatCapabilityLabel)}
                        detailHref={`/channels/connectors/${encodeURIComponent(installation.id)}`}
                        mappingHref={mappingHref}
                        launchNote={installation.launchNote}
                        contextTitle={shopifyContext ? "Shopify connection context" : null}
                        contextSummary={
                          shopifyContext
                            ? shopifyContext.shopName || shopifyContext.shopDomain || "Shop context not recorded yet"
                            : null
                        }
                        contextNote={
                          shopifyContext
                            ? shopifyContext.publicationTargetCount > 0
                              ? `Publication targets: ${shopifyContext.publicationTargetSummary}`
                              : "No publication targets selected."
                            : null
                        }
                        contextActionHref={
                          shopifyContext && shopifyContext.publicationTargetCount === 0
                            ? `/channels/connectors/${encodeURIComponent(installation.id)}?tab=credentials`
                            : null
                        }
                        contextActionLabel={
                          shopifyContext && shopifyContext.publicationTargetCount === 0
                            ? "Set publication targets →"
                            : null
                        }
                      />
                      <Link
                        href={`/channels/connectors/${encodeURIComponent(installation.id)}`}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Details
                      </Link>
                      <Link
                        href={mappingHref}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Mapping
                      </Link>
                      {installation.actions?.reconnect.allowed ? (
                        <form action={reconnectConnectorAction}>
                          <input type="hidden" name="installationId" value={installation.id} />
                          <PendingSubmitButton
                            type="submit"
                            variant="secondary"
                            idleLabel="Reconnect"
                            pendingLabel="Reconnecting..."
                          />
                        </form>
                      ) : null}
                      {installation.actions?.uninstall.allowed ? (
                        <form action={uninstallConnectorAction}>
                          <input type="hidden" name="installationId" value={installation.id} />
                          <PendingSubmitButton
                            type="submit"
                            variant="secondary"
                            idleLabel="Disable"
                            pendingLabel="Disabling..."
                          />
                        </form>
                      ) : null}
                    </div>

                    {!installation.actions?.reconnect.allowed ? (
                      <p className="mt-3 text-xs text-slate-500">
                        Reconnect blocked: {formatActionBlockedReason(installation.actions?.reconnect.reason)}
                      </p>
                    ) : null}
                    {!installation.actions?.uninstall.allowed ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Disable blocked: {formatActionBlockedReason(installation.actions?.uninstall.reason)}
                      </p>
                    ) : null}
                    {(isPlanBlockedReason(installation.actions?.reconnect.reason) ||
                      isPlanBlockedReason(installation.actions?.uninstall.reason)) ? (
                      <p className="mt-2 text-xs text-slate-500">
                        <Link href="/admin/plan" className="underline">
                          Upgrade your plan
                        </Link>{" "}
                        to unblock connector actions.
                      </p>
                    ) : null}

                    {actorRole === "admin" && installation.status === "DISABLED" ? (
                      <form action={deleteConnectorInstallationAction} className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        <input type="hidden" name="installationId" value={installation.id} />
                        <input type="hidden" name="connectorSlug" value={installation.slug} />
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            name="confirmDelete"
                            value="yes"
                            required
                            className="rounded border-slate-300"
                          />
                          Confirm permanent delete
                        </label>
                        <PendingSubmitButton
                          type="submit"
                          className="text-xs"
                          idleLabel="Delete Record"
                          pendingLabel="Deleting record..."
                        />
                      </form>
                    ) : null}

                    <details className="mt-4 rounded-xl border border-slate-200 bg-white">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        View connector metadata
                      </summary>
                      <JsonPreview
                        value={JSON.stringify(installation.metadata ?? {}, null, 2)}
                        className="max-h-44 rounded-none border-0 border-t border-slate-200 bg-transparent p-3 text-[11px] leading-4 text-slate-600"
                      />
                    </details>
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/connectors", error));
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Connectors"
          description="Channel connector data is temporarily unavailable."
        />
        <InlineAlert
          tone="error"
          title="Connectors unavailable"
          message="Connector marketplace and installation data could not be loaded. Retry in a moment or contact support if the issue persists."
        />
      </div>
    );
  }
}
