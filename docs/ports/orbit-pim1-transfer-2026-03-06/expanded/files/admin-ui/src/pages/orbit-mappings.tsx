import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, postJson, requestJson } from "../lib/api";
import { CONNECTOR_CATALOGUE } from "../data/connectorCatalogue";

type MappingLevel = "tenant_connector_default" | "tenant_connector_category_mapping";
type MappingLifecycle = "draft" | "validated" | "published" | "superseded" | "archived";
type MappingCompatibility = "compatible" | "deprecated" | "remap_required" | "blocked";

type MappingVersion = {
  id: string;
  connectorSlug: string;
  categoryScope: string;
  mappingLevel: MappingLevel;
  lifecycleState: MappingLifecycle;
  connectorDefinitionId: string;
  connectorDefinitionVersion: string;
  compatibilityState: MappingCompatibility;
  mappingRules: Record<string, unknown>;
  fallbackPolicy: Record<string, unknown>;
  fallbackAckRequired: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

type TaxonomyNode = {
  id: string;
  label: string;
  parent_id: string | null;
  leaf: boolean;
  required_attributes: string[];
};

type PreflightResult = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  compatibilityState: MappingCompatibility;
  fallbackApplied: boolean;
  fallbackAckRequired: boolean;
  matchedVersionIds: string[];
};

const C = {
  surface: "var(--orbit-surface)",
  border: "var(--orbit-border)",
  text: "var(--orbit-text)",
  textSec: "var(--orbit-text-sec)",
  accent: "var(--orbit-accent)",
  green: "var(--orbit-green)",
  amber: "var(--orbit-amber)",
  red: "var(--orbit-red)",
  mono: "var(--orbit-font-mono)",
};

function parseMappingVersion(input: unknown): MappingVersion | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    connectorSlug: String(row.connectorSlug ?? row.connector_slug ?? ""),
    categoryScope: String(row.categoryScope ?? row.category_scope ?? "*"),
    mappingLevel: String(row.mappingLevel ?? row.mapping_level ?? "tenant_connector_default") as MappingLevel,
    lifecycleState: String(row.lifecycleState ?? row.lifecycle_state ?? "draft") as MappingLifecycle,
    connectorDefinitionId: String(row.connectorDefinitionId ?? row.connector_definition_id ?? ""),
    connectorDefinitionVersion: String(row.connectorDefinitionVersion ?? row.connector_definition_version ?? ""),
    compatibilityState: String(row.compatibilityState ?? row.compatibility_state ?? "compatible") as MappingCompatibility,
    mappingRules:
      row.mappingRules && typeof row.mappingRules === "object" && !Array.isArray(row.mappingRules)
        ? (row.mappingRules as Record<string, unknown>)
        : row.mapping_rules && typeof row.mapping_rules === "object" && !Array.isArray(row.mapping_rules)
          ? (row.mapping_rules as Record<string, unknown>)
          : {},
    fallbackPolicy:
      row.fallbackPolicy && typeof row.fallbackPolicy === "object" && !Array.isArray(row.fallbackPolicy)
        ? (row.fallbackPolicy as Record<string, unknown>)
        : row.fallback_policy && typeof row.fallback_policy === "object" && !Array.isArray(row.fallback_policy)
          ? (row.fallback_policy as Record<string, unknown>)
          : {},
    fallbackAckRequired: Boolean(row.fallbackAckRequired ?? row.fallback_ack_required),
    publishedAt: row.publishedAt ? String(row.publishedAt) : row.published_at ? String(row.published_at) : null,
    updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
  };
}

function parseTaxonomy(input: unknown): TaxonomyNode[] {
  const rows: unknown[] =
    input && typeof input === "object" && Array.isArray((input as { items?: unknown[] }).items)
      ? (input as { items: unknown[] }).items
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const item = row as Record<string, unknown>;
      const id = String(item.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        label: String(item.label ?? id),
        parent_id: item.parent_id ? String(item.parent_id) : null,
        leaf: Boolean(item.leaf),
        required_attributes: Array.isArray(item.required_attributes)
          ? item.required_attributes.map((value) => String(value))
          : [],
      } satisfies TaxonomyNode;
    })
    .filter((row): row is TaxonomyNode => row !== null);
}

function parseJson(text: string): Record<string, unknown> {
  const raw = text.trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("json_object_required");
  return parsed as Record<string, unknown>;
}

export function OrbitMappingsPage() {
  const connectorIds = useMemo(
    () => Array.from(new Set(CONNECTOR_CATALOGUE.map((item) => item.id))).sort(),
    []
  );
  const [connectorSlug, setConnectorSlug] = useState(connectorIds[0] ?? "flipkart");
  const [versions, setVersions] = useState<MappingVersion[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxonomyNode[]>([]);
  const [unmapped, setUnmapped] = useState<TaxonomyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    mappingLevel: "tenant_connector_default" as MappingLevel,
    categoryScope: "*",
    connectorDefinitionVersion: "1.0.0",
    compatibilityState: "compatible" as MappingCompatibility,
    fallbackAckRequired: false,
    mappingRulesText: `{
  "field_mappings": {
    "title": "name",
    "sku": "sku"
  }
}`,
    fallbackPolicyText: "{}",
  });

  const [resolveScope, setResolveScope] = useState("apparel.men.shirts");
  const [resolveResult, setResolveResult] = useState<Record<string, unknown> | null>(null);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [fallbackAck, setFallbackAck] = useState(false);
  const [taxonomySearch, setTaxonomySearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [versionsPayload, taxonomyPayload, unmappedPayload] = await Promise.all([
        requestJson<{ items?: unknown[] }>(`/mappings/${encodeURIComponent(connectorSlug)}/versions?includeArchived=true`),
        requestJson<{ items?: unknown[] }>(
          `/taxonomy/${encodeURIComponent(connectorSlug)}/search?limit=200&q=${encodeURIComponent(taxonomySearch.trim())}`
        ),
        requestJson<{ items?: unknown[] }>(
          `/taxonomy/${encodeURIComponent(connectorSlug)}/unmapped?limit=200&q=${encodeURIComponent(taxonomySearch.trim())}`
        ),
      ]);
      const nextVersions = Array.isArray(versionsPayload.items)
        ? versionsPayload.items.map(parseMappingVersion).filter((row): row is MappingVersion => row !== null)
        : [];
      setVersions(nextVersions);
      setTaxonomy(parseTaxonomy(taxonomyPayload));
      setUnmapped(parseTaxonomy(unmappedPayload));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mapping data");
      setVersions([]);
      setTaxonomy([]);
      setUnmapped([]);
    } finally {
      setLoading(false);
    }
  }, [connectorSlug, taxonomySearch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function createDraft() {
    setBusyAction("create");
    setError(null);
    setMessage(null);
    try {
      const mappingRules = parseJson(createForm.mappingRulesText);
      const fallbackPolicy = parseJson(createForm.fallbackPolicyText);
      await postJson(`/mappings/${encodeURIComponent(connectorSlug)}/versions`, {
        category_scope: createForm.categoryScope.trim(),
        mapping_level: createForm.mappingLevel,
        connector_definition_id: connectorSlug,
        connector_definition_version: createForm.connectorDefinitionVersion.trim(),
        compatibility_state: createForm.compatibilityState,
        mapping_rules: mappingRules,
        fallback_policy: fallbackPolicy,
        fallback_ack_required: createForm.fallbackAckRequired,
      });
      setMessage("Mapping draft created.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create draft failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function runAction(versionId: string, action: "validate" | "publish" | "archive") {
    setBusyAction(`${action}:${versionId}`);
    setError(null);
    setMessage(null);
    try {
      if (action === "validate") {
        await postJson(`/mappings/${encodeURIComponent(connectorSlug)}/versions/${encodeURIComponent(versionId)}/validate`, {});
      } else if (action === "publish") {
        await postJson(`/mappings/${encodeURIComponent(connectorSlug)}/versions/${encodeURIComponent(versionId)}/publish`, {
          confirm: true,
        });
      } else {
        await postJson(`/mappings/${encodeURIComponent(connectorSlug)}/versions/${encodeURIComponent(versionId)}/archive`, {
          reason: "archived_from_ui",
        });
      }
      setMessage(`Mapping ${action} succeeded.`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Mapping ${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function resolveMapping() {
    setBusyAction("resolve");
    setError(null);
    setMessage(null);
    try {
      const payload = await requestJson<Record<string, unknown>>(
        `/mappings/${encodeURIComponent(connectorSlug)}/resolve?categoryScope=${encodeURIComponent(resolveScope.trim())}`
      );
      setResolveResult(payload);
      setMessage("Resolution completed.");
    } catch (e) {
      setResolveResult(null);
      setError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function runPreflight() {
    setBusyAction("preflight");
    setError(null);
    setMessage(null);
    try {
      const payload = await postJson<PreflightResult>(`/mappings/${encodeURIComponent(connectorSlug)}/preflight`, {
        category_scope: resolveScope.trim(),
        fallback_acknowledged: fallbackAck,
      });
      setPreflightResult(payload);
      setMessage(payload.ok ? "Preflight passed." : "Preflight returned blockers.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details && typeof e.details === "object") {
        setPreflightResult(e.details as PreflightResult);
        setMessage("Preflight returned blockers.");
      } else {
        setError(e instanceof Error ? e.message : "Preflight failed");
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ color: C.text, fontSize: 18 }}>PIM1 Mapping Control</div>
          <div style={{ color: C.textSec, fontSize: 12 }}>Attribute mapping lifecycle, taxonomy coverage, and preflight gating.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={connectorSlug}
            onChange={(event) => setConnectorSlug(event.target.value)}
            style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
          >
            {connectorIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            value={taxonomySearch}
            onChange={(event) => setTaxonomySearch(event.target.value)}
            placeholder="search taxonomy"
            style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px", width: 180 }}
          />
          <button
            type="button"
            onClick={() => void loadAll()}
            style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontFamily: C.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 11, marginBottom: 10 }}>Loading mapping state...</div> : null}
      {message ? <div style={{ color: C.green, fontFamily: C.mono, fontSize: 11, marginBottom: 10 }}>{message}</div> : null}
      {error ? <div style={{ color: C.red, fontFamily: C.mono, fontSize: 11, marginBottom: 10 }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12 }}>
        <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12 }}>
          <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Create Draft Mapping Version</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <select
              value={createForm.mappingLevel}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, mappingLevel: event.target.value as MappingLevel, categoryScope: event.target.value === "tenant_connector_default" ? "*" : prev.categoryScope }))
              }
              style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
            >
              <option value="tenant_connector_default">tenant_connector_default</option>
              <option value="tenant_connector_category_mapping">tenant_connector_category_mapping</option>
            </select>
            <input
              value={createForm.categoryScope}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, categoryScope: event.target.value }))}
              placeholder="category scope"
              style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
            />
            <input
              value={createForm.connectorDefinitionVersion}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, connectorDefinitionVersion: event.target.value }))}
              placeholder="definition version"
              style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
            />
            <select
              value={createForm.compatibilityState}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, compatibilityState: event.target.value as MappingCompatibility }))}
              style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
            >
              <option value="compatible">compatible</option>
              <option value="deprecated">deprecated</option>
              <option value="remap_required">remap_required</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: C.textSec, fontFamily: C.mono, fontSize: 10, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={createForm.fallbackAckRequired}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, fallbackAckRequired: event.target.checked }))}
            />
            fallback acknowledgement required
          </label>
          <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 10, marginTop: 8, marginBottom: 4 }}>mapping_rules (JSON)</div>
          <textarea
            value={createForm.mappingRulesText}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, mappingRulesText: event.target.value }))}
            style={{ width: "100%", minHeight: 130, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "8px" }}
          />
          <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 10, marginTop: 8, marginBottom: 4 }}>fallback_policy (JSON)</div>
          <textarea
            value={createForm.fallbackPolicyText}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, fallbackPolicyText: event.target.value }))}
            style={{ width: "100%", minHeight: 70, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "8px" }}
          />
          <button
            type="button"
            onClick={() => void createDraft()}
            disabled={busyAction === "create"}
            style={{ marginTop: 8, border: `1px solid ${C.accent}`, background: C.accent, color: "var(--orbit-bg)", fontFamily: C.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}
          >
            {busyAction === "create" ? "Creating..." : "Create Draft"}
          </button>
        </section>

        <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12 }}>
          <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Taxonomy and Unmapped Coverage</div>
          <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 11, marginBottom: 6 }}>
            taxonomy={taxonomy.length} · unmapped={unmapped.length}
          </div>
          <div style={{ maxHeight: 280, overflow: "auto", border: `1px solid ${C.border}`, padding: 8 }}>
            {unmapped.slice(0, 60).map((node) => (
              <div key={node.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "6px 0" }}>
                <div style={{ color: C.amber, fontFamily: C.mono, fontSize: 10 }}>{node.id}</div>
                <div style={{ color: C.textSec, fontSize: 11 }}>{node.label}</div>
                {node.required_attributes.length ? (
                  <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>
                    required: {node.required_attributes.join(", ")}
                  </div>
                ) : null}
              </div>
            ))}
            {unmapped.length === 0 ? <div style={{ color: C.green, fontFamily: C.mono, fontSize: 11 }}>No unmapped taxonomy leaf categories.</div> : null}
          </div>
        </section>
      </div>

      <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12, marginTop: 12 }}>
        <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Resolution and Preflight</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            value={resolveScope}
            onChange={(event) => setResolveScope(event.target.value)}
            placeholder="category scope"
            style={{ width: 280, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>
            <input type="checkbox" checked={fallbackAck} onChange={(event) => setFallbackAck(event.target.checked)} />
            fallback acknowledged
          </label>
          <button
            type="button"
            onClick={() => void resolveMapping()}
            disabled={busyAction === "resolve"}
            style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontFamily: C.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}
          >
            Resolve
          </button>
          <button
            type="button"
            onClick={() => void runPreflight()}
            disabled={busyAction === "preflight"}
            style={{ border: `1px solid ${C.accent}`, background: C.accent, color: "var(--orbit-bg)", fontFamily: C.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}
          >
            {busyAction === "preflight" ? "Running..." : "Run Preflight"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 10, marginBottom: 4 }}>Resolve Output</div>
            <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", border: `1px solid ${C.border}`, background: "rgba(0,0,0,.15)", color: C.text, fontFamily: C.mono, fontSize: 10, padding: 8 }}>
              {JSON.stringify(resolveResult ?? {}, null, 2)}
            </pre>
          </div>
          <div>
            <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 10, marginBottom: 4 }}>Preflight</div>
            <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", border: `1px solid ${C.border}`, background: "rgba(0,0,0,.15)", color: C.text, fontFamily: C.mono, fontSize: 10, padding: 8 }}>
              {JSON.stringify(preflightResult ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </section>

      <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12, marginTop: 12 }}>
        <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Version Lifecycle</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["id", "scope", "level", "state", "compat", "updated", "actions"].map((head) => (
                <th key={head} align="left" style={{ padding: "7px 8px", color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versions.map((row) => (
              <tr key={row.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "7px 8px", color: C.text, fontFamily: C.mono, fontSize: 10 }}>{row.id.slice(0, 8)}</td>
                <td style={{ padding: "7px 8px", color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>{row.categoryScope}</td>
                <td style={{ padding: "7px 8px", color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>{row.mappingLevel}</td>
                <td style={{ padding: "7px 8px", color: row.lifecycleState === "published" ? C.green : C.textSec, fontFamily: C.mono, fontSize: 10 }}>{row.lifecycleState}</td>
                <td style={{ padding: "7px 8px", color: row.compatibilityState === "blocked" ? C.red : row.compatibilityState === "deprecated" ? C.amber : C.textSec, fontFamily: C.mono, fontSize: 10 }}>{row.compatibilityState}</td>
                <td style={{ padding: "7px 8px", color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>{new Date(row.updatedAt).toLocaleString()}</td>
                <td style={{ padding: "7px 8px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => void runAction(row.id, "validate")}
                      disabled={busyAction === `validate:${row.id}` || row.lifecycleState !== "draft"}
                      style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontFamily: C.mono, fontSize: 10, padding: "4px 6px", cursor: "pointer" }}
                    >
                      validate
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAction(row.id, "publish")}
                      disabled={busyAction === `publish:${row.id}` || row.lifecycleState !== "validated"}
                      style={{ border: `1px solid ${C.accent}`, background: C.accent, color: "var(--orbit-bg)", fontFamily: C.mono, fontSize: 10, padding: "4px 6px", cursor: "pointer" }}
                    >
                      publish
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAction(row.id, "archive")}
                      disabled={busyAction === `archive:${row.id}` || row.lifecycleState === "archived"}
                      style={{ border: `1px solid ${C.red}`, background: "transparent", color: C.red, fontFamily: C.mono, fontSize: 10, padding: "4px 6px", cursor: "pointer" }}
                    >
                      archive
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {versions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 10, color: C.textSec, fontFamily: C.mono, fontSize: 11 }}>
                  No mapping versions created for this connector.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
