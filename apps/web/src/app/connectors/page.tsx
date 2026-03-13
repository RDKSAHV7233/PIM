import Link from "next/link";
import { redirect } from "next/navigation";
import {
  deleteConnectorInstallationAction,
  installConnectorAction,
  reconnectConnectorAction,
  uninstallConnectorAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  type MarketplaceChannel,
  getConnectorDefinitions,
  getInstalledConnectors,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
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
  }>;
}

function mapConnectorSlugToChannel(slugInput: string): MarketplaceChannel | null {
  const slug = String(slugInput ?? "").trim().toLowerCase();
  if (slug === "amazon-in") {
    return "amazon";
  }
  if (slug === "flipkart") {
    return "flipkart";
  }
  if (slug === "meesho") {
    return "meesho";
  }
  return null;
}

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

function installationStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "success";
  }
  if (normalized === "DISABLED" || normalized === "INACTIVE") {
    return "warning";
  }
  if (normalized === "ERROR" || normalized === "FAILED") {
    return "danger";
  }
  return "neutral";
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

  try {
    const [definitions, installations, productsRaw] = await Promise.all([
      getConnectorDefinitions({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
    ]);

    const visibleProducts = filterTestData(productsRaw, true);
    const firstProductId = visibleProducts[0]?.id ?? "";

    return (
      <div className="space-y-5">
        <PageHeader
          title="Channel Connectors"
          description="Install, reconnect, and govern channel accounts for this tenant."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Connectors</span>
            </>
          }
          actions={
            <Link href="/admin/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
              Connector Access
            </Link>
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

        <Card>
          <CardTitle>Available Connectors</CardTitle>
          {definitions.length === 0 ? (
            <EmptyState
              icon="PLUG"
              title="No connector definitions available"
              description="Connector definitions have not been seeded for this environment."
            />
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {definitions.map((definition) => {
                const installedForDefinition = installations.filter(
                  (installation) => installation.connectorId === definition.id,
                );

                return (
                  <section
                    key={definition.id}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">{definition.displayName}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      slug: <span className="font-mono">{definition.slug}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Auth: {definition.authType} | Version: {definition.connectorVersion}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Capabilities: {definition.capabilities.length > 0 ? definition.capabilities.join(", ") : "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Installed accounts: {installedForDefinition.length}
                    </p>

                    {definition.actions?.install.allowed ? (
                      <form action={installConnectorAction} className="mt-3 space-y-2">
                        <input type="hidden" name="slug" value={definition.slug} />
                        <div className="space-y-1">
                          <label
                            htmlFor={`install-alias-${definition.id}`}
                            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                          >
                            Account Alias
                          </label>
                          <Input
                            id={`install-alias-${definition.id}`}
                            name="accountAlias"
                            defaultValue="primary"
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor={`install-ref-${definition.id}`}
                            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                          >
                            External Account Ref
                          </label>
                          <Input
                            id={`install-ref-${definition.id}`}
                            name="externalAccountRef"
                            placeholder="Optional"
                          />
                        </div>
                        {definition.slug === "flipkart" ? (
                          <>
                            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                              Flipkart live install needs validated API credentials. These values are encrypted on save and never shown again.
                            </div>
                            <div className="space-y-1">
                              <label
                                htmlFor={`install-client-id-${definition.id}`}
                                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                              >
                                Client ID
                              </label>
                              <Input
                                id={`install-client-id-${definition.id}`}
                                name="clientId"
                                autoComplete="off"
                                placeholder="fk-client-id"
                              />
                            </div>
                            <div className="space-y-1">
                              <label
                                htmlFor={`install-client-secret-${definition.id}`}
                                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                              >
                                Client Secret
                              </label>
                              <Input
                                id={`install-client-secret-${definition.id}`}
                                name="clientSecret"
                                type="password"
                                autoComplete="new-password"
                                placeholder="Enter Flipkart client secret"
                              />
                            </div>
                            <div className="space-y-1">
                              <label
                                htmlFor={`install-refresh-token-${definition.id}`}
                                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                              >
                                Refresh Token
                              </label>
                              <Input
                                id={`install-refresh-token-${definition.id}`}
                                name="refreshToken"
                                type="password"
                                autoComplete="new-password"
                                placeholder="Enter Flipkart refresh token"
                              />
                            </div>
                          </>
                        ) : null}
                        <Button type="submit">Install connector</Button>
                      </form>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        {isPlanBlockedReason(definition.actions?.install.reason)
                          ? (
                            <>
                              {formatActionBlockedReason(definition.actions?.install.reason)}{" "}
                              <Link href="/admin/plan" className="underline">
                                Upgrade your plan
                              </Link>{" "}
                              to install more accounts.
                            </>
                          )
                          : formatActionBlockedReason(definition.actions?.install.reason)}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Installed Connectors</CardTitle>
          {installations.length === 0 ? (
            <EmptyState
              icon="PLUG"
              title="No connectors installed"
              description="Install at least one connector to enable mapping previews and export flows."
            />
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Connector</th>
                    <th className="px-3 py-2">Account Alias</th>
                    <th className="px-3 py-2">External Ref</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Capabilities</th>
                    <th className="px-3 py-2">Installed</th>
                    <th className="px-3 py-2">Last Sync</th>
                    <th className="px-3 py-2">Metadata</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {installations.map((installation) => {
                    const mappedChannel = mapConnectorSlugToChannel(installation.slug);
                    const mappingHref =
                      mappedChannel && firstProductId
                        ? `/connectors/${encodeURIComponent(installation.id)}/mapping?productId=${encodeURIComponent(firstProductId)}&channel=${encodeURIComponent(mappedChannel)}`
                        : `/connectors/${encodeURIComponent(installation.id)}/mapping`;

                    return (
                      <tr key={installation.id} className="border-t border-slate-200 align-top hover:bg-slate-50/50">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-900">{installation.displayName}</div>
                          <div className="font-mono text-xs text-slate-500">{installation.slug}</div>
                        </td>
                        <td className="px-3 py-2.5">{installation.accountAlias}</td>
                        <td className="px-3 py-2.5">{installation.externalAccountRef || "-"}</td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={installation.status} tone={installationStatusTone(installation.status)} />
                        </td>
                        <td className="px-3 py-2.5 text-xs">{installation.capabilities.join(", ") || "-"}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{new Date(installation.installedAt).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {installation.lastSyncAt ? new Date(installation.lastSyncAt).toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2.5">
                          <pre className="max-h-28 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-4 text-slate-600">
                            {JSON.stringify(installation.metadata ?? {}, null, 2)}
                          </pre>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/channels/connectors/${encodeURIComponent(installation.id)}`}
                              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm hover:bg-slate-50"
                            >
                              Details
                            </Link>
                            <Link
                              href={mappingHref}
                              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm hover:bg-slate-50"
                            >
                              Mapping
                            </Link>
                            {installation.actions?.reconnect.allowed ? (
                              <>
                                <form action={reconnectConnectorAction}>
                                  <input type="hidden" name="installationId" value={installation.id} />
                                  <Button type="submit" variant="secondary" className="text-xs">
                                    Reconnect
                                  </Button>
                                </form>
                              </>
                            ) : null}
                            {installation.actions?.uninstall.allowed ? (
                              <>
                                <form action={uninstallConnectorAction}>
                                  <input type="hidden" name="installationId" value={installation.id} />
                                  <Button type="submit" variant="secondary" className="text-xs">
                                    Disable
                                  </Button>
                                </form>
                              </>
                            ) : null}
                            {actorRole === "admin" && installation.status === "DISABLED" ? (
                              <form action={deleteConnectorInstallationAction} className="space-y-1 rounded border border-slate-200 p-2">
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
                                <Button type="submit" className="text-xs">
                                  Delete Record
                                </Button>
                              </form>
                            ) : null}
                            {!installation.actions?.reconnect.allowed ? (
                              <p className="w-full text-xs text-slate-500">
                                Reconnect blocked: {formatActionBlockedReason(installation.actions?.reconnect.reason)}
                              </p>
                            ) : null}
                            {!installation.actions?.uninstall.allowed ? (
                              <p className="w-full text-xs text-slate-500">
                                Disable blocked: {formatActionBlockedReason(installation.actions?.uninstall.reason)}
                              </p>
                            ) : null}
                            {(isPlanBlockedReason(installation.actions?.reconnect.reason) ||
                              isPlanBlockedReason(installation.actions?.uninstall.reason)) ? (
                              <p className="w-full text-xs text-slate-500">
                                <Link href="/admin/plan" className="underline">
                                  Upgrade your plan
                                </Link>{" "}
                                to unblock connector actions.
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/connectors", error.status));
    }
    throw error;
  }
}
