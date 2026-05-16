import Link from "next/link";
import { redirect } from "next/navigation";
import { installConnectorAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type ConnectorDefinition,
  type ConnectorInstallation,
  getConnectorDefinitions,
  getInstalledConnectors,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ConnectorSetupPageProps {
  searchParams: Promise<{
    slug?: string;
    q?: string;
    status?: string;
    connectorSlug?: string;
    installError?: string;
  }>;
}

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type ConnectorMaturity = "Live publish" | "Export/manual" | "Beta" | "Experimental";

function formatStatusMessage(raw: string): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "installed") {
    return "Connector installation created.";
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
          : connectorSlug === "shopify"
            ? "Shopify"
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
  if (value === "SHOPIFY_SHOP_DOMAIN_REQUIRED") {
    return "Shopify install requires the store domain before the connector account can be created.";
  }
  if (value === "SHOPIFY_SHOP_DOMAIN_INVALID") {
    return "Shopify store domain must be a valid *.myshopify.com hostname.";
  }
  return `${connectorLabel} install failed: ${value}`;
}

function connectorAccountReferenceLabel(slug: string): string {
  return slug === "amazon-in" ? "Seller ID" : "External Account Ref";
}

function connectorAccountReferencePlaceholder(slug: string): string {
  if (slug === "amazon-in") {
    return "Enter Amazon seller ID";
  }
  return "Optional";
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

function connectorLaunchLabel(
  stage: "live" | "manual" | "planned",
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

function summarizeDefinitionWorkspace(
  definition: ConnectorDefinition,
  installedForDefinition: ConnectorInstallation[],
): { label: string; tone: StatusTone; description: string } {
  const activeAccounts = installedForDefinition.filter(
    (installation) => String(installation.status ?? "").trim().toUpperCase() === "ACTIVE",
  ).length;

  if (activeAccounts > 0) {
    return {
      label: "Expand footprint",
      tone: "success",
      description: `${activeAccounts} active account${activeAccounts === 1 ? "" : "s"} already installed. Add another alias only when the workflow really needs a second account.`,
    };
  }
  if (definition.launchStage === "manual") {
    return {
      label: "Export/manual",
      tone: "warning",
      description: "Operationally limited. Coordinate export-led or manual rollout work before you connect a new account.",
    };
  }
  if (definition.launchStage === "planned") {
    return {
      label: "Experimental",
      tone: "info",
      description: "Tracked in the roadmap but not open for seller self-serve install yet.",
    };
  }
  if (definition.actions?.install.allowed) {
    return {
      label: "Ready to install",
      tone: "info",
      description: "This catalog channel is ready for its first account connection and downstream mapping work.",
    };
  }
  return {
    label: "Action blocked",
    tone: "warning",
    description: "Install is currently blocked by server policy or plan limits.",
  };
}

function connectorMatchesQuery(query: string, definition: ConnectorDefinition, installedForDefinition: ConnectorInstallation[]): boolean {
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

function ConnectorCredentialFields({ definitionId, slug }: { definitionId: string; slug: string }) {
  if (slug === "flipkart") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Flipkart live install needs validated API credentials. These values are encrypted on save and never shown again.
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`install-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="fk-client-id" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input id={`install-client-secret-${definitionId}`} name="clientSecret" type="password" autoComplete="new-password" placeholder="Enter Flipkart client secret" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input id={`install-refresh-token-${definitionId}`} name="refreshToken" type="password" autoComplete="new-password" placeholder="Enter Flipkart refresh token" />
        </div>
      </>
    );
  }

  if (slug === "amazon-in") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Amazon India live install needs seller ID plus validated LWA (Login with Amazon) credentials. Values are encrypted on save and never shown again.
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`install-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="amzn1.application-oa2-client.xxxxxxxx" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input id={`install-client-secret-${definitionId}`} name="clientSecret" type="password" autoComplete="new-password" placeholder="Enter Amazon LWA client secret" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input id={`install-refresh-token-${definitionId}`} name="refreshToken" type="password" autoComplete="new-password" placeholder="Enter Amazon SP-API refresh token" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-marketplace-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Marketplace ID
          </label>
          {/* datalist gives autocomplete while still allowing any valid ID */}
          <datalist id={`amazon-marketplace-list-${definitionId}`}>
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
            id={`install-marketplace-${definitionId}`}
            name="marketplaceId"
            list={`amazon-marketplace-list-${definitionId}`}
            defaultValue="A21TJRUUN4KGV"
            placeholder="A21TJRUUN4KGV"
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">
            Pre-filled: A21TJRUUN4KGV (India). Common IDs — US: ATVPDKIKX0DER · UK: A1F83G8C2ARO7P · DE: A1PA6795UKMFR9 · JP: A1VC38T7YXB528
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-default-product-type-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Default Product Type <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <datalist id={`amazon-product-type-list-${definitionId}`}>
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
            id={`install-default-product-type-${definitionId}`}
            name="defaultProductType"
            list={`amazon-product-type-list-${definitionId}`}
            placeholder="e.g. SHIRT"
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">
            Used when no per-product type is set. Leave blank if your catalog has mixed product types — you can set this per-product or update it later in the connector settings.
          </p>
        </div>
      </>
    );
  }

  if (slug === "shopify") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Enter your store domain and Admin API access token to complete setup immediately. The access token is your custom app&apos;s SHPAT (starts with <code>shpat_</code>) — find it in Shopify Admin → Apps → your custom app → API credentials. Client ID is optional and only needed for managed OAuth installs.
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-shop-domain-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Store Domain
          </label>
          <Input
            id={`install-shop-domain-${definitionId}`}
            name="shopDomain"
            autoComplete="off"
            placeholder="demo-store.myshopify.com"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-access-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Admin API Access Token (SHPAT)
          </label>
          <Input
            id={`install-access-token-${definitionId}`}
            name="accessToken"
            type="password"
            autoComplete="new-password"
            placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`install-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID <span className="font-normal text-slate-400">(optional — managed OAuth only)</span>
          </label>
          <Input
            id={`install-client-id-${definitionId}`}
            name="clientId"
            autoComplete="off"
            placeholder="Leave blank for custom app / SHPAT installs"
          />
        </div>
      </>
    );
  }

  return null;
}

export default async function ConnectorSetupPage({ searchParams }: ConnectorSetupPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const selectedSlug = String(query.slug ?? "").trim().toLowerCase();
  const searchValue = String(query.q ?? "").trim();
  const normalizedSearch = searchValue.toLowerCase();
  const actionStatusMessage = formatStatusMessage(String(query.status ?? ""));
  const installErrorMessage = formatInstallErrorMessage(
    String(query.installError ?? ""),
    String(query.connectorSlug ?? selectedSlug).trim().toLowerCase(),
  );

  try {
    const [definitions, installations] = await Promise.all([
      getConnectorDefinitions({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
    ]);

    const setupDefinitions = definitions
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
      .filter((item) => item.definition.launchStage === "live")
      .filter((item) => (selectedSlug ? item.definition.slug === selectedSlug : true))
      .filter((item) => connectorMatchesQuery(normalizedSearch, item.definition, item.installedForDefinition))
      .sort((left, right) => left.definition.displayName.localeCompare(right.definition.displayName));
    const selectedDefinitionModel =
      selectedSlug.length > 0
        ? setupDefinitions.find((item) => item.definition.slug === selectedSlug) ?? null
        : null;

    const returnToBase = selectedSlug || searchValue
      ? `/channels/connectors/setup?${new URLSearchParams(
          Object.fromEntries(
            Object.entries({
              slug: selectedSlug || undefined,
              q: searchValue || undefined,
            }).filter(([, value]) => Boolean(value)),
          ) as Record<string, string>,
        ).toString()}`
      : "/channels/connectors/setup";

    return (
      <div className="space-y-6">
        <PageHeader
          title="Catalog Connection Setup"
          description="Complete credential entry and alias setup in one focused workspace, then return to the connector portfolio once the catalog account is installed."
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
              / <span className="font-semibold text-slate-700">Setup</span>
            </>
          }
          actions={
            <Link
              href="/channels/connectors"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to connection portfolio
            </Link>
          }
        />

        {actionStatusMessage ? <InlineAlert tone="success" message={actionStatusMessage} /> : null}
        {installErrorMessage ? <InlineAlert tone="error" message={installErrorMessage} /> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.85fr)]">
          <Card className="border-slate-200 bg-white">
            <CardTitle>Find a setup lane</CardTitle>
            <form method="GET" action="/channels/connectors/setup" className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1 space-y-2">
                <label htmlFor="connector-setup-search" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Search setup lanes
                </label>
                <Input
                  id="connector-setup-search"
                  name="q"
                  defaultValue={searchValue}
                  placeholder="Search channels, aliases, capabilities, or rollout notes"
                />
                {selectedSlug ? <input type="hidden" name="slug" value={selectedSlug} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit">Apply filters</Button>
                {(searchValue || selectedSlug) ? (
                  <Link
                    href="/channels/connectors/setup"
                    className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>
          </Card>
          <Card className="border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.98))]">
            <CardTitle>Setup flow</CardTitle>
            <div className="mt-3 grid gap-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">1. Choose channel</p>
                <p className="mt-2 text-sm text-slate-600">
                  Filter to the exact connector lane you want to install so the rest of the page stays focused. This setup workspace only exposes Live publish connectors.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">2. Add credentials</p>
                <p className="mt-2 text-sm text-slate-600">
                  Enter the account alias and connector credentials once. For Shopify, this step captures the store domain and managed-install context before token exchange continues.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">3. Install and continue</p>
                <p className="mt-2 text-sm text-slate-600">
                  Finish install here, then return to mappings or account detail for catalog readiness, managed install, and publication work.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Connection readiness checklist
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li>Confirm the marketplace account alias matches the operator team that will own this lane.</li>
                <li>Use validated credentials for live publish connectors and keep manual/export lanes clearly scoped.</li>
                <li>Return to connector detail after install to verify account health, publication targets, and recovery guidance.</li>
              </ul>
            </div>
          </Card>
        </div>

        {selectedDefinitionModel ? (
          <Card className="border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.95),rgba(248,250,252,0.98))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Focused setup lane</CardTitle>
                <p className="mt-2 text-sm text-slate-600">
                  You are working on <span className="font-medium text-slate-900">{selectedDefinitionModel.definition.displayName}</span>. Clear the slug filter any time to return to the full setup workspace.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={selectedDefinitionModel.workspaceState.label} tone={selectedDefinitionModel.workspaceState.tone} />
                <StatusChip
                  label={connectorLaunchLabel(
                    selectedDefinitionModel.definition.launchStage,
                    selectedDefinitionModel.definition.implementationStatus,
                  )}
                  tone={connectorLaunchTone(selectedDefinitionModel.definition.launchStage)}
                />
              </div>
            </div>
          </Card>
        ) : null}

        {setupDefinitions.length === 0 ? (
          <EmptyState
            icon="PLUG"
            title={searchValue || selectedSlug ? "No setup lanes match this filter" : "No setup lanes available"}
            description={
              searchValue || selectedSlug
                ? "Try a broader search term or clear the slug filter to inspect the full setup workspace."
                : "Connector definitions have not been seeded for this workspace."
            }
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {setupDefinitions.map((item) => {
              const { definition, installedForDefinition, statusNote, workspaceState } = item;
              const existingAliases = installedForDefinition.map((installation) => installation.accountAlias).join(", ");

              return (
                <section key={definition.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{definition.displayName}</h3>
                      <p className="mt-1 font-mono text-xs text-slate-500">{definition.slug}</p>
                      <p className="mt-2 text-sm text-slate-600">{workspaceState.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip label={workspaceState.label} tone={workspaceState.tone} />
                      <StatusChip
                        label={connectorLaunchLabel(definition.launchStage, definition.implementationStatus)}
                        tone={connectorLaunchTone(definition.launchStage)}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Existing aliases</p>
                      <p className="mt-2 text-sm text-slate-700">{existingAliases || "No accounts installed yet"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supported operations</p>
                      <p className="mt-2 text-sm text-slate-700">{formatCapabilityList(definition.capabilities)}</p>
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

                  <form action={installConnectorAction} className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <input type="hidden" name="slug" value={definition.slug} />
                    <input type="hidden" name="returnTo" value={returnToBase} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor={`install-alias-${definition.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Account Alias
                        </label>
                        <Input id={`install-alias-${definition.id}`} name="accountAlias" defaultValue="primary" />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`install-external-account-${definition.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {connectorAccountReferenceLabel(definition.slug)}
                        </label>
                        <Input
                          id={`install-external-account-${definition.id}`}
                          name="externalAccountRef"
                          autoComplete="off"
                          placeholder={connectorAccountReferencePlaceholder(definition.slug)}
                        />
                      </div>
                    </div>

                    <ConnectorCredentialFields definitionId={definition.id} slug={definition.slug} />

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <p className="text-xs text-slate-500">
                        {definition.slug === "shopify"
                          ? "Provide store domain and SHPAT to complete setup now, or leave the token blank to finish via managed install in connector detail."
                          : "Install here, then return to the portfolio to open mappings, detail, or catalog account operations."}
                      </p>
                      <PendingSubmitButton
                        type="submit"
                        idleLabel={definition.slug === "shopify" ? "Create Shopify connector" : "Install connector"}
                        pendingLabel={definition.slug === "shopify" ? "Creating Shopify connector..." : "Installing connector..."}
                      />
                    </div>
                  </form>
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/connectors/setup", error));
    }
    throw error;
  }
}
