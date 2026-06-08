// ============================================================
// PersonaMindMap Component — Claude Design System
// Numbered sections · JetBrains Mono labels · thin progress bars
// Keeps full editable functionality from the main-branch version
// ============================================================

import { useState, useMemo, type ReactNode, type CSSProperties } from "react";
import type {
  PersonaData,
  ExperienceData,
  AccumulatedState,
  ComputedOutputs,
  ComfortDriver,
  TemporalData,
  RouteSummary,
  LLMObservation,
  FeltDim,
} from "@/lib/store";
import {
  buildAnxietyData,
  deriveAnxietyLevel,
  deriveComfortDrivers,
  computeComfortScore,
  computeStressScore,
  defaultTemporal,
  FELT_DIMS,
  ENGINE_DIM_KEY,
} from "@/lib/store";

/**
 * One peer agent's reaction to the current environment, surfaced inline
 * inside the active agent's Env. Satisfaction + Layer 3 · The Critique
 * panels so that the per-agent panel doubles as a cohort-comparison
 * view. Callers pass the OTHER agents (active agent excluded) plus
 * their persona color for the colour dot.
 */
export interface PeerAgentReaction {
  agentIdx: number;
  agentId: string;
  agentName?: string;
  hasSimulated: boolean;
  experience: ExperienceData;
  accState: AccumulatedState;
  color: { primary: string; secondary?: string; bg?: string; label?: string };
}

// ---------------------------------------------------------------
// Shared atoms (mirroring Claude app.jsx)
// ---------------------------------------------------------------

function Section({
  num, title, tag, badge, children, style,
}: {
  num: string;
  title: string;
  tag?: "amber" | "red" | "teal" | "green";
  badge?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const tagColors: Record<string, string> = {
    red: "var(--brick)",
    amber: "var(--amber)",
    teal: "var(--teal)",
    green: "var(--calm)",
  };
  const dotColor = tagColors[tag || "amber"];
  return (
    <div className="sa-section" style={style}>
      <div className="sa-section-head">
        <span className="sa-section-title">
          <span className="sa-section-dot" style={{ background: dotColor }} />
          <span>
            <span className="sa-section-title-num">{num}</span> · {title}
          </span>
        </span>
        {badge !== undefined && (
          <span className="sa-section-meta">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function DataRow({
  label, value, onEdit, type = "text", options, placeholder,
}: {
  label: string;
  value: string | number;
  onEdit?: (v: string) => void;
  type?: "text" | "number" | "select";
  options?: string[];
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    if (onEdit) onEdit(draft);
    setEditing(false);
  };

  if (editing && onEdit) {
    if (type === "select" && options) {
      return (
        <div className="sa-data-row">
          <span className="sa-data-row-label">{label}</span>
          <select
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 12,
              background: "var(--bg-2)", color: "var(--ink-0)",
              border: "1px solid var(--amber)", padding: "2px 6px",
            }}
          >
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div className="sa-data-row">
        <span className="sa-data-row-label">{label}</span>
        <input
          autoFocus
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          style={{
            fontFamily: "var(--font-mono)", fontSize: 12,
            background: "var(--bg-2)", color: "var(--ink-0)",
            border: "1px solid var(--amber)", padding: "2px 6px",
            width: 160, textAlign: "right",
          }}
        />
      </div>
    );
  }

  const displayValue = value === "" || value === null || value === undefined
    ? <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>{placeholder ?? "—"}</span>
    : value;
  return (
    <div
      className="sa-data-row"
      onClick={() => onEdit && setEditing(true)}
      style={{ cursor: onEdit ? "pointer" : "default" }}
      title={onEdit ? "Click to edit" : undefined}
    >
      <span className="sa-data-row-label">{label}</span>
      <span className="sa-data-row-val">{displayValue}</span>
    </div>
  );
}

function EnvBar({
  label, value, min, max, unit, color, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  color?: string;
  onChange?: (v: number) => void;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-0)", fontVariantNumeric: "tabular-nums" }}>
          {typeof value === "number" ? value.toFixed(value % 1 === 0 ? 0 : 1) : value}
          {unit && <span style={{ color: "var(--ink-3)", fontSize: 10 }}>{unit}</span>}
        </span>
      </div>
      <div style={{ position: "relative", height: 3, background: "var(--line-1)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color || "var(--amber)", transition: "width .3s" }} />
        {onChange && (
          <input
            type="range" min={min} max={max} step={(max - min) / 100} value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            style={{ position: "absolute", inset: -6, width: "100%", height: 15, opacity: 0, cursor: "pointer" }}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>{min}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>{max}</span>
      </div>
    </div>
  );
}

function SpatialRow({
  label, value, unit, arrow,
}: {
  label: string;
  value: number | null;
  unit?: string;
  arrow?: boolean;
}) {
  const displayVal = value == null || value < 0 ? "—" : value.toFixed(value % 1 === 0 ? 0 : 2);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto",
      padding: "7px 0", borderBottom: "1px dashed var(--line-1)",
      alignItems: "center", gap: 8,
    }}>
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
        {arrow && <span style={{ color: "var(--amber)", marginRight: 4 }}>→</span>}
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: value == null || value < 0 ? "var(--ink-3)" : "var(--ink-0)", fontVariantNumeric: "tabular-nums" }}>
        {displayVal}
      </span>
      {unit && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>{unit}</span>}
    </div>
  );
}

function ComputedCell({
  label, value, unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 12px", flex: 1, textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, color: "var(--ink-0)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
      {unit && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", marginTop: 3 }}>{unit}</div>}
    </div>
  );
}

function PLoadBar({
  label, value, color, baseline,
}: {
  label: string;
  value: number;
  color?: string;
  /** Layer-1 engine baseline tick, rendered as a faint 2px vertical line
   *  at this percentage. Pass undefined to hide. Same 0..1 scale as value. */
  baseline?: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const bl = baseline == null ? null : Math.max(0, Math.min(100, baseline * 100));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 32px", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{label}</span>
      <div style={{ position: "relative", height: 4, background: "var(--line-1)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color || "var(--amber)", transition: "width .4s" }} />
        {bl != null && (
          <div
            title="Layer 1 baseline"
            style={{
              position: "absolute", top: -2, bottom: -2,
              left: `calc(${bl}% - 1px)`, width: 2,
              background: "var(--ink-1)", opacity: 0.5,
            }}
          />
        )}
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-2)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value.toFixed(1)}</span>
    </div>
  );
}

function InlineSlider({
  label, value, min, max, step = 0.1, onChange, color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  color?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-0)", fontVariantNumeric: "tabular-nums" }}>{value.toFixed(1)}</span>
      </div>
      <div style={{ position: "relative", height: 28 }}>
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 2, background: "var(--line-2)", transform: "translateY(-50%)" }} />
        <div style={{ position: "absolute", top: "50%", left: 0, width: `${pct}%`, height: 2, background: color || "var(--amber)", transform: "translateY(-50%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "50%", left: `${pct}%`, width: 10, height: 10, background: "var(--bg-1)", border: `2px solid ${color || "var(--amber)"}`, borderRadius: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>{min}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>{max}</span>
      </div>
    </div>
  );
}

/**
 * One peer-agent line inside the cohort comparison strip. Compact —
 * colour-dot + id/name + comfort badge + stress mini + truncated
 * summary. Sized to fit ~5 peers without overwhelming the active
 * agent's panel. Greyed when the peer has not yet simulated.
 */
function CohortRow({ peer }: { peer: PeerAgentReaction }) {
  const c = peer.experience.comfort_score;
  const s = peer.hasSimulated ? computeStressScore(peer.accState) : null;
  const comfortColor = !peer.hasSimulated
    ? "var(--ink-3)"
    : c >= 7 ? "var(--calm)" : c >= 4 ? "var(--amber)" : "var(--brick)";
  const stressColor = s === null
    ? "var(--ink-3)"
    : s <= 3 ? "var(--calm)" : s <= 6 ? "var(--amber)" : "var(--brick)";
  const summary = peer.hasSimulated
    ? (peer.experience.summary || "(no narrative captured)")
    : "Not yet simulated on this environment.";
  const trunc = (str: string, n: number): string => str.length > n ? str.slice(0, n - 1) + "…" : str;
  const label = peer.agentName?.trim() || peer.agentId;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(70px, max-content) auto auto 1fr",
        gap: 8,
        alignItems: "center",
        padding: "6px 8px",
        background: "var(--bg-2)",
        border: `1px solid var(--line-1)`,
        borderLeft: `2px solid ${peer.color.primary}`,
      }}
      title={summary}
    >
      <span style={{ width: 8, height: 8, background: peer.color.primary, borderRadius: 1, flexShrink: 0 }} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: peer.color.primary, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: comfortColor,
          padding: "1px 5px",
          border: `1px solid ${comfortColor}`,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
        }}
        title="Final comfort score (post-LLM intervention) /10"
      >
        C·{peer.hasSimulated ? c : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: stressColor,
          padding: "1px 5px",
          border: `1px dashed ${stressColor}`,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
        }}
        title="Stress (weighted accumulated_state) /10"
      >
        S·{s === null ? "—" : s.toFixed(1)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)", fontSize: 11,
          color: peer.hasSimulated ? "var(--ink-1)" : "var(--ink-3)",
          fontStyle: peer.hasSimulated ? "normal" : "italic",
          lineHeight: 1.35,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {trunc(summary, 140)}
      </span>
    </div>
  );
}

/**
 * One peer agent's Layer-2 LLM observation, rendered as a compact
 * sub-card under the active agent's observations. Same epistemic tag
 * as the primary observations — hypothesis, not research — but
 * coloured + labelled by the peer's persona colour so the user can
 * tell whose observation it is at a glance.
 */
function PeerObservationCard({
  peer,
  observation,
}: {
  peer: PeerAgentReaction;
  observation: LLMObservation;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        border: "1px dashed var(--line-2)",
        borderLeft: `2px solid ${peer.color.primary}`,
        background: "var(--bg-2)",
        fontFamily: "var(--font-serif)",
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--ink-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5 }}>
        <span style={{ width: 6, height: 6, background: peer.color.primary, borderRadius: 1, display: "inline-block" }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em", color: peer.color.primary }}>
          {(peer.agentName?.trim() || peer.agentId)}
        </span>
      </div>
      <div style={{ fontStyle: "italic", marginBottom: 5 }}>{observation.observation}</div>
      <div style={{ fontSize: 10, color: "var(--ink-2)", marginBottom: 3 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>Mechanism: </span>
        {observation.proposed_mechanism}
      </div>
      <div style={{ fontSize: 10, color: "var(--ink-2)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>Verify: </span>
        {observation.verification}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Main component
// ---------------------------------------------------------------

// ASI level → display label + color. Cutoffs sourced from
// `deriveAnxietyLevel` in store.ts so the band edges (0/16/23/48/72)
// can never silently drift between research code and UI.
const ASI_LEVEL_DISPLAY: Record<ReturnType<typeof deriveAnxietyLevel>, { label: string; color: string }> = {
  normal: { label: "NORMAL", color: "var(--calm)" },
  mild: { label: "MILD", color: "var(--amber)" },
  moderate: { label: "MODERATE", color: "var(--amber)" },
  severe: { label: "SEVERE", color: "var(--brick)" },
};
const ASI_LEVEL = (v: number) => ASI_LEVEL_DISPLAY[deriveAnxietyLevel(v)];

export default function PersonaMindMap({
  persona,
  experience,
  accumulatedState,
  computedOutputs,
  ruleTriggers,
  prevExperience,
  prevAccumulatedState,
  onPersonaChange,
  hasSimulated = true,
  personaColor,
  agentPlaced = false,
  routeSummary = null,
  cohort = [],
}: {
  persona: PersonaData;
  experience: ExperienceData;
  accumulatedState: AccumulatedState;
  computedOutputs: ComputedOutputs;
  ruleTriggers: string[];
  prevExperience: ExperienceData | null;
  prevAccumulatedState: AccumulatedState | null;
  onPersonaChange: (p: PersonaData) => void;
  hasSimulated?: boolean;
  personaColor?: { primary: string; secondary: string; bg: string; label: string };
  agentPlaced?: boolean;
  routeSummary?: RouteSummary | null;
  /**
   * Other agents' reactions to the same environment, surfaced inline
   * in Section 07 (Env. Satisfaction) and the Layer 3 · The Critique
   * block so the per-agent panel doubles as a quick cohort comparison.
   * Empty array = no peer agents declared (single-agent mode) —
   * strips are hidden.
   */
  cohort?: PeerAgentReaction[];
}) {
  const { agent, position, environment, spatial } = persona;
  const asi = agent.anxiety.asi_score;
  const asiLevel = ASI_LEVEL(asi);

  const [showFormulas, setShowFormulas] = useState(false);

  // ---- mutators ----
  const updateAgent = (key: keyof PersonaData["agent"], val: string | number) => {
    // Clamp goal_progress to [0, 1] so the prompt's "X% complete"
    // formatting never wraps. Caller (InlineSlider) already enforces
    // the range but coercing here keeps any future edit path safe.
    const v = key === "goal_progress" && typeof val === "number"
      ? Math.max(0, Math.min(1, val))
      : val;
    onPersonaChange({ ...persona, agent: { ...persona.agent, [key]: v } as PersonaData["agent"] });
  };

  const updateAsi = (v: number) => {
    onPersonaChange({
      ...persona,
      agent: { ...persona.agent, anxiety: buildAnxietyData(v) },
    });
  };

  const updateEnv = (key: keyof PersonaData["environment"], val: number) => {
    onPersonaChange({
      ...persona,
      environment: { ...persona.environment, [key]: val },
    });
  };

  // Thesis-canonical Temporal block. Hydrated with safe zeros when
  // absent so the editor never sees undefined; the underlying
  // `persona.temporal` is still optional in the schema for backward
  // compatibility with pre-change localStorage saves.
  const temporal: TemporalData = persona.temporal ?? defaultTemporal;

  // Derive comfort color. The displayed gauge is computed LIVE from the
  // current accumulated_state — so dropping a green shape, redrawing a
  // wall, or editing zone env values immediately updates the score.
  // `experience.comfort_score` is the snapshot saved at the last sim
  // run; it lives on per-leg perception_log entries (Route Summary)
  // but the gauge here is intentionally live so the user sees the
  // model respond as they design.
  const liveComfort = useMemo(
    () => computeComfortScore(accumulatedState),
    [accumulatedState],
  );
  const comfort = liveComfort;
  const comfortColor = comfort >= 7 ? "var(--calm)" : comfort >= 4 ? "var(--amber)" : "var(--brick)";

  // Comfort drivers — deterministic explainer of which accumulated_state
  // dimensions are pulling comfort down RIGHT NOW, with the sensor
  // reading that explains each. Pure derivation from props the panel
  // already receives; no LLM round-trip. Empty when no driver crosses
  // the noticeability threshold (= agent is uniformly comfortable).
  const comfortDrivers: ComfortDriver[] = useMemo(
    () => deriveComfortDrivers(accumulatedState, computedOutputs, persona.environment, persona.spatial),
    [accumulatedState, computedOutputs, persona.environment, persona.spatial],
  );

  // Compute trend arrow vs prevExperience
  const trendArrow = !prevExperience ? "—" :
    comfort > prevExperience.comfort_score ? "↑" :
    comfort < prevExperience.comfort_score ? "↓" : "→";
  const trendColor = !prevExperience ? "var(--ink-3)" :
    comfort > prevExperience.comfort_score ? "var(--calm)" :
    comfort < prevExperience.comfort_score ? "var(--brick)" : "var(--ink-2)";

  // Modifier display from anxiety
  const modifiers = useMemo(() => {
    const m = agent.anxiety.modifiers;
    return [
      { k: "Noise sensitivity", v: m.noise_sensitivity },
      { k: "Thermal range", v: m.thermal_comfort_range },
      { k: "Personal space", v: m.personal_space_radius },
      { k: "Enclosure sens.", v: m.enclosure_sensitivity },
      { k: "Exit proximity", v: m.exit_proximity_need },
    ];
  }, [agent.anxiety.modifiers]);

  const accentColor = personaColor?.primary || "var(--amber)";

  return (
    <div>
      {/* Persona badge */}
      {personaColor && (
        <div style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--line-1)",
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg-1)",
        }}>
          <span style={{ width: 10, height: 10, background: accentColor, borderRadius: 1 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em", color: accentColor, fontWeight: 500 }}>
            {agent.id}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
            {personaColor.label}
          </span>
          <div className="flex-1" />
          {!agentPlaced && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--brick)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Not Placed
            </span>
          )}
          {hasSimulated && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--calm)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Simulated
            </span>
          )}
        </div>
      )}

      {/* ── 01 · AGENT ───────────────────────────────── */}
      <Section num="01" title="Agent" tag="amber" badge={agent.id}>
        <DataRow label="ID"       value={agent.id}        onEdit={(v) => updateAgent("id", v)} />
        <DataRow label="Name"     value={agent.name ?? ""} onEdit={(v) => updateAgent("name", v.trim())} placeholder="e.g. Mei Lin, Madam Wong" />
        <DataRow label="Role"     value={agent.role ?? ""} onEdit={(v) => updateAgent("role", v.trim())} placeholder="e.g. doctor, nurse, patient, visitor" />
        {/* Purpose = WHY the agent is here today (a static intent), not what
            they are doing right now. The current activity is inferred at
            perception time from purpose × zone × co-located agents. */}
        <DataRow label="Purpose"  value={agent.purpose_at_centre ?? ""} onEdit={(v) => updateAgent("purpose_at_centre", v.trim())} placeholder='e.g. "appointment with Dr Chan to discuss blood test results"' />
        <DataRow label="Relations" value={`${agent.relationships?.length ?? 0} declared`} />
        <DataRow label="Age"      value={agent.age}       onEdit={(v) => updateAgent("age", parseInt(v) || 0)} type="number" />
        <DataRow label="Gender"   value={agent.gender}    onEdit={(v) => updateAgent("gender", v)} type="select" options={["male", "female"]} />
        <DataRow label="MBTI"     value={agent.mbti}      onEdit={(v) => updateAgent("mbti", v)} />
        <DataRow label="Mobility" value={agent.mobility}  onEdit={(v) => updateAgent("mobility", v)} type="select" options={["normal", "walker", "wheelchair", "cane"]} />
        <DataRow label="Hearing"  value={agent.hearing}   onEdit={(v) => updateAgent("hearing", v)} type="select" options={["normal", "impaired", "deaf"]} />
        <DataRow label="Vision"   value={agent.vision}    onEdit={(v) => updateAgent("vision", v)} type="select" options={["normal", "mild_impairment", "severe_impairment"]} />
        <div style={{ marginTop: 8 }}>
          <InlineSlider label="Met" value={agent.metabolic_rate}        min={0.5} max={4} step={0.1} onChange={(v) => updateAgent("metabolic_rate", v)} color="var(--brick)" />
          <InlineSlider label="Clo" value={agent.clothing_insulation}   min={0}   max={2} step={0.1} onChange={(v) => updateAgent("clothing_insulation", v)} color="var(--brick)" />
        </div>
      </Section>

      {/* ── 02 · ANXIETY ASI-3 ───────────────────────── */}
      <Section num="02" title="Anxiety (ASI-3)" tag="red" badge="0 – 72">
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>ASI Score</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-0)", fontVariantNumeric: "tabular-nums" }}>
              {asi}<span style={{ color: "var(--ink-3)" }}>/72</span>
            </span>
          </div>
          <div style={{ position: "relative", height: 32 }}>
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 2, background: "var(--line-2)", transform: "translateY(-50%)" }} />
            <div style={{ position: "absolute", top: "50%", left: 0, width: `${(asi / 72) * 100}%`, height: 2, background: asiLevel.color, transform: "translateY(-50%)", pointerEvents: "none", transition: "width .2s" }} />
            <div style={{ position: "absolute", top: "50%", left: `${(asi / 72) * 100}%`, width: 10, height: 10, background: "var(--bg-1)", border: `2px solid ${asiLevel.color}`, borderRadius: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
            {[0, 16, 23, 72].map((v) => (
              <div key={v} style={{ position: "absolute", top: "calc(50% + 8px)", left: `${(v / 72) * 100}%`, transform: "translateX(-50%)", fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)" }}>{v}</div>
            ))}
            <input
              type="range" min={0} max={72} value={asi}
              onChange={(e) => updateAsi(parseInt(e.target.value))}
              style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Level</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em",
            padding: "3px 10px", border: `1px solid ${asiLevel.color}`, color: asiLevel.color, textTransform: "uppercase",
          }}>{asiLevel.label}</span>
        </div>

        <div style={{ marginTop: 4 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>
            Modifiers (read-only)
          </div>
          {modifiers.map((m, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: "5px 0", borderBottom: "1px dashed var(--line-1)", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{m.k}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 11,
                color: m.v > 1.2 ? "var(--brick)" : m.v > 0.9 ? "var(--amber)" : "var(--ink-2)",
                fontVariantNumeric: "tabular-nums",
              }}>×{m.v.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
          0–16 normal · 17–23 mild · 24–48 moderate · 49–72 severe
        </div>
      </Section>

      {/* ── 03 · POSITION ────────────────────────────── */}
      <Section num="03" title="Position" tag="amber">
        <DataRow label="Cell" value={`[${position.cell[0]}, ${position.cell[1]}]`} />
        <DataRow label="Time" value={position.timestamp} onEdit={(v) =>
          onPersonaChange({ ...persona, position: { ...position, timestamp: v } })
        } />
        <DataRow label="Dur." value={`${position.duration_in_cell} min`} onEdit={(v) =>
          onPersonaChange({ ...persona, position: { ...position, duration_in_cell: parseInt(v) || 0 } })
        } type="number" />
      </Section>

      {/* ── 04 · ENVIRONMENT ─────────────────────────── */}
      <Section num="04" title="Environment" tag="teal">
        <EnvBar label="Lux"    value={environment.lux}          min={0}    max={2000} color="var(--amber)" onChange={(v) => updateEnv("lux", v)} />
        <EnvBar label="Noise"  value={environment.dB}           min={0}    max={110}  unit=" dB"   color="#c4623a" onChange={(v) => updateEnv("dB", v)} />
        <EnvBar label="Temp"   value={environment.air_temp}     min={10}   max={40}   unit=" °C"   color="#7aa6c4" onChange={(v) => updateEnv("air_temp", v)} />
        <EnvBar label="RH"     value={environment.humidity}     min={0}    max={100}  unit=" %"    color="#8aa676" onChange={(v) => updateEnv("humidity", v)} />
        <EnvBar label="Air V." value={environment.air_velocity} min={0}    max={2}    unit=" m/s"  color="#8aa676" onChange={(v) => updateEnv("air_velocity", v)} />
      </Section>

      {/* ── 05 · SPATIAL ─────────────────────────────── */}
      <Section num="05" title="Spatial" tag="amber">
        <SpatialRow label="Wall"   value={spatial.dist_to_wall >= 0   ? spatial.dist_to_wall   : null} unit="m" arrow />
        <SpatialRow label="Win."   value={spatial.dist_to_window >= 0 ? spatial.dist_to_window : null} unit="m" arrow />
        <SpatialRow label="Exit"   value={spatial.dist_to_exit >= 0   ? spatial.dist_to_exit   : null} unit="m" arrow />
        <SpatialRow label="Ceil."  value={spatial.ceiling_h >= 0 ? spatial.ceiling_h : null} unit="m" />
        <SpatialRow label="Encl."  value={spatial.enclosure_ratio} />
        <SpatialRow label="Vis.Ag" value={spatial.visible_agents} />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", marginTop: 6 }}>
          Auto-calculated from map geometry
        </div>
      </Section>

      {/* ── 06 · COMPUTED ────────────────────────────── */}
      <Section num="06" title="Computed" tag="green">
        <div style={{ display: "flex", gap: 1, marginBottom: 1 }}>
          <ComputedCell label="PMV" value={computedOutputs.PMV > 0 ? `+${computedOutputs.PMV.toFixed(2)}` : computedOutputs.PMV.toFixed(2)} />
          <ComputedCell label="PPD" value={`${computedOutputs.PPD.toFixed(0)}%`} />
        </div>
        <div style={{ display: "flex", gap: 1, marginBottom: 8 }}>
          <ComputedCell label="Eff. Lx" value={computedOutputs.effective_lux.toFixed(0)} />
          <ComputedCell label="Pr. dB"  value={computedOutputs.perceived_dB.toFixed(0)} />
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", textAlign: "center", marginBottom: 8, letterSpacing: "0.04em" }}>
          ISO 7730 · Fanger Model · Anxiety-adjusted
        </div>
        <button
          onClick={() => setShowFormulas((f) => !f)}
          style={{
            width: "100%", padding: "9px",
            background: showFormulas ? "var(--amber)" : "var(--bg-2)",
            color: showFormulas ? "var(--bg-0)" : "var(--ink-1)",
            border: `1px solid ${showFormulas ? "var(--amber)" : "var(--line-2)"}`,
            fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, cursor: "pointer", letterSpacing: "0.02em",
          }}
        >
          {showFormulas ? "Hide Formulas" : "Show Formulas"}
        </button>
        {showFormulas && (
          <div style={{ marginTop: 8, padding: 10, background: "var(--bg-2)", border: "1px solid var(--line-1)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-2)", lineHeight: 1.7 }}>
            PMV = f(M, W, fcl, ta, tr, var, pa)<br />
            PPD = 100 − 95 × e^(−0.03353×PMV⁴ − 0.2179×PMV²)<br />
            Eff.Lx = E_v × CRI/100 × η_mel<br />
            Pr.dB = SPL + AF_dist − AR_room<br />
            Anx.dB = Pr.dB × noise_sensitivity<br />
            Anx.PMV = 1 / thermal_comfort_range
          </div>
        )}
        {computedOutputs.pmv_warnings && computedOutputs.pmv_warnings.length > 0 && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(200,90,85,0.08)", border: "1px solid rgba(200,90,85,0.3)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--brick)", lineHeight: 1.5 }}>
            {computedOutputs.pmv_warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
      </Section>

      {/* ── 07 · EXPERIENCES ─────────────────────────── */}
      <Section
        num="07"
        title={routeSummary ? "Env. Satisfaction · Route Summary" : "Env. Satisfaction"}
        tag="amber"
        badge={routeSummary ? `${routeSummary.legCount} legs` : undefined}
      >
        <div style={{
          background: "var(--bg-2)", border: "1px solid var(--line-1)",
          padding: "12px 14px", marginBottom: 10,
          fontFamily: "var(--font-serif)", fontSize: 13, lineHeight: 1.6, color: "var(--ink-1)",
          borderLeft: "2px solid var(--amber)",
        }}>
          {routeSummary
            ? (routeSummary.finalSummary || <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Route ran but no narrative captured.</span>)
            : hasSimulated && experience.summary
              ? experience.summary
              : <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>Run calculation to generate narrative…</span>}
        </div>
        {routeSummary ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              {(() => {
                const c = routeSummary.avgComfort;
                const cColor = c >= 7 ? "var(--calm)" : c >= 4 ? "var(--amber)" : "var(--brick)";
                const s = routeSummary.avgStress;
                const sColor = s <= 3 ? "var(--calm)" : s <= 6 ? "var(--amber)" : "var(--brick)";
                const overBudget = routeSummary.totalDwellMin > routeSummary.totalBudgetMin;
                const tColor = overBudget ? "var(--brick)" : "var(--ink-0)";
                return (
                  <>
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Avg Comfort</div>
                      <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: cColor, lineHeight: 1 }}>
                        {c}<span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2 }}>/10</span>
                      </div>
                    </div>
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Avg Stress</div>
                      <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: sColor, lineHeight: 1 }}>
                        {s}<span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2 }}>/10</span>
                      </div>
                    </div>
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Time</div>
                      <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: tColor, lineHeight: 1 }}>
                        {routeSummary.totalDwellMin}<span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2 }}>/{routeSummary.totalBudgetMin}m</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center", textAlign: "center",
            }}>
              <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 6px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Start</div>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: routeSummary.startComfort >= 7 ? "var(--calm)" : routeSummary.startComfort >= 4 ? "var(--amber)" : "var(--brick)" }}>{routeSummary.startComfort}</div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: routeSummary.trend === "rising" ? "var(--calm)" : routeSummary.trend === "declining" ? "var(--brick)" : "var(--ink-2)" }}>
                {routeSummary.trend === "rising" ? "↑" : routeSummary.trend === "declining" ? "↓" : "→"}
              </div>
              <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 6px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>End</div>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: routeSummary.endComfort >= 7 ? "var(--calm)" : routeSummary.endComfort >= 4 ? "var(--amber)" : "var(--brick)" }}>{routeSummary.endComfort}</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", letterSpacing: "0.08em" }}>COMFORT</span>
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: comfortColor }}>{comfort}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>/10</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, border: "1px solid var(--line-2)", padding: "2px 6px", color: trendColor, marginLeft: 4 }}>
                {trendArrow} {experience.trend}
              </span>
            </div>
            {/* Methodology v2 status badge — replaces the old engine→±delta
                "LLM intervention" widget. Surfaces whether the displayed
                comfort came from the LLM, the engine baseline (intentional
                skip on a non-terminal leg), or a failed LLM call. */}
            {(() => {
              const status = experience.llm_call_status;
              if (!status || status === "skipped") return null;
              const badgeStyle: CSSProperties = {
                display: "inline-block",
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "2px 6px",
                border: "1px solid",
                marginTop: 6,
                marginBottom: 4,
              };
              const cfg: Record<string, { label: string; color: string }> = {
                ok:       { label: "Layer 2 · LLM reading",         color: "var(--calm)" },
                baseline: { label: "Layer 1 · engine baseline",     color: "var(--ink-2)" },
                failed:   { label: "Layer 1 baseline · LLM failed", color: "var(--brick)" },
              };
              const c = cfg[status] ?? cfg.baseline;
              return (
                <>
                  <span style={{ ...badgeStyle, color: c.color, borderColor: c.color }}>
                    {c.label}
                  </span>
                  {status === "ok" && experience.summary && (
                    <div style={{
                      marginTop: 4, marginBottom: 8,
                      fontFamily: "var(--font-serif)", fontSize: 11.5,
                      color: "var(--ink-1)", lineHeight: 1.5,
                    }}>
                      {experience.summary}
                    </div>
                  )}
                </>
              );
            })()}
            {prevExperience && (
              <div style={{
                marginTop: 10,
                display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center", textAlign: "center",
              }}>
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 6px" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Before</div>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: prevExperience.comfort_score >= 7 ? "var(--calm)" : prevExperience.comfort_score >= 4 ? "var(--amber)" : "var(--brick)" }}>{prevExperience.comfort_score}</div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink-2)" }}>→</div>
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 6px" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>After</div>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: comfortColor }}>{comfort}</div>
                </div>
              </div>
            )}
          </>
        )}
        {/* Comfort drivers — labels what's pulling comfort down. Each chip
            shows the factor + level (0..1, 2 dp). Hover the chip to see
            the underlying sensor cause. Sorted highest-level first;
            empty when the agent is uniformly comfortable. */}
        {hasSimulated && comfortDrivers.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>
              What's driving comfort down
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {comfortDrivers.map((d, i) => {
                // Severity colour mirrors the comfort gauge so the eye
                // groups them at a glance: 0.7+ red, 0.5–0.7 amber,
                // 0.3–0.5 muted.
                const sev = d.level >= 0.7 ? "var(--brick)" : d.level >= 0.5 ? "var(--amber)" : "var(--ink-2)";
                const factorLabel = d.factor.replace(/_/g, " ");
                return (
                  <div
                    key={i}
                    title={d.cause}
                    style={{
                      display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center",
                      gap: 8, padding: "4px 8px",
                      border: `1px solid ${sev}`, background: "var(--bg-2)",
                      fontFamily: "var(--font-mono)", fontSize: 10,
                    }}
                  >
                    <span style={{ color: sev, fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}>
                      {d.level.toFixed(2)}
                    </span>
                    <span style={{ color: "var(--ink-1)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {factorLabel}
                    </span>
                    <span style={{
                      color: "var(--ink-3)", fontFamily: "var(--font-serif)", fontSize: 11,
                      maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textAlign: "right",
                    }}>
                      {d.cause}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {ruleTriggers && ruleTriggers.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>
              Triggers
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ruleTriggers.map((t, i) => (
                <span key={i} style={{
                  fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em",
                  padding: "2px 8px", border: "1px solid var(--amber)", color: "var(--amber)", textTransform: "uppercase",
                }}>{t}</span>
              ))}
            </div>
          </div>
        )}
        {/* Cohort reactions — how OTHER agents are reading the same */}
        {/* environment right now. Lets the persona panel double as a */}
        {/* quick cross-agent comparison (one row per peer, sorted by */}
        {/* current comfort score so divergence is easy to spot). */}
        {cohort.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                Other agents on this environment
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
                · {cohort.length} peer{cohort.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...cohort]
                .sort((a, b) => (b.experience.comfort_score ?? 0) - (a.experience.comfort_score ?? 0))
                .map((peer) => (
                  <CohortRow key={peer.agentIdx} peer={peer} />
                ))}
            </div>
          </div>
        )}
        {/* Layer 3 · "The Critique" — LLM steps out of the character
            and reads the configuration as a design discipline. Surfaced
            as falsifiable hypotheses, epistemically distinct from the
            research-grounded comfort_drivers block above. Always shown
            after a simulation so that "LLM call failed" and "LLM
            returned no observations" are distinguishable from the
            block silently disappearing — the user previously saw
            this section vanish whenever V4 thinking-mode swallowed
            the response. */}
        {hasSimulated && (() => {
          const obs = experience.llm_observations ?? [];
          const status = experience.llm_call_status ?? "ok";
          // Don't render anything if LLM was never invoked AND there
          // are no observations — i.e. nothing meaningful to say.
          if (status === "skipped" && obs.length === 0) return null;
          return (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                  Layer 3 · The Critique
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.06em",
                  padding: "1px 6px", border: "1px dashed var(--ink-3)", color: "var(--ink-3)",
                  textTransform: "uppercase",
                }}>
                  LLM hypothesis · not research
                </span>
              </div>
              {obs.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {obs.map((o, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px 10px",
                        border: "1px dashed var(--line-2)",
                        background: "var(--bg-2)",
                        fontFamily: "var(--font-serif)",
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: "var(--ink-1)",
                      }}
                    >
                      <div style={{ fontStyle: "italic", marginBottom: 5 }}>
                        {o.observation}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--ink-2)", marginBottom: 3 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>Mechanism: </span>
                        {o.proposed_mechanism}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--ink-2)" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>Verify: </span>
                        {o.verification}
                      </div>
                    </div>
                  ))}
                </div>
              ) : status === "failed" ? (
                <div style={{
                  padding: "8px 10px",
                  border: "1px dashed var(--brick)",
                  background: "var(--bg-2)",
                  fontFamily: "var(--font-serif)",
                  fontSize: 11,
                  fontStyle: "italic",
                  color: "var(--brick)",
                  lineHeight: 1.5,
                }}>
                  LLM call did not complete for this leg — observations unavailable.
                  Check browser console for <code style={{ fontFamily: "var(--font-mono)" }}>[SentiArch] LLM</code> error details.
                </div>
              ) : (
                <div style={{
                  padding: "8px 10px",
                  border: "1px dashed var(--line-2)",
                  background: "var(--bg-2)",
                  fontFamily: "var(--font-serif)",
                  fontSize: 11,
                  fontStyle: "italic",
                  color: "var(--ink-3)",
                  lineHeight: 1.5,
                }}>
                  No non-obvious observations surfaced for this leg. The deterministic drivers above already capture what the model can see.
                </div>
              )}
              {/* Cross-agent critique — surface every other agent's */}
              {/* Layer-3 hypotheses on the same environment. Lets the */}
              {/* user spot when a single observation is shared (= a */}
              {/* cohort-wide design issue) vs idiosyncratic (= one */}
              {/* persona's reading only). Hidden when no peers exist. */}
              {(() => {
                const peerCards: Array<{ peer: PeerAgentReaction; obs: LLMObservation }> = [];
                for (const peer of cohort) {
                  if (!peer.hasSimulated) continue;
                  const peerObs = peer.experience.llm_observations ?? [];
                  for (const o of peerObs) peerCards.push({ peer, obs: o });
                }
                if (peerCards.length === 0) return null;
                return (
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed var(--line-2)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                        Cross-agent critique
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
                        · {peerCards.length} from {new Set(peerCards.map((c) => c.peer.agentIdx)).size} peer{new Set(peerCards.map((c) => c.peer.agentIdx)).size === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {peerCards.map(({ peer, obs }, i) => (
                        <PeerObservationCard key={`${peer.agentIdx}-${i}`} peer={peer} observation={obs} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </Section>

      {/* ── 08 · PERCEPTUAL LOAD ─────────────────────── */}
      {(() => {
        const llm = experience.llm ?? null;
        const status = experience.llm_call_status;
        const firstName = (agent.name?.trim() || agent.id).split(" ")[0];
        const sectionLabel = llm && status === "ok"
          ? `Layer 2 · ${firstName}'s reading`
          : status === "baseline"
            ? "Layer 1 · physical baseline"
            : status === "failed"
              ? "Layer 1 baseline · LLM unavailable"
              : "Perceptual load";
        // Dim labels in §08 order
        const labelByDim: Record<FeltDim, string> = {
          thermal: "Thermal", visual: "Visual", noise: "Noise",
          social: "Social", temporal: "Fatigue", wayfinding: "Wayfind",
        };
        // Value: LLM dim score (0-100) when ok, else engine accState value (0-1).
        // Render PLoadBar in 0-1 scale, so divide LLM scores by 100.
        // baseline tick (0-1) is the engine accState value, shown only when llm is ok.
        const dimRow = (d: FeltDim) => {
          const engineVal = accumulatedState[ENGINE_DIM_KEY[d]];
          const llmVal = llm ? (llm.dims[d] ?? 0) / 100 : null;
          const value = llmVal != null ? llmVal : engineVal;
          const color = value > 0.6 ? "var(--brick)" : "var(--amber)";
          return (
            <PLoadBar
              key={d}
              label={labelByDim[d]}
              value={value}
              color={color}
              baseline={llmVal != null ? engineVal : undefined}
            />
          );
        };
        return (
          <Section num="08" title={sectionLabel} tag="red">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
              {FELT_DIMS.map(dimRow)}
            </div>
            {/* LLM per-dimension reasoning — only when an `ok` LLM read is
                present. Shows the top-4 most-loaded dims (score >= 30, sorted
                desc) with the LLM's terse rationale for each. */}
            {llm && (() => {
              const loaded = FELT_DIMS
                .filter((d) => (llm.dims[d] ?? 0) >= 30)
                .sort((a, b) => (llm.dims[b] ?? 0) - (llm.dims[a] ?? 0))
                .slice(0, 4);
              if (loaded.length === 0) return null;
              return (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 4 }}>
                    {firstName}'s reasoning
                  </div>
                  {loaded.map((d) => (
                    <div key={d} style={{
                      fontFamily: "var(--font-mono)", fontSize: 10.5,
                      color: "var(--ink-2)", lineHeight: 1.5, margin: "3px 0",
                    }}>
                      <b style={{ color: "var(--ink-1)", textTransform: "uppercase" }}>{d}</b> — {llm.reasons[d] || "—"}
                    </div>
                  ))}
                </div>
              );
            })()}
            {prevAccumulatedState && (
              <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Δ since previous simulation ·
                <span style={{ marginLeft: 6, color: "var(--ink-2)" }}>
                  Th {(accumulatedState.thermal_discomfort - prevAccumulatedState.thermal_discomfort).toFixed(2)} ·
                  Vi {(accumulatedState.visual_strain - prevAccumulatedState.visual_strain).toFixed(2)} ·
                  No {(accumulatedState.noise_stress - prevAccumulatedState.noise_stress).toFixed(2)}
                </span>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ── 09 · OBJECTIVE ───────────────────────────── */}
      {/* Thesis-canonical "Pride #1" dimension. The role + purpose */}
      {/* halves live on agent.role / agent.purpose_at_centre (Section */}
      {/* 01 above) — they were duplicated here in an earlier iteration */}
      {/* and the dedup pass collapsed them. This section now carries */}
      {/* only the goal_progress axis. */}
      <Section num="09" title="Objective" tag="amber" badge={typeof agent.goal_progress === "number" ? `${Math.round(agent.goal_progress * 100)}%` : "—"}>
        <DataRow label="Role" value={agent.role ?? ""} placeholder="set in 01 · Agent" />
        <DataRow label="Purpose" value={agent.purpose_at_centre ?? ""} placeholder="set in 01 · Agent" />
        <div style={{ marginTop: 8 }}>
          <InlineSlider
            label="Goal progress"
            value={agent.goal_progress ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateAgent("goal_progress", v)}
            color={accentColor}
          />
        </div>
        <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.05em" }}>
          0% = just arrived · 100% = done. Drives Layer-2 narrative tone.
        </div>
      </Section>

      {/* ── 10 · TEMPORAL ───────────────────────────── */}
      {/* Thesis-canonical cumulative state across a route. Updated by */}
      {/* runRouteForAgent after each dwell. Lets Layer 2 say "I've been */}
      {/* waiting longer than expected" without citing minute counts. */}
      <Section num="10" title="Temporal" tag="red" style={{ borderBottom: "none" }}>
        <DataRow label="Total dwell" value={`${temporal.total_dwell_min} min`} />
        <div style={{ marginTop: 8 }}>
          <EnvBar
            label="Fatigue accumulated"
            value={temporal.fatigue_accumulated}
            min={0}
            max={1}
            color={temporal.fatigue_accumulated > 0.6 ? "var(--brick)" : "var(--amber)"}
          />
        </div>
        <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.05em" }}>
            Accumulates each dwell · saturates at 1.0
          </span>
          {(temporal.total_dwell_min > 0 || temporal.fatigue_accumulated > 0) && (
            <button
              type="button"
              onClick={() => onPersonaChange({ ...persona, temporal: { total_dwell_min: 0, fatigue_accumulated: 0 } })}
              style={{
                fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
                color: "var(--brick)", background: "transparent",
                border: "1px solid var(--brick)", padding: "2px 8px",
                cursor: "pointer", textTransform: "uppercase",
              }}
              title="Zero the cumulative temporal state for this persona"
            >
              Reset
            </button>
          )}
        </div>
      </Section>
    </div>
  );
}
