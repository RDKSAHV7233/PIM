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
import {
  ApiHttpError,
  type MarketplaceChannel,
  getConnectorDefinitions,
  getInstalledConnectors,
  getProducts,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface ConnectorsPageProps {
  searchParams: Promise<{
    status?: string;
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

export default async function ConnectorsPage({ searchParams }: ConnectorsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const actionStatusMessage = formatStatusMessage(String(query.status ?? ""));

  try {
    const [definitions, installations, productsRaw] = await Promise.all([
      getConnectorDefinitions({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
    ]);

    const visibleProducts = filterTestData(productsRaw, true);
    const firstProductId = visibleProducts[0]?.id ?? "";

    return (
      <div className="space-y-5">
        <header className="space-y-1">
          <Link href="/" className="text-sm text-slate-600 underline">
            Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">Connector Management</h1>
          <p className="text-sm text-slate-600">
            Install, reconnect, and review connector configuration details for this tenant.
          </p>
          <Link href="/settings/connectors" className="text-xs text-slate-600 underline">
            Manage connector permissions
          </Link>
        </header>

        {actionStatusMessage ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {actionStatusMessage}
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
                      Capabilities: {definition.capabilities.join(", ")}
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
                        <Button type="submit">Install connector</Button>
                      </form>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        {definition.actions?.install.reason === "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED" ||
                        definition.actions?.install.reason === "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED"
                          ? (
                            <>
                              Connector plan limit reached.{" "}
                              <Link href="/settings/plan" className="underline">
                                Upgrade your plan
                              </Link>{" "}
                              to install more accounts.
                            </>
                          )
                          : "You do not have install permission for this connector."}
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
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Connector</th>
                    <th className="py-2">Account Alias</th>
                    <th className="py-2">External Ref</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Capabilities</th>
                    <th className="py-2">Installed</th>
                    <th className="py-2">Last Sync</th>
                    <th className="py-2">Metadata</th>
                    <th className="py-2">Actions</th>
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
                      <tr key={installation.id} className="border-t border-border align-top">
                        <td className="py-2">
                          <div className="font-medium text-slate-900">{installation.displayName}</div>
                          <div className="font-mono text-xs text-slate-500">{installation.slug}</div>
                        </td>
                        <td className="py-2">{installation.accountAlias}</td>
                        <td className="py-2">{installation.externalAccountRef || "-"}</td>
                        <td className="py-2">{installation.status}</td>
                        <td className="py-2 text-xs">{installation.capabilities.join(", ")}</td>
                        <td className="py-2 text-xs">{new Date(installation.installedAt).toLocaleString()}</td>
                        <td className="py-2 text-xs">
                          {installation.lastSyncAt ? new Date(installation.lastSyncAt).toLocaleString() : "-"}
                        </td>
                        <td className="py-2">
                          <pre className="max-h-28 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-4 text-slate-600">
                            {JSON.stringify(installation.metadata ?? {}, null, 2)}
                          </pre>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={mappingHref}
                              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                            >
                              Mapping
                            </Link>
                            {installation.actions?.reconnect.allowed ? (
                              <>
                                <form action={reconnectConnectorAction}>
                                  <input type="hidden" name="installationId" value={installation.id} />
                                  <Button type="submit" variant="secondary">
                                    Reconnect
                                  </Button>
                                </form>
                              </>
                            ) : null}
                            {installation.actions?.uninstall.allowed ? (
                              <>
                                <form action={uninstallConnectorAction}>
                                  <input type="hidden" name="installationId" value={installation.id} />
                                  <Button type="submit">Disable</Button>
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
                                <Button type="submit" variant="secondary">
                                  Delete Record
                                </Button>
                              </form>
                            ) : null}
                            {!installation.actions?.reconnect.allowed &&
                            !installation.actions?.uninstall.allowed ? (
                              <span className="text-xs text-slate-500">
                                {installation.actions?.reconnect.reason ===
                                  "CONNECTOR_PERMISSION_REQUIRED" ||
                                installation.actions?.uninstall.reason ===
                                  "CONNECTOR_PERMISSION_REQUIRED"
                                  ? "No manage permission"
                                  : "Read-only"}
                              </span>
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
      redirect(buildLoginRedirect("/connectors", error.status));
    }
    throw error;
  }
}
