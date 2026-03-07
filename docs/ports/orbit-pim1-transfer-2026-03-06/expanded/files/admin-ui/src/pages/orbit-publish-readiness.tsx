import { useMemo, useState } from "react";
import { ApiError, postJson } from "../lib/api";
import { CONNECTOR_CATALOGUE } from "../data/connectorCatalogue";

type PublishReadiness = {
  ok: boolean;
  connector_slug: string;
  category_scope: string;
  blockers: string[];
  warnings: string[];
  sections: {
    installation?: {
      installed: boolean;
      installationId: string | null;
      credentialsConfigured: boolean;
    };
    mapping_preflight?: {
      ok: boolean;
      blockers: string[];
      warnings: string[];
      compatibilityState: string;
      fallbackApplied: boolean;
      fallbackAckRequired: boolean;
      matchedVersionIds: string[];
    };
    connector_health?: {
      id: string;
      name: string;
      status: string;
      errorRate: number;
      eventsLast24h: number;
    } | null;
  };
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

export function OrbitPublishReadinessPage() {
  const connectorIds = useMemo(() => Array.from(new Set(CONNECTOR_CATALOGUE.map((item) => item.id))).sort(), []);
  const [connectorSlug, setConnectorSlug] = useState(connectorIds[0] ?? "flipkart");
  const [categoryScope, setCategoryScope] = useState("apparel.men.shirts");
  const [fallbackAcknowledged, setFallbackAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PublishReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runReadiness() {
    setLoading(true);
    setError(null);
    try {
      const payload = await postJson<PublishReadiness>(`/publish-readiness/${encodeURIComponent(connectorSlug)}`, {
        category_scope: categoryScope.trim(),
        fallback_acknowledged: fallbackAcknowledged,
      });
      setResult(payload);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details && typeof e.details === "object") {
        setResult(e.details as PublishReadiness);
      } else {
        setResult(null);
        setError(e instanceof Error ? e.message : "Readiness check failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const stateColor = result?.ok ? C.green : C.red;

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: C.text, fontSize: 18 }}>Publish Readiness (Hard Gate)</div>
        <div style={{ color: C.textSec, fontSize: 12 }}>
          Unified gate for connector install, credential presence, mapping preflight, and runtime health.
        </div>
      </div>

      <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={connectorSlug}
            onChange={(event) => setConnectorSlug(event.target.value)}
            style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px" }}
          >
            {connectorIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            value={categoryScope}
            onChange={(event) => setCategoryScope(event.target.value)}
            placeholder="category scope"
            style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: C.mono, fontSize: 11, padding: "6px 8px", width: 260 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: C.textSec, fontFamily: C.mono, fontSize: 10 }}>
            <input
              type="checkbox"
              checked={fallbackAcknowledged}
              onChange={(event) => setFallbackAcknowledged(event.target.checked)}
            />
            fallback acknowledged
          </label>
          <button
            type="button"
            onClick={() => void runReadiness()}
            disabled={loading}
            style={{ border: `1px solid ${C.accent}`, background: C.accent, color: "var(--orbit-bg)", fontFamily: C.mono, fontSize: 10, padding: "6px 10px", cursor: "pointer" }}
          >
            {loading ? "Checking..." : "Run Gate"}
          </button>
        </div>
      </section>

      {error ? <div style={{ color: C.red, fontFamily: C.mono, fontSize: 11, marginBottom: 10 }}>{error}</div> : null}

      {result ? (
        <>
          <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12, marginBottom: 12 }}>
            <div style={{ color: stateColor, fontFamily: C.mono, fontSize: 14, marginBottom: 6 }}>
              {result.ok ? "READY_TO_PUBLISH" : "BLOCKED"}
            </div>
            <div style={{ color: C.textSec, fontFamily: C.mono, fontSize: 11 }}>
              connector={result.connector_slug} · category={result.category_scope}
            </div>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12 }}>
              <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Blockers</div>
              {result.blockers.length ? (
                result.blockers.map((blocker) => (
                  <div key={blocker} style={{ color: C.red, fontFamily: C.mono, fontSize: 11, marginBottom: 4 }}>
                    • {blocker}
                  </div>
                ))
              ) : (
                <div style={{ color: C.green, fontFamily: C.mono, fontSize: 11 }}>No blockers</div>
              )}
            </section>

            <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12 }}>
              <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Warnings</div>
              {result.warnings.length ? (
                result.warnings.map((warning) => (
                  <div key={warning} style={{ color: C.amber, fontFamily: C.mono, fontSize: 11, marginBottom: 4 }}>
                    • {warning}
                  </div>
                ))
              ) : (
                <div style={{ color: C.green, fontFamily: C.mono, fontSize: 11 }}>No warnings</div>
              )}
            </section>
          </div>

          <section style={{ border: `1px solid ${C.border}`, background: C.surface, padding: 12, marginTop: 12 }}>
            <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>Gate Sections</div>
            <pre
              style={{
                margin: 0,
                border: `1px solid ${C.border}`,
                background: "rgba(0,0,0,.15)",
                color: C.text,
                fontFamily: C.mono,
                fontSize: 10,
                padding: 8,
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {JSON.stringify(result.sections, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
