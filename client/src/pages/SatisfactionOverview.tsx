// ============================================================
// SentiArch — All-Agents · All-Canvases Env. Satisfaction
// One row per agent; one column per canvas. Lets the user compare
// how different design schemes affect the same agent.
// ============================================================

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  type CanvasData,
  type PersonaData,
  type RouteSummary,
  type CritiqueReport,
  type CritiqueFinding,
  callTheCritique,
  computeRouteSummary,
  getPersonaColor,
  loadCanvasesWithMigration,
} from "@/lib/store";

interface AgentLane {
  agentIdx: number;
  persona: PersonaData;
  perCanvas: ({ canvas: CanvasData; summary: RouteSummary | null })[];
}

function loadLanes(): { canvases: CanvasData[]; lanes: AgentLane[] } {
  const { store, personas } = loadCanvasesWithMigration();
  const lanes: AgentLane[] = personas.map((persona, agentIdx) => {
    const perCanvas = store.canvases.map((canvas) => {
      const log = canvas.perceptionLogs[agentIdx] ?? [];
      const wps = canvas.waypoints[agentIdx] ?? [];
      const summary = computeRouteSummary(log, wps, persona);
      return { canvas, summary };
    });
    return { agentIdx, persona, perCanvas };
  });
  return { canvases: store.canvases, lanes };
}

function comfortColor(c: number): string {
  return c >= 7 ? "var(--calm)" : c >= 4 ? "var(--amber)" : "var(--brick)";
}
function stressColor(s: number): string {
  return s <= 3 ? "var(--calm)" : s <= 6 ? "var(--amber)" : "var(--brick)";
}
function trendArrow(t: RouteSummary["trend"]): string {
  return t === "rising" ? "↑" : t === "declining" ? "↓" : "→";
}
function trendColor(t: RouteSummary["trend"]): string {
  return t === "rising" ? "var(--calm)" : t === "declining" ? "var(--brick)" : "var(--ink-2)";
}

function CanvasCell({ summary }: { summary: RouteSummary | null }) {
  if (!summary) {
    return (
      <div
        style={{
          padding: 14,
          background: "var(--bg-2)",
          border: "1px dashed var(--line-2)",
          minHeight: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        No simulation yet.
      </div>
    );
  }
  const overBudget = summary.totalDwellMin > summary.totalBudgetMin;
  return (
    <div
      style={{
        padding: 12,
        background: "var(--bg-2)",
        border: "1px solid var(--line-1)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--line-1)",
          borderLeft: "2px solid var(--amber)",
          padding: "8px 10px",
          fontFamily: "var(--font-serif)",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--ink-1)",
          minHeight: 42,
        }}
      >
        {summary.finalSummary || (
          <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Route ran but no narrative captured.</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
        <Stat label="Comfort" value={summary.avgComfort} unit="/10" color={comfortColor(summary.avgComfort)} />
        <Stat label="Stress" value={summary.avgStress} unit="/10" color={stressColor(summary.avgStress)} />
        <Stat
          label="Time"
          value={summary.totalDwellMin}
          unit={`/${summary.totalBudgetMin}m`}
          color={overBudget ? "var(--brick)" : "var(--ink-0)"}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4, alignItems: "center", textAlign: "center" }}>
        <Stat label="Start" value={summary.startComfort} color={comfortColor(summary.startComfort)} small />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: trendColor(summary.trend) }}>
          {trendArrow(summary.trend)}
        </div>
        <Stat label="End" value={summary.endComfort} color={comfortColor(summary.endComfort)} small />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {summary.legCount} {summary.legCount === 1 ? "leg" : "legs"}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  color,
  small,
}: {
  label: string;
  value: number;
  unit?: string;
  color: string;
  small?: boolean;
}) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", padding: small ? "8px 4px" : "6px 8px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: small ? 18 : 17, color, lineHeight: 1 }}>
        {value}
        {unit ? <span style={{ fontSize: 9, color: "var(--ink-3)", marginLeft: 2 }}>{unit}</span> : null}
      </div>
    </div>
  );
}

export default function SatisfactionOverview() {
  const [, navigate] = useLocation();
  const { canvases, lanes } = useMemo(() => loadLanes(), []);

  // ── Layer 3 · "The Critique" state ────────────────────────
  // The Critique runs against ONE canvas at a time (the active one in
  // the picker), so the prompt stays focused. Active canvas defaults to
  // the first one with a non-empty perception log.
  const firstWithLog = useMemo(() => {
    const idx = canvases.findIndex((c) =>
      Object.values(c.perceptionLogs).some((l) => Array.isArray(l) && l.length > 0),
    );
    return idx >= 0 ? idx : 0;
  }, [canvases]);
  const [activeCanvasIdx, setActiveCanvasIdx] = useState<number>(firstWithLog);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [critiqueError, setCritiqueError] = useState<string | null>(null);
  const [critiqueReport, setCritiqueReport] = useState<CritiqueReport | null>(null);

  // Cohort summaries per canvas (mean comfort/stress across all agents that
  // were simulated on that canvas).
  const cohortByCanvas = useMemo(() => {
    return canvases.map((c, ci) => {
      const summaries = lanes
        .map((lane) => lane.perCanvas[ci]?.summary)
        .filter((s): s is RouteSummary => s !== null && s !== undefined);
      if (summaries.length === 0) {
        return { canvas: c, simulated: 0, avgComfort: null, avgStress: null };
      }
      const avgComfort = Math.round((summaries.reduce((s, x) => s + x.avgComfort, 0) / summaries.length) * 10) / 10;
      const avgStress = Math.round((summaries.reduce((s, x) => s + x.avgStress, 0) / summaries.length) * 10) / 10;
      return { canvas: c, simulated: summaries.length, avgComfort, avgStress };
    });
  }, [canvases, lanes]);

  // Per-canvas "does this canvas have any log entries" gate. Disables the
  // Critique button cleanly when no agent has simulated on the active
  // canvas; the user gets a tooltip instead of a "did nothing" click.
  const anyLogOnActiveCanvas = useMemo(() => {
    const c = canvases[activeCanvasIdx];
    if (!c) return false;
    return Object.values(c.perceptionLogs).some((l) => Array.isArray(l) && l.length > 0);
  }, [canvases, activeCanvasIdx]);

  const runCritique = async () => {
    const canvas = canvases[activeCanvasIdx];
    if (!canvas) return;
    setCritiqueLoading(true);
    setCritiqueError(null);
    setCritiqueReport(null);
    try {
      const personas = lanes.map((lane) => lane.persona);
      const report = await callTheCritique(
        canvas,
        personas,
        canvas.perceptionLogs,
        canvas.waypoints,
      );
      if (!report) {
        setCritiqueError(
          "The Critique did not complete. Check Settings for LLM configuration, " +
          "and confirm at least one agent has a perception log on this canvas. " +
          "Console has full diagnostics.",
        );
      } else {
        setCritiqueReport(report);
      }
    } catch (err) {
      setCritiqueError(err instanceof Error ? err.message : String(err));
    } finally {
      setCritiqueLoading(false);
    }
  };

  const gridTemplate = `180px repeat(${canvases.length}, minmax(260px, 1fr))`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)", color: "var(--ink-0)", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div
        style={{
          height: 48,
          padding: "0 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--line-1)",
          background: "var(--bg-1)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <div className="sa-brand">
            <svg viewBox="0 0 22 22" fill="none" width="22" height="22" style={{ flexShrink: 0 }}>
              <rect x="2" y="2" width="18" height="18" stroke="var(--amber)" strokeWidth="1.2" />
              <path d="M2 11 L20 11 M11 2 L11 20" stroke="var(--amber)" strokeWidth="0.6" strokeDasharray="1.5 1.5" />
              <circle cx="11" cy="11" r="3.2" fill="var(--amber)" opacity="0.85" />
            </svg>
            <span>SentiArch</span>
          </div>
          <div className="sa-crumb">
            <span>Project</span>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <b>Env. Satisfaction · Cross-Canvas</b>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <b>{lanes.length} agent{lanes.length !== 1 ? "s" : ""} × {canvases.length} canvas{canvases.length !== 1 ? "es" : ""}</b>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="sa-btn" onClick={() => navigate("/legacy")}>← Prototype</button>
          {/* Layer 3 · "The Critique" — read the whole cohort on the
              active canvas at once and surface cross-agent failure
              patterns no single Layer-2 narrative could see. */}
          {canvases.length > 0 && (
            <>
              <select
                value={activeCanvasIdx}
                onChange={(e) => {
                  setActiveCanvasIdx(parseInt(e.target.value, 10));
                  setCritiqueReport(null);
                  setCritiqueError(null);
                }}
                disabled={critiqueLoading}
                title="Choose which canvas The Critique should read"
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  background: "var(--bg-2)", color: "var(--ink-0)",
                  border: "1px solid var(--line-2)", padding: "4px 8px",
                  letterSpacing: "0.06em",
                }}
              >
                {canvases.map((c, i) => (
                  <option key={c.id} value={i}>{c.name}</option>
                ))}
              </select>
              <button
                className="sa-btn"
                onClick={runCritique}
                disabled={!anyLogOnActiveCanvas || critiqueLoading}
                title={
                  !anyLogOnActiveCanvas
                    ? "Run at least one route on this canvas first."
                    : "Layer 3 · The Critique — read the whole cohort and surface cross-agent failure patterns"
                }
                style={{
                  opacity: !anyLogOnActiveCanvas || critiqueLoading ? 0.55 : 1,
                }}
              >
                {critiqueLoading ? "Reading…" : "Read with The Critique →"}
              </button>
            </>
          )}
          <button className="sa-btn" onClick={() => navigate("/settings")}>Settings</button>
        </div>
      </div>

      {/* Layer 3 results panel — slot under the top bar so it sits above
          the matrix grid without disrupting its layout. Renders only
          when there is something to show (loading, error, or report). */}
      {(critiqueLoading || critiqueError || critiqueReport) && (
        <CritiquePanel
          canvasName={canvases[activeCanvasIdx]?.name ?? "—"}
          loading={critiqueLoading}
          error={critiqueError}
          report={critiqueReport}
          onDismiss={() => { setCritiqueReport(null); setCritiqueError(null); }}
        />
      )}

      {/* Body */}
      <div style={{ padding: 24, flex: 1, overflow: "auto" }}>
        {lanes.length === 0 ? (
          <div style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            No agents found. Open the prototype and add agents first.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: 12, alignItems: "stretch" }}>
            {/* Header row: empty cell + canvas headers with cohort summary */}
            <div />
            {cohortByCanvas.map(({ canvas, simulated, avgComfort, avgStress }) => (
              <div
                key={canvas.id}
                style={{
                  background: "var(--bg-1)",
                  border: "1px solid var(--line-1)",
                  borderTop: "3px solid var(--brick)",
                  padding: "10px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--brick)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {canvas.name}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Cohort · {simulated} / {lanes.length} simulated
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>
                    <span style={{ letterSpacing: "0.08em" }}>AVG COMFORT</span>{" "}
                    <span style={{ fontFamily: "var(--font-serif)", fontSize: 14, color: avgComfort !== null ? comfortColor(avgComfort) : "var(--ink-3)" }}>
                      {avgComfort !== null ? avgComfort.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>
                    <span style={{ letterSpacing: "0.08em" }}>AVG STRESS</span>{" "}
                    <span style={{ fontFamily: "var(--font-serif)", fontSize: 14, color: avgStress !== null ? stressColor(avgStress) : "var(--ink-3)" }}>
                      {avgStress !== null ? avgStress.toFixed(1) : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {/* One row per agent */}
            {lanes.map((lane) => {
              const color = getPersonaColor(lane.agentIdx);
              return (
                <Row key={lane.agentIdx} lane={lane} primaryColor={color.primary} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ lane, primaryColor }: { lane: AgentLane; primaryColor: string }) {
  return (
    <>
      <div
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--line-1)",
          borderLeft: `3px solid ${primaryColor}`,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minHeight: 180,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: "2px 8px",
            background: `${primaryColor}22`,
            color: primaryColor,
            border: `1px solid ${primaryColor}`,
            letterSpacing: "0.06em",
            alignSelf: "flex-start",
          }}
        >
          {lane.persona.agent.name?.trim() || lane.persona.agent.id}
        </span>
        {lane.persona.agent.name?.trim() && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.06em" }} title={lane.persona.agent.id}>
            {lane.persona.agent.id}
          </div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {lane.persona.agent.role?.trim() || lane.persona.agent.mbti}
        </div>
        {lane.persona.agent.role?.trim() && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {lane.persona.agent.mbti}
          </div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ASI · {lane.persona.agent.anxiety?.asi_level ?? "normal"}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Age {lane.persona.agent.age} · {lane.persona.agent.mobility}
        </div>
      </div>
      {lane.perCanvas.map(({ canvas, summary }) => (
        <CanvasCell key={canvas.id} summary={summary} />
      ))}
    </>
  );
}

// ============================================================
// Layer 3 · The Critique · Results panel
// ============================================================
// Sits between the top bar and the matrix grid. Renders three states:
// loading (spinner-glyph + skeleton), error (red banner), report
// (population summary + findings grouped by category).

const CATEGORY_META: Record<
  CritiqueFinding["category"],
  { label: string; color: string; description: string }
> = {
  practical_problem: {
    label: "Practical problems",
    color: "var(--amber)",
    description: "Concrete issues multiple agents actually ran into.",
  },
  latent_risk: {
    label: "Latent risks",
    color: "var(--brick)",
    description: "Risks the cohort exhibits but no single agent named.",
  },
  geometric_failure_mode: {
    label: "Geometric failure modes",
    color: "var(--teal)",
    description: "Failures the geometry of this canvas has invited in.",
  },
};

function CritiquePanel({
  canvasName,
  loading,
  error,
  report,
  onDismiss,
}: {
  canvasName: string;
  loading: boolean;
  error: string | null;
  report: CritiqueReport | null;
  onDismiss: () => void;
}) {
  // Group findings by category for display. Empty categories are hidden
  // so the panel doesn't grow with empty section headers.
  const grouped = useMemo(() => {
    if (!report) return null;
    const m: Record<CritiqueFinding["category"], CritiqueFinding[]> = {
      practical_problem: [],
      latent_risk: [],
      geometric_failure_mode: [],
    };
    for (const f of report.findings) m[f.category].push(f);
    return m;
  }, [report]);

  return (
    <div
      style={{
        padding: "16px 24px 20px",
        borderBottom: "1px solid var(--line-1)",
        background: "var(--bg-1)",
      }}
    >
      {/* Header — title + canvas + dismiss */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--brick)",
            borderLeft: "3px solid var(--brick)",
            paddingLeft: 8,
          }}
        >
          Layer 3 · The Critique
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
          canvas “{canvasName}”
          {report && (
            <>
              {" · "}
              {report.agent_count} agent{report.agent_count !== 1 ? "s" : ""}
              {" · "}
              {new Date(report.generated_at).toLocaleString()}
              {" · "}
              {report.model}
            </>
          )}
        </span>
        <div style={{ flex: 1 }} />
        {!loading && (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
              color: "var(--ink-3)", background: "transparent",
              border: "1px solid var(--line-2)", padding: "2px 8px",
              cursor: "pointer", textTransform: "uppercase",
            }}
          >
            Dismiss
          </button>
        )}
      </div>

      {loading && (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            color: "var(--ink-2)",
            fontStyle: "italic",
          }}
        >
          Reading the whole cohort at once… this typically takes 4–10 seconds.
        </div>
      )}

      {error && (
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--brick)",
            borderLeft: "3px solid var(--brick)",
            padding: "10px 14px",
            color: "var(--brick)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {report && grouped && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Population summary */}
          {report.population_summary && (
            <div
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--line-1)",
                borderLeft: "3px solid var(--brick)",
                padding: "12px 16px",
                fontFamily: "var(--font-serif)",
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--ink-0)",
              }}
            >
              {report.population_summary}
            </div>
          )}

          {/* Findings by category */}
          {(Object.keys(CATEGORY_META) as CritiqueFinding["category"][]).map((cat) => {
            const items = grouped[cat];
            if (!items || items.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 8, height: 8, background: meta.color,
                      display: "inline-block", borderRadius: 1,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      color: meta.color, fontWeight: 500,
                    }}
                  >
                    {meta.label}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>
                    · {items.length}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.04em", fontStyle: "italic" }}>
                    {meta.description}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((f, i) => (
                    <Finding key={`${cat}-${i}`} finding={f} color={meta.color} />
                  ))}
                </div>
              </div>
            );
          })}

          {report.findings.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 13,
                color: "var(--ink-3)",
                fontStyle: "italic",
              }}
            >
              The Critique returned no distinct findings beyond the population summary above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Finding({ finding, color }: { finding: CritiqueFinding; color: string }) {
  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line-1)",
        borderLeft: `2px solid ${color}`,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 14,
          color: "var(--ink-0)",
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {finding.pattern}
      </div>
      <FindingRow label="Evidence" value={finding.evidence} />
      <FindingRow label="Mechanism" value={finding.mechanism} italic />
      <FindingRow label="Implication" value={finding.design_implication} accent={color} />
    </div>
  );
}

function FindingRow({
  label,
  value,
  italic,
  accent,
}: {
  label: string;
  value: string;
  italic?: boolean;
  accent?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "baseline" }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 12,
          color: accent || "var(--ink-1)",
          lineHeight: 1.5,
          fontStyle: italic ? "italic" : "normal",
        }}
      >
        {value}
      </span>
    </div>
  );
}
