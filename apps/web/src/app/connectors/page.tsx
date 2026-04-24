import Link from "next/link";
import { redirect } from "next/navigation";
import {
  deleteConnectorInstallationAction,
  reconnectConnectorAction,
  uninstallConnectorAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
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
  return null;
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
      return "Meesho uses Excel export only. After exporting, upload the file manually in Meesho Supplier Panel. Direct publish is not supported by Meesho.";
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
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
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

function connectorLaunchTone(stage: "live" | "manual" | "planned"): StatusTone {
  if (stage === "live") {
    return "success";
  }
  if (stage === "manual") {
    return "warning";
  }
  return "info";
}

function connectorLaunchLabel(stage: "live" | "manual" | "planned"): string {
  if (stage === "manual") {
    return "guided rollout";
  }
  if (stage === "planned") {
    return "not seller-ready";
  }
  return "live";
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

function formatCapabilityList(capabilities: string[]): string {
  return capabilities.length > 0 ? capabilities.join(", ") : "-";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not recorded";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
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
  const activeAccounts = installedForDefinition.filter(
    (installation) => String(installation.status ?? "").trim().toUpperCase() === "ACTIVE",
  ).length;
  const attentionAccounts = installedForDefinition.filter((installation) =>
    isInstallationAttentionStatus(installation.status),
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
      label: "Guided rollout",
      tone: "warning",
      description: "Operationally limited. Keep installs coordinated with the rollout owner.",
    };
  }
  if (definition.launchStage === "planned") {
    return {
      label: "Planned",
      tone: "info",
      description: "Tracked in the product roadmap but not open for seller self-serve install yet.",
    };
  }
  if (definition.actions?.install.allowed) {
    return {
      label: "Needs setup",
      tone: "info",
      description: "Ready for the first account connection and downstream mapping work.",
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
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const actionStatusMessage = formatStatusMessage(String(query.status ?? ""));
  const installErrorMessage = formatInstallErrorMessage(
    String(query.installError ?? ""),
    String(query.connectorSlug ?? "").trim().toLowerCase(),
  );
  const searchValue = String(query.q ?? "").trim();
  const normalizedSearch = searchValue.toLowerCase();

  try {
    const [definitions, installations, productsRaw] = await Promise.all([
      getConnectorDefinitions({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
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
    const plannedDefinitions = definitionModels.filter(
      (item) => item.definition.launchStage === "planned",
    );
    const needsSetupDefinitions = definitionModels.filter(
      (item) => item.workspaceState.label === "Needs setup",
    );
    const filteredInstallations = installations
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
    const attentionAccountsCount = filteredInstallations.filter((installation) =>
      isInstallationAttentionStatus(installation.status),
    ).length;
    const attentionInstallations = filteredInstallations.filter((installation) =>
      isInstallationAttentionStatus(installation.status),
    );
    const portfolioContext = searchValue ? ` for "${searchValue}"` : "";

    return (
      <div className="space-y-6">
        <PageHeader
          className="overflow-hidden border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.98),rgba(255,247,237,0.98))]"
          title="Connections"
          description="Run your catalog channel portfolio like a connector workspace: see what is live, what needs setup, which accounts need attention, and where to jump next."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Connectors</span>
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
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Guided rollout</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-slate-900">{manualDefinitions.length + plannedDefinitions.length}</p>
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
                  Review live connector lanes first so operators can install, map, and manage each Vexa connector from the same catalog workspace{portfolioContext}.
                </p>
              </div>
              <StatusChip
                label={`${channelCatalogDefinitions.filter((item) => item.installedForDefinition.length > 0).length} with active footprint`}
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
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                          label={connectorLaunchLabel(definition.launchStage)}
                          tone={connectorLaunchTone(definition.launchStage)}
                        />
                      </div>
                    </div>

                      <p className="mt-3 text-sm text-slate-600">{workspaceState.description}</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capability surface</p>
                          <p className="mt-2 text-sm text-slate-700">{formatCapabilityList(definition.capabilities)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Install footprint</p>
                          <p className="mt-2 text-sm text-slate-700">
                            {installedForDefinition.length} account{installedForDefinition.length === 1 ? "" : "s"} installed
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Auth {definition.authType} · Version {definition.connectorVersion}
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
            )}
          </Card>

        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Guided rollout</CardTitle>
                <p className="text-sm text-slate-600">
                  Connectors with manual or partial operational paths that still matter for account planning.
                </p>
              </div>
              <StatusChip label={`${manualDefinitions.length} connectors`} tone="warning" />
            </div>
            {manualDefinitions.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon="PLUG"
                  title="No guided-rollout connectors in this view"
                  description="Manual-rollout connectors will appear here when they are seeded into the connector definitions."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {manualDefinitions.map((item) => (
                  <div key={item.definition.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{item.definition.displayName}</h3>
                        <p className="mt-1 font-mono text-xs text-slate-500">{item.definition.slug}</p>
                      </div>
                      <StatusChip
                        label={connectorLaunchLabel(item.definition.launchStage)}
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
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Planned and research</CardTitle>
                <p className="text-sm text-slate-600">
                  Future connector opportunities that are visible for roadmap awareness but not seller-ready.
                </p>
              </div>
              <StatusChip label={`${plannedDefinitions.length} connectors`} tone="info" />
            </div>
            {plannedDefinitions.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon="PLUG"
                  title="No planned connectors in this view"
                  description="When roadmap-only connector definitions are present, they will appear here."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {plannedDefinitions.map((item) => (
                  <div key={item.definition.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{item.definition.displayName}</h3>
                        <p className="mt-1 font-mono text-xs text-slate-500">{item.definition.slug}</p>
                      </div>
                      <StatusChip
                        label={connectorLaunchLabel(item.definition.launchStage)}
                        tone={connectorLaunchTone(item.definition.launchStage)}
                      />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{item.workspaceState.description}</p>
                    {item.definition.launchNote ? (
                      <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                        {item.definition.launchNote}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                      Capability surface: {formatCapabilityList(item.definition.capabilities)}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      Seller setup unlocks after the connector reaches live launch stage.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

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
                          label={connectorLaunchLabel(installation.launchStage)}
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

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">External reference</p>
                        <p className="mt-2 text-sm text-slate-700">{installation.externalAccountRef || "Not recorded"}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capabilities</p>
                        <p className="mt-2 text-sm text-slate-700">{formatCapabilityList(installation.capabilities)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Installed</p>
                        <p className="mt-2 text-sm text-slate-700">{formatDateTime(installation.installedAt)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last sync</p>
                        <p className="mt-2 text-sm text-slate-700">
                          {installation.lastSyncAt ? formatDateTime(installation.lastSyncAt) : "No sync recorded yet"}
                        </p>
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
                            <p className="mt-1 text-xs text-slate-500">
                              {shopifyContext.publicationTargetCount > 0
                                ? "Selected targets will be used during Shopify publish."
                                : "Open connector details to select the publication targets Vexa should publish to."}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
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
                      <pre className="max-h-44 overflow-auto border-t border-slate-200 p-3 text-[11px] leading-4 text-slate-600">
                        {JSON.stringify(installation.metadata ?? {}, null, 2)}
                      </pre>
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
    throw error;
  }
}

