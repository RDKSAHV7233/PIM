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
  ConnectorCredentialFields,
  connectorAccountReferenceLabel,
  connectorAccountReferencePlaceholder,
} from "@/components/connectors/connector-credential-fields";
import {
  ApiHttpError,
  type ConnectorDefinition,
  type ConnectorInstallation,
  getConnectorDefinitions,
  getInstalledConnectors,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

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

type ConnectorMaturity = "Live publish" | "Export/manual" | "Beta" | "Experimental" | "Controlled pilot" | "P1 blocker hold";

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
            : connectorSlug === "myntra"
              ? "Myntra"
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
  if (value === "WOOCOMMERCE_SITE_URL_NOT_HTTPS") {
    return `${connectorLabel} Site URL must use HTTPS. Update the store URL and retry.`;
  }
  if (value === "WOOCOMMERCE_CREDENTIALS_INVALID") {
    return `${connectorLabel} credentials could not be validated. Check the Site URL, Consumer Key, and Consumer Secret in WooCommerce > Settings > Advanced > REST API.`;
  }
  if (value === "SHOPIFY_SHOP_DOMAIN_REQUIRED") {
    return "Shopify install requires the store domain before the connector account can be created.";
  }
  if (value === "SHOPIFY_SHOP_DOMAIN_INVALID") {
    return "Shopify store domain must be a valid *.myshopify.com hostname.";
  }
  if (value === "SHOPIFY_STORE_NOT_FOUND") {
    return "We couldn't find a Shopify store at that domain. Check the store domain and try again.";
  }
  if (value === "SHOPIFY_TOKEN_REJECTED") {
    return "Shopify rejected that access token. Check it and try again.";
  }
  if (value === "SHOPIFY_UPSTREAM_UNAVAILABLE") {
    return "Shopify's API is temporarily unavailable. Please try again shortly.";
  }
  if (value === "install_failed") {
    return `${connectorLabel} install failed. Check your details and try again, or contact support if this continues.`;
  }
  return `${connectorLabel} install failed: ${value}`;
}

function connectorLaunchTone(stage: string): StatusTone {
  if (stage === "live") {
    return "success";
  }
  if (stage === "manual" || stage === "controlled_pilot" || stage === "p1_blocker_hold") {
    return "warning";
  }
  return "info";
}

function connectorLaunchLabel(
  stage: string,
  implementationStatus: string | undefined,
): ConnectorMaturity {
  if (stage === "controlled_pilot") {
    return "Controlled pilot";
  }
  if (stage === "p1_blocker_hold") {
    return "P1 blocker hold";
  }
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

// Note: for WooCommerce, this note is deliberately kept identical to
// connector-launch-policy.ts's launchNote (see woocommerce-launch-copy-consistency.test.cjs,
// PIM#633) — both surfaces must tell the customer the same thing. The render logic
// (below, in the JSX) skips this box when it duplicates definition.launchNote verbatim,
// so keeping the strings identical does not produce two stacked identical banners.
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
    if (slug === "myntra") {
      return "Myntra API access is account-manager gated. Credentials (Merchant ID, Secret Key, Warehouse ID) are issued by your Myntra account manager. Beta — live credential validation enabled after AM kickoff and Postman collection receipt.";
    }
    if (slug === "woocommerce") {
      return "WooCommerce setup is paused while P1 blocker closure is in progress. Customer self-serve install and pilot onboarding require fresh CTO/PO/Security/QA/SRE signoff after P1-1 and P1-2 are closed.";
    }
    return "This connector has limited functionality. Check the channel guide for details.";
  }
  if (slug === "woocommerce") {
    return "WooCommerce setup is paused while P1 blocker closure is in progress. Customer self-serve install and pilot onboarding require fresh CTO/PO/Security/QA/SRE signoff after P1-1 and P1-2 are closed.";
  }
  return null;
}

// Mirrors apps/api/src/connector-framework/connector-launch-policy.ts's
// isInstallableStage() — kept in sync manually since this page has no
// access to the backend module. "manual" (Meesho, Nykaa: Excel-export-only,
// no live publish) was missing here, so those two customer-visible,
// backend-installable connectors never appeared in this setup wizard.
function isSetupLaneStage(stage: string): boolean {
  return stage === "live" || stage === "manual" || stage === "early_access";
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

export default async function ConnectorSetupPage({ searchParams }: ConnectorSetupPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
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
      getConnectorDefinitions({ role: actorRole, authHeader, revalidateSeconds: 60 }),
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
      .filter((item) => isSetupLaneStage(item.definition.launchStage))
      .filter((item) => !item.definition.slug.startsWith("diag-"))
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
                  Filter to the exact connector lane you want to install so the rest of the page stays focused. This setup workspace exposes live, manual/export, and early-access setup lanes.
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
              const installFormAllowed = Boolean(definition.actions?.install.allowed) && isSetupLaneStage(definition.launchStage);

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
                  {statusNote && statusNote !== definition.launchNote ? (
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {statusNote}
                    </p>
                  ) : null}

                  {installFormAllowed ? (
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

                      <ConnectorCredentialFields definitionId={definition.id} slug={definition.slug} mode="install" />

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
                  ) : (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Setup is not open for this connector in the current release state.
                    </p>
                  )}
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
    return (
      <div className="space-y-5">
        <PageHeader
          title="Connect a Channel"
          description="Connector setup data is temporarily unavailable."
        />
        <InlineAlert
          tone="error"
          title="Connector setup unavailable"
          message="Connector definitions could not be loaded. Retry in a moment or contact support if the issue persists."
        />
      </div>
    );
  }
}
