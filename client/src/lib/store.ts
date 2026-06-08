// ============================================================
// SentiArch Store - State Management & Computation Logic
// Multi-Agent System + Baseline Reset + Intervention Feedback Loop
// ============================================================
import defaultLayoutData from "./defaultLayout.json";
import lightRailPlatformBeforeData from "./presets/light-rail-platform-before.json";
import polygonClipping from "polygon-clipping";

// ---- Types ----

// ---- Anxiety (ASI-3) Types & Helpers ----
// The Anxiety Sensitivity Index (ASI-3) is an 18-item self-report scale; each
// item is scored 0–4, giving a total range of 0–72. Clinical cut-offs (Taylor
// et al., 2007) divide scores into three bands:
//   • 0–16  → normal       (no sensitivity modulation; all modifiers = 1.0)
//   • 17–23 → moderate     (perceptual thresholds tightened modestly)
//   • 24–72 → severe       (perceptual thresholds tightened strongly)
//
// Each level maps to five behavioural modifiers that SentiArch uses to scale
// environmental perception downstream:
//   • noise_sensitivity     — multiplies perceived_dB
//   • thermal_comfort_range — divisor that narrows the agent's acceptable PMV
//                             envelope (anxiety_pmv_range = 1 / this)
//   • exit_proximity_need   — multiplies dist_to_exit into a personal-space
//                             requirement
//   • social_threshold      — reserved for future crowd / social-overload use
//   • fatigue_accumulation  — reserved for future fatigue carry-over use
export type AnxietyLevel = "normal" | "mild" | "moderate" | "severe";

export interface AnxietyModifiers {
  noise_sensitivity: number;
  thermal_comfort_range: number;
  personal_space_radius: number;
  enclosure_sensitivity: number;
  exit_proximity_need: number;
}

export interface AnxietyData {
  asi_score: number;          // integer 0–72
  asi_level: AnxietyLevel;    // auto-derived from asi_score
  modifiers: AnxietyModifiers; // auto-assigned from asi_level
  /** Optional clinical subtype tag (e.g. "GAD", "Panic_Agoraphobic"). */
  subtype_label?: string;
  /** Optional free-text clinical description. */
  clinical_note?: string;
}

/** Derive ASI level band from raw ASI-3 score (0–72). */
export function deriveAnxietyLevel(asiScore: number): AnxietyLevel {
  const s = Math.max(0, Math.min(72, Math.round(asiScore)));
  if (s <= 16) return "normal";
  if (s <= 23) return "mild";
  if (s <= 48) return "moderate";
  return "severe";
}

/** Canonical modifier table. Normal = identity; higher bands tighten thresholds. */
export const ANXIETY_MODIFIERS_BY_LEVEL: Record<AnxietyLevel, AnxietyModifiers> = {
  normal: {
    noise_sensitivity: 1.0,
    thermal_comfort_range: 1.0,
    personal_space_radius: 1.0,
    enclosure_sensitivity: 1.0,
    exit_proximity_need: 1.0,
  },
  mild: {
    noise_sensitivity: 1.2,
    thermal_comfort_range: 1.3,
    personal_space_radius: 1.05,
    enclosure_sensitivity: 1.2,
    exit_proximity_need: 1.2,
  },
  moderate: {
    noise_sensitivity: 1.4,
    thermal_comfort_range: 1.6,
    personal_space_radius: 1.09,
    enclosure_sensitivity: 1.5,
    exit_proximity_need: 1.5,
  },
  severe: {
    noise_sensitivity: 1.6,
    thermal_comfort_range: 1.9,
    personal_space_radius: 1.15,
    enclosure_sensitivity: 1.8,
    exit_proximity_need: 1.9,
  },
};

/**
 * Build a full AnxietyData block from a raw ASI score.
 * Level and modifiers are always recomputed from score — they are never edited
 * directly by the user.
 */
export function buildAnxietyData(asiScore: number): AnxietyData {
  const clamped = Math.max(0, Math.min(72, Math.round(asiScore)));
  const level = deriveAnxietyLevel(clamped);
  return {
    asi_score: clamped,
    asi_level: level,
    modifiers: { ...ANXIETY_MODIFIERS_BY_LEVEL[level] },
  };
}

/** Default anxiety block used when loading older saved data without one. */
export const defaultAnxiety: AnxietyData = buildAnxietyData(0);

// ============================================================
// ---- Role categorisation -----------------------------------
// ============================================================
// Free-text `agent.role` is bucketed into staff / patient / companion
// for two purposes:
//   1. The LLM prompt branches its behavioural framing on the bucket
//      (staff are working, patients are waiting, companions attend).
//   2. Post-processing clamps accState (e.g. staff wayfinding_anxiety
//      ≤ 0.1) so role-incoherent values from the LLM are corrected.

export type RoleCategory = "staff" | "patient" | "companion" | "unspecified";

const STAFF_PATTERNS = /(nurse|doctor|physician|surgeon|pharmacist|technician|orderly|receptionist|cashier|admin|clinician|therapist|janitor|cleaner|security|guard|usher|teacher|conductor|dispatcher|barista|cashier|paramedic|midwife)/;
const COMPANION_PATTERNS = /(companion|caregiver|carer|escort|parent|guardian|relative|family|chaperone|friend with|attendant)/;

/**
 * Bucket a free-text role into a coarse category. Defaults to "patient"
 * when the role is set but doesn't match staff / companion patterns —
 * because most non-working visitors to a venue are clients of some kind
 * (patient / customer / passenger). "unspecified" only when role is empty.
 */
export function categoriseRole(role: string | undefined): RoleCategory {
  if (!role || !role.trim()) return "unspecified";
  const r = role.toLowerCase();
  if (STAFF_PATTERNS.test(r)) return "staff";
  if (COMPANION_PATTERNS.test(r)) return "companion";
  return "patient";
}

/**
 * Apply role-coherent ceilings to an accumulated state. The LLM tends
 * to over-attribute environmental anxieties (wayfinding, social overload)
 * to staff who actually know the space; this pass corrects that.
 *
 * - Staff: wayfinding_anxiety capped at 0.1; social_overload damped 30%.
 * - Companion: leaves accState alone — narrative carries the framing,
 *              and we don't have the companioned-agent's state to mix in.
 * - Patient / unspecified: untouched.
 */
export function applyRoleAccStateConstraints(
  acc: AccumulatedState, role: string | undefined,
): AccumulatedState {
  const cat = categoriseRole(role);
  if (cat === "staff") {
    return {
      ...acc,
      wayfinding_anxiety: Math.min(acc.wayfinding_anxiety, 0.1),
      social_overload: Math.round(acc.social_overload * 0.7 * 100) / 100,
    };
  }
  return acc;
}

/**
 * Explicit relationship between this agent and another agent in the
 * scenario. Used by the situated-cognition prompt so the LLM can
 * resolve "people I know in this building today" without it being
 * implied by narrative cues.
 *
 *  - `with`: target agent's id (must match another agent's id).
 *  - `type`: free-text relation kind. Examples:
 *      "is_seeing_today_at:10:30"   (client → clinician appointment)
 *      "is_accompanying"            (companion → patient)
 *      "is_facilitator_of"          (staff → group)
 *      "is_colleague_of"            (staff ↔ staff)
 */
export interface AgentRelationship {
  with: string;
  type: string;
}

export interface AgentData {
  id: string;
  age: number;
  gender: "male" | "female";
  mbti: string;
  mobility: "normal" | "walker" | "wheelchair" | "cane";
  hearing: "normal" | "impaired" | "deaf";
  vision: "normal" | "mild_impairment" | "severe_impairment";
  metabolic_rate: number;
  clothing_insulation: number;
  anxiety: AnxietyData;
  /**
   * Free-text role / identity for this agent within the current scenario
   * (e.g. "doctor", "nurse", "patient", "visitor", "commuter", "tourist").
   * Threaded into the LLM prompt so behaviour and inner monologue reflect
   * the role's expectations, not just demographics. Optional.
   */
  role?: string;
  /**
   * Short human name (e.g. "Mei Lin", "Madam Wong"). Gives the agent an
   * identity anchor in the LLM narrative; lets activities reference each
   * other by name. Optional — agents without a name still work.
   */
  name?: string;
  /**
   * Why this agent is in the building today. ONE sentence — a static
   * intent, not a moment-by-moment description.
   *   "appointment with Dr Chan to discuss recent blood test results"
   *   "running a 10am support circle"
   *   "accompanying my mother for her grief session"
   *
   * The LLM does NOT receive a pre-baked "what you are doing right now".
   * It infers the current activity at perception time from the
   * intersection of (this purpose, the zone the agent is in, the other
   * agents co-located with them).
   */
  purpose_at_centre?: string;
  /**
   * Explicit list of other agents this person knows in the scenario,
   * with the kind of relation. Surfaced in the LLM prompt as "people you
   * know in this building today" — separately from who is currently
   * visible — so the prompt can express "I'm here to see X" even when X
   * is not yet present, and "who is/isn't with me right now" emerges
   * from the sensing layer rather than being scripted.
   */
  relationships?: AgentRelationship[];
  /**
   * Thesis "Objective" axis — 0..1 progress through the agent's stated
   * `purpose_at_centre`. 0 = just arrived; 1 = done. Drives Layer 2
   * narrative tone: an agent at goal_progress=0 notices the room, an
   * agent near 1 notices the path out.
   *
   * Lives on AgentData (not a separate ObjectiveData block) because
   * `role` and `purpose_at_centre` already carry the role + purpose
   * halves of the slide-15 schema — splitting them again was a
   * duplicated editor surface with no semantic gain.
   */
  goal_progress?: number;
  /**
   * Waypoint-trajectory mode. When true AND the agent has ≥1 waypoint, the
   * agent is simulated as a moving visitor: one independent perception
   * snapshot per waypoint, with a bounded bidirectional carry-over of
   * affective state between waypoints (see `blendCarriedState`). When
   * false/undefined the agent keeps the existing stationary / route
   * behaviour byte-for-byte. Explicit flag (not derived from waypoint
   * fields) so dispatch is unambiguous and old scenarios stay unchanged.
   */
  trajectory_mode?: boolean;
}

export interface PositionData {
  cell: [number, number];
  timestamp: string;
  duration_in_cell: number;
}

export interface EnvironmentData {
  lux: number;
  dB: number;
  air_temp: number;
  humidity: number;
  air_velocity: number;
  /** Mean radiant temperature at the agent's position in °C. Already
   *  blended with window-proximity adjustment when applicable. Defaults
   *  to `air_temp` when the zone defines no MRT and no outdoor delta. */
  mrt?: number;
  /** Outdoor air temp °C — passed through from the zone for downstream
   *  reasoning (e.g. seasonal narrative cues, thermal asymmetry
   *  diagnostics). Undefined when the zone has not declared one. */
  outdoor_air_temp?: number;
  /** True when the agent's zone is open-sky / outdoor (no overhead roof —
   *  courtyard, atrium, void). Threaded from `ZoneEnv.open_space` via
   *  `zoneEnvToEnvironment` so the perception engine can treat outdoor
   *  space correctly (no indoor glare model, no windowless penalties,
   *  full view-out recovery). Undefined/false → indoor (unchanged). */
  open_space?: boolean;
}

export interface SpatialData {
  /** Metres to nearest wall/column. Always >= 0 (a wall is always derived). */
  dist_to_wall: number;
  /** Metres to nearest LOS-visible window. Sentinel `-1` = no window present. */
  dist_to_window: number;
  /** Metres to nearest LOS-visible door / exit. Sentinel `-1` = no exit detected. */
  dist_to_exit: number;
  /** Ceiling clearance in metres, sourced from the agent's current zone.
   *  Sentinel `-1` = agent is not inside any zone (display as N/A). */
  ceiling_h: number;
  /** 0 (open) … 1 (fully enclosed) — share of agent's surroundings blocked by walls. */
  enclosure_ratio: number;
  /** Count of other agents with line of sight to this one. */
  visible_agents: number;
  /**
   * Green View Index (GVI), 0..1: share of the agent's horizon (LOS rays in
   * a 360° scan) that lands on a `green` shape before hitting any LOS-blocker.
   * 1.0 if the agent stands inside a green polygon.
   * Used by computeOutputs (perceived temp cooling) and computePerceptualLoad
   * (stress recovery curve), and by green-visibility rules.
   *
   * Calibration follows Li et al. 2024 (Comm. Earth & Env., 182-study
   * meta-analysis, trees lower pedestrian temp up to 12°C, ~30% canopy ≈
   * 1.5°C cooling), Jing et al. 2024 (Buildings 14(10):3316, RCT n=24:
   * WGVI 25% optimal with plateau), Song et al. 2022 (PMC9658851 meta:
   * fatigue d=−0.84, vitality d=+0.85, HR d=−0.60), Pun et al. 2018
   * (PMC5902952, longitudinal n=4118), Zhang et al. 2024 (Front. Pub.
   * Health, Shanghai SVI: GS coefficient = −2.814 on stress).
   */
  green_visibility?: number;
}

/**
 * Convert a sentinel-encoded distance (`-1` = "feature absent") to a
 * `number | null` form suitable for JSON export. Undefined/NaN map to null.
 */
export function distanceForExport(d: number | undefined | null): number | null {
  if (d === undefined || d === null || Number.isNaN(d) || d < 0) return null;
  return d;
}

export interface PersonaData {
  agent: AgentData;
  position: PositionData;
  environment: EnvironmentData;
  spatial: SpatialData;
  /**
   * Thesis "Temporal" dimension — cumulative, route-spanning state
   * (`position.duration_in_cell` captures only the leg-level budget).
   * Used by Layer 2 (so dwell narration can reference fatigue carried
   * in from earlier legs) and rendered in PersonaMindMap. Updated
   * incrementally by `runRouteForAgent` after each dwell. Optional for
   * backward compatibility — `hydratePersonaDefaults` backfills zeros.
   */
  temporal?: TemporalData;
}

/**
 * Thesis "Temporal" dimension — cumulative state across a route.
 *   total_dwell_min       cumulative dwell minutes across all completed
 *                         legs of the current route. Reset to 0 at
 *                         route start; accumulates on each dwell.
 *   fatigue_accumulated   0..1 monotonic non-decreasing accumulator.
 *                         Approximate model: each dwell minute adds
 *                         0.02 × (0.5 + currentLoad) where currentLoad
 *                         is the average of fatigue / thermal / noise
 *                         from the per-leg AccumulatedState. Saturates
 *                         at 1.0.
 */
export interface TemporalData {
  total_dwell_min: number;
  fatigue_accumulated: number;
}

export const defaultTemporal: TemporalData = {
  total_dwell_min: 0,
  fatigue_accumulated: 0,
};

/**
 * Backfill optional schema blocks on a freshly-loaded persona so the rest
 * of the app can read `persona.temporal` without guarding against
 * undefined. Called by all three persona load paths (loadMultiAgent,
 * loadPersonas, parseImportedPersonas). Idempotent — if the blocks are
 * already present, they pass through untouched.
 *
 * Also accepts legacy persona JSON that carried a `persona.objective.*`
 * block (an earlier iteration of this branch): the `goal_progress`
 * value is migrated forward onto `agent.goal_progress` and the
 * `objective` block is dropped. `role` and `purpose` were already
 * mirrored on `agent.role` / `agent.purpose_at_centre`, so nothing is
 * lost in the migration.
 */
export function hydratePersonaDefaults(p: PersonaData): PersonaData {
  let agent = p.agent;
  // Migrate the entire legacy `persona.objective` block forward.
  // - objective.role           → agent.role (only if agent.role empty)
  // - objective.purpose        → agent.purpose_at_centre (only if empty)
  // - objective.goal_progress  → agent.goal_progress (only if undefined)
  // Then strip the block from the returned object.
  const legacyObj = (p as unknown as {
    objective?: { role?: string; purpose?: string; goal_progress?: number };
  }).objective;
  if (legacyObj) {
    const patch: Partial<AgentData> = {};
    if (typeof legacyObj.role === "string" && legacyObj.role.trim() && !agent.role) {
      patch.role = legacyObj.role.trim();
    }
    if (typeof legacyObj.purpose === "string" && legacyObj.purpose.trim() && !agent.purpose_at_centre) {
      patch.purpose_at_centre = legacyObj.purpose.trim();
    }
    if (typeof legacyObj.goal_progress === "number" && Number.isFinite(legacyObj.goal_progress) && agent.goal_progress === undefined) {
      patch.goal_progress = Math.max(0, Math.min(1, legacyObj.goal_progress));
    }
    if (Object.keys(patch).length > 0) agent = { ...agent, ...patch };
  }
  // Strip the legacy block so downstream consumers see only the
  // canonical schema.
  const rest = { ...p } as PersonaData & { objective?: unknown };
  delete rest.objective;
  return {
    ...rest,
    agent,
    temporal: p.temporal ?? { ...defaultTemporal },
  };
}

export interface ExperienceData {
  summary: string;
  /**
   * Final comfort score (1-10) surfaced to UI / route summary. When the
   * LLM call succeeded this equals `experience.llm.comfort`; otherwise
   * it is the engine baseline derived from the Layer-1 accState.
   */
  comfort_score: number;
  /**
   * Layer-2 LLM assessment — 6 felt-dimension scores + per-dim reasons
   * + narration + derived comfort/stress. Present only when the LLM
   * call succeeded (status === "ok"); null for baseline / failed legs.
   */
  llm?: LLMAssessment | null;
  /**
   * Layer-1 engine accState preserved on the experience block too, so
   * UI consumers (mini-cards, exports) can render the baseline without
   * having to climb to the PerceptionLogEntry above. Mirrors
   * `PerceptionLogEntry.accState_engine`.
   */
  accState_llm?: AccumulatedState;
  trend: "rising" | "declining" | "stable";
  /** Deterministic explainer: which dimensions of accumulated_state are
   *  pulling comfort down at this leg, and the underlying sensor cause
   *  for each. Computed from accState / computed / env / spatial via
   *  `deriveComfortDrivers`; populated at export and (optionally) at
   *  state-update time. Sorted highest level first. Empty when
   *  accumulated_state is uniformly low (= comfort_score is high). */
  comfort_drivers?: ComfortDriver[];
  /** LAYER 3 · "THE CRITIQUE" — LLM-generated design observations.
   *
   *  These are NON-research-grounded hypotheses about non-obvious
   *  configuration-specific design issues that the deterministic
   *  perceptual_load model would miss (e.g. gaze-axis awkwardness in
   *  a circular seating layout, activity-type asymmetry, role-specific
   *  privacy concern). Each carries an explicit epistemic_tag flagging
   *  it as a hypothesis requiring empirical verification.
   *
   *  Distinct from `comfort_drivers` (deterministic, cite-able). The
   *  two-layer architecture follows the Post-Occupancy Evaluation
   *  framework (Preiser, Rabinowitz & White 1988) and mixed-methods
   *  research convention (Creswell 2014) — quantitative findings
   *  alongside qualitative observations, kept epistemically separate.
   *
   *  Empty array (or absent) when the LLM either (a) found nothing
   *  non-obvious worth surfacing, or (b) was not invoked.
   */
  llm_observations?: LLMObservation[];
  /** Status of the LLM call that produced this experience entry.
   *  Lets the UI distinguish four legitimately different states for
   *  the Layer-2 block:
   *    - "ok"       → call succeeded; `experience.llm` carries the
   *                   6-dim assessment + reasons + narration.
   *    - "failed"   → call did not complete (HTTP error, timeout,
   *                   parse error). UI falls back to the Layer-1
   *                   engine baseline.
   *    - "baseline" → intentional skip (non-terminal leg of a route
   *                   under terminal-only LLM policy). NOT a failure.
   *    - "skipped"  → no LLM was configured / called. Default state.
   *  Without this tag, Layer-2 silently disappearing during multi-leg
   *  sims (when LLM intermittently fails) is indistinguishable from
   *  "all good, nothing to flag" — confusing for the user.
   */
  llm_call_status?: "ok" | "failed" | "baseline" | "skipped";
}

/**
 * One LLM-generated design observation. NOT a research finding —
 * always tagged as a hypothesis requiring verification, never
 * cite-able as fact in a thesis. Surfaced separately from
 * deterministic comfort_drivers so the epistemic difference is
 * always visible in UI / export.
 */
export interface LLMObservation {
  /** What the LLM noticed about THIS specific configuration that
   *  the deterministic model would not capture. Single short
   *  sentence. */
  observation: string;
  /** Why this might matter — a proposed mechanism, optionally
   *  referencing a literature direction (e.g. "Goffman 1959 frame
   *  analysis", "Ulrich 1991 supportive design"). NOT a citation —
   *  a pointer for further reading. */
  proposed_mechanism: string;
  /** What study, measurement, or post-occupancy method could
   *  confirm or refute this observation. Forces falsifiability. */
  verification: string;
  /** Always "LLM-derived hypothesis"; auto-set by the engine, not
   *  the LLM, so it cannot be cite-laundered into "research". */
  epistemic_tag: "LLM-derived hypothesis";
}

export interface AccumulatedState {
  thermal_discomfort: number;
  visual_strain: number;
  noise_stress: number;
  social_overload: number;
  fatigue: number;
  wayfinding_anxiety: number;
}

// ============================================================
// ---- Layer 2 · LLM assessment (felt-dimension scoring) -----
// ============================================================
// Thesis methodology v2: the engine is pure Layer-1 physics + geometry;
// the LLM becomes the character and produces 6 felt-dimension scores
// (0-100) + per-dimension reasoning + a first-person narration in one
// structured JSON response. comfort/stress are derived deterministically
// from the LLM's dim scores via `feltComfort` (same weighting as the
// engine's computeStressScore — only WHO produced the 6 inputs changes).

export type FeltDim = "thermal" | "visual" | "noise" | "social" | "temporal" | "wayfinding";
export const FELT_DIMS: FeltDim[] = ["thermal", "visual", "noise", "social", "temporal", "wayfinding"];
export const ENGINE_DIM_KEY: Record<FeltDim, keyof AccumulatedState> = {
  thermal: "thermal_discomfort",
  visual: "visual_strain",
  noise: "noise_stress",
  social: "social_overload",
  temporal: "fatigue",
  wayfinding: "wayfinding_anxiety",
};
export const DIM_WEIGHT: Record<FeltDim, number> = {
  thermal: 0.20,
  visual: 0.15,
  noise: 0.20,
  social: 0.15,
  temporal: 0.15,
  wayfinding: 0.15,
};

export interface LLMAssessment {
  /** Per-dim score 0..100 — the LLM's felt reading of each pressure. */
  dims: Record<FeltDim, number>;
  /** Per-dim terse rationale (<=14 words) tying the score to body + facts. */
  reasons: Record<FeltDim, string>;
  /** 2-4 sentence first-person narration. */
  narration: string;
  /** Comfort 1-10, derived from `dims` via `feltComfort`. */
  comfort: number;
  /** Stress 0-10, derived from `dims` via `feltComfort`. */
  stress: number;
  /** Layer 3 · "The Critique" — 0-3 non-obvious design observations
   *  surfaced by the same call. Falsifiable hypotheses only; empty
   *  array when nothing non-obvious applies. */
  observations: LLMObservation[];
}

/** A single dimension of accumulated_state flagged as a comfort driver,
 *  with the sensor reading that explains it. */
export interface ComfortDriver {
  /** Which accumulated_state dimension this is. */
  factor: keyof AccumulatedState;
  /** 0..1 — how strongly this dimension is loaded. */
  level: number;
  /** Plain-English explanation of the underlying sensor cause. */
  cause: string;
}

export interface ComputedOutputs {
  PMV: number;
  PPD: number;
  effective_lux: number;
  perceived_dB: number;
  pmv_warnings: string[];
  // ---- Anxiety-adjusted derived values ----
  /** perceived_dB × anxiety.modifiers.noise_sensitivity (with greenery damping if applicable) */
  anxiety_perceived_dB: number;
  /** 1 / anxiety.modifiers.thermal_comfort_range — narrower value means the
   *  agent tolerates a smaller PMV envelope before registering discomfort. */
  anxiety_pmv_range: number;
  /** spatial.dist_to_exit × anxiety.modifiers.exit_proximity_need, in metres.
   *  Interpreted as the effective personal-space distance an anxious agent
   *  wants to maintain from the nearest exit. Returns -1 when dist_to_exit
   *  is -1 (no exit detected). */
  anxiety_personal_space: number;
  /** Air temperature actually felt by the agent (°C), after greenery cooling
   *  is applied. Drives PMV downstream. Equals env.air_temp when GVI=0. */
  perceived_air_temp: number;
  /** Effective mean radiant temperature at the agent's position (°C),
   *  after greenery cooling AND window-proximity blending. Used as
   *  the `tr` input to PMV — independent from `perceived_air_temp`
   *  per ISO 7730 / ASHRAE 55. When the zone defines no MRT and no
   *  outdoor delta, equals `perceived_air_temp` (radiant-symmetric room). */
  effective_mrt: number;
  /** Signed difference (effective_mrt − perceived_air_temp) in °C. Negative
   *  near cold windows / poorly-insulated envelope; positive under solar
   *  gain or radiant heating. Surfaces the radiant asymmetry channel
   *  to the UI / prompt without forcing them to subtract. */
  mrt_delta: number;
  /** Greenery stress-recovery factor used in this computation, exposed for
   *  prompts and rules (0..0.85, peaks around GVI=0.25 per Jing 2024). */
  green_recovery: number;
  /** Heat-loss partition in W/m² body surface area — Convection /
   *  Radiation / Evaporation / Respiration plus net metabolic input.
   *  Mirrors thermBAL's display so designers can see WHICH channel
   *  drives discomfort (e.g. high radiation term near a cold window
   *  even when air temp is fine). Per ISO 7730 partition. */
  heat_loss: HeatLossPartition;
}

export type ShapeType = "site" | "wall" | "column" | "door" | "window" | "green" | "special";

export interface ShapeMeta {
  /** Wall / Door fixed thickness in mm. Walls allow 100 or 300. Doors fixed at 100. */
  thickness?: 100 | 300;
  /** Column dimensions in mm — width along X, depth along Y. */
  width?: number;
  depth?: number;
  /** Site option: when true, the site polygon perimeter also acts as walls
   *  (blocks LOS + agent movement). When false, the site is a containment
   *  region only — defines drawable / walkable area without blocking. */
  hasWalls?: boolean;
  /** Wall / Door centerline endpoints (the two points the user clicked).
   *  The 4 polygon corners in `points` are derived from this + thickness.
   *  Stored separately so the wall can be re-snapped or edited later. */
  centerline?: [[number, number], [number, number]];
  /** Wall / Door thickness side relative to the centerline. Persisted so
   *  endpoint resize can rebuild the rectangle on the same side as
   *  originally chosen. */
  side?: "left" | "right";
}

export interface Shape {
  type: ShapeType;
  /** Geometry vertices in world coords (mm).
   *  - site: polygon (3+ pts)
   *  - wall / column / door: 4 rectangle corners in CCW or CW order
   *  - window: 2 endpoints (line segment) */
  points: [number, number][];
  label?: string;
  meta?: ShapeMeta;
}

/** Returns true if the shape blocks line-of-sight (wall, column, walled
 *  site). Doors and windows do NOT block LOS — they are openings cut
 *  into a wall. Bare sites (without hasWalls) also do not block. */
export function blocksLineOfSight(s: Shape): boolean {
  if (s.type === "wall" || s.type === "column") return true;
  if (s.type === "site" && s.meta?.hasWalls) return true;
  return false;
}

/**
 * Build a 4-corner thick rectangle from a 2-point centerline (clockwise
 * or counter-clockwise — order is consistent within itself for both
 * sides). `side` controls which side of the centerline gets the thickness.
 * Centerline endpoints become rect points 0 and 1; the offset corners
 * become 2 and 3.
 *
 * Used by walls, doors, and windows so all three render and behave
 * uniformly — every opening is a "block" with its own footprint.
 */
export function buildThickRect(
  ax: number, ay: number, bx: number, by: number, thickness: number,
  side: "left" | "right" = "left",
): [number, number][] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    const t = thickness / 2;
    return [
      [ax - t, ay - t], [ax + t, ay - t], [ax + t, ay + t], [ax - t, ay + t],
    ];
  }
  const sign = side === "left" ? 1 : -1;
  const nx = -dy / len * sign;
  const ny = dx / len * sign;
  const t = thickness;
  return [
    [Math.round(ax), Math.round(ay)],
    [Math.round(bx), Math.round(by)],
    [Math.round(bx + nx * t), Math.round(by + ny * t)],
    [Math.round(ax + nx * t), Math.round(ay + ny * t)],
  ];
}

/** Returns true if the shape blocks agent movement (cannot cross / enter).
 *  Walls, columns, windows block. Doors do NOT block (agents pass through).
 *  Sites only block at perimeter when hasWalls=true (handled separately). */
export function blocksMovement(s: Shape): boolean {
  return s.type === "wall" || s.type === "column" || s.type === "window";
}

// ---- Geometry Helpers (used by zone env + spatial calculations) ----
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
}

function lineIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const dxAB = bx - ax, dyAB = by - ay;
  const dxCD = dx - cx, dyCD = dy - cy;
  const denom = dxAB * dyCD - dyAB * dxCD;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
  const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Compute the centroid (average of all points) of a shape.
 * Used as the LOS target point for windows and doors.
 */
function shapeCentroid(pts: [number, number][]): [number, number] {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  return [sx / pts.length, sy / pts.length];
}

/**
 * Line-of-sight check: returns true if no LOS-blocking shape segment
 * intersects the line from (ax,ay) to (bx,by).
 *   - Walls / columns / walled-site edges block LOS by default.
 *   - Doors and windows are openings: any wall edge intersection that
 *     lies INSIDE a door or window polygon is considered a hole and
 *     does NOT block (so a wall is "cut" by every opening on top of it).
 */
export function hasLineOfSight(
  ax: number, ay: number, bx: number, by: number, shapes: Shape[]
): boolean {
  const blockers = shapes.filter(blocksLineOfSight);
  if (blockers.length === 0) return true;
  // Only WINDOWS act as line-of-sight cutouts. Doors are treated as
  // closed by default — they allow agent MOVEMENT (blocksMovement=false)
  // but block LOS just like the wall they sit on. Architecturally:
  //   - want visual continuity between rooms? add a window
  //   - want passage but no view-through? add a door (default)
  //   - want both passage AND view-through? add a door AND a window
  // Previously doors ALSO cut LOS, which caused agents in interior
  // rooms (e.g. windowless group therapy spaces) to "see" distant
  // windows in other rooms via chains of doorways — directly
  // suppressing the windowless-room comfort penalty.
  const losOpenings = shapes.filter((s) =>
    s.type === "window" && s.points.length >= 3,
  );

  const EPS = 1e-4;
  for (const blocker of blockers) {
    const pts = blocker.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      // For window-style 2-point shapes (currently never blockers, but defensive)
      // and lines, skip the closing edge.
      if (pts.length === 2 && i === 1) break;
      const dxAB = bx - ax, dyAB = by - ay;
      const dxCD = pts[j][0] - pts[i][0], dyCD = pts[j][1] - pts[i][1];
      const denom = dxAB * dyCD - dyAB * dxCD;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((pts[i][0] - ax) * dyCD - (pts[i][1] - ay) * dxCD) / denom;
      const u = ((pts[i][0] - ax) * dyAB - (pts[i][1] - ay) * dxAB) / denom;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
        // Crossing inside a door / window footprint = wall section is cut
        // through here, so this intersection does NOT block.
        //
        // Edge-tolerant containment: when a window is drawn with its
        // centerline ON the wall surface (side="left"/"right"), one
        // edge of the window polygon coincides exactly with the wall
        // surface. A strict ray-cast point-in-polygon test rejects
        // points lying on that boundary, falsely treating the wall as
        // opaque. Using `isPointInBoundaryOrOnEdge` (default 5 mm
        // tolerance, bumped to 50 mm here for typical drawing
        // imprecision) lets boundary-coincident windows act as the
        // cutouts they visually are.
        const ix = ax + t * dxAB;
        const iy = ay + t * dyAB;
        const insideOpening = losOpenings.some((op) => isPointInBoundaryOrOnEdge(ix, iy, op.points, OPENING_EDGE_TOLERANCE_MM));
        if (insideOpening) continue;
        return false;
      }
    }
  }
  return true;
}

/**
 * Tolerance (mm) used when checking whether a wall-edge ray
 * intersection falls "inside" a door / window polygon for the cutout
 * rule in `hasLineOfSight` / `nearestBlockerTWithOpenings`. 50 mm
 * comfortably absorbs the on-boundary case (wall and window sharing a
 * centerline) plus minor drawing imprecision, without leaking the
 * cutout into adjacent wall segments at typical 100 mm thickness.
 */
const OPENING_EDGE_TOLERANCE_MM = 50;

// ---- Zone Environment Data ----
export interface ZoneBounds {
  x: number;      // top-left x in world coords (mm)
  y: number;      // top-left y in world coords (mm)
  width: number;  // width in world coords (mm)
  height: number; // height in world coords (mm)
  points?: [number, number][]; // Optional points for polygon zones
}

export interface ZoneEnv {
  temperature: number;   // °C — air temperature (Ta input to PMV)
  humidity: number;      // %
  light: number;         // lux
  noise: number;         // dB
  air_velocity: number;  // m/s
  ceiling_height: number; // mm — overhead clearance (mm to keep units consistent
                          //       with shape coords; convert to metres at the agent
                          //       perception boundary).
  open_space: boolean;    // true → no overhead roof (outdoor / atrium / void).
                          //       When true, ceiling_height is informational only
                          //       (agents perceive an open sky).
  /**
   * Mean radiant temperature in °C — independent PMV input per ISO 7730
   * / ASHRAE 55. When undefined, MRT is assumed equal to `temperature`
   * (perfectly insulated room with no asymmetric radiating surfaces).
   *
   * Designer levers:
   *   - Lower MRT below air temp to model cold envelope (single-glazed,
   *     uninsulated wall, north-facing in winter).
   *   - Raise MRT above air temp to model solar gain on dark surfaces
   *     or radiant heating panels.
   *
   * Architectural rule of thumb: a single-glazed window in a 24°C room
   * with -5°C outdoor produces an inner surface ≈ 9-12°C; well-insulated
   * triple-glazing keeps surface near 21-22°C. Designer should set
   * `mrt` to reflect the zone-average radiant temperature.
   *
   * For automatic per-position window-proximity MRT depression, set
   * `outdoor_air_temp` instead — the engine will then blend MRT toward
   * the window inner surface temp at agent positions within ~3 m of a
   * line-of-sight visible window.
   */
  mrt?: number;
  /**
   * Outdoor air temperature in °C — enables automatic window-proximity
   * MRT computation. When set:
   *   1. Engine estimates window inner surface temp from indoor /
   *      outdoor delta (single-glazed-equivalent: surface ≈ midpoint).
   *   2. Agents within 3 m line-of-sight of any window get an MRT shift
   *      toward that surface temp, weighted by proximity and view factor.
   *   3. Far-from-window agents read the zone's `mrt` (or `temperature`)
   *      unmodified.
   *
   * Leave undefined (or set equal to `temperature`) to disable —
   * appropriate for well-insulated zones or when window-proximity
   * effects are not the focus.
   */
  outdoor_air_temp?: number;
}

export interface Zone {
  id: string;
  label?: string;
  bounds: ZoneBounds;
  env: ZoneEnv;
  /**
   * Free-text description of the space's program / function and the
   * implied agent activity. Examples: "Light rail platform — waiting
   * for train", "Hospital waiting room", "Open-plan office desk".
   * Passed verbatim to the LLM prompt so it can frame perception
   * around the right behavioural context. Optional; absent zones are
   * described to the LLM as "Unspecified".
   */
  program?: string;
  /**
   * How far the zone's env values bleed beyond its boundary, in mm,
   * with linear falloff (full strength at the perimeter, 0 at the
   * radius). Lets a high-noise Railway zone radiate noise into a
   * neighbouring Platform zone, or a high-light "sun" zone fade to
   * shade. 0 (default) preserves the legacy hard-edge behaviour.
   */
  influence_radius_mm?: number;
}

export const defaultZoneEnv: ZoneEnv = {
  temperature: 24,
  humidity: 55,
  light: 300,
  noise: 55,
  air_velocity: 0.1,
  ceiling_height: 2800,
  open_space: false,
};

/** Check if a point (world coords) is inside a zone's bounds */
/** Standard even-odd ray-casting test on a polygon's points (in order). */
function rayCastInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInZone(px: number, py: number, z: ZoneBounds): boolean {
  if (z.points && z.points.length >= 3) {
    // First try the polygon as authored.
    if (rayCastInPolygon(px, py, z.points)) return true;
    // Fallback for bowtie / out-of-order point arrays (a frequent
    // export-import artefact): sort the same vertices by angle around
    // their centroid — that recovers the convex outline for any
    // 3- or 4-point quadrilateral and tests cleanly with ray-casting.
    let cx = 0, cy = 0;
    for (const p of z.points) { cx += p[0]; cy += p[1]; }
    cx /= z.points.length;
    cy /= z.points.length;
    const sorted = [...z.points].sort(
      (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
    );
    if (rayCastInPolygon(px, py, sorted)) return true;
    return false;
  }
  // No polygon → use the rectangle bounds.
  return px >= z.x && px <= z.x + z.width && py >= z.y && py <= z.y + z.height;
}

/**
 * Convert any ZoneBounds into a 4-point rectangle polygon when no explicit
 * polygon is set. Used as the seed shape for the cut splitters so that
 * legacy rectangle zones can also be cut by an arbitrary path.
 */
function zonePolygon(b: ZoneBounds): [number, number][] {
  if (b.points && b.points.length >= 3) return b.points.map((p) => [p[0], p[1]] as [number, number]);
  return [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ];
}

/** Axis-aligned bounding box of a polygon. */
function polygonAABB(pts: [number, number][]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---- Polygon cutting (powered by polygon-clipping) ----
//
// All zone-cut paths route through polygon-clipping to keep behaviour
// uniform across rectangle zones, manually-drawn polygon zones, and
// auto-zones whose polygons come from contour tracing — the latter are
// non-convex by construction (they wrap around walls and columns) and
// the previous hand-rolled Sutherland–Hodgman / chord-walk algorithms
// failed on them at numerical edge cases (vertices ON the cut line at
// cell boundaries, edges parallel to the cut). polygon-clipping handles
// all of those robustly via the Martinez–Rueda algorithm.
//
// Coordinate convention: polygons are arrays of [x, y] vertices in mm.
// polygon-clipping expects rings to be closed (first === last) and
// nested as Polygon = Ring[] where Ring[0] is the outer boundary.

type Pair = [number, number];
type Ring = Pair[];
type PCPolygon = Ring[];

/** Convert an open polygon vertex list to a polygon-clipping Polygon. */
function toPCPolygon(pts: Pair[]): PCPolygon {
  if (pts.length < 3) return [];
  const closed: Ring = pts.map((p) => [p[0], p[1]] as Pair);
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (last[0] !== first[0] || last[1] !== first[1]) closed.push([first[0], first[1]]);
  return [closed];
}

/** Convert a polygon-clipping ring back to an open vertex list. */
function fromPCRing(ring: Ring): Pair[] {
  const out: Pair[] = [];
  for (const p of ring) out.push([p[0], p[1]]);
  if (out.length >= 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  }
  return out;
}

/**
 * Build a huge axis-aligned rectangle covering one half-plane of the
 * directed line p1→p2. `side = "left"` returns the half where the cross
 * product (q − p1) × (p2 − p1) is positive; `"right"` is the opposite.
 * `pad` should comfortably exceed the subject polygon's extent so the
 * resulting rect fully contains the kept side after intersection.
 */
function halfPlaneRect(p1: Pair, p2: Pair, side: "left" | "right", pad: number): PCPolygon {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular unit pointing to the "left" of p1→p2 (positive cross
  // product side). For "right" we flip its sign.
  const px = -uy * (side === "left" ? 1 : -1);
  const py = ux * (side === "left" ? 1 : -1);
  // Centre of the line segment, padded along the line in both directions
  // so the rect overhangs the polygon on either end.
  const cx = (p1[0] + p2[0]) / 2;
  const cy = (p1[1] + p2[1]) / 2;
  const a: Pair = [cx - ux * pad, cy - uy * pad];
  const b: Pair = [cx + ux * pad, cy + uy * pad];
  const c: Pair = [b[0] + px * pad * 2, b[1] + py * pad * 2];
  const d: Pair = [a[0] + px * pad * 2, a[1] + py * pad * 2];
  return [[a, b, c, d, a]];
}

/** AABB diagonal — used to size half-plane rects so they fully cover the polygon. */
function aabbPad(pts: Pair[]): number {
  const bb = polygonAABB(pts);
  return Math.max(bb.width, bb.height) * 4 + 1000;
}

/**
 * Split a (possibly non-convex) simple polygon with the infinite line
 * through (p1, p2). Returns the lists of polygons that lie on the LEFT
 * and RIGHT of the directed line p1→p2 (left = positive cross product).
 * Concave polygons can yield more than one piece per side (e.g. cutting
 * a U-shape horizontally produces 2 pieces on the side that goes through
 * both legs).
 */
export function splitPolygonByLine(
  poly: Pair[],
  p1: Pair,
  p2: Pair,
): { left: Pair[][]; right: Pair[][] } {
  if (poly.length < 3) return { left: [], right: [] };
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  if (dx * dx + dy * dy < 1e-12) {
    return { left: [poly.map((p) => [p[0], p[1]] as Pair)], right: [] };
  }
  const subject = toPCPolygon(poly);
  const pad = aabbPad(poly);
  const leftClip = halfPlaneRect(p1, p2, "left", pad);
  const rightClip = halfPlaneRect(p1, p2, "right", pad);
  const leftMP = polygonClipping.intersection(subject, leftClip);
  const rightMP = polygonClipping.intersection(subject, rightClip);
  const flatten = (mp: PCPolygon[]): Pair[][] =>
    mp.map((p) => fromPCRing(p[0])).filter((r) => r.length >= 3);
  return { left: flatten(leftMP), right: flatten(rightMP) };
}

/**
 * Strict 2D segment–segment intersection test (proper crossing only —
 * collinear / endpoint-on-segment cases return false). Used by the
 * zone-detection helpers to decide whether a cut path enters a zone's
 * polygon edge from outside.
 */
function segmentsIntersect(a: Pair, b: Pair, c: Pair, d: Pair): boolean {
  const cross = (p: Pair, q: Pair, r: Pair) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Endpoint exactly on the other segment — accept with a tiny eps so that
  // user clicks on a wall edge still count as "the cut touches this zone".
  const eps = 0.5; // mm
  const onSeg = (p: Pair, q: Pair, r: Pair) => {
    if (Math.abs(cross(p, q, r)) > eps * Math.max(1, Math.hypot(q[0] - p[0], q[1] - p[1]))) return false;
    return r[0] >= Math.min(p[0], q[0]) - eps && r[0] <= Math.max(p[0], q[0]) + eps
        && r[1] >= Math.min(p[1], q[1]) - eps && r[1] <= Math.max(p[1], q[1]) + eps;
  };
  return onSeg(c, d, a) || onSeg(c, d, b) || onSeg(a, b, c) || onSeg(a, b, d);
}

/**
 * Test whether the line segment p1→p2 meaningfully engages a polygon —
 * either an endpoint is inside, the midpoint is inside, or the segment
 * crosses any polygon edge. Used by findZoneForLineCut as a pure-
 * geometry alternative to polygon-clipping intersection (more robust to
 * the numerical edge cases that trip the library on cell-aligned
 * auto-zone polygons, and avoids any module-resolution issues with the
 * ESM default export).
 */
function segmentTouchesPolygon(p1: Pair, p2: Pair, poly: Pair[]): boolean {
  if (poly.length < 3) return false;
  if (rayCastInPolygon(p1[0], p1[1], poly)) return true;
  if (rayCastInPolygon(p2[0], p2[1], poly)) return true;
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  if (rayCastInPolygon(mx, my, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (segmentsIntersect(p1, p2, a, b)) return true;
  }
  return false;
}

/**
 * Pick the zone the user most plausibly meant to slice with a cut line.
 * Iterates zones top-down (last drawn first) and returns the first one
 * the cut segment engages — endpoint inside, midpoint inside, or the
 * segment crosses any polygon edge. Returns null only when the cut is
 * genuinely disjoint from every zone.
 *
 * Auto-zone-friendly: the segment-vs-edge test catches the common case
 * where a user clicks on opposite walls of a room (both endpoints land
 * inside the wall thickness, so neither is "in" the auto-zone polygon
 * itself, but the line passes straight through the zone interior).
 */
export function findZoneForLineCut(p1: Pair, p2: Pair, zones: Zone[]): Zone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    const poly = zonePolygon(z.bounds);
    if (segmentTouchesPolygon(p1, p2, poly)) return z;
  }
  return null;
}

/**
 * Split a zone with an arbitrary-angle line through (p1, p2). The line
 * is treated as infinite. Returns all child zones — concave polygons can
 * yield more than two children when the cut crosses the boundary >2
 * times (e.g. a U-shape cut horizontally across both legs). Children
 * inherit env / program / influence from the parent and get fresh ids +
 * indexed labels. Returns null when the cut misses the polygon entirely
 * (zero pieces on one side).
 */
export function splitZoneByLine(zone: Zone, p1: Pair, p2: Pair): Zone[] | null {
  const poly = zonePolygon(zone.bounds);
  const { left, right } = splitPolygonByLine(poly, p1, p2);
  if (left.length === 0 || right.length === 0) return null;
  const baseLabel = (zone.label || zone.id).trim();
  const stamp = Date.now();
  const baseProgram = zone.program?.trim();
  const make = (pts: Pair[], idx: number): Zone => ({
    id: `zone_${stamp}_${idx}`,
    label: `${baseLabel} ${idx}`,
    bounds: { ...polygonAABB(pts), points: pts },
    env: { ...zone.env },
    ...(baseProgram ? { program: baseProgram } : {}),
    ...(zone.influence_radius_mm && zone.influence_radius_mm > 0
      ? { influence_radius_mm: zone.influence_radius_mm }
      : {}),
  });
  const out: Zone[] = [];
  let idx = 1;
  for (const piece of left) out.push(make(piece, idx++));
  for (const piece of right) out.push(make(piece, idx++));
  return out;
}

/**
 * Build a thin closed strip polygon along an open polyline. Each segment
 * is offset by ±halfWidth perpendicular to its direction; the forward
 * pass walks the polyline with +halfWidth offset, the backward pass
 * returns with −halfWidth, producing a closed loop suitable for
 * polygon-clipping difference. Used both as a "knife" for polyline cuts
 * and as a fat-line probe by findZoneForLineCut.
 */
function polylineToStrip(line: Pair[], halfWidth: number): PCPolygon {
  if (line.length < 2) return [];
  const fwd: Pair[] = [];
  const bwd: Pair[] = [];
  for (let i = 0; i < line.length; i++) {
    // Average the perpendiculars of the adjacent segments so corners
    // miter cleanly without a pinch. At endpoints, use the single-segment
    // perpendicular.
    let nx = 0, ny = 0;
    if (i > 0) {
      const dx = line[i][0] - line[i - 1][0];
      const dy = line[i][1] - line[i - 1][1];
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
    }
    if (i < line.length - 1) {
      const dx = line[i + 1][0] - line[i][0];
      const dy = line[i + 1][1] - line[i][1];
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
    }
    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen;
    ny /= nLen;
    fwd.push([line[i][0] + nx * halfWidth, line[i][1] + ny * halfWidth]);
    bwd.push([line[i][0] - nx * halfWidth, line[i][1] - ny * halfWidth]);
  }
  // Close the loop: forward path + reversed backward path.
  const ring: Ring = [...fwd, ...bwd.reverse()];
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

/**
 * Extend the first and last segments of a polyline outward by `pad` so a
 * cut starting/ending inside the zone still crosses the boundary on both
 * ends. Without this, a polyline whose endpoints are inside the zone
 * would only cut a narrow notch instead of fully splitting the zone.
 */
function extendPolylineEnds(line: Pair[], pad: number): Pair[] {
  if (line.length < 2) return line.map((p) => [p[0], p[1]] as Pair);
  const out: Pair[] = line.map((p) => [p[0], p[1]] as Pair);
  // Extend start backward.
  {
    const a = out[0];
    const b = out[1];
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const len = Math.hypot(dx, dy) || 1;
    out[0] = [a[0] + (dx / len) * pad, a[1] + (dy / len) * pad];
  }
  // Extend end forward.
  {
    const n = out.length;
    const a = out[n - 1];
    const b = out[n - 2];
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const len = Math.hypot(dx, dy) || 1;
    out[n - 1] = [a[0] + (dx / len) * pad, a[1] + (dy / len) * pad];
  }
  return out;
}

/**
 * Split a (possibly non-convex) simple polygon with an open polyline. The
 * polyline acts as a "knife": its endpoints are extended past the
 * polygon's bounding box on both ends, and a thin strip is subtracted
 * from the polygon. Returns all resulting pieces, in no particular
 * order. A 2-point polyline produces the same result as splitPolygonByLine.
 */
export function splitPolygonByPolyline(poly: Pair[], polyline: Pair[]): Pair[][] {
  if (poly.length < 3 || polyline.length < 2) return [];
  const pad = aabbPad(poly);
  const extended = extendPolylineEnds(polyline, pad);
  // Strip width: well below the auto-zone simplification tolerance
  // (400mm) but large enough for polygon-clipping numerical robustness.
  // 0.1mm has worked reliably in testing.
  const strip = polylineToStrip(extended, 0.1);
  if (strip.length === 0) return [];
  const subject = toPCPolygon(poly);
  const result = polygonClipping.difference(subject, strip);
  const pieces: Pair[][] = [];
  for (const polygon of result) {
    if (polygon.length === 0) continue;
    const ring = fromPCRing(polygon[0]);
    if (ring.length >= 3) pieces.push(ring);
  }
  return pieces;
}

/**
 * Pick the zone a multi-segment polyline cut should slice. Tests every
 * polyline segment against every zone polygon using the same pure-
 * geometry checks as findZoneForLineCut — so a polyline that snakes
 * through a concave zone correctly identifies that zone even when
 * individual vertices fall outside.
 */
export function findZoneForPolylineCut(polyline: Pair[], zones: Zone[]): Zone | null {
  if (polyline.length < 2) return null;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    const poly = zonePolygon(z.bounds);
    if (poly.length < 3) continue;
    for (let j = 0; j < polyline.length - 1; j++) {
      if (segmentTouchesPolygon(polyline[j], polyline[j + 1], poly)) return z;
    }
  }
  return null;
}

/**
 * Split a zone with an open multi-segment polyline. Endpoints are
 * extended past the polygon so the cut always traverses the boundary.
 * Returns all child zones (typically 2; concave zones with a polyline
 * that crosses the boundary more than twice yield more). Children
 * inherit env / program / influence from the parent. Returns null when
 * the polyline doesn't cleanly cut the polygon (fewer than 2 pieces).
 */
export function splitZoneByPolyline(zone: Zone, polyline: Pair[]): Zone[] | null {
  if (polyline.length < 2) return null;
  const poly = zonePolygon(zone.bounds);
  const pieces = splitPolygonByPolyline(poly, polyline);
  if (pieces.length < 2) return null;
  const baseLabel = (zone.label || zone.id).trim();
  const stamp = Date.now();
  const baseProgram = zone.program?.trim();
  return pieces.map((pts, idx) => ({
    id: `zone_${stamp}_${idx + 1}`,
    label: `${baseLabel} ${idx + 1}`,
    bounds: { ...polygonAABB(pts), points: pts },
    env: { ...zone.env },
    ...(baseProgram ? { program: baseProgram } : {}),
    ...(zone.influence_radius_mm && zone.influence_radius_mm > 0
      ? { influence_radius_mm: zone.influence_radius_mm }
      : {}),
  }));
}

/**
 * Split a zone into `count` axis-aligned sub-zones along the chosen
 * direction. `horizontal` slices the zone by horizontal lines (varying
 * y); `vertical` slices by vertical lines (varying x). Children inherit
 * env / program / influence from the parent. For concave zones (e.g.
 * auto-zones from contour tracing where a wall partition U-shapes into a
 * room), a single slice may produce multiple disjoint pieces — they are
 * all returned as separate child zones so the cut is topologically
 * correct rather than collapsed into a self-intersecting boundary.
 */
export function splitZoneIntoParts(
  zone: Zone,
  direction: "horizontal" | "vertical",
  count: number,
): Zone[] {
  const n = Math.max(2, Math.floor(count));
  const { x, y, width, height } = zone.bounds;
  const baseLabel = (zone.label || zone.id).trim();
  const stamp = Date.now();
  const baseProgram = zone.program?.trim();
  const make = (pts: Pair[], idx: number): Zone => ({
    id: `zone_${stamp}_${idx}`,
    label: `${baseLabel} ${idx}`,
    bounds: { ...polygonAABB(pts), points: pts },
    env: { ...zone.env },
    ...(baseProgram ? { program: baseProgram } : {}),
    ...(zone.influence_radius_mm && zone.influence_radius_mm > 0
      ? { influence_radius_mm: zone.influence_radius_mm }
      : {}),
  });

  const subject = toPCPolygon(zonePolygon(zone.bounds));
  if (subject.length === 0) return [{ ...zone, env: { ...zone.env } }];

  const pad = aabbPad(zone.bounds.points ?? zonePolygon(zone.bounds));
  const finalised: Pair[][] = [];
  for (let i = 0; i < n; i++) {
    let lo: number, hi: number;
    let sliceClip: PCPolygon;
    if (direction === "horizontal") {
      lo = y + (height * i) / n;
      hi = y + (height * (i + 1)) / n;
      sliceClip = [[
        [x - pad, lo],
        [x + width + pad, lo],
        [x + width + pad, hi],
        [x - pad, hi],
        [x - pad, lo],
      ]];
    } else {
      lo = x + (width * i) / n;
      hi = x + (width * (i + 1)) / n;
      sliceClip = [[
        [lo, y - pad],
        [hi, y - pad],
        [hi, y + height + pad],
        [lo, y + height + pad],
        [lo, y - pad],
      ]];
    }
    const intersected = polygonClipping.intersection(subject, sliceClip);
    for (const polygon of intersected) {
      if (polygon.length === 0) continue;
      const ring = fromPCRing(polygon[0]);
      if (ring.length >= 3) finalised.push(ring);
    }
  }

  if (finalised.length === 0) return [{ ...zone, env: { ...zone.env } }];
  return finalised.map((pts, i) => make(pts, i + 1));
}

/**
 * Bilinear interpolation between two ZoneEnv values.
 * t = 0 → returns a, t = 1 → returns b
 */
function lerpEnv(a: ZoneEnv, b: ZoneEnv, t: number): ZoneEnv {
  const cl = Math.max(0, Math.min(1, t));
  return {
    temperature: a.temperature + (b.temperature - a.temperature) * cl,
    humidity: a.humidity + (b.humidity - a.humidity) * cl,
    light: a.light + (b.light - a.light) * cl,
    noise: a.noise + (b.noise - a.noise) * cl,
    air_velocity: a.air_velocity + (b.air_velocity - a.air_velocity) * cl,
    ceiling_height: a.ceiling_height + (b.ceiling_height - a.ceiling_height) * cl,
    // open_space is categorical — pick the destination's value once we're past
    // the midpoint of the blend, so transitions snap cleanly rather than
    // produce a meaningless "0.5 open" state.
    open_space: cl >= 0.5 ? b.open_space : a.open_space,
  };
}

/**
 * Get environment parameters at a world position.
 * - If inside exactly one zone → return that zone's env
 * - If inside multiple overlapping zones → average them
 * - If outside all zones but within BLEND_MARGIN of a zone edge → interpolate
 * - If outside all zones → return default env
 */
const BLEND_MARGIN = 500; // mm — interpolation margin near zone edges

/**
 * Compute window influence on environment at a given position.
 * Windows boost light (lux) and air_velocity based on proximity.
 * Uses inverse-square-like falloff with a max influence radius.
 */
const WINDOW_INFLUENCE_RADIUS = 5000; // mm — max distance a window affects env
const WINDOW_LIGHT_BOOST = 400; // lux — max additional light from a window at distance 0
const WINDOW_AIR_BOOST = 0.15; // m/s — max additional air velocity from a window at distance 0

export function computeWindowInfluence(
  px: number, py: number, shapes: Shape[]
): { lightBoost: number; airBoost: number } {
  const windows = shapes.filter(s => s.type === "window");
  if (windows.length === 0) return { lightBoost: 0, airBoost: 0 };

  let totalLightBoost = 0;
  let totalAirBoost = 0;

  for (const win of windows) {
    // LOS check: skip windows blocked by walls / columns / doors
    const [cx, cy] = shapeCentroid(win.points);
    if (!hasLineOfSight(px, py, cx, cy, shapes)) continue;

    // Window is a line (2 endpoints). Distance = closest point on segment.
    let minDist = Infinity;
    if (win.points.length >= 2) {
      for (let i = 0; i < win.points.length - 1; i++) {
        const d = distToSegment(
          px, py,
          win.points[i][0], win.points[i][1],
          win.points[i + 1][0], win.points[i + 1][1]
        );
        if (d < minDist) minDist = d;
      }
    } else if (win.points.length === 1) {
      minDist = Math.sqrt((px - win.points[0][0]) ** 2 + (py - win.points[0][1]) ** 2);
    }

    if (minDist <= WINDOW_INFLUENCE_RADIUS) {
      // Smooth falloff: 1 at distance 0, 0 at WINDOW_INFLUENCE_RADIUS
      const t = 1 - minDist / WINDOW_INFLUENCE_RADIUS;
      const falloff = t * t; // quadratic falloff for natural light decay
      totalLightBoost += WINDOW_LIGHT_BOOST * falloff;
      totalAirBoost += WINDOW_AIR_BOOST * falloff;
    }
  }

  return {
    lightBoost: Math.round(totalLightBoost),
    airBoost: Math.round(totalAirBoost * 100) / 100,
  };
}

/**
 * Extract movement-blocking line segments from shapes.
 * Walls, columns, windows block agent movement (their edges).
 * Doors do NOT block — agents pass through.
 * Site polygon edges block only when meta.hasWalls is true.
 */
export interface CollisionSegment {
  x1: number; y1: number;
  x2: number; y2: number;
  type: ShapeType;
}

export function getCollisionBoundaries(shapes: Shape[]): CollisionSegment[] {
  const segments: CollisionSegment[] = [];

  for (const shape of shapes) {
    const isPolygonBlock = blocksMovement(shape) || (shape.type === "site" && shape.meta?.hasWalls);
    if (!isPolygonBlock) continue;
    const pts = shape.points;
    if (pts.length < 2) continue;
    if (shape.type === "window") {
      // Window is a line segment (2 endpoints) — single segment
      segments.push({
        x1: pts[0][0], y1: pts[0][1],
        x2: pts[1][0], y2: pts[1][1],
        type: "window",
      });
      continue;
    }
    // Polygon: emit each edge (closing edge included)
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (pts.length === 2 && i === 1) break;
      segments.push({
        x1: pts[i][0], y1: pts[i][1],
        x2: pts[j][0], y2: pts[j][1],
        type: shape.type,
      });
    }
  }

  return segments;
}

/**
 * Check if a line segment from A to B crosses any movement-blocking edge.
 * Used for pathfinding to ensure agents don't walk through walls / columns
 * / windows.
 */
export function doesPathCrossWall(
  ax: number, ay: number, bx: number, by: number, shapes: Shape[]
): boolean {
  const boundaries = getCollisionBoundaries(shapes);
  // Doors are passable holes in a wall. (Windows are glass: still a barrier
  // for movement, only transparent for LOS.)
  const movementOpenings = shapes.filter((s) => s.type === "door" && s.points.length >= 3);
  const dxAB = bx - ax, dyAB = by - ay;
  for (const seg of boundaries) {
    if (!lineIntersect(ax, ay, bx, by, seg.x1, seg.y1, seg.x2, seg.y2)) continue;
    if (movementOpenings.length === 0) return true;
    // Find the actual intersection point and check if it falls inside
    // any door footprint — if yes, that segment is "cut" here, so the
    // path is allowed.
    const dxCD = seg.x2 - seg.x1, dyCD = seg.y2 - seg.y1;
    const denom = dxAB * dyCD - dyAB * dxCD;
    if (Math.abs(denom) < 1e-10) return true; // parallel: be conservative
    const t = ((seg.x1 - ax) * dyCD - (seg.y1 - ay) * dxCD) / denom;
    const ix = ax + t * dxAB;
    const iy = ay + t * dyAB;
    if (!movementOpenings.some((op) => isPointInBoundary(ix, iy, op.points))) {
      return true;
    }
  }
  return false;
}

/** Closest point on a 2D segment to (px, py), plus its distance. */
function closestPointOnSegment(
  px: number, py: number, x1: number, y1: number, x2: number, y2: number,
): { x: number; y: number; d: number } {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: x1, y: y1, d: Math.hypot(px - x1, py - y1) };
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { x: cx, y: cy, d: Math.hypot(px - cx, py - cy) };
}

/**
 * Nearest point on a zone's perimeter to (px, py). If the point is inside
 * the zone, returns the query point itself (distance 0).
 */
function nearestPointOnZone(px: number, py: number, z: Zone): { x: number; y: number; d: number } {
  if (isPointInZone(px, py, z.bounds)) return { x: px, y: py, d: 0 };
  const pts = z.bounds.points;
  if (pts && pts.length >= 3) {
    let best = { x: pts[0][0], y: pts[0][1], d: Infinity };
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const c = closestPointOnSegment(px, py, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      if (c.d < best.d) best = c;
    }
    return best;
  }
  const b = z.bounds;
  const cx = Math.max(b.x, Math.min(px, b.x + b.width));
  const cy = Math.max(b.y, Math.min(py, b.y + b.height));
  return { x: cx, y: cy, d: Math.hypot(px - cx, py - cy) };
}

/** Distance from a world point to a zone's nearest edge (0 if inside). */
function distFromZonePerimeter(px: number, py: number, z: Zone): number {
  return nearestPointOnZone(px, py, z).d;
}

/**
 * Predicate for shapes that attenuate sound. Walls, columns, and walled
 * sites count; doors/windows do not (treated as openings — closed doors and
 * single-pane glass attenuate ~25 dB but the sim's default geometry treats
 * them as porous).
 */
function blocksNoise(s: Shape): boolean {
  if (s.type === "wall" || s.type === "column") return true;
  if (s.type === "site" && s.meta?.hasWalls) return true;
  return false;
}

/**
 * Count how many noise-blocking shape edges the segment (ax,ay)→(bx,by)
 * crosses. Used to attenuate zone bleed contributions: each crossed wall
 * deducts WALL_NOISE_LOSS_DB from the noise delta and fully zeros the
 * light / air_velocity bleed (binary block for those channels).
 */
function countNoiseBlockerCrossings(
  ax: number, ay: number, bx: number, by: number, shapes: Shape[],
): number {
  const blockers = shapes.filter(blocksNoise);
  if (blockers.length === 0) return 0;
  // Door = full opening (no acoustic seal). Window = glass: in this model
  // we treat a glazed pane as a partial blocker, so windows still count.
  // Only doors create acoustic holes through walls.
  const noiseOpenings = shapes.filter((s) => s.type === "door" && s.points.length >= 3);
  let count = 0;
  const EPS = 1e-4;
  for (const blocker of blockers) {
    const pts = blocker.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (pts.length === 2 && i === 1) break; // open polyline
      const dxAB = bx - ax, dyAB = by - ay;
      const dxCD = pts[j][0] - pts[i][0], dyCD = pts[j][1] - pts[i][1];
      const denom = dxAB * dyCD - dyAB * dxCD;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((pts[i][0] - ax) * dyCD - (pts[i][1] - ay) * dxCD) / denom;
      const u = ((pts[i][0] - ax) * dyAB - (pts[i][1] - ay) * dxAB) / denom;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
        const ix = ax + t * dxAB;
        const iy = ay + t * dyAB;
        if (noiseOpenings.some((op) => isPointInBoundary(ix, iy, op.points))) continue;
        count++;
      }
    }
  }
  return count;
}

/**
 * Sound transmission loss per intervening wall, in dB. Approximates a
 * residential/commercial partition (gypsum + studs ≈ 30 dB, glass ≈ 25 dB,
 * masonry ≈ 50 dB). 20 dB is a conservative default that produces a
 * legible difference in narrative without instantly silencing sources.
 */
const WALL_NOISE_LOSS_DB = 20;

/**
 * Apply linear-falloff influence from every zone with `influence_radius_mm > 0`,
 * pulling the base env toward that zone's values when the query point is within
 * the radius. Influence weight = (1 - dist / radius), capped at 1 inside the
 * zone perimeter. Categorical fields (open_space, ceiling_height) are not
 * modified by influence — those belong to the base zone only.
 *
 * Contributions are computed against `baseEnv` (not against the running
 * result) so multiple overlapping influences combine predictably without
 * order-dependence.
 */
function applyZoneInfluences(
  baseEnv: ZoneEnv,
  px: number,
  py: number,
  zones: Zone[],
  excludeIds: Set<string>,
  shapes?: Shape[],
): ZoneEnv {
  const result = { ...baseEnv };
  for (const z of zones) {
    if (excludeIds.has(z.id)) continue;
    const radius = z.influence_radius_mm ?? 0;
    if (radius <= 0) continue;
    const near = nearestPointOnZone(px, py, z);
    if (near.d >= radius) continue;
    const w = 1 - near.d / radius; // 1 at perimeter, 0 at edge of influence

    // --- Wall attenuation: count blockers between query point and nearest
    // ---  point on the source zone's perimeter. Walls block light + air
    // ---  fully and attenuate noise by WALL_NOISE_LOSS_DB per crossing.
    const wallCount = (shapes && shapes.length > 0 && near.d > 0)
      ? countNoiseBlockerCrossings(px, py, near.x, near.y, shapes)
      : 0;

    // Temperature & humidity: pass through walls (slow conduction is not
    // modelled — heat eventually equalises across partitions).
    result.temperature += w * (z.env.temperature - baseEnv.temperature);
    result.humidity    += w * (z.env.humidity    - baseEnv.humidity);

    // Light & air velocity: walls fully block (binary).
    if (wallCount === 0) {
      result.light        += w * (z.env.light        - baseEnv.light);
      result.air_velocity += w * (z.env.air_velocity - baseEnv.air_velocity);
    }

    // Noise: dB-style attenuation. Apply weight first, then subtract
    // WALL_NOISE_LOSS_DB per intervening wall from the magnitude of the
    // delta (sign preserved so a quiet zone bleeding into a loud one still
    // dampens through walls).
    let noiseDelta = w * (z.env.noise - baseEnv.noise);
    if (wallCount > 0) {
      const loss = wallCount * WALL_NOISE_LOSS_DB;
      const sign = Math.sign(noiseDelta);
      noiseDelta = sign * Math.max(0, Math.abs(noiseDelta) - loss);
    }
    result.noise += noiseDelta;
  }
  // Clamp to physical floors so subtractive influences cannot push values negative.
  result.light        = Math.max(0, result.light);
  result.noise        = Math.max(0, result.noise);
  result.humidity     = Math.max(0, Math.min(100, result.humidity));
  result.air_velocity = Math.max(0, result.air_velocity);
  return result;
}

/**
 * Get environment parameters at a world position. Considers (in order):
 *  1. Zones that contain the point  → base env (averaged if overlapping).
 *  2. All other zones with `influence_radius_mm > 0` → bleed in via linear
 *     falloff, so a noisy Railway zone radiates beyond its perimeter.
 *  3. Window influence on light + air velocity.
 *  4. Default zone env when the point is outside everything (with the same
 *     `BLEND_MARGIN` legacy fade kept for backward compatibility).
 */
export function getEnvAtPosition(px: number, py: number, zones: Zone[], shapes?: Shape[]): ZoneEnv {
  if (zones.length === 0) return { ...defaultZoneEnv };

  // Check which zones contain this point
  const containingZones = zones.filter(z => isPointInZone(px, py, z.bounds));

  if (containingZones.length >= 1) {
    let baseEnv: ZoneEnv;
    if (containingZones.length === 1) {
      baseEnv = { ...containingZones[0].env };
    } else {
      // Average overlapping zones for the base.
      const avg: ZoneEnv = { temperature: 0, humidity: 0, light: 0, noise: 0, air_velocity: 0, ceiling_height: 0, open_space: false };
      let mrtSum = 0, mrtN = 0;
      let outSum = 0, outN = 0;
      for (const z of containingZones) {
        avg.temperature += z.env.temperature;
        avg.humidity += z.env.humidity;
        avg.light += z.env.light;
        avg.noise += z.env.noise;
        avg.air_velocity += z.env.air_velocity;
        avg.ceiling_height += z.env.ceiling_height;
        if (z.env.open_space) avg.open_space = true;
        if (z.env.mrt !== undefined) { mrtSum += z.env.mrt; mrtN++; }
        if (z.env.outdoor_air_temp !== undefined) { outSum += z.env.outdoor_air_temp; outN++; }
      }
      const n = containingZones.length;
      avg.temperature /= n;
      avg.humidity /= n;
      avg.light /= n;
      avg.noise /= n;
      avg.air_velocity /= n;
      avg.ceiling_height /= n;
      if (mrtN > 0) avg.mrt = mrtSum / mrtN;
      if (outN > 0) avg.outdoor_air_temp = outSum / outN;
      baseEnv = avg;
    }
    // Bleed in influence from non-containing zones.
    const excludeIds = new Set(containingZones.map((z) => z.id));
    let env = applyZoneInfluences(baseEnv, px, py, zones, excludeIds, shapes);
    if (shapes && shapes.length > 0) {
      const { lightBoost, airBoost } = computeWindowInfluence(px, py, shapes);
      env.light += lightBoost;
      env.air_velocity += airBoost;
    }
    // Apply window-proximity MRT depression — see helper. Always done
    // after light/air boosts so the MRT calc sees the canonical Ta.
    env = applyWindowProximityToMRT(px, py, env, shapes ?? []);
    return env;
  }

  // Not inside any zone — check proximity for blending (legacy BLEND_MARGIN).
  let closestZone: Zone | null = null;
  let closestDist = Infinity;

  for (const z of zones) {
    const b = z.bounds;
    const cx = Math.max(b.x, Math.min(px, b.x + b.width));
    const cy = Math.max(b.y, Math.min(py, b.y + b.height));
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (dist < closestDist) {
      closestDist = dist;
      closestZone = z;
    }
  }

  let baseEnv: ZoneEnv;
  if (closestZone && closestDist <= BLEND_MARGIN) {
    const t = 1 - closestDist / BLEND_MARGIN;
    baseEnv = lerpEnv(defaultZoneEnv, closestZone.env, t);
  } else {
    baseEnv = { ...defaultZoneEnv };
  }
  // Even when outside everything, a nearby high-influence zone should still
  // bleed in (e.g. a Railway noise source affecting the open street).
  let env = applyZoneInfluences(baseEnv, px, py, zones, new Set(), shapes);
  if (shapes && shapes.length > 0) {
    const { lightBoost, airBoost } = computeWindowInfluence(px, py, shapes);
    env.light += lightBoost;
    env.air_velocity += airBoost;
  }
  env = applyWindowProximityToMRT(px, py, env, shapes ?? []);
  return env;
}

/**
 * Apply window-proximity mean-radiant-temperature depression to a
 * resolved zone env at world coords (px, py). Mutates a copy of the
 * input env and returns it.
 *
 * Mechanism (architectural levers, no active systems):
 *   1. Each zone declares an indoor air temp (env.temperature) and,
 *      OPTIONALLY, an outdoor air temp (env.outdoor_air_temp).
 *   2. When outdoor_air_temp is set, the engine estimates the inner
 *      surface temp of any window in the zone by treating glazing as
 *      single-glazed equivalent: surface ≈ midpoint of indoor/outdoor.
 *      (This is intentionally pessimistic; designers can model better
 *      glazing by raising env.mrt manually, which short-circuits this
 *      blend.)
 *   3. For agent positions within 3 m line-of-sight of a window, MRT
 *      is shifted toward the surface temp. The blend weight follows a
 *      window view-factor heuristic: at d=0 the window contributes
 *      ~30% of MRT view; falls linearly to 0 at d=3m.
 *   4. Far-from-window agents read the zone's `mrt` (or `temperature`
 *      if mrt is undefined) unmodified — radiant-symmetric assumption.
 *
 * No effect when env.outdoor_air_temp is undefined OR no LOS-visible
 * window is within 3 m. This keeps existing scenarios behaving as
 * before — the new channel is opt-in via outdoor_air_temp.
 */
function applyWindowProximityToMRT(
  px: number, py: number, env: ZoneEnv, shapes: Shape[],
): ZoneEnv {
  const baseMrt = env.mrt ?? env.temperature;
  if (env.outdoor_air_temp === undefined) {
    // No outdoor delta declared — nothing to blend; keep base MRT.
    return { ...env, mrt: baseMrt };
  }

  // Find the closest LOS-visible window to the agent position.
  let nearestD = Infinity;
  for (const s of shapes) {
    if (s.type !== "window" || s.points.length < 3) continue;
    const [cx, cy] = shapeCentroid(s.points);
    if (!hasLineOfSight(px, py, cx, cy, shapes)) continue;
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / 1000;
    if (d < nearestD) nearestD = d;
  }
  if (nearestD > 3) return { ...env, mrt: baseMrt };

  // Single-glazed-equivalent inner surface temp ≈ midpoint of Ta and
  // outdoor. Designer can override the whole MRT via env.mrt (then this
  // path won't fire as the proximity blend uses baseMrt as anchor).
  const surfaceTemp = 0.5 * (env.temperature + env.outdoor_air_temp);
  const proximity = Math.max(0, 1 - nearestD / 3);     // 0..1
  const viewFactor = 0.3 * proximity;                   // peak ~30% at d=0
  const blendedMrt = baseMrt + viewFactor * (surfaceTemp - baseMrt);
  return { ...env, mrt: blendedMrt };
}

/**
 * Get the label(s) of zone(s) containing a given world position.
 * Returns a descriptive string for use in LLM prompts.
 */
export function getZoneLabelAtPosition(px: number, py: number, zones: Zone[]): string {
  const containingZones = zones.filter((z) => isPointInZone(px, py, z.bounds));
  if (containingZones.length === 0) return "Not in any defined zone";
  if (containingZones.length === 1) {
    return containingZones[0].label || containingZones[0].id;
  }
  // Multiple overlapping zones
  const labels = containingZones.map((z) => z.label || z.id).join(" / ");
  return labels;
}

/**
 * Return the topmost zone containing the agent position, or the nearest
 * zone within `BLEND_MARGIN` of its perimeter when the point is just
 * outside (matches the proximity behaviour of `getEnvAtPosition`, so
 * spatial.ceiling_h and the prompt's "current zone" don't go null while
 * the agent's environment is still being read from the zone). Returns
 * null only when the point is outside every zone AND beyond the blend
 * margin. When zones overlap, the LAST containing zone wins (more
 * specific zones drawn on top of a broader one take priority).
 */
export function getZoneAtPosition(px: number, py: number, zones: Zone[]): Zone | null {
  const containingZones = zones.filter((z) => isPointInZone(px, py, z.bounds));
  if (containingZones.length > 0) {
    return containingZones[containingZones.length - 1];
  }
  // Proximity fallback: find the nearest zone perimeter and accept it
  // when the agent stands within BLEND_MARGIN of an edge.
  let closest: Zone | null = null;
  let closestDist = Infinity;
  for (const z of zones) {
    const b = z.bounds;
    const cx = Math.max(b.x, Math.min(px, b.x + b.width));
    const cy = Math.max(b.y, Math.min(py, b.y + b.height));
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (dist < closestDist) { closestDist = dist; closest = z; }
  }
  return closest && closestDist <= BLEND_MARGIN ? closest : null;
}

// ---- Zone area + occupant density ------------------------------------
//
// Density and "personal-space adequacy" are documented architectural
// stressors with their own research lineage. Adding a per-position
// m²/person reading lets computePerceptualLoad penalise zones that
// pack too many people into too little floor — even when raw counts
// already trip social_overload.
//
// Sources:
//   Hall, E.T. 1966 — "The Hidden Dimension" (Doubleday). Proxemic
//     zones: intimate (<0.45 m) / personal (0.45–1.2 m) / social
//     (1.2–3.6 m) / public (>3.6 m). Comfortable adult interaction
//     requires ≥ 1.2 m centre-to-centre, i.e. ≈ 4 m² per person at
//     minimum to avoid breaching the personal zone with every glance.
//   Sommer, R. 1969 — "Personal Space: The Behavioral Basis of Design"
//     (Prentice Hall). Behavioural studies in classrooms, offices,
//     transit: chronic personal-space breach degrades attention and
//     elevates withdrawal behaviours.
//   Stokols, D. 1972 — "On the distinction between density and
//     crowding". Psychological Review 79(3):275–277. Density is
//     spatial; crowding is the subjective response. Same density
//     produces different crowding depending on context.
//   Evans, G.W. 2003 — "The built environment and mental health".
//     J Urban Health 80:536–555. Meta-review: chronic crowding
//     (< ~3 m²/person) raises cortisol, helplessness, social
//     withdrawal — independent of noise / heat.
//   WELL Building Standard v2 (IWBI 2020) — Concept C09 / V01 calls
//     for ≥ 4 m²/person open-office allocation as a comfort floor.

/** Polygon area in m² via Shoelace formula. Input points are in mm
 *  (the SentiArch coordinate convention); divides by 1e6 at the end. */
export function polygonAreaM2(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(s / 2) / 1_000_000;
}

/** Floor area of a Zone in m². Uses the polygon when provided; falls
 *  back to the rectangular bounds otherwise. */
export function zoneAreaM2(zone: Zone): number {
  const b = zone.bounds;
  if (b.points && b.points.length >= 3) return polygonAreaM2(b.points);
  return (b.width * b.height) / 1_000_000;
}

/**
 * Personal-space adequacy penalty as a function of m² per person.
 * Cramped-only: applies a multiplicative penalty when occupants have
 * less floor than published proxemic / chronic-crowding research
 * deems comfortable.
 *
 * The previously-included oversized branch (m²/pp > 25) was removed
 * per academic-rigour decision: directional support exists for "too
 * big = institutional / empty" (Appleton 1975 / Stamps 2014 / Evans &
 * McCoy 1998 / Hildebrand 1999 / AIA-FGI 2018) but no published
 * dose-response curve quantifies stress as a function of m²/pp on
 * that side. Rather than ship a calibrated-by-eye oversized curve
 * dressed as research, we keep this function strictly to the
 * cramped-side literature where dose-response is documented.
 *
 * Curve (research-anchored):
 *     ≥ 8 m²/pp  : 1.00 — public/social-distance comfort, no penalty
 *     4–8        : 1.00 → 1.20  (Hall 1966 social-distance breach)
 *     2–4        : 1.20 → 1.60  (personal-distance breach; Evans
 *                                2003 cortisol elevation threshold)
 *     < 2        : 1.60 → 2.50 cap (intimate-distance breach;
 *                                   Calhoun-style behavioural stress)
 *
 * Sources:
 *   · Hall, E.T. 1966 — "The Hidden Dimension" (Doubleday). 4-band
 *     proxemic model.
 *   · Sommer, R. 1969 — "Personal Space" (Prentice Hall). Behavioural
 *     dose-response of personal-space breach.
 *   · Stokols, D. 1972 — Psych Review 79(3):275–277. Density vs
 *     crowding distinction.
 *   · Evans, G.W. 2003 — J Urban Health 80:536–555. Meta-review:
 *     chronic density < 3 m²/pp elevates cortisol baseline.
 *   · WELL Building Standard v2 (IWBI 2020) — 4 m²/pp open-office
 *     allocation floor.
 */
export function densityPenaltyMultiplier(m2PerPerson: number): number {
  if (!Number.isFinite(m2PerPerson) || m2PerPerson < 0) return 1.0;
  if (m2PerPerson >= 8) return 1.0;
  if (m2PerPerson >= 4) return 1.0 + (8 - m2PerPerson) / 4 * 0.20;
  if (m2PerPerson >= 2) return 1.20 + (4 - m2PerPerson) / 2 * 0.40;
  return Math.min(2.50, 1.60 + (2 - m2PerPerson) / 2 * 0.90);
}

// ---- Situated Cognition: co-zone agents + relationship resolution ----
// Lightweight projection of another agent that the perception prompt cares
// about: who they are, why they're here, and (optionally) how they relate
// to the perceiving agent. Kept narrow on purpose — the LLM should not
// receive other agents' anxiety / MBTI / sensory state.
export interface SituatedAgentInfo {
  id: string;
  name?: string;
  role?: string;
  purpose_at_centre?: string;
  /** Relation to the perceiving agent if one exists in their `relationships`
   *  list. Same string as `AgentRelationship.type`. Undefined when the two
   *  agents are co-located but have no declared relationship. */
  relation?: string;
}

/**
 * Compute the agents that share a zone with the perceiving agent — i.e.
 * the agents the LLM should see as "in this zone with me right now".
 *
 * Definition of "same zone" matches `getZoneAtPosition` (containment with
 * proximity blend), so an agent on the boundary between two zones still
 * resolves to one zone consistently. Agents whose position is unknown
 * (null) are skipped; agents in (undefined area) are co-located only with
 * other (undefined area) agents.
 *
 * Returns lightweight projections — never raw `AgentData`, so personality
 * / anxiety state of other agents never leaks into a perception prompt.
 */
export function computeCoZoneAgents(
  agentIdx: number,
  allPersonas: { agent: AgentData }[],
  allPositions: (AgentPosition | null)[],
  zones: Zone[],
): SituatedAgentInfo[] {
  const myPos = allPositions[agentIdx];
  if (!myPos) return [];
  const me = allPersonas[agentIdx]?.agent;
  if (!me) return [];
  const myZone = getZoneAtPosition(myPos.x, myPos.y, zones);
  const myRelations = me.relationships ?? [];

  const out: SituatedAgentInfo[] = [];
  for (let i = 0; i < allPersonas.length; i++) {
    if (i === agentIdx) continue;
    const otherPos = allPositions[i];
    if (!otherPos) continue;
    const otherZone = getZoneAtPosition(otherPos.x, otherPos.y, zones);
    // Same zone: both inside the same zone object, OR both in (undefined area).
    const sameZone = myZone && otherZone
      ? myZone.id === otherZone.id
      : (!myZone && !otherZone);
    if (!sameZone) continue;
    const other = allPersonas[i]?.agent;
    if (!other) continue;
    const rel = myRelations.find((r) => r.with === other.id);
    out.push({
      id: other.id,
      ...(other.name ? { name: other.name } : {}),
      ...(other.role ? { role: other.role } : {}),
      ...(other.purpose_at_centre ? { purpose_at_centre: other.purpose_at_centre } : {}),
      ...(rel ? { relation: rel.type } : {}),
    });
  }
  return out;
}

/**
 * Resolve every entry in the agent's `relationships` list into a
 * SituatedAgentInfo enriched with the referenced agent's name / role /
 * purpose. Used by the prompt's "people you know in this building today"
 * block — separate from co-zone presence so the prompt expresses BOTH
 * "I came to see Dr Chan" AND "Dr Chan is/isn't currently in this zone
 * with me".
 *
 * Entries that point at unknown ids are still emitted (with the bare id)
 * so the LLM can see that a relationship was declared but the target is
 * not in the current scenario — useful when the scenario has been
 * imported partially.
 */
export function resolveRelationshipDetails(
  agent: AgentData,
  allPersonas: { agent: AgentData }[],
): SituatedAgentInfo[] {
  const rels = agent.relationships ?? [];
  if (rels.length === 0) return [];
  const byId = new Map<string, AgentData>();
  for (const p of allPersonas) byId.set(p.agent.id, p.agent);
  return rels.map((r) => {
    const other = byId.get(r.with);
    if (!other) return { id: r.with, relation: r.type };
    return {
      id: other.id,
      ...(other.name ? { name: other.name } : {}),
      ...(other.role ? { role: other.role } : {}),
      ...(other.purpose_at_centre ? { purpose_at_centre: other.purpose_at_centre } : {}),
      relation: r.type,
    };
  });
}

/** Convert ZoneEnv to EnvironmentData (field name mapping) */
export function zoneEnvToEnvironment(ze: ZoneEnv): EnvironmentData {
  return {
    lux: Math.round(ze.light),
    dB: Math.round(ze.noise * 10) / 10,
    air_temp: Math.round(ze.temperature * 10) / 10,
    humidity: Math.round(ze.humidity * 10) / 10,
    air_velocity: Math.round(ze.air_velocity * 100) / 100,
    open_space: ze.open_space === true,
    ...(ze.mrt !== undefined ? { mrt: Math.round(ze.mrt * 10) / 10 } : {}),
    ...(ze.outdoor_air_temp !== undefined
      ? { outdoor_air_temp: Math.round(ze.outdoor_air_temp * 10) / 10 }
      : {}),
  };
}

export interface AgentPosition {
  x: number;
  y: number;
}

// ---- Waypoint & Route System ----
export interface Waypoint {
  id: string;
  label: string;
  position: AgentPosition; // world coords (mm)
  dwell_minutes: number;   // how long agent stays at this point
  /**
   * Waypoint-trajectory fields (optional — only meaningful when the agent's
   * `trajectory_mode` is true). Existing saved scenarios omit these and
   * deserialize unchanged.
   *   t_min          wall-clock minute the agent arrives at this waypoint,
   *                  measured from visit start (0, 10, 25, …). X-axis of the
   *                  Panel-04 trajectory chart. The engine dwell for a
   *                  waypoint is derived as the Δt_min to the next waypoint.
   *   context        short situational description ("doorway hesitation");
   *                  injected into the LLM narrative prompt only.
   *   narrative_seed optional story-continuity fragment for the prompt.
   */
  t_min?: number;
  context?: string;
  narrative_seed?: string;
}

// ---- Derived Metrics ----
export function computeStressScore(acc: AccumulatedState): number {
  // Weighted average of all accumulated stress dimensions (0-10 scale)
  const weights = {
    thermal_discomfort: 0.20,
    visual_strain: 0.15,
    noise_stress: 0.20,
    social_overload: 0.15,
    fatigue: 0.15,
    wayfinding_anxiety: 0.15,
  };
  const score = (
    acc.thermal_discomfort * weights.thermal_discomfort +
    acc.visual_strain * weights.visual_strain +
    acc.noise_stress * weights.noise_stress +
    acc.social_overload * weights.social_overload +
    acc.fatigue * weights.fatigue +
    acc.wayfinding_anxiety * weights.wayfinding_anxiety
  ) * 10; // acc values are 0-1, multiply by 10 to get 0-10 scale
  return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
}

/**
 * Deterministic comfort score (1..10) derived from accumulated_state via
 * the inverse of {@link computeStressScore}. The mapping is linear:
 *     comfort = 10 − stress  (clamped to [1, 10] and rounded)
 * Anchors against the rubric the LLM previously used for self-scoring:
 *   stress 0  → comfort 10  (thriving)
 *   stress 5  → comfort  5  (neutral / tolerable)
 *   stress 10 → comfort  1  (distressed)
 *
 * The LLM does NOT score comfort. Comfort is a function of the
 * research-grounded perceptual load (Fanger PMV, ASI-3 modifiers,
 * Song 2022 / Jing 2024 / Li 2024 greenery effects, MBTI-aware social
 * loading, etc.) — see {@link computePerceptualLoad}. The LLM only
 * translates the resulting state into a first-person summary.
 */
export function computeComfortScore(load: AccumulatedState): number {
  const stress = computeStressScore(load); // 0..10
  return Math.max(1, Math.min(10, Math.round(10 - stress)));
}

/**
 * Waypoint-trajectory carry-over weight. At each waypoint the carried
 * affective state moves α toward the freshly-computed instantaneous state
 * and retains (1−α) of the prior carried state. α = 0.6 means the agent
 * adapts ~60% to the new space each waypoint while carrying 40% of the
 * emotional load they walked in with. Single source of truth — tune here.
 */
export const TRAJECTORY_CARRY_ALPHA = 0.6;

/**
 * Bounded bidirectional carry-over for waypoint-trajectory agents.
 *
 * `computePerceptualLoad` is recomputed fresh per waypoint and stays
 * snapshot-pure (untouched). This is a thin post-engine layer that blends
 * that fresh `instant` reading into the `prev` carried state:
 *
 *   - thermal / visual / noise / social / wayfinding: exponential moving
 *     average `(1−α)·prev + α·instant`. Restorative spaces (low instant)
 *     pull the carried value DOWN; stressful spaces push it UP. State is
 *     genuinely recoverable for these five dimensions.
 *   - fatigue: MONOTONIC non-decreasing — `max(prev, ema)`. Physiological
 *     / attentional depletion accumulates over a visit and is not undone
 *     by a short transit through a calmer room (Ulrich 1984 / Kaplan ART
 *     concern recovery of *affect*, not reversal of tiredness).
 *
 * Pure: no React, no I/O. Rounded to 2dp to match the engine's
 * `Math.round(x*100)/100` convention so downstream comparisons line up.
 * Seed `prev` with `defaultAccumulatedState` at the first waypoint so the
 * trajectory baseline matches the rest of the app.
 */
export function blendCarriedState(
  prev: AccumulatedState,
  instant: AccumulatedState,
): AccumulatedState {
  const round2 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
  const ema = (p: number, i: number) => (1 - TRAJECTORY_CARRY_ALPHA) * p + TRAJECTORY_CARRY_ALPHA * i;
  const fatigueEma = ema(prev.fatigue, instant.fatigue);
  return {
    thermal_discomfort: round2(ema(prev.thermal_discomfort, instant.thermal_discomfort)),
    visual_strain: round2(ema(prev.visual_strain, instant.visual_strain)),
    noise_stress: round2(ema(prev.noise_stress, instant.noise_stress)),
    social_overload: round2(ema(prev.social_overload, instant.social_overload)),
    fatigue: round2(Math.max(prev.fatigue, fatigueEma)),
    wayfinding_anxiety: round2(ema(prev.wayfinding_anxiety, instant.wayfinding_anxiety)),
  };
}

/**
 * Deterministic trend label from the change in comfort between the
 * previous leg and this one. Used when assembling the experience block
 * for export / state — the LLM no longer emits trend.
 */
export function deriveTrend(
  prevComfort: number | null | undefined,
  currComfort: number,
): "rising" | "declining" | "stable" {
  if (prevComfort === null || prevComfort === undefined) return "stable";
  if (currComfort > prevComfort) return "rising";
  if (currComfort < prevComfort) return "declining";
  return "stable";
}

/** Threshold above which an accumulated_state dimension is considered to
 *  be actively pulling comfort down. 0.30 = "noticeable" — below this
 *  the agent is not really feeling that dimension as stress. */
export const COMFORT_DRIVER_THRESHOLD = 0.30;

/**
 * Deterministic explainer for "what is making this agent uncomfortable
 * RIGHT NOW". Returns a sorted list of accumulated_state dimensions
 * loaded above {@link COMFORT_DRIVER_THRESHOLD}, each tagged with the
 * sensor reading that most likely explains it.
 *
 * Pure function — driven only by accState / computed / env / spatial.
 * Uses the same data the UI already sees; no LLM round-trip. Returns
 * an empty array when the agent is uniformly comfortable, which is
 * easy for downstream consumers to "(no drivers above threshold)".
 */
export function deriveComfortDrivers(
  accState: AccumulatedState,
  computed: ComputedOutputs,
  env: EnvironmentData,
  spatial: SpatialData,
): ComfortDriver[] {
  const out: ComfortDriver[] = [];

  if (accState.thermal_discomfort >= COMFORT_DRIVER_THRESHOLD) {
    const pmv = computed.PMV;
    const t = computed.perceived_air_temp;
    const direction = pmv <= -0.5 ? "cold" : pmv >= 0.5 ? "warm" : "borderline neutral";
    out.push({
      factor: "thermal_discomfort",
      level: round01(accState.thermal_discomfort),
      cause: `PMV ${pmv.toFixed(2)} (${direction}); perceived ${t.toFixed(1)}°C, ${env.humidity}% RH, air ${env.air_velocity} m/s`,
    });
  }

  if (accState.visual_strain >= COMFORT_DRIVER_THRESHOLD) {
    const lux = env.lux;
    const lit = lux < 100 ? "very dim — eyes straining"
      : lux < 200 ? "dim — below comfortable reading lux"
      : lux < 500 ? "low ambient — borderline"
      : lux > 3000 ? "very bright — possible glare"
      : `${lux} lux — within neutral range, strain likely from contrast or duration`;
    out.push({
      factor: "visual_strain",
      level: round01(accState.visual_strain),
      cause: `lux ${Math.round(lux)} — ${lit}`,
    });
  }

  if (accState.noise_stress >= COMFORT_DRIVER_THRESHOLD) {
    const dB = env.dB;
    const anx = computed.anxiety_perceived_dB;
    const amp = anx > dB + 0.1 ? ` (anxiety amplifies to ~${anx.toFixed(1)})` : "";
    out.push({
      factor: "noise_stress",
      level: round01(accState.noise_stress),
      cause: `${dB} dB${amp}`,
    });
  }

  if (accState.social_overload >= COMFORT_DRIVER_THRESHOLD) {
    const va = spatial.visible_agents;
    const space = computed.anxiety_personal_space;
    const spaceNote = space > 0 ? `; personal-space need ~${space.toFixed(1)}m` : "";
    out.push({
      factor: "social_overload",
      level: round01(accState.social_overload),
      cause: `${va} other agent${va === 1 ? "" : "s"} in line of sight${spaceNote}`,
    });
  }

  if (accState.fatigue >= COMFORT_DRIVER_THRESHOLD) {
    out.push({
      factor: "fatigue",
      level: round01(accState.fatigue),
      cause: "accumulated across prior legs of this visit",
    });
  }

  if (accState.wayfinding_anxiety >= COMFORT_DRIVER_THRESHOLD) {
    const exit = spatial.dist_to_exit;
    const cause = exit < 0
      ? "no exit visible from current position"
      : `nearest exit ${exit}m away${spatial.enclosure_ratio >= 0.7 ? `; enclosure ${spatial.enclosure_ratio.toFixed(2)} (mostly enclosed)` : ""}`;
    out.push({
      factor: "wayfinding_anxiety",
      level: round01(accState.wayfinding_anxiety),
      cause,
    });
  }

  return out.sort((a, b) => b.level - a.level);
}

function round01(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number; // 0-10 stress score
  agentIdx: number;
}

export interface PerceptionLogEntry {
  waypoint_id: string;
  phase: "walking" | "dwelling";
  from?: string;           // waypoint_id of origin (for walking phase)
  to?: string;             // waypoint_id of destination (for walking phase)
  position: AgentPosition;
  environment: EnvironmentData;
  spatial: SpatialData;
  computed: ComputedOutputs;
  experience: ExperienceData;
  /**
   * Final accumulated state actually used by downstream consumers
   * (stress heatmap, route summary, next-leg prompt context). When the
   * LLM call succeeded this equals `dimsToAccState(llm.dims)`; otherwise
   * (baseline / skipped / failed) it equals `accState_engine`.
   */
  accState: AccumulatedState;
  /**
   * Engine-derived 6-dim accumulated state — pure Layer-1 physics +
   * geometry, computed by `computePerceptualLoad` + `applyRoleAccStateConstraints`.
   * Always present so the UI / export can render the baseline tick
   * underneath the LLM bars for `ok` legs and show the bars directly
   * for baseline / failed legs.
   */
  accState_engine: AccumulatedState;
  triggers: string[];
  timestamp: string;
}

export interface AgentRoute {
  waypoints: Waypoint[];
  perceptionLog: PerceptionLogEntry[];
}

// ---- Multi-Agent Per-Persona State ----
export interface PersonaState {
  persona: PersonaData;
  experience: ExperienceData;
  accState: AccumulatedState;
  computed: ComputedOutputs;
  triggers: string[];
  prevExperience: ExperienceData | null;
  prevAccState: AccumulatedState | null;
  agentPos: AgentPosition | null;
  hasSimulated: boolean; // tracks if this persona has ever been simulated
  route: AgentRoute;     // waypoint route + perception log
}

// ---- Persona Colors & Identities ----
export const PERSONA_COLORS_PRESETS = [
  { primary: "#B85C38", secondary: "#D4856A", bg: "rgba(184, 92, 56, 0.15)", label: "P1" },
  { primary: "#2E6B8A", secondary: "#5A9AB5", bg: "rgba(46, 107, 138, 0.15)", label: "P2" },
  { primary: "#6B8E5A", secondary: "#8FB87A", bg: "rgba(107, 142, 90, 0.15)", label: "P3" },
  { primary: "#8B5E83", secondary: "#B07DA8", bg: "rgba(139, 94, 131, 0.15)", label: "P4" },
  { primary: "#C47A2B", secondary: "#D9A05C", bg: "rgba(196, 122, 43, 0.15)", label: "P5" },
  { primary: "#4A7B8C", secondary: "#6FA0B0", bg: "rgba(74, 123, 140, 0.15)", label: "P6" },
  { primary: "#7B6B4A", secondary: "#A08E6A", bg: "rgba(123, 107, 74, 0.15)", label: "P7" },
  { primary: "#5A6B8E", secondary: "#7A8FB8", bg: "rgba(90, 107, 142, 0.15)", label: "P8" },
];

export function getPersonaColor(index: number) {
  if (index < PERSONA_COLORS_PRESETS.length) return PERSONA_COLORS_PRESETS[index];
  // Generate deterministic color for indices beyond presets
  const hue = (index * 137.508) % 360; // golden angle
  const s = 45 + (index % 3) * 10;
  const l = 35 + (index % 4) * 5;
  const primary = `hsl(${hue}, ${s}%, ${l}%)`;
  const secondary = `hsl(${hue}, ${s}%, ${l + 20}%)`;
  const bg = `hsla(${hue}, ${s}%, ${l}%, 0.15)`;
  return { primary, secondary, bg, label: `P${index + 1}` };
}

// Backward-compatible alias
export const PERSONA_COLORS = PERSONA_COLORS_PRESETS;

// ---- Defaults ----
export const defaultEnvironment: EnvironmentData = {
  lux: 300,
  dB: 55,
  air_temp: 24,
  humidity: 55,
  air_velocity: 0.1,
};

export const defaultPersonas: PersonaData[] = [
  {
    // Persona 01: Elderly female, low metabolism, thick clothing → feels comfortable at 24°C (PMV ≈ +0.03)
    agent: {
      id: "persona_01",
      age: 75,
      gender: "female",
      mbti: "ISFJ",
      mobility: "walker",
      hearing: "impaired",
      vision: "mild_impairment",
      metabolic_rate: 0.8,
      clothing_insulation: 1.2,
      anxiety: buildAnxietyData(8),
      // Thesis-aligned objective seed (slide 15 patient archetype).
      role: "client · waiting",
      purpose_at_centre: "Returning client of Dr Shum — here for a follow-up appointment",
      goal_progress: 0,
    },
    position: { cell: [0, 0], timestamp: "14:30", duration_in_cell: 45 },
    environment: { ...defaultEnvironment },
    // dist_to_window / dist_to_exit use the −1 sentinel for "no
    // LOS-visible window/exit" — the same convention computeSpatialFromAgent
    // uses at runtime. Defaulting to 0 instead would make the windowless
    // penalty / view-out damping fire INVERTED for a freshly-created
    // un-placed agent.
    spatial: { dist_to_wall: 0, dist_to_window: -1, dist_to_exit: -1, ceiling_h: -1, enclosure_ratio: 0, visible_agents: 0 },
    temporal: { ...defaultTemporal },
  },
  {
    // Persona 02: Young male, high metabolism, thin clothing → feels warm/hot at 24°C (PMV ≈ +0.46)
    agent: {
      id: "persona_02",
      age: 28,
      gender: "male",
      mbti: "ENTP",
      mobility: "normal",
      hearing: "normal",
      vision: "normal",
      metabolic_rate: 1.6,
      clothing_insulation: 0.5,
      anxiety: buildAnxietyData(20),
      role: "staff · ward round",
      purpose_at_centre: "Checking in on patients between appointments",
      goal_progress: 0.4,
    },
    position: { cell: [0, 0], timestamp: "14:30", duration_in_cell: 30 },
    environment: { ...defaultEnvironment },
    // dist_to_window / dist_to_exit use the −1 sentinel for "no
    // LOS-visible window/exit" — the same convention computeSpatialFromAgent
    // uses at runtime. Defaulting to 0 instead would make the windowless
    // penalty / view-out damping fire INVERTED for a freshly-created
    // un-placed agent.
    spatial: { dist_to_wall: 0, dist_to_window: -1, dist_to_exit: -1, ceiling_h: -1, enclosure_ratio: 0, visible_agents: 0 },
    temporal: { ...defaultTemporal },
  },
  {
    // Persona 03: Middle-aged female, mid metabolism, severe vision impairment → thermally neutral but high visual load (PMV ≈ -0.08, EffLux = 150)
    agent: {
      id: "persona_03",
      age: 45,
      gender: "female",
      mbti: "INFP",
      mobility: "normal",
      hearing: "normal",
      vision: "severe_impairment",
      metabolic_rate: 1.0,
      clothing_insulation: 0.8,
      anxiety: buildAnxietyData(28),
      role: "client (health anxiety)",
      purpose_at_centre: "First visit, navigating an unfamiliar space",
      goal_progress: 0.1,
    },
    position: { cell: [0, 0], timestamp: "14:30", duration_in_cell: 60 },
    environment: { ...defaultEnvironment },
    // dist_to_window / dist_to_exit use the −1 sentinel for "no
    // LOS-visible window/exit" — the same convention computeSpatialFromAgent
    // uses at runtime. Defaulting to 0 instead would make the windowless
    // penalty / view-out damping fire INVERTED for a freshly-created
    // un-placed agent.
    spatial: { dist_to_wall: 0, dist_to_window: -1, dist_to_exit: -1, ceiling_h: -1, enclosure_ratio: 0, visible_agents: 0 },
    temporal: { ...defaultTemporal },
  },
];

// Factory function for creating new agents with dynamic index
export function createNewPersona(index: number): PersonaData {
  return {
    agent: {
      id: `persona_${String(index + 1).padStart(2, "0")}`,
      age: 30,
      gender: "male",
      mbti: "INTJ",
      mobility: "normal",
      hearing: "normal",
      vision: "normal",
      metabolic_rate: 1.2,
      clothing_insulation: 0.7,
      anxiety: buildAnxietyData(0),
    },
    position: { cell: [0, 0], timestamp: "14:30", duration_in_cell: 30 },
    environment: { ...defaultEnvironment },
    // dist_to_window / dist_to_exit use the −1 sentinel for "no
    // LOS-visible window/exit" — the same convention computeSpatialFromAgent
    // uses at runtime. Defaulting to 0 instead would make the windowless
    // penalty / view-out damping fire INVERTED for a freshly-created
    // un-placed agent.
    spatial: { dist_to_wall: 0, dist_to_window: -1, dist_to_exit: -1, ceiling_h: -1, enclosure_ratio: 0, visible_agents: 0 },
    temporal: { ...defaultTemporal },
  };
}

export const defaultExperience: ExperienceData = {
  summary:
    'Waiting for calculation... Click "Run Current Calculation" to generate experience narrative.',
  comfort_score: 0,
  trend: "stable",
};

export const defaultAccumulatedState: AccumulatedState = {
  thermal_discomfort: 0.25,
  visual_strain: 0.35,
  noise_stress: 0.40,
  social_overload: 0.15,
  fatigue: 0.30,
  wayfinding_anxiety: 0.20,
};

export const defaultComputedOutputs: ComputedOutputs = {
  PMV: 0,
  PPD: 5,
  effective_lux: 0,
  perceived_dB: 0,
  pmv_warnings: [],
  anxiety_perceived_dB: 0,
  anxiety_pmv_range: 1.0,
  anxiety_personal_space: 0,
  perceived_air_temp: 24,
  effective_mrt: 24,
  mrt_delta: 0,
  green_recovery: 0,
  heat_loss: { convection: 0, radiation: 0, evaporation: 0, respiration: 0, metabolic_input: 58.15 },
};

// ---- Baseline Reset: Agent Core Fields ----
// When these fields change, previous results are cleared (treated as first simulation)
export const AGENT_CORE_FIELDS: (keyof AgentData)[] = [
  "mbti", "age", "gender", "mobility", "hearing", "vision", "id",
];

export function isAgentCoreChange(prev: AgentData, next: AgentData): boolean {
  if (AGENT_CORE_FIELDS.some((k) => prev[k] !== next[k])) return true;
  // Anxiety is a core field too: a different ASI level implies different
  // perceptual modifiers and invalidates prior simulation state.
  const prevLevel = prev.anxiety?.asi_level ?? defaultAnxiety.asi_level;
  const nextLevel = next.anxiety?.asi_level ?? defaultAnxiety.asi_level;
  return prevLevel !== nextLevel;
}

/**
 * Heat-loss partition returned by {@link calculatePMV}, in W/m² of body
 * surface area. Mirrors thermBAL's convection / radiation / evaporation
 * / respiration breakdown so designers can diagnose WHY thermal is
 * uncomfortable, not just whether it is.
 *
 * - convection : skin-to-air convective loss (fcl·hc·(tcl−tdb))
 * - radiation  : skin-to-surfaces radiative loss (Stefan-Boltzmann term)
 * - evaporation: skin diffusion + sweat regulation (latent skin)
 * - respiration: sensible + latent respiratory loss
 * - metabolic_input: net M − W (effective metabolic heat production)
 */
export interface HeatLossPartition {
  convection: number;
  radiation: number;
  evaporation: number;
  respiration: number;
  metabolic_input: number;
}

// ---- PMV/PPD Calculation (pythermalcomfort-inspired, ISO 7730 Fanger) ----
//
// Inputs:
//   tdb : air temperature  (°C)  — Ta
//   tr  : mean radiant temperature (°C) — MRT (independent of Ta;
//          asymmetry near cold windows / sun-warmed surfaces drives
//          the radiative term)
//   vr  : air speed (m/s)
//   rh  : relative humidity (%)
//   met : metabolic rate (met units; 1 met = 58.15 W/m²)
//   clo : clothing insulation (clo units; 1 clo = 0.155 m²K/W)
//
// Returns PMV + PPD per ISO 7730 / ASHRAE 55, plus the same heat-loss
// partition that thermBAL exposes (convection, radiation, evaporation,
// respiration, metabolic input).
export function calculatePMV(
  tdb: number, tr: number, vr: number, rh: number, met: number, clo: number
): { pmv: number; ppd: number; heatLoss: HeatLossPartition } {
  const M = met * 58.15;
  const W = 0;
  const Icl = clo * 0.155;
  const pa = (rh / 100) * 610.5 * Math.exp((17.269 * tdb) / (237.3 + tdb));
  const fcl = clo <= 0.078 ? 1.0 + 1.29 * Icl : 1.05 + 0.645 * Icl;

  let tcl = 35.7 - 0.028 * (M - W) - Icl * (
    3.96e-8 * fcl * (Math.pow(35.7 - 0.028 * (M - W) + 273, 4) - Math.pow(tr + 273, 4))
  );

  for (let i = 0; i < 150; i++) {
    const hcn = 2.38 * Math.pow(Math.abs(tcl - tdb), 0.25);
    const hcf = 12.1 * Math.sqrt(vr);
    const hc = Math.max(hcn, hcf);
    const tclNew = 35.7 - 0.028 * (M - W) - Icl * (
      3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4)) +
      fcl * hc * (tcl - tdb)
    );
    if (Math.abs(tclNew - tcl) < 0.00015) { tcl = tclNew; break; }
    tcl = 0.5 * tcl + 0.5 * tclNew;
  }

  const hcn = 2.38 * Math.pow(Math.abs(tcl - tdb), 0.25);
  const hcf = 12.1 * Math.sqrt(vr);
  const hc = Math.max(hcn, hcf);

  // Heat-loss partition — same six terms that PMV sums internally.
  // Rendered separately so the UI can show which channel is dominating
  // (e.g. high Rad term near a cold window even if Ta is fine).
  const L_skin_diffusion = 3.05e-3 * (5733 - 6.99 * (M - W) - pa);
  const L_sweat = 0.42 * ((M - W) - 58.15);
  const L_resp_latent = 1.7e-5 * M * (5867 - pa);
  const L_resp_sensible = 0.0014 * M * (34 - tdb);
  const L_radiation = 3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4));
  const L_convection = fcl * hc * (tcl - tdb);

  const pmv = (0.303 * Math.exp(-0.036 * M) + 0.028) * (
    (M - W)
    - L_skin_diffusion
    - L_sweat
    - L_resp_latent
    - L_resp_sensible
    - L_radiation
    - L_convection
  );

  const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    pmv: isNaN(pmv) ? 0 : r2(pmv),
    ppd: isNaN(ppd) ? 5 : Math.round(ppd * 10) / 10,
    heatLoss: {
      convection: r2(L_convection),
      radiation: r2(L_radiation),
      evaporation: r2(L_skin_diffusion + L_sweat),
      respiration: r2(L_resp_latent + L_resp_sensible),
      metabolic_input: r2(M - W),
    },
  };
}

// ---- thermBAL-aligned PMV Validity Warnings ----
export function getPMVWarnings(
  tdb: number, rh: number, vr: number, met: number, clo: number, pmv: number
): string[] {
  const warnings: string[] = [];
  // Air speed warning (thermBAL: >0.2 m/s)
  if (vr > 0.2) warnings.push("Elevated air speed: PMV may be unreliable; consider SET.");
  // Humidity warnings (thermBAL: <20% or >80%)
  if (rh < 20 || rh > 80) warnings.push("Extreme humidity may reduce PMV reliability.");
  // Temperature bounds (thermBAL: 10–35°C)
  if (tdb < 10 || tdb > 35) warnings.push("Air temperature outside typical PMV bounds (10–35 °C).");
  // Met bounds (thermBAL: 0.8–2.0 met)
  if (met < 0.8 || met > 2.0) warnings.push("Met outside typical PMV range (0.8–2.0).");
  // Clo bounds (thermBAL: 0–2 clo)
  if (clo > 2) warnings.push("High clothing insulation (>2 clo).");
  // PMV out of scale
  if (Math.abs(pmv) > 3) warnings.push("PMV value outside comfort scale range (−3 to +3).");
  return warnings;
}

// ============================================================
// ---- Greenery (Green View Index, GVI) ----------------------
// ============================================================
// All coefficients calibrated to peer-reviewed evidence; do not tune
// without justification. References:
//   Li et al. 2024 — Communications Earth & Environment. Meta-analysis
//     of 182 studies: trees lower pedestrian temp up to 12°C; ~30% canopy
//     ≈ 1.5°C cooling typical. Our cap of 5°C reflects "high canopy"
//     pedestrian-level effect.
//   Jing et al. 2024 — Buildings 14(10):3316. RCT n=24 (VR): WGVI 25%
//     optimal for stress recovery, plateau effect after 25%.
//   Song et al. 2022 — PMC9658851. Meta-analysis of RCTs on green
//     exposure: fatigue Cohen's d=−0.84, vitality d=+0.85, HR d=−0.60.
//   Pun et al. 2018 — PMC5902952. Longitudinal n=4118: neighbourhood
//     greenness lowers chronic stress.
//   Zhang et al. 2024 — Frontiers in Public Health. Shanghai SVI/ML:
//     greenness coefficient = −2.814 on stress.

/** Compute GVI from agent position via 360° horizon raycast against `green`
 *  shapes. Walls / columns / walled-site edges block rays — but a wall edge
 *  with a window or door drawn over it is treated as a cutout (the GVI ray
 *  passes through the opening), matching the LOS rules used by
 *  `hasLineOfSight`. Returns 1.0 if the agent stands inside a green polygon. */
export function computeGreenVisibility(pos: AgentPosition, shapes: Shape[]): number {
  const greens = shapes.filter((s) => s.type === "green" && s.points.length >= 3);
  if (greens.length === 0) return 0;
  for (const g of greens) {
    if (isPointInBoundary(pos.x, pos.y, g.points)) return 1.0;
  }
  const RAYS = 36;        // 10° resolution
  const MAX_DIST = 30000; // 30 m horizon
  let hits = 0;
  for (let i = 0; i < RAYS; i++) {
    const angle = (i / RAYS) * 2 * Math.PI;
    const ex = pos.x + Math.cos(angle) * MAX_DIST;
    const ey = pos.y + Math.sin(angle) * MAX_DIST;
    let greenT = Infinity;
    for (const g of greens) {
      const t = nearestRayPolygonT(pos.x, pos.y, ex, ey, g.points);
      if (t !== null && t < greenT) greenT = t;
    }
    if (greenT === Infinity) continue;
    // Cutout-aware blocker scan: a wall edge whose intersection with the
    // ray falls inside a door / window polygon is NOT a blocker (the
    // wall has been cut through there). Without this, agents indoors
    // looking through a window at trees outside read GVI = 0 even when
    // they can clearly see the greenery.
    const blockerT = nearestBlockerTWithOpenings(pos.x, pos.y, ex, ey, shapes);
    if (greenT < blockerT) hits++;
  }
  return Math.round((hits / RAYS) * 100) / 100;
}

/**
 * Nearest LOS-blocker intersection along the ray (ax,ay)→(bx,by),
 * returning the t in (0, 1] of the closest crossing — but treating any
 * wall-edge intersection that lies INSIDE a door / window polygon as a
 * cutout (i.e. NOT a blocker).
 *
 * Mirrors the cutout logic in `hasLineOfSight` so that ray-cast metrics
 * (currently GVI) agree with LOS on what actually blocks an agent's
 * line of sight. Returns Infinity when no blocker is hit before t = 1.
 */
function nearestBlockerTWithOpenings(
  ax: number, ay: number, bx: number, by: number, shapes: Shape[],
): number {
  const blockers = shapes.filter(blocksLineOfSight);
  if (blockers.length === 0) return Infinity;
  // Mirrors hasLineOfSight: only windows are LOS cutouts; doors are
  // closed by default (block LOS rays the way the wall does).
  const losOpenings = shapes.filter((s) =>
    s.type === "window" && s.points.length >= 3,
  );
  const dxAB = bx - ax, dyAB = by - ay;
  const EPS = 1e-4;
  let best = Infinity;
  for (const blocker of blockers) {
    const pts = blocker.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      // Defensive — match hasLineOfSight's guard for 2-point line shapes.
      if (pts.length === 2 && i === 1) break;
      const cx = pts[i][0], cy = pts[i][1];
      const dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
      const denom = dxAB * dyCD - dyAB * dxCD;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
      const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
      if (t > EPS && t < 1 && u >= 0 && u <= 1) {
        const ix = ax + t * dxAB;
        const iy = ay + t * dyAB;
        // Crossing inside a door / window footprint = wall section is
        // cut through here, so this intersection does NOT block.
        // Edge-tolerant — see hasLineOfSight for the rationale.
        const insideOpening = losOpenings.some((op) => isPointInBoundaryOrOnEdge(ix, iy, op.points, OPENING_EDGE_TOLERANCE_MM));
        if (insideOpening) continue;
        if (t < best) best = t;
      }
    }
  }
  return best;
}

/** Helper for computeGreenVisibility — nearest segment-intersection
 *  parameter t in [0,1] along the ray from (ax,ay) to (bx,by) against a
 *  closed polygon's edges. Returns null when no intersection. */
function nearestRayPolygonT(
  ax: number, ay: number, bx: number, by: number, pts: [number, number][],
): number | null {
  const dxAB = bx - ax, dyAB = by - ay;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const cx = pts[i][0], cy = pts[i][1];
    const dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
    const denom = dxAB * dyCD - dyAB * dxCD;
    if (Math.abs(denom) < 1e-10) continue;
    const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
    const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
    if (t > 1e-4 && t < 1 && u >= 0 && u <= 1) {
      if (t < best) best = t;
    }
  }
  return best === Infinity ? null : best;
}

/**
 * View-out factor (0..1) — how strongly an agent reads as having a
 * line-of-sight window connection to the outside. Used as a small
 * restorative damping channel parallel to GVI (greenery), since even
 * non-green window views (sky, daylight, urban) measurably reduce
 * stress and improve mood.
 *
 * Sources:
 *   - Ulrich 1984 (Science 224:420) — RCT, post-surgery patients with
 *     view of trees recovered faster + used less analgesic vs brick
 *     wall view. The seminal window-view restoration evidence.
 *   - Aries et al. 2010 (J. Environmental Psychology 30(4):533–541) — view
 *     content less critical than view PRESENCE; even neutral views
 *     beat no view.
 *   - Heschong 2003 (CEC 500-03-082) — daylight + view in offices
 *     correlated with cognitive performance.
 *
 * Ramp:
 *   sentinel −1 (no LOS-visible window): 0
 *   ≤ 2 m: 1.0
 *   2 → 10 m: linear 1.0 → 0.1
 *   ≥ 10 m: 0.1 (still some benefit if any window is in view)
 */
export function viewOutFactor(distToWindow: number): number {
  if (distToWindow < 0) return 0;
  if (distToWindow <= 2) return 1.0;
  if (distToWindow >= 10) return 0.1;
  return 1.0 - (distToWindow - 2) / 8 * 0.9;
}

/**
 * Stress-recovery factor as a function of GVI. Non-linear curve from
 * Jing et al. 2024 (RCT, VR): rising 0..0.25 with slope 3.4, plateau at
 * 0.85 from 0.25..0.75, mild decline beyond. Returns 0..0.85.
 */
export function stressRecoveryFromGVI(gvi: number): number {
  const g = Math.max(0, Math.min(1, gvi));
  if (g <= 0.25) return g * 3.4;
  if (g <= 0.75) return 0.85;
  return Math.max(0, 0.85 - (g - 0.75) * 0.3);
}

/** Anxiety amplifier table for greenery's stress-recovery effect on
 *  noise_sensitivity / exit_proximity_need. Higher anxiety → bigger
 *  proportional benefit from greenery. Per Song 2022 (effect size
 *  larger for clinically anxious cohorts). */
export function anxietyGreenAmplifier(level: AnxietyLevel): number {
  switch (level) {
    case "normal": return 1.0;
    case "mild": return 1.2;
    case "moderate": return 1.5;
    case "severe": return 1.7;
  }
}

/** Effective anxiety modifiers after greenery damping. Used by
 *  computeOutputs (downstream computed.anxiety_*) and by
 *  computePerceptualLoad (threshold ladders). */
function effectiveAnxietyModifiers(persona: PersonaData, gvi: number): AnxietyModifiers {
  const anxiety = persona.agent.anxiety ?? defaultAnxiety;
  const mods = anxiety.modifiers;
  if (anxiety.asi_level === "normal" || gvi <= 0) return mods;
  const recovery = stressRecoveryFromGVI(gvi);
  const amp = anxietyGreenAmplifier(anxiety.asi_level);
  // Damp noise_sensitivity by up to 20% × amp; exit_proximity_need by 15% × amp.
  // E.g. severe (amp=1.7) at gvi=0.25 (recovery=0.85): noise_sens × (1 − 0.289).
  return {
    noise_sensitivity:     mods.noise_sensitivity     * Math.max(0.05, 1 - recovery * 0.20 * amp),
    thermal_comfort_range: mods.thermal_comfort_range,
    personal_space_radius: mods.personal_space_radius,
    enclosure_sensitivity: mods.enclosure_sensitivity,
    exit_proximity_need:   mods.exit_proximity_need   * Math.max(0.05, 1 - recovery * 0.15 * amp),
  };
}

/**
 * Apply tree/canopy cooling to air temperature. Li 2024 meta-analysis:
 * trees lower pedestrian temp up to ~12°C; we cap at 5°C in the model
 * for typical urban canopies.
 *
 * Cooling effectiveness ramps with the ambient air temp — Li 2024's
 * cohort is pedestrian heat exposure (summer, urban canyon, daytime),
 * where evapotranspiration and shading make sense. In cool indoor
 * conditions trees are not making the air noticeably cooler than the
 * setpoint already is, so applying the same cooling at 22°C as at
 * 30°C produces a perverse outcome: agents who are already on the
 * cold side of PMV get pushed further cold by greenery, which
 * cancels out greenery's documented stress-recovery benefit.
 *
 * Ramp:
 *   ≤ 24°C : 0   (neutral indoor / cool — adding cooling is perverse,
 *                 it just pushes occupants who are already at PMV ≤ 0
 *                 into mild cold discomfort)
 *   24→27°C: 0..1 linear (cooling phases in across the warm-but-OK
 *                 band where greenery can credibly take the edge off)
 *   27→30°C: 1.0 (full canopy cooling — typical hot-day outdoor temp)
 *   > 30°C : 1.3 (heat-amp boost — Li 2024 transpiration peak)
 *
 * At a Health-Centre-style 25.5°C setpoint the ramp is 0.5, so a green
 * shape no longer cools agents into colder PMV territory — the
 * documented Song 2022 / Jing 2024 stress-recovery damping (fatigue,
 * social, visual, anxiety-amplified noise) goes through unopposed.
 */
function perceivedAirTemp(airTemp: number, gvi: number): number {
  const baseCooling = Math.min(gvi * 5.0, 5.0);
  const heatRamp =
    airTemp <= 24 ? 0 :
    airTemp >= 30 ? 1.3 :
    airTemp >= 27 ? 1.0 :
    (airTemp - 24) / 3;
  return airTemp - baseCooling * heatRamp;
}

export function computeOutputs(persona: PersonaData): ComputedOutputs {
  // Greenery: cool air temp first (Li 2024) so PMV reflects perceived temp.
  const gvi = persona.spatial.green_visibility ?? 0;
  const airTempRaw = persona.environment.air_temp;
  const perceivedTemp = perceivedAirTemp(airTempRaw, gvi);
  const recovery = stressRecoveryFromGVI(gvi);

  // MRT: independent PMV input per ISO 7730 / ASHRAE 55. The env may
  // already carry an `mrt` resolved by `getEnvAtPosition` (zone-level
  // override + window-proximity blend). The greenery cooling that we
  // applied to air_temp also applies to MRT (canopy / planting cools
  // BOTH air and surrounding surfaces in Li 2024's outdoor cohort);
  // we preserve the absolute Ta-MRT delta rather than recomputing.
  const baseMrt = persona.environment.mrt ?? airTempRaw;
  const mrtDelta = baseMrt - airTempRaw;
  const effectiveMrt = perceivedTemp + mrtDelta;

  const { pmv, ppd, heatLoss } = calculatePMV(
    perceivedTemp, effectiveMrt,
    persona.environment.air_velocity, persona.environment.humidity,
    persona.agent.metabolic_rate, persona.agent.clothing_insulation
  );
  const warnings = getPMVWarnings(
    perceivedTemp, persona.environment.humidity,
    persona.environment.air_velocity, persona.agent.metabolic_rate,
    persona.agent.clothing_insulation, pmv
  );
  const visionFactor = persona.agent.vision === "normal" ? 1 : persona.agent.vision === "mild_impairment" ? 0.75 : 0.5;
  const hearingFactor = persona.agent.hearing === "normal" ? 1 : persona.agent.hearing === "impaired" ? 1.1 : 0.7;
  const perceivedDb = Math.round(persona.environment.dB * hearingFactor);
  // Apply greenery damping to anxiety modifiers (only fires for non-normal levels).
  const effMods = effectiveAnxietyModifiers(persona, gvi);
  const anxietyPerceivedDb = Math.round(perceivedDb * effMods.noise_sensitivity * 10) / 10;
  const anxietyPmvRange = Math.round((1 / effMods.thermal_comfort_range) * 100) / 100;
  const distExit = persona.spatial.dist_to_exit;
  const anxietyPersonalSpace = distExit < 0
    ? -1
    : Math.round(distExit * effMods.exit_proximity_need * 10) / 10;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    PMV: pmv, PPD: ppd,
    effective_lux: Math.round(persona.environment.lux * visionFactor),
    perceived_dB: perceivedDb,
    pmv_warnings: warnings,
    anxiety_perceived_dB: anxietyPerceivedDb,
    anxiety_pmv_range: anxietyPmvRange,
    anxiety_personal_space: anxietyPersonalSpace,
    perceived_air_temp: r1(perceivedTemp),
    effective_mrt: r1(effectiveMrt),
    mrt_delta: r1(effectiveMrt - perceivedTemp),
    green_recovery: Math.round(recovery * 100) / 100,
    heat_loss: heatLoss,
  };
}

// ---- Perceptual Load ----
//
// Computes the six accumulated stress dimensions from raw env + spatial data
// and applies the agent's anxiety modifiers so high-ASI / clinical-subtype
// agents see amplified responses to identical environments. All five
// modifiers in `agent.anxiety.modifiers` are now read here:
//
//   thermal_comfort_range  → divides PMV envelope (via computed.anxiety_pmv_range)
//   noise_sensitivity      → scales perceived dB (via computed.anxiety_perceived_dB)
//   personal_space_radius  → multiplies social_overload base
//   enclosure_sensitivity  → adds enclosure-mismatch term to social_overload
//   exit_proximity_need    → scales effective exit distance
//                            (via computed.anxiety_personal_space)
//
// Normal-anxiety agents (all modifiers = 1.0) keep their previous values.
export function computePerceptualLoad(
  persona: PersonaData,
  computed: ComputedOutputs,
  zones?: Zone[],
): AccumulatedState {
  // Methodology v2: Layer-1 is pure physics + geometry. The personality
  // coefficients (ASI-3 thermal/noise/social/exit modifiers, MBTI
  // introversion) no longer modulate this function — the LLM (Layer 2)
  // applies its OWN reading of the same Layer-1 facts through the
  // character's disposition and register.

  // --- Thermal: |PMV| over a constant 3°C envelope. ---
  const pmvDivisor = 3;
  const thermalDiscomfort = Math.min(1, Math.abs(computed.PMV) / pmvDivisor);

  // --- Visual: lux deviation + vision penalty + windowless flat penalty.
  //
  // Windowless penalty: a fully artificial-lit interior with no
  // line-of-sight window adds a constant load on visual_strain. Even
  // when lux is near IES-optimal, an absent daylight cue + absent
  // outside view is a documented contributor to ocular fatigue and
  // mood. References:
  //   - Heschong 2003 (CEC 500-03-082) — daylight + view in offices
  //     correlated with cognitive performance.
  //   - Aries et al. 2010 (J. Environmental Psychology 30(4):533–541) — view
  //     PRESENCE matters more than view content; absence is the
  //     critical penalty.
  //   - Boubekri et al. 2014 (J Clin Sleep Med 10:603) — workers near
  //     windows had better sleep + activity scores; windowless cohort
  //     was the deficit group.
  // Open-sky zones (ZoneEnv.open_space === true — courtyard, atrium,
  // void) are genuinely outdoor. The indoor IES-calibrated optimalLux
  // glare model does NOT apply (daylight under open sky is not modelled
  // as glare here), and the windowless-room penalties / absent view-out
  // would wrongly punish the centre's most restorative space (the engine
  // already cites Ulrich 1984 / Aries 2010 for view-out recovery — an
  // open courtyard is the maximal case of that). ALL outdoor handling is
  // gated on `isOutdoor`: when false every expression reduces exactly to
  // the original, so indoor zones / the 19 stationary agents are
  // byte-identical to before.
  const isOutdoor = persona.environment.open_space === true;
  const optimalLux = 300;
  const luxDev = isOutdoor ? 0 : Math.abs(persona.environment.lux - optimalLux) / optimalLux;
  const visionPenalty = persona.agent.vision === "normal" ? 0 : persona.agent.vision === "mild_impairment" ? 0.15 : 0.3;
  const hasWindowInLOS = persona.spatial.dist_to_window >= 0;
  const windowlessVisualPenalty = (hasWindowInLOS || isOutdoor) ? 0 : 0.15;
  const visualStrain = Math.min(1, luxDev * 0.6 + visionPenalty + windowlessVisualPenalty);

  // --- Noise: feed the raw measured dB through the threshold ladder. ---
  // (Anxiety amplification moves to Layer 2 — the LLM reads the raw dB
  // through its character's anxiety register.)
  const noiseInput = persona.environment.dB;
  const noiseBase = noiseInput > 70 ? 0.8 : noiseInput > 55 ? 0.4 : noiseInput > 40 ? 0.2 : 0.05;
  const hearingPenalty = persona.agent.hearing === "impaired" ? 0.15 : persona.agent.hearing === "deaf" ? -0.1 : 0;
  const noiseStress = Math.min(1, Math.max(0, noiseBase + hearingPenalty));

  // --- Social: straight density ladder on visible_agents (Layer-1). ---
  // MBTI and ASI-driven personal-space + enclosure-sensitivity modulation
  // is the LLM's job (Layer 2), not the engine's.
  const socialCore = persona.spatial.visible_agents > 5 ? 0.6 : persona.spatial.visible_agents > 2 ? 0.3 : 0.1;
  let socialOverload = Math.min(1, Math.max(0, socialCore));

  // --- Personal-space adequacy via zone density ---
  // Hall 1966 / Sommer 1969 / Stokols 1972 / Evans 2003 / WELL v2.
  // Compute m²/person from the zone's floor area and occupant count
  // (visible_agents + 1, where visible_agents is LOS-bounded and after
  // the door-blocks-LOS fix is a reasonable proxy for co-zone count).
  // Apply a research-curve multiplier:
  //   ≥ 8 m²/pp     : factor 1.00 — public-distance comfort
  //   4–8 m²/pp     : 1.00 → 1.20 — Hall social-distance breach
  //   2–4 m²/pp     : 1.20 → 1.60 — personal-distance breach (Evans
  //                                 chronic-crowding cortisol band)
  //   < 2 m²/pp     : up to 2.50 — intimate breach
  // Apply as additive boost on social_overload (already past its
  // own ladder ceiling, so we add post-cap and re-clip), and a
  // smaller boost on fatigue (chronic crowding sustains sympathetic
  // activation per Evans 2003).
  let densityM2PerPerson = -1;
  let densityFactor = 1.0;
  if (zones && zones.length > 0) {
    const px = persona.position.cell[0] * 1000;
    const py = persona.position.cell[1] * 1000;
    const zone = getZoneAtPosition(px, py, zones);
    if (zone) {
      const area = zoneAreaM2(zone);
      if (area > 0) {
        const occupants = persona.spatial.visible_agents + 1;
        densityM2PerPerson = area / occupants;
        densityFactor = densityPenaltyMultiplier(densityM2PerPerson);
      }
    }
  }
  // socialBoost is 0 when factor = 1.0 (no penalty), up to 1.5 at
  // factor 2.5 (severe crowding). Scaled into 0..0.45 added to
  // social_overload — large enough to push over the cap when severe,
  // small enough that mild crowding (5 m²/pp) only adds ~0.02.
  const densityExcess = Math.max(0, densityFactor - 1.0);
  if (densityExcess > 0) {
    socialOverload = Math.min(1, socialOverload + densityExcess * 0.30);
  }

  // --- Fatigue: duration × age × thermal carryover + windowless duration penalty.
  //
  // Windowless duration penalty: the longer an agent stays in an
  // interior with no line-of-sight window, the more mental fatigue
  // accumulates (Boubekri 2014; Heschong 2003). Scales with duration:
  // a 15-min visit to a windowless room is mild; a 90-min group
  // therapy session in one is meaningfully draining. Calibrated so a
  // 90-min session adds ~0.30 to fatigue load.
  const durationFactor = Math.min(1, persona.position.duration_in_cell / 120);
  const ageFactor = persona.agent.age > 65 ? 0.2 : persona.agent.age > 45 ? 0.1 : 0;
  const windowlessFatiguePenalty = (hasWindowInLOS || isOutdoor)
    ? 0
    : persona.position.duration_in_cell < 30 ? 0.05
    : persona.position.duration_in_cell < 60 ? 0.15
    : persona.position.duration_in_cell < 90 ? 0.25
    : 0.30;
  // Chronic-crowding fatigue boost (Evans 2003): sustained crowding
  // raises cortisol baseline; we add a smaller share of densityExcess
  // to fatigue so a 2 m²/pp space leaks ~0.20 into fatigue on top of
  // the social boost. Scales with duration via durationFactor so a
  // brief overcrowded corridor does NOT load fatigue significantly.
  const densityFatigueBoost = densityExcess * 0.20 * durationFactor;
  let fatigue = Math.min(1, durationFactor * 0.5 + ageFactor + thermalDiscomfort * 0.2 + windowlessFatiguePenalty + densityFatigueBoost);

  // --- Wayfinding: raw effective exit distance. ---
  // Layer-1 geometry only; the "panic when no exit" amplification moves
  // to Layer 2 — the LLM reads dist_to_exit through its anxiety register.
  const effectiveExit = persona.spatial.dist_to_exit;
  const baseExitFactor = effectiveExit < 0
    ? 0.7  // unknown exit — meaningful trapped baseline
    : effectiveExit > 10 ? 0.5 : effectiveExit > 5 ? 0.3 : 0.1;
  const exitFactor = baseExitFactor;
  const mobilityPenalty = persona.agent.mobility !== "normal" ? 0.2 : 0;
  let wayfindingAnxiety = Math.min(1, exitFactor + mobilityPenalty);

  // --- Claustrophobic compound (Stokols 1972 / Evans 2003 / McEwen 1998).
  // When the spatial trap signals all fire together — no LOS window,
  // no reachable exit, fully enclosed (encl > 0.85), and crowded
  // (visAgents ≥ 3) — the per-dim ladder underweights what is in
  // psychology a multiplicative allostatic-load condition. We compute
  // a compound score that boosts fatigue (sustained sympathetic
  // activation) scaled by duration in the room and the agent's ASI.
  // Pure spatial inputs only; no active systems (CO₂ etc.) per the
  // user's research-scope brief.
  const noExit = persona.spatial.dist_to_exit < 0;
  // An open-sky zone is the opposite of a sealed windowless trap — never
  // count it as "no window" in the claustrophobic compound.
  const noWindow = !isOutdoor && persona.spatial.dist_to_window < 0;
  const sealed = persona.spatial.enclosure_ratio > 0.85;
  const crowded = persona.spatial.visible_agents >= 3;
  const trappedCount = (noExit ? 1 : 0) + (noWindow ? 1 : 0) + (sealed ? 1 : 0) + (crowded ? 1 : 0);
  // Require at least 3 of 4 trap signals firing — otherwise it is just
  // an ordinary cell, not a sealed crowded windowless trap.
  const trappedIntensity = trappedCount >= 3
    ? (trappedCount / 4) * Math.min(1, persona.position.duration_in_cell / 60)
    : 0;
  // Compound also lifts wayfinding when 4-of-4 conditions, which the
  // exit-factor branch alone can't capture (no-exit is just one input).
  if (trappedIntensity > 0) {
    wayfindingAnxiety = Math.min(1, wayfindingAnxiety + trappedIntensity * 0.20);
  }

  // --- Greenery stress recovery (Song 2022 effect sizes scaled to 0..1) ---
  // fatigue       ×= (1 − recovery × 0.20)   max 17% reduction at recovery=0.85
  // social        ×= (1 − recovery × 0.15)   max 12.75%
  // visual_strain ×= (1 − recovery × 0.10)   max 8.5%
  // Apply claustrophobic compound to fatigue (allostatic load grows
  // when sealed-trap signals persist over time) and social_overload
  // (Evans 2003: crowding stress is multiplicatively worse when
  // there is no escape valve). Applied BEFORE greenery / view-out
  // damping so any residual restorative effect can still help.
  if (trappedIntensity > 0) {
    fatigue = Math.min(1, fatigue + trappedIntensity * 0.25);
    socialOverload = Math.min(1, socialOverload + trappedIntensity * 0.10);
  }

  const recovery = computed.green_recovery;
  let fatigueOut = fatigue * (1 - recovery * 0.20);
  let socialOut = socialOverload * (1 - recovery * 0.15);
  let visualOut = visualStrain * (1 - recovery * 0.10);

  // --- View-out restorative damping (Ulrich 1984 / Aries 2010) ---
  // When a window IS visible, line-of-sight to the outside provides
  // documented stress recovery beyond what's captured by GVI alone —
  // even non-green views (sky, urban) reduce sympathetic activity
  // (Ulrich 1984; Aries 2010 found view content less critical than
  // view PRESENCE). Scaled smaller than greenery damping so a window
  // onto a planted courtyard is best (both stack), a window onto a
  // brick wall still helps mildly, and no window at all gets the
  // windowless penalties applied above WITHOUT this damping.
  // fatigue       ×= (1 − viewOut × 0.10)   max 10% reduction
  // social        ×= (1 − viewOut × 0.08)   max 8%
  // visual_strain ×= (1 − viewOut × 0.05)   max 5%
  // Open sky = the maximal view-out (unobstructed outdoor exposure);
  // Ulrich 1984 / Aries 2010 restorative damping applies in full.
  const viewOut = isOutdoor ? 1 : viewOutFactor(persona.spatial.dist_to_window);
  fatigueOut *= (1 - viewOut * 0.10);
  socialOut  *= (1 - viewOut * 0.08);
  visualOut  *= (1 - viewOut * 0.05);

  return {
    thermal_discomfort: Math.round(thermalDiscomfort * 100) / 100,
    visual_strain: Math.round(visualOut * 100) / 100,
    noise_stress: Math.round(noiseStress * 100) / 100,
    social_overload: Math.round(socialOut * 100) / 100,
    fatigue: Math.round(fatigueOut * 100) / 100,
    wayfinding_anxiety: Math.round(wayfindingAnxiety * 100) / 100,
  };
}

// ---- Spatial Calculations ----

/**
 * Distance from (ax,ay) to nearest shape of given type(s) in metres.
 * Accepts a single ShapeType or an array of ShapeTypes (for "wall+column" combos).
 * Returns -1 if no shape of that type is found.
 *
 * Per-type semantics:
 *   - WINDOW: LOS-gated — you only "see" a window you can actually
 *     see; visual-amenity metric, feeds view-out factor.
 *   - DOOR: NOT LOS-gated, BUT must be in the agent's reachable room
 *     (no wall between agent and the door's interior face). Doors
 *     are wayfinding landmarks but only the doors of the room you
 *     are CURRENTLY IN count as exits — a door in a sealed
 *     neighbouring room is not an exit for you. Implemented via
 *     `isDoorInAgentRoom`: probe the door's room-side sample point
 *     and check it is reachable by straight line that does not cross
 *     any wall (no cutouts). When the agent has no reachable door,
 *     dist_to_exit = −1 (agent feels trapped, wayfinding load 0.5).
 *   - WALL / COLUMN / SITE: pure geometric distance (no gating).
 *
 * History:
 *   - Pre-fix: doors LOS-gated like windows. Worked when doors were
 *     LOS cutouts, broke when doors began blocking LOS (commit
 *     e4b8271 — door's centroid sits inside wall thickness, so
 *     LOS-to-centroid was always blocked). Result: every agent
 *     read dist_to_exit = −1.
 *   - Post-fix (this commit): reachability-based gating uses straight
 *     ray to a sample point offset 300 mm from the door's centerline
 *     midpoint into either adjacent space. If either side is reachable
 *     without a wall crossing, the door is on the agent's room side.
 */
/**
 * Strict ray-vs-wall intersection test (no cutouts). Returns true if
 * the segment (ax,ay)→(bx,by) crosses any LOS-blocker edge anywhere
 * along its interior (excluding the endpoints). Used for the
 * reachability test for door-as-exit: walls are walls, even where a
 * door or window is drawn over them — for the purpose of "can I walk
 * to that door without crossing into another room?", a wall always
 * separates rooms.
 */
function rayCrossesWall(ax: number, ay: number, bx: number, by: number, shapes: Shape[]): boolean {
  const blockers = shapes.filter(blocksLineOfSight);
  if (blockers.length === 0) return false;
  const dxAB = bx - ax;
  const dyAB = by - ay;
  const EPS = 1e-4;
  for (const blocker of blockers) {
    const pts = blocker.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (pts.length === 2 && i === 1) break;
      const cx = pts[i][0], cy = pts[i][1];
      const dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
      const denom = dxAB * dyCD - dyAB * dxCD;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
      const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) return true;
    }
  }
  return false;
}

/**
 * Check whether a door is part of the room the agent is currently in
 * (i.e. the door's threshold can be reached from the agent's position
 * without crossing a wall). Probes a sample point 300 mm offset from
 * the door's centerline midpoint into both adjacent spaces; if EITHER
 * sample is reachable from (ax, ay) without a wall crossing, the door
 * is on the agent's room side. Falls back to the door's 4 polygon
 * corners when no centerline meta is available (older shape data).
 */
function isDoorInAgentRoom(ax: number, ay: number, door: Shape, shapes: Shape[]): boolean {
  const cl = door.meta?.centerline;
  if (cl) {
    const [a, b] = cl;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      const offset = 300; // mm into the room from the wall surface
      const sampleA: [number, number] = [cx + nx * offset, cy + ny * offset];
      const sampleB: [number, number] = [cx - nx * offset, cy - ny * offset];
      if (!rayCrossesWall(ax, ay, sampleA[0], sampleA[1], shapes)) return true;
      if (!rayCrossesWall(ax, ay, sampleB[0], sampleB[1], shapes)) return true;
      return false;
    }
  }
  // Centerline missing — probe each polygon corner.
  for (const p of door.points) {
    if (!rayCrossesWall(ax, ay, p[0], p[1], shapes)) return true;
  }
  return false;
}

export function distToShapeType(
  ax: number, ay: number, shapes: Shape[], type: ShapeType | ShapeType[]
): number {
  let minDist = Infinity;
  const types = Array.isArray(type) ? type : [type];
  const filtered = shapes.filter((s) => types.includes(s.type));
  if (filtered.length === 0) return -1;
  // Window-only queries use LOS gating (with the established window-
  // cutout semantics). Mixed / non-window queries fall through.
  const needLOS = types.every((t) => t === "window");
  for (const shape of filtered) {
    if (needLOS) {
      const [cx, cy] = shapeCentroid(shape.points);
      if (!hasLineOfSight(ax, ay, cx, cy, shapes)) continue;
    }
    // Door-specific reachability gate: only count doors whose
    // room-side sample is in the agent's reachable space (no wall
    // between them). Without this, dist_to_exit would return the
    // raw geometric distance to *any* door in the building, including
    // doors in sealed neighbouring rooms — exactly the failure
    // mode the user just flagged.
    if (shape.type === "door" && !isDoorInAgentRoom(ax, ay, shape, shapes)) continue;
    const pts = shape.points;
    if (pts.length < 2) continue;
    // window = 2-point line; site/wall/column/door = closed polygon
    const isClosed = shape.type !== "window" && pts.length >= 3;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (!isClosed && j === 0 && pts.length > 1) continue;
      const d = distToSegment(ax, ay, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      if (d < minDist) minDist = d;
    }
  }
  return minDist === Infinity ? -1 : Math.round(minDist / 100) / 10;
}

export function computeEnclosure(ax: number, ay: number, shapes: Shape[]): number {
  const blockers = shapes.filter(blocksLineOfSight);
  if (blockers.length === 0) return 0;
  const rays = 16;
  let hits = 0;
  const reach = 10000;
  for (let i = 0; i < rays; i++) {
    const angle = (i / rays) * Math.PI * 2;
    const ex = ax + Math.cos(angle) * reach;
    const ey = ay + Math.sin(angle) * reach;
    let rayHit = false;
    for (const blocker of blockers) {
      if (rayHit) break;
      const pts = blocker.points;
      for (let j = 0; j < pts.length; j++) {
        const k = (j + 1) % pts.length;
        if (pts.length === 2 && j === 1) break;
        if (lineIntersect(ax, ay, ex, ey, pts[j][0], pts[j][1], pts[k][0], pts[k][1])) {
          rayHit = true; break;
        }
      }
    }

    if (rayHit) hits++;
  }
  return Math.round((hits / rays) * 100) / 100;
}

// ---- Point-in-Polygon (for vis.agent boundary detection) ----
export function isPointInBoundary(px: number, py: number, roomPoints: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = roomPoints.length - 1; i < roomPoints.length; j = i++) {
    const xi = roomPoints[i][0], yi = roomPoints[i][1];
    const xj = roomPoints[j][0], yj = roomPoints[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function computeSpatialFromAgent(
  pos: AgentPosition, shapes: Shape[], currentSpatial: SpatialData,
  zones?: Zone[],
): SpatialData {
  // dist_to_wall now considers the new physical obstacles: walls + columns.
  // (The old "boundary" semantics — outermost room perimeter — is now `site`
  //  with optional hasWalls; if none of the new shapes exist yet, fall back
  //  to site edge so the metric still produces a meaningful number.)
  let distWall = distToShapeType(pos.x, pos.y, shapes, ["wall", "column"]);
  if (distWall < 0) {
    distWall = distToShapeType(pos.x, pos.y, shapes, "site");
  }
  const distWin = distToShapeType(pos.x, pos.y, shapes, "window");
  const distDoor = distToShapeType(pos.x, pos.y, shapes, "door");
  const enclosure = computeEnclosure(pos.x, pos.y, shapes);
  // Pull ceiling height from the containing zone (mm → m). When the agent
  // is not inside any zone the metric has no meaningful answer, so we
  // emit sentinel -1 (display layer renders "N/A"). Same convention as
  // dist_to_window / dist_to_exit.
  let ceiling = -1;
  if (zones && zones.length > 0) {
    const zone = getZoneAtPosition(pos.x, pos.y, zones);
    if (zone) {
      ceiling = Math.round((zone.env.ceiling_height / 1000) * 100) / 100;
    }
  }
  return {
    dist_to_wall: distWall,
    dist_to_window: distWin,
    // dist_to_exit ONLY counts reachable doors (distToShapeType for
    // doors uses isDoorInAgentRoom). When no door is reachable from
    // the agent's room, returns −1 — agent feels trapped, wayfinding
    // ladder reads max load (0.5).
    //
    // Previously this had a `: distWall` fallback, which made walls
    // masquerade as exits whenever no door was reachable: an agent in
    // a sealed room saw "exit at 3 m" pointing at the nearest wall.
    // Architecturally meaningless and the very thing the user just
    // flagged ("某 d wall 都好奇怪咁被當左門").
    dist_to_exit: distDoor,
    ceiling_h: ceiling,
    enclosure_ratio: enclosure,
    visible_agents: currentSpatial.visible_agents, // will be overridden by computeVisibleAgents
    green_visibility: computeGreenVisibility(pos, shapes),
  };
}

// ---- Vis.Agent Dynamic Calculation ----
// Counts how many OTHER agents are visible to the given agent.
// Site polygons define the "room" — agents in the same site can see each
// other (subject to LOS). Walls / columns / doors break LOS.
export function computeVisibleAgents(
  agentIdx: number,
  allPositions: (AgentPosition | null)[],
  shapes: Shape[]
): number {
  const myPos = allPositions[agentIdx];
  if (!myPos) return 0;

  const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
  const mySites = sites.filter((r) => isPointInBoundary(myPos.x, myPos.y, r.points));

  if (mySites.length === 0) {
    // Agent is outside all sites — see other agents also outside, clear LOS
    let count = 0;
    for (let i = 0; i < allPositions.length; i++) {
      if (i === agentIdx || !allPositions[i]) continue;
      const otherPos = allPositions[i]!;
      const otherInSite = sites.some((r) => isPointInBoundary(otherPos.x, otherPos.y, r.points));
      if (!otherInSite && hasLineOfSight(myPos.x, myPos.y, otherPos.x, otherPos.y, shapes)) count++;
    }
    return count;
  }

  // Agent is inside site(s) — count others in same site(s) with clear LOS
  let count = 0;
  for (let i = 0; i < allPositions.length; i++) {
    if (i === agentIdx || !allPositions[i]) continue;
    const otherPos = allPositions[i]!;
    const sameSite = mySites.some((r) => isPointInBoundary(otherPos.x, otherPos.y, r.points));
    if (sameSite && hasLineOfSight(myPos.x, myPos.y, otherPos.x, otherPos.y, shapes)) count++;
  }
  return count;
}

/** Returns the first site polygon containing the given world point, or null
 *  if the point is outside every site. Used for the "must draw inside site"
 *  validation when adding new shapes. */
export function findContainingSite(px: number, py: number, shapes: Shape[]): Shape | null {
  for (const s of shapes) {
    if (s.type !== "site" || s.points.length < 3) continue;
    if (isPointInBoundary(px, py, s.points)) return s;
  }
  return null;
}

/** Edge-tolerant point-in-polygon — returns true if the point is inside the
 *  polygon OR within `epsilon` mm of any edge. Used by the site-containment
 *  check so that shapes whose corners sit exactly on the site perimeter are
 *  still considered "inside". */
export function isPointInBoundaryOrOnEdge(
  px: number, py: number, pts: [number, number][], epsilon = 5
): boolean {
  if (isPointInBoundary(px, py, pts)) return true;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    let t = ((px - pts[j][0]) * dx + (py - pts[j][1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = pts[j][0] + t * dx;
    const cy = pts[j][1] + t * dy;
    const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    if (d <= epsilon) return true;
  }
  return false;
}

/** Returns true if every point of `pts` lies inside at least one site polygon
 *  (edge-tolerant: points exactly on a site edge count as inside). */
export function isShapeInsideSite(pts: [number, number][], shapes: Shape[]): boolean {
  const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
  if (sites.length === 0) return false;
  return pts.every(([px, py]) => sites.some((s) => isPointInBoundaryOrOnEdge(px, py, s.points)));
}

export function posToCell(x: number, y: number, cellSize = 1000): [number, number] {
  return [Math.floor(x / cellSize), Math.floor(y / cellSize)];
}

// ---- Default Layout & Preset Registry ----
export interface LayoutData {
  shapes: Shape[];
  zones: Zone[];
  agentPositions: (AgentPosition | null)[];
  waypoints: Record<number, Waypoint[]>;
}

export interface LayoutPreset {
  /** Stable id used for persistence + URL params; kebab-case. */
  id: string;
  /** Human-readable name shown in UI selectors. */
  name: string;
  data: LayoutData;
}

/**
 * Registry of bundled layout presets. The first entry is treated as the
 * built-in default for first-run bootstrap. Add new presets by dropping a
 * JSON file under `client/src/lib/presets/` and appending an entry here.
 */
export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "default", name: "Default", data: defaultLayoutData as unknown as LayoutData },
  { id: "light-rail-platform-before", name: "Light Rail Platform Before", data: lightRailPlatformBeforeData as unknown as LayoutData },
];

export function getPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}

/** Backwards-compat alias — first preset acts as the implicit default. */
export const DEFAULT_LAYOUT = LAYOUT_PRESETS[0].data;

// ---- LocalStorage Persistence ----
// Version bump forces all clients to reset to new default personas
// v4 = Shape model refactor: boundary -> site / wall / column / door / window
const STORE_VERSION = "v4";
const SHAPES_KEY = `thesis_spatial_shapes_${STORE_VERSION}`;
const MULTI_AGENT_KEY = `thesis_multi_agent_${STORE_VERSION}`;
const ZONES_KEY = `thesis_zones_${STORE_VERSION}`;
// Clear any old versioned keys on load
if (typeof window !== "undefined") {
  ["thesis_spatial_shapes", "thesis_multi_agent",
   "thesis_spatial_shapes_v1", "thesis_multi_agent_v1",
   "thesis_spatial_shapes_v2", "thesis_multi_agent_v2",
   "thesis_spatial_shapes_v3", "thesis_multi_agent_v3", "thesis_zones_v3"].forEach((k) => {
    try { localStorage.removeItem(k); } catch {}
  });
}

/** Migrate legacy shapes into the current model:
 *   - "boundary" type → "site" with hasWalls=true (preserves prior LOS/move).
 *   - 2-point windows  → 4-point thick rectangles (default 100mm thickness),
 *     so windows render as glass blocks like walls/doors and can be cut by
 *     other openings consistently.
 *   - "special" shapes pass through unchanged (added in commit eea82b9).
 */
export function migrateLegacyShapes(input: unknown): Shape[] {
  if (!Array.isArray(input)) return [];
  const out: Shape[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as { type?: string; points?: [number, number][]; label?: string; meta?: ShapeMeta };
    if (!s.points || !Array.isArray(s.points)) continue;
    const t = s.type;
    if (t === "boundary") {
      out.push({ type: "site", points: s.points, label: s.label, meta: { hasWalls: true } });
    } else if (t === "window" && s.points.length === 2) {
      // Legacy 2-point window → upgrade to a 100mm-thick rectangle.
      const [a, b] = s.points;
      const thickness = (s.meta?.thickness ?? 100) as 100 | 300;
      const side = s.meta?.side ?? "left";
      const rect = buildThickRect(a[0], a[1], b[0], b[1], thickness, side);
      out.push({
        type: "window",
        points: rect,
        label: s.label,
        meta: { ...s.meta, thickness, centerline: [a, b] as [[number, number], [number, number]], side },
      });
    } else if (t === "site" || t === "wall" || t === "column" || t === "door" || t === "window" || t === "green" || t === "special") {
      out.push({ type: t, points: s.points, label: s.label, meta: s.meta });
    }
  }
  return out;
}

export function saveShapes(shapes: Shape[]) {
  try { localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes)); } catch {}
}
export function loadShapes(): Shape[] {
  try {
    const s = localStorage.getItem(SHAPES_KEY);
    if (s) return migrateLegacyShapes(JSON.parse(s));
    // No saved data — return default layout shapes (already migrated via cast)
    return migrateLegacyShapes(DEFAULT_LAYOUT.shapes);
  } catch { return migrateLegacyShapes(DEFAULT_LAYOUT.shapes); }
}
export function saveZones(zones: Zone[]) {
  try { localStorage.setItem(ZONES_KEY, JSON.stringify(zones)); } catch {}
}
/** Backfill new ZoneEnv fields on legacy saves so `+= undefined` never produces NaN. */
export function migrateZoneEnv(z: Zone): Zone {
  const env = z.env || {};
  return {
    ...z,
    env: {
      temperature: typeof env.temperature === "number" ? env.temperature : defaultZoneEnv.temperature,
      humidity: typeof env.humidity === "number" ? env.humidity : defaultZoneEnv.humidity,
      light: typeof env.light === "number" ? env.light : defaultZoneEnv.light,
      noise: typeof env.noise === "number" ? env.noise : defaultZoneEnv.noise,
      air_velocity: typeof env.air_velocity === "number" ? env.air_velocity : defaultZoneEnv.air_velocity,
      ceiling_height: typeof env.ceiling_height === "number" ? env.ceiling_height : defaultZoneEnv.ceiling_height,
      open_space: typeof env.open_space === "boolean" ? env.open_space : defaultZoneEnv.open_space,
      // mrt + outdoor_air_temp stay optional; legacy saves with neither
      // continue to behave as radiant-symmetric (MRT=Ta, no window
      // proximity blending).
      ...(typeof env.mrt === "number" ? { mrt: env.mrt } : {}),
      ...(typeof env.outdoor_air_temp === "number" ? { outdoor_air_temp: env.outdoor_air_temp } : {}),
    },
  };
}

export function loadZones(): Zone[] {
  try {
    const s = localStorage.getItem(ZONES_KEY);
    if (s) return (JSON.parse(s) as Zone[]).map(migrateZoneEnv);
    // No saved data — return default layout zones
    return DEFAULT_LAYOUT.zones.map(migrateZoneEnv);
  } catch { return DEFAULT_LAYOUT.zones.map(migrateZoneEnv); }
}
export function saveMultiAgent(data: { personas: PersonaData[]; positions: (AgentPosition | null)[] }) {
  try { localStorage.setItem(MULTI_AGENT_KEY, JSON.stringify(data)); } catch {}
}
export function loadMultiAgent(): { personas: PersonaData[]; positions: (AgentPosition | null)[] } | null {
  try {
    const s = localStorage.getItem(MULTI_AGENT_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as { personas: PersonaData[]; positions: (AgentPosition | null)[] };
    // Migration: older saves may not contain an anxiety block on agents. Backfill
    // with default (score 0, normal, identity modifiers) so downstream computations
    // never see `undefined`.
    parsed.personas = (parsed.personas || []).map((p) => {
      if (!p || !p.agent) return p;
      const anxiety = p.agent.anxiety && typeof p.agent.anxiety.asi_score === "number"
        // Always re-derive level/modifiers from score to keep data self-consistent.
        ? buildAnxietyData(p.agent.anxiety.asi_score)
        : buildAnxietyData(0);
      return hydratePersonaDefaults({ ...p, agent: { ...p.agent, anxiety } });
    });
    return parsed;
  } catch { return null; }
}

// ---- Waypoint Persistence ----
const WAYPOINTS_KEY = `thesis_waypoints_${STORE_VERSION}`;

export function saveWaypoints(agentIdx: number, waypoints: Waypoint[]) {
  try {
    const all = loadAllWaypoints();
    all[agentIdx] = waypoints;
    localStorage.setItem(WAYPOINTS_KEY, JSON.stringify(all));
  } catch {}
}

export function loadAllWaypoints(): Record<number, Waypoint[]> {
  try {
    const s = localStorage.getItem(WAYPOINTS_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

export function loadWaypoints(agentIdx: number): Waypoint[] {
  return loadAllWaypoints()[agentIdx] || [];
}

// ---- Perception Log Persistence ----
const PERCEPTION_LOGS_KEY = `thesis_perception_logs_${STORE_VERSION}`;

export function saveAllPerceptionLogs(logs: Record<number, PerceptionLogEntry[]>) {
  try { localStorage.setItem(PERCEPTION_LOGS_KEY, JSON.stringify(logs)); } catch {}
}

/**
 * Methodology v2 migration: older saved entries do not carry
 * `accState_engine` (it was optional before). Default it to the legacy
 * `accState` value so the new required field is satisfied on rehydrate.
 */
export function migratePerceptionLog(entry: PerceptionLogEntry): PerceptionLogEntry {
  if (entry.accState_engine) return entry;
  return { ...entry, accState_engine: entry.accState };
}

export function loadAllPerceptionLogs(): Record<number, PerceptionLogEntry[]> {
  try {
    const s = localStorage.getItem(PERCEPTION_LOGS_KEY);
    if (!s) return {};
    const raw = JSON.parse(s) as Record<string, PerceptionLogEntry[]>;
    const out: Record<number, PerceptionLogEntry[]> = {};
    for (const [k, list] of Object.entries(raw)) {
      out[Number(k)] = Array.isArray(list) ? list.map(migratePerceptionLog) : [];
    }
    return out;
  } catch { return {}; }
}

export interface RouteSummary {
  totalDwellMin: number;
  totalBudgetMin: number;
  avgComfort: number;
  avgStress: number;
  legCount: number;
  finalSummary: string;
  trend: "rising" | "declining" | "stable";
  startComfort: number;
  endComfort: number;
}

export function computeRouteSummary(
  log: PerceptionLogEntry[],
  waypoints: Waypoint[],
  persona: PersonaData,
): RouteSummary | null {
  if (!log || log.length === 0) return null;
  const dwellEntries = log.filter((e) => e.phase === "dwelling");
  if (dwellEntries.length === 0) return null;
  const avgComfort = Math.round(
    (log.reduce((s, e) => s + e.experience.comfort_score, 0) / log.length) * 10
  ) / 10;
  const avgStress = Math.round(
    (dwellEntries.reduce((s, e) => s + computeStressScore(e.accState), 0) / dwellEntries.length) * 10
  ) / 10;
  const hasRoute = waypoints.length > 0;
  const totalBudgetMin = persona.position.duration_in_cell;
  const totalDwellMin = hasRoute
    ? waypoints.reduce((s, w) => s + (w.dwell_minutes || 0), 0)
    : totalBudgetMin;
  const legCount = hasRoute ? waypoints.length : 1;
  const startComfort = log[0].experience.comfort_score;
  const endComfort = log[log.length - 1].experience.comfort_score;
  const delta = endComfort - startComfort;
  const trend: "rising" | "declining" | "stable" =
    delta > 0.5 ? "rising" : delta < -0.5 ? "declining" : "stable";
  const finalSummary = dwellEntries[dwellEntries.length - 1].experience.summary || "";
  return {
    totalDwellMin,
    totalBudgetMin,
    avgComfort,
    avgStress,
    legCount,
    finalSummary,
    trend,
    startComfort,
    endComfort,
  };
}

// ============================================================
// ---- Canvas (Scheme) Persistence ---------------------------
// ============================================================
// A Canvas captures one architectural scheme that all shared agents
// can be evaluated against: shapes, zones, per-agent starting positions,
// waypoint routes, and resulting perception logs. Personas (agent
// configs) live separately and are shared across canvases.
export interface CanvasData {
  id: string;
  name: string;
  shapes: Shape[];
  zones: Zone[];
  agentPositions: (AgentPosition | null)[];
  waypoints: Record<number, Waypoint[]>;
  perceptionLogs: Record<number, PerceptionLogEntry[]>;
}

export interface CanvasStore {
  canvases: CanvasData[];
  activeIdx: number;
}

export const MAX_CANVASES = 5;

const CANVASES_KEY = `thesis_canvases_${STORE_VERSION}`;
const PERSONAS_KEY = `thesis_personas_${STORE_VERSION}`;

function genCanvasId(): string {
  return `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function makeEmptyCanvas(name: string, agentCount: number): CanvasData {
  return {
    id: genCanvasId(),
    name,
    shapes: migrateLegacyShapes(DEFAULT_LAYOUT.shapes),
    zones: DEFAULT_LAYOUT.zones,
    agentPositions: Array.from({ length: agentCount }, (_, i) => DEFAULT_LAYOUT.agentPositions[i] ?? null),
    waypoints: {},
    perceptionLogs: {},
  };
}

export function cloneCanvas(src: CanvasData, name: string): CanvasData {
  // Deep-ish clone: we never mutate the inner objects, but copy arrays/records
  // so independent edits in the new canvas do not leak back to the source.
  return {
    id: genCanvasId(),
    name,
    shapes: src.shapes.map((s) => ({ ...s, points: s.points.map((p) => [...p] as [number, number]) })),
    zones: src.zones.map((z) => ({ ...z, bounds: { ...z.bounds }, env: { ...z.env } })),
    agentPositions: src.agentPositions.map((p) => (p ? { ...p } : null)),
    waypoints: Object.fromEntries(
      Object.entries(src.waypoints).map(([k, v]) => [k, v.map((w) => ({ ...w, position: { ...w.position } }))])
    ),
    perceptionLogs: {}, // simulation results never carry over
  };
}

export function savePersonas(personas: PersonaData[]) {
  try { localStorage.setItem(PERSONAS_KEY, JSON.stringify(personas)); } catch {}
}

export function loadPersonas(): PersonaData[] | null {
  try {
    const s = localStorage.getItem(PERSONAS_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as PersonaData[];
    return parsed.map((p) => {
      if (!p || !p.agent) return p;
      const anxiety = p.agent.anxiety && typeof p.agent.anxiety.asi_score === "number"
        ? buildAnxietyData(p.agent.anxiety.asi_score)
        : buildAnxietyData(0);
      return hydratePersonaDefaults({ ...p, agent: { ...p.agent, anxiety } });
    });
  } catch { return null; }
}

export function saveCanvasStore(store: CanvasStore) {
  try { localStorage.setItem(CANVASES_KEY, JSON.stringify(store)); } catch {}
}

export function loadCanvasStore(): CanvasStore | null {
  try {
    const s = localStorage.getItem(CANVASES_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as CanvasStore;
    if (!parsed.canvases || parsed.canvases.length === 0) return null;
    const activeIdx = Math.max(0, Math.min(parsed.canvases.length - 1, parsed.activeIdx ?? 0));
    // Migrate per-canvas zones: older saves predate ceiling_height / open_space
    // and would otherwise propagate undefined into env arithmetic.
    const canvases = parsed.canvases.map((cv) => ({
      ...cv,
      zones: (cv.zones ?? []).map(migrateZoneEnv),
    }));
    return { canvases, activeIdx };
  } catch { return null; }
}

/**
 * Migrate legacy single-canvas data (separate keys for shapes/zones/positions/
 * waypoints/perception logs) into a single canvas store. Idempotent: if a
 * canvas store already exists it is returned as-is.
 *
 * Returns the migrated/loaded store plus the persona list.
 */
export function loadCanvasesWithMigration(): { store: CanvasStore; personas: PersonaData[] } {
  // Personas: prefer the new dedicated key, otherwise fall back to the legacy
  // multi-agent blob, otherwise the built-in defaults.
  let personas = loadPersonas();
  if (!personas) {
    const legacyMA = loadMultiAgent();
    personas = legacyMA?.personas ?? defaultPersonas;
  }

  const existing = loadCanvasStore();
  if (existing) {
    return { store: existing, personas };
  }

  // Build a single canvas from the legacy keys.
  const legacyShapes = loadShapes();
  const legacyZones = loadZones();
  const legacyMA = loadMultiAgent();
  const legacyWps = loadAllWaypoints();
  const legacyLogs = loadAllPerceptionLogs();
  const positions: (AgentPosition | null)[] = personas.map((_, i) => {
    if (legacyMA && legacyMA.positions[i] !== undefined) return legacyMA.positions[i];
    return DEFAULT_LAYOUT.agentPositions[i] ?? null;
  });

  const canvas: CanvasData = {
    id: genCanvasId(),
    name: "Canvas 1",
    shapes: legacyShapes,
    zones: legacyZones,
    agentPositions: positions,
    waypoints: legacyWps,
    perceptionLogs: legacyLogs,
  };

  const store: CanvasStore = { canvases: [canvas], activeIdx: 0 };
  saveCanvasStore(store);
  savePersonas(personas);
  return { store, personas };
}

// ============================================================
// ---- Persona JSON Import -----------------------------------
// ============================================================
// Parse a user-supplied JSON array of persona objects (the same shape the
// app produces via Export JSON, plus a few optional clinical fields). Only
// input data — agent/position/environment/spatial — is read; runtime
// outputs (computed, accumulated_state, experience, route, etc.) are
// ignored. Anxiety level + modifiers are always re-derived from
// `asi_score` to stay consistent with the app's own scale.

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Numeric coercion with strict null/undefined handling.
 *
 * The previous implementation deferred to `Number(value)` for all
 * non-number inputs, which silently turned `null` → 0 (because
 * `Number(null) === 0` and 0 is finite). That bit re-import flows
 * downstream: distanceForExport encodes the "no LOS-visible window"
 * sentinel (-1) as `null` in JSON, and re-importing with the old
 * asNum read it back as 0, which the perceptual-load model then
 * treats as "agent is right at a window" — the OPPOSITE of intent.
 * Newly-created or un-placed agents using the same convention hit
 * the same bug.
 *
 * Fix: null and undefined ALWAYS return the caller's fallback. Other
 * non-finite results (NaN, "abc", etc.) also fall back. Numbers and
 * numeric strings still coerce as before.
 */
function asNum(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Result of parsing a scenario / persona-import file. Always carries a
 * `personas` list (possibly empty); `shapes`, `zones`, and per-agent
 * `agentPositions` are present only when the file ships them — i.e. a
 * full scenario export (`{scenario, agents}`). Persona-only array files
 * leave shapes/zones/agentPositions undefined so callers can decide
 * whether to leave the active canvas alone.
 */
export interface ParsedScenarioImport {
  personas: PersonaData[];
  shapes?: Shape[];
  zones?: Zone[];
  /** Index-aligned with `personas`; entry is null when the agent had no recorded position. */
  agentPositions?: (AgentPosition | null)[];
  source: "scenario-export" | "persona-array";
}

/** Coerce arbitrary JSON into a Shape. Skips invalid entries. */
function parseShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.type !== "string") return null;
  if (!Array.isArray(s.points)) return null;
  const allowed: ShapeType[] = ["site", "wall", "column", "door", "window", "green", "special"];
  if (!(allowed as string[]).includes(s.type)) return null;
  const pts = s.points.filter(
    (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"),
  );
  if (pts.length < 2) return null;
  const out: Shape = { type: s.type as ShapeType, points: pts };
  if (typeof s.label === "string") out.label = s.label;
  if (s.meta && typeof s.meta === "object") out.meta = s.meta as ShapeMeta;
  return out;
}

/** Coerce arbitrary JSON into a Zone. Returns null when bounds are missing. */
function parseZone(raw: unknown): Zone | null {
  if (!raw || typeof raw !== "object") return null;
  const z = raw as Record<string, unknown>;
  if (typeof z.id !== "string") return null;
  const b = z.bounds as Record<string, unknown> | undefined;
  if (!b) return null;
  const env = z.env as Partial<ZoneEnv> | undefined;
  const zone: Zone = {
    id: z.id,
    label: typeof z.label === "string" ? z.label : undefined,
    bounds: {
      x: asNum(b.x, 0),
      y: asNum(b.y, 0),
      width: asNum(b.width, 0),
      height: asNum(b.height, 0),
      ...(Array.isArray(b.points) ? { points: b.points as [number, number][] } : {}),
    },
    env: {
      temperature: asNum(env?.temperature, defaultZoneEnv.temperature),
      humidity: asNum(env?.humidity, defaultZoneEnv.humidity),
      light: asNum(env?.light, defaultZoneEnv.light),
      noise: asNum(env?.noise, defaultZoneEnv.noise),
      air_velocity: asNum(env?.air_velocity, defaultZoneEnv.air_velocity),
      ceiling_height: asNum(env?.ceiling_height, defaultZoneEnv.ceiling_height),
      open_space: typeof env?.open_space === "boolean" ? env.open_space : defaultZoneEnv.open_space,
      ...(typeof env?.mrt === "number" ? { mrt: env.mrt } : {}),
      ...(typeof env?.outdoor_air_temp === "number" ? { outdoor_air_temp: env.outdoor_air_temp } : {}),
    },
    ...(typeof z.program === "string" && z.program.trim() ? { program: z.program.trim() } : {}),
    ...(typeof z.influence_radius_mm === "number" && z.influence_radius_mm > 0
      ? { influence_radius_mm: z.influence_radius_mm }
      : {}),
  };
  return zone;
}

/**
 * Parse either:
 *   (a) a plain array of persona objects (legacy / hand-authored — only
 *       agents change, current canvas geometry is left intact), OR
 *   (b) a full scenario dump produced by exportJSON, of shape
 *       `{ scenario: { shapes, zones }, agents: [...] }` — replaces
 *       canvas geometry AND personas, plus restores agent positions
 *       from each agent's first perception_log entry when present.
 */
export function parseScenarioImport(raw: unknown): ParsedScenarioImport {
  // Wrapped scenario form
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const root = raw as Record<string, unknown>;
    const agentsRaw = Array.isArray(root.agents) ? root.agents : null;
    const scenarioRaw = root.scenario as Record<string, unknown> | undefined;
    if (agentsRaw) {
      const personas = parseImportedPersonas(agentsRaw);
      const shapes = scenarioRaw && Array.isArray(scenarioRaw.shapes)
        ? (scenarioRaw.shapes.map(parseShape).filter((s): s is Shape => s !== null))
        : undefined;
      const zones = scenarioRaw && Array.isArray(scenarioRaw.zones)
        ? (scenarioRaw.zones.map(parseZone).filter((z): z is Zone => z !== null))
        : undefined;
      // Per-agent position from first perception_log entry (export saves
      // world-coord position there). Falls back to persona.position.cell × 1000.
      const agentPositions = agentsRaw.map((a) => {
        if (!a || typeof a !== "object") return null;
        const ag = a as Record<string, unknown>;
        const log = (ag.route as { perception_log?: unknown[] } | undefined)?.perception_log;
        if (Array.isArray(log) && log.length > 0) {
          const first = log[0] as { position?: { x?: unknown; y?: unknown } } | null;
          if (first && first.position && typeof first.position.x === "number" && typeof first.position.y === "number") {
            return { x: first.position.x, y: first.position.y };
          }
        }
        const pos = ag.position as { cell?: unknown } | undefined;
        if (pos && Array.isArray(pos.cell) && pos.cell.length === 2 && pos.cell.every((n) => typeof n === "number")) {
          const [cx, cy] = pos.cell as [number, number];
          if (cx === 0 && cy === 0) return null; // unset placeholder
          return { x: cx * 1000, y: cy * 1000 };
        }
        return null;
      });
      return { personas, shapes, zones, agentPositions, source: "scenario-export" };
    }
  }
  // Plain persona array form
  const personas = parseImportedPersonas(raw);
  return { personas, source: "persona-array" };
}

export function parseImportedPersonas(raw: unknown): PersonaData[] {
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array of persona objects");
  }
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Entry ${i}: not an object`);
    }
    const e = entry as Record<string, unknown>;
    const agent = (e.agent as Record<string, unknown> | undefined) ?? {};
    if (!agent.id) throw new Error(`Entry ${i}: missing agent.id`);

    const anxietyIn = (agent.anxiety as Record<string, unknown> | undefined) ?? {};
    const asiScore = asNum(anxietyIn.asi_score, 0);
    const anxiety = buildAnxietyData(asiScore);
    if (typeof anxietyIn.subtype_label === "string" && anxietyIn.subtype_label.trim()) {
      anxiety.subtype_label = anxietyIn.subtype_label.trim();
    }
    if (typeof anxietyIn.clinical_note === "string" && anxietyIn.clinical_note.trim()) {
      anxiety.clinical_note = anxietyIn.clinical_note.trim();
    }

    const position = (e.position as Record<string, unknown> | undefined) ?? {};
    const cellRaw = position.cell;
    const cell: [number, number] = Array.isArray(cellRaw) && cellRaw.length === 2
      ? [asNum(cellRaw[0], 0), asNum(cellRaw[1], 0)]
      : [0, 0];

    const env = (e.environment as Record<string, unknown> | undefined) ?? {};
    const spatial = (e.spatial as Record<string, unknown> | undefined) ?? {};

    const persona: PersonaData = {
      agent: {
        id: String(agent.id),
        age: Math.round(asNum(agent.age, 30)),
        gender: asEnum<"male" | "female">(agent.gender, ["male", "female"], "female"),
        mbti: typeof agent.mbti === "string" ? agent.mbti : "ENFP",
        mobility: asEnum<"normal" | "walker" | "wheelchair" | "cane">(
          agent.mobility, ["normal", "walker", "wheelchair", "cane"], "normal",
        ),
        hearing: asEnum<"normal" | "impaired" | "deaf">(
          agent.hearing, ["normal", "impaired", "deaf"], "normal",
        ),
        vision: asEnum<"normal" | "mild_impairment" | "severe_impairment">(
          agent.vision, ["normal", "mild_impairment", "severe_impairment"], "normal",
        ),
        metabolic_rate: asNum(agent.metabolic_rate, 1.0),
        clothing_insulation: asNum(agent.clothing_insulation, 0.7),
        anxiety,
        ...(typeof agent.role === "string" && agent.role.trim()
          ? { role: agent.role.trim() }
          : {}),
        ...(typeof agent.name === "string" && agent.name.trim()
          ? { name: agent.name.trim() }
          : {}),
        // Situated-cognition fields. New scenarios should ship
        // `purpose_at_centre`; legacy scenarios that only carry the old
        // narrative-style `current_activity` are migrated forward —
        // `current_activity` was a what-you're-doing-right-now
        // description, while `purpose_at_centre` is the underlying
        // why-I-came. The migrated value is a best-effort fallback;
        // scenario authors should review and rewrite where needed.
        ...((): Partial<AgentData> => {
          const raw = (typeof agent.purpose_at_centre === "string" && agent.purpose_at_centre.trim())
            ? agent.purpose_at_centre.trim()
            : (typeof agent.current_activity === "string" && agent.current_activity.trim())
              ? agent.current_activity.trim()
              : "";
          return raw ? { purpose_at_centre: raw } : {};
        })(),
        ...((): Partial<AgentData> => {
          const raw = agent.relationships;
          if (!Array.isArray(raw)) return {};
          const rels: AgentRelationship[] = [];
          for (const r of raw) {
            if (!r || typeof r !== "object") continue;
            const rec = r as Record<string, unknown>;
            const w = typeof rec.with === "string" ? rec.with.trim() : "";
            const t = typeof rec.type === "string" ? rec.type.trim() : "";
            if (w && t) rels.push({ with: w, type: t });
          }
          return rels.length > 0 ? { relationships: rels } : {};
        })(),
        // goal_progress: prefer agent.goal_progress; fall back to a
        // legacy persona.objective.goal_progress block if present
        // (an earlier branch packaged it under persona.objective).
        ...((): Partial<AgentData> => {
          const direct = agent.goal_progress;
          if (typeof direct === "number" && Number.isFinite(direct)) {
            return { goal_progress: Math.max(0, Math.min(1, direct)) };
          }
          const legacy = (e.objective as Record<string, unknown> | undefined)?.goal_progress;
          if (typeof legacy === "number" && Number.isFinite(legacy)) {
            return { goal_progress: Math.max(0, Math.min(1, legacy)) };
          }
          return {};
        })(),
      },
      position: {
        cell,
        timestamp: typeof position.timestamp === "string" ? position.timestamp : "14:30",
        duration_in_cell: Math.round(asNum(position.duration_in_cell, 0)),
      },
      environment: {
        lux: asNum(env.lux, 300),
        dB: asNum(env.dB, 55),
        air_temp: asNum(env.air_temp, 24),
        humidity: asNum(env.humidity, 55),
        air_velocity: asNum(env.air_velocity, 0.1),
        ...(typeof env.mrt === "number" ? { mrt: env.mrt } : {}),
        ...(typeof env.outdoor_air_temp === "number" ? { outdoor_air_temp: env.outdoor_air_temp } : {}),
      },
      spatial: {
        dist_to_wall: asNum(spatial.dist_to_wall, 0),
        // -1 sentinel = no LOS-visible window/exit at this position.
        // distanceForExport encodes -1 as `null` in JSON; with the
        // asNum null-fix above, the round-trip preserves the sentinel.
        dist_to_window: asNum(spatial.dist_to_window, -1),
        dist_to_exit: asNum(spatial.dist_to_exit, -1),
        ceiling_h: asNum(spatial.ceiling_h, -1),
        enclosure_ratio: asNum(spatial.enclosure_ratio, 0),
        visible_agents: Math.round(asNum(spatial.visible_agents, 0)),
      },
      ...((): { temporal?: TemporalData } => {
        const t = e.temporal as Record<string, unknown> | undefined;
        if (!t || typeof t !== "object") return {};
        const total_dwell_min = Math.max(0, asNum(t.total_dwell_min, 0));
        const fatigue_accumulated = Math.max(0, Math.min(1, asNum(t.fatigue_accumulated, 0)));
        return { temporal: { total_dwell_min, fatigue_accumulated } };
      })(),
    };
    return hydratePersonaDefaults(persona);
  });
}

// ---- LLM Integration ----
export function getLLMConfig(): { apiKey: string; apiUrl: string; model: string; provider?: LLMProvider } | null {
  const raw = localStorage.getItem("llm_config");
  if (!raw) return null;
  const cfg = JSON.parse(raw);
  // Ollama needs *some* api key value (defaults seed "ollama"). DeepSeek and
  // OpenAI go through the /api/llm proxy under BYOK: the visitor's own key
  // (config.apiKey) is forwarded as the `x-llm-key` header. We stay lenient
  // and return the config even with an empty key so local dev (which can fall
  // back to a .env.local key) still works; if no key is available anywhere the
  // proxy responds 401 with a "enter your key in Settings" message.
  const provider: LLMProvider = cfg.provider ?? "ollama";
  if (provider === "deepseek" || provider === "openai") return cfg;
  return cfg.apiKey ? cfg : null;
}

/** Provider tag persisted alongside `llm_config`. Methodology v2 only
 *  supports Ollama for the new Layer-2 assessment shape; other providers
 *  fall back to engine baseline (see callLLMWithPrompt). */
export type LLMProvider = "ollama" | "anthropic" | "deepseek" | "openai" | "custom";

// ============================================================
// ---- Layer 2 · methodology v2 helpers ----------------------
// ============================================================
// Verbatim ports from `client/public/mhc-demo/app.jsx` — the working
// prototype. Keep wording / weights / shape identical so the SPA's
// outputs are directly comparable to the demo's.

/** Comfort + stress derived from the LLM's 6 felt-dim scores (0-100 each).
 *  Stress uses the SAME weighting as the engine's `computeStressScore` so
 *  only WHO produced the 6 inputs changes, not how they roll up. */
export function feltComfort(dims: Record<FeltDim, number>): { stress: number; comfort: number } {
  let s = 0;
  for (const d of FELT_DIMS) {
    s += (Math.max(0, Math.min(100, dims[d] ?? 0)) / 100) * DIM_WEIGHT[d];
  }
  const stress = Math.round(Math.min(10, Math.max(0, s * 10)) * 10) / 10;
  return { stress, comfort: Math.max(1, Math.min(10, Math.round(10 - stress))) };
}

/** Map 6 felt-dim scores (0-100) to a 6-dim AccumulatedState (0-1 each). */
export function dimsToAccState(dims: Record<FeltDim, number>): AccumulatedState {
  return {
    thermal_discomfort: (dims.thermal ?? 0) / 100,
    visual_strain: (dims.visual ?? 0) / 100,
    noise_stress: (dims.noise ?? 0) / 100,
    social_overload: (dims.social ?? 0) / 100,
    fatigue: (dims.temporal ?? 0) / 100,
    wayfinding_anxiety: (dims.wayfinding ?? 0) / 100,
  };
}

/** Parse the LLM's JSON assessment defensively. Returns null on parse fail.
 *  Accepts either `{ thermal: { score, reason }, ... }` (preferred) or
 *  `{ thermal: <number>, ... }` (legacy). Out-of-range scores get clamped
 *  to [0,100]; missing reasons become "". */
export function parseAssessment(raw: string): LLMAssessment | null {
  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { obj = JSON.parse(m[0]) as Record<string, unknown>; } catch { /* swallow */ }
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const dims = {} as Record<FeltDim, number>;
  const reasons = {} as Record<FeltDim, string>;
  for (const d of FELT_DIMS) {
    const v = obj[d];
    let score = 0;
    let reason = "";
    if (v && typeof v === "object") {
      const vv = v as { score?: unknown; reason?: unknown };
      score = Number(vv.score);
      reason = typeof vv.reason === "string" ? vv.reason : "";
    } else if (typeof v === "number") {
      score = v;
    }
    dims[d] = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
    reasons[d] = reason;
  }
  const narration = typeof obj.narration === "string" ? obj.narration.trim() : "";
  // Layer 3 · The Critique — defensively parse the observations array,
  // drop entries missing any of the three falsifiability fields, hard
  // cap at 3, and stamp the engine-controlled epistemic_tag (so the LLM
  // cannot launder "research finding" into the field).
  const rawObs: unknown = obj.observations;
  const observations: LLMObservation[] = Array.isArray(rawObs)
    ? rawObs
        .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
        .map((o) => ({
          observation: typeof o.observation === "string" ? o.observation.trim() : "",
          proposed_mechanism: typeof o.proposed_mechanism === "string" ? o.proposed_mechanism.trim() : "",
          verification: typeof o.verification === "string" ? o.verification.trim() : "",
          epistemic_tag: "LLM-derived hypothesis" as const,
        }))
        .filter((o) => o.observation && o.proposed_mechanism && o.verification)
        .slice(0, 3)
    : [];
  const { stress, comfort } = feltComfort(dims);
  return { dims, reasons, narration, comfort, stress, observations };
}

/** Relationship type (from the persona graph) → a phrase, holder's POV.
 *  Verbatim port from the demo. */
const RELATION_PHRASE: Record<string, string> = {
  is_clinician:            "is your clinician — the person who treats you here",
  is_client_of:            "is your client — you are the one treating them",
  checks_in_with:          "is the receptionist you check in with",
  is_spouse_of:            "is your spouse",
  is_clinician_of_spouse:  "is your spouse's clinician",
  is_colleague_of:         "is a colleague you work alongside here",
  is_facilitator:          "facilitates your support group",
  is_circle_member:        "is a fellow member of your support circle",
  is_locum_client:         "is a client you are covering as a locum",
  is_locum_clinician:      "is the locum standing in for your usual clinician",
  is_locum_for_my_clients: "is the locum covering your own clients",
};

/** Layer-2 user-message task — become the character, score the 6 felt
 *  dimensions, then step out as Layer-3 design critic. Felt-dim block
 *  is the verbatim demo port; the critique block restores the pre-v2
 *  observations channel (commit f07139c) on top of v2. */
export const SCORING_TASK = [
  `BECOME this person now and read the room. For each of the 6 pressures, decide — as YOU, through your disposition and anxiety register — how strongly it weighs on you right now: 0 = not felt at all, 100 = overwhelming. The same physical fact lands differently on different people; a measured 66 dB is background to a steady person and a wall of pressure to an anxious one. Score what YOU feel, justified by the Layer-1 physical readout above and by who you are.`,
  ``,
  `The 6 pressures:`,
  `· thermal — the air / temperature on your body`,
  `· visual — the light: dim, glaring, or windowless strain`,
  `· noise — the sound as it presses on you`,
  `· social — the people here: WHO they are to you matters as much as how many; a room holding your own therapist, or your spouse, is not a room of strangers`,
  `· temporal — how the time you have spent here is wearing on you`,
  `· wayfinding — orientation: knowing the way out, free vs trapped`,
  ``,
  `Reply with JSON ONLY, exactly this shape. Every "reason" must be TERSE — 14 words maximum, clipped, no full paragraphs; spend your effort on the narration instead:`,
  `{`,
  `  "thermal":    {"score": 0-100, "reason": "<=14 words, tying the score to the physical fact AND to who you are"},`,
  `  "visual":     {"score": 0-100, "reason": "..."},`,
  `  "noise":      {"score": 0-100, "reason": "..."},`,
  `  "social":     {"score": 0-100, "reason": "..."},`,
  `  "temporal":   {"score": 0-100, "reason": "..."},`,
  `  "wayfinding": {"score": 0-100, "reason": "..."},`,
  `  "narration":  "2-4 sentences, first person, present tense, in YOUR voice — how being here actually feels, grounded in body and senses at the intensity your register warrants. Ordinary lived language: no numbers, no units, no instrument words.",`,
  `  "observations": [ /* see LAYER 3 below; 0-3 entries, [] is valid */ ]`,
  `}`,
  ``,
  `LAYER 3 — THE CRITIQUE. After scoring as the character, step OUT and read the configuration as a design discipline would. The 6 scores above already encode physics + density + exit distance + greenery + duration — those are Layer-1 / Layer-2 territory and are NOT critique-worthy on their own. The "observations" array surfaces 0-3 NON-obvious, configuration-specific design issues the deterministic layer cannot see.`,
  ``,
  `Return 0-3 observations. RETURN [] IF NOTHING NON-OBVIOUS APPLIES — do not invent observations to fill the quota.`,
  ``,
  `What QUALIFIES:`,
  `  · Sightline / gaze-axis awkwardness from the seating geometry (e.g. circular layout forcing direct eye-contact with an authority figure for a socially-anxious client).`,
  `  · Activity-type asymmetry (same headcount but different psychological pressure: "the same 7 people, but here the agent is being looked AT while emotionally vulnerable").`,
  `  · Second-order privacy concern (e.g. visually exposed to other agents whose emotional state would compound theirs).`,
  `  · Role-specific concern the load model can't see (caregiver-cared-for asymmetry, locum unfamiliarity beyond what the relationships list captures).`,
  `  · Adjacency / circulation pattern issues (path to the exit passes through another zone whose program creates emotional contagion).`,
  ``,
  `What DOES NOT qualify (already in deterministic + felt layers — do not duplicate):`,
  `  · "Windowless" / "many people" / "far from exit" / "needs greenery" / generic statements every architect already knows.`,
  ``,
  `Each entry MUST contain three fields. Drop the entry if you cannot fill all three concretely:`,
  `  observation         — what you noticed in THIS configuration (one short sentence).`,
  `  proposed_mechanism  — why it might matter; cite a literature direction if applicable (e.g. "Schultz & Heimberg 2008 social anxiety", "Goffman 1959 frame analysis", "Ulrich 1991 supportive design"). One sentence.`,
  `  verification        — what study, measurement, or POE method could test it. One sentence.`,
  ``,
  `Observations are surfaced downstream as LLM-derived HYPOTHESES, not research findings. Falsifiable-or-drop. PRESENCE FIDELITY applies: do not pretend a feature is absent in order to construct a finding. If the engine reports a window or exit, the non-obvious observation must be about something OTHER than its absence.`,
].join("\n");

/**
 * One-line reasons keyed by tag, used by the prompt to ground the LLM in
 * the actual sensor values that triggered each rule (avoids the "agent
 * reacts to abstract labels" failure mode). Order-preserving merge with
 * tag-only strings happens in callers.
 */
export interface PromptTrigger {
  tag: string;
  reason?: string;
}

/** Plain-English derived band for `enclosure_ratio` (0..1). */
function enclosureBand(ratio: number, openSky: boolean): string {
  if (openSky && ratio < 0.2) return "OUTDOORS — no overhead cover, no surrounding walls";
  if (openSky && ratio < 0.5) return "SEMI-OPEN — under open sky with some lateral walls (open courtyard or partial enclosure)";
  if (!openSky && ratio < 0.2) return "COVERED OPEN — roof / canopy overhead but no walls (open-sided pavilion)";
  if (!openSky && ratio < 0.5) return "SEMI-OPEN — covered with partial walls (covered platform / loggia / partly enclosed shelter)";
  if (ratio < 0.7) return "MOSTLY ENCLOSED — three or more sides enclosed; roof present";
  return "INDOOR — fully enclosed room with walls and roof";
}

/** Plain-English band for lux. */
function luxBand(lux: number): string {
  if (lux < 100) return "very dim, like emergency lighting at night";
  if (lux < 500) return "dim, indoor-level lighting (corridor / mood lighting)";
  if (lux < 3000) return "moderate ambient light (typical office / shaded outdoor)";
  if (lux < 8000) return "bright, but NOT direct sun (overcast outdoors / under a canopy facing the sun)";
  return "direct sunlight intensity, no shade overhead";
}

/** Plain-English band for dB — used in the WHAT YOU SENSE block so the
 *  agent perceives a sound LEVEL rather than a number. Matches typical
 *  human descriptors: < 30 library hush; 30–45 quiet office; 45–55
 *  conversational ambient; 55–65 noticeably noisy; 65+ loud. */
function dBBand(db: number): string {
  if (db < 30) return "almost silent — library hush";
  if (db < 45) return "quiet, like a calm office";
  if (db < 55) return "conversational ambient hum";
  if (db < 65) return "noticeably noisy, low-grade strain";
  if (db < 75) return "loud — voices have to rise";
  return "very loud, intrusive";
}

/** Plain-English band for a metric distance. Used to convert raw
 *  dist_to_window / dist_to_exit into spatial framing the LLM should
 *  feel ("across the room", "just outside the door") rather than quote
 *  ("3 meters away"). Negative / NaN inputs return "unknown". */
function distanceBand(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "unknown distance";
  if (metres < 1) return "right next to me";
  if (metres < 3) return "a couple of steps away";
  if (metres < 6) return "across the room";
  if (metres < 12) return "at the far end of the space";
  if (metres < 25) return "well across, at the limit of comfortable line-of-sight";
  return "distant, requires walking to reach";
}

/** Plain-English band for an air temperature in °C. Used in the WHAT
 *  YOU SENSE block so the agent feels temperate / cool / warm rather
 *  than reading "23.5°C". Calibrated for indoor occupant comfort:
 *  18–24 = neutral comfort, drift outwards = mild, then stronger. */
function tempBand(celsius: number): string {
  if (!Number.isFinite(celsius)) return "neutral";
  if (celsius < 14) return "cold — uncomfortable";
  if (celsius < 18) return "cool, slightly chilly";
  if (celsius < 22) return "comfortably cool";
  if (celsius < 25) return "neutral, comfortable";
  if (celsius < 28) return "warm";
  if (celsius < 32) return "warm-hot, starting to register heat stress";
  return "hot — uncomfortable";
}

/**
 * Structured role-behaviour block injected into the LLM prompt. Routes
 * the agent's free-text role through `categoriseRole` and emits the
 * matching directive set so the LLM frames the narrative around what
 * the agent is DOING (work / waiting / attending) instead of falling
 * back to a generic dwelling-body voice. Includes explicit forbidden
 * phrases for staff (the most common failure mode is staff narrating
 * like a patient who wants to leave).
 */
function roleFramingBlock(role: string | undefined): string {
  const cat = categoriseRole(role);
  const r = role?.trim() ?? "";
  // If the role string carries a parenthetical reason ("patient (skin
  // condition)"), surface it so the narrative can reflect the specific
  // complaint or task.
  const detail = r.match(/\(([^)]+)\)/)?.[1]?.trim();

  if (cat === "staff") {
    return `ROLE BEHAVIOUR FRAMING (overrides default dwelling language):
The agent is WORKING — not waiting, not dwelling. They KNOW this space (low
wayfinding anxiety) and are familiar with the patient/customer flow (low
"unfamiliar layout" reaction). Their stress comes from workload, decision
fatigue, time pressure, and accumulated shift hours — NOT from
environmental novelty.

Role-specific anchors:
- Nurse: triaging, prepping treatment areas, attending a specific patient,
  updating charts, handing off. Body language: efficient, practiced.
- Pharmacist: checking dosages, labels, interactions; verifying scripts;
  counselling on side effects. Mental focus: precision and accuracy.
- Doctor / physician: between consultations reviewing notes, mentally
  preparing for the next patient, charting the previous case. Posture:
  composed. Gaze: planning, not seeking refuge.
- Receptionist / admin: registering, dispatching, navigating queue and
  waiting list. Tone: professional courtesy under load.
- Other staff: infer task from the title — they have a job to do here.

CRITICAL — FORBIDDEN PHRASES for staff:
"scanning for exits", "want to leave", "feel restless waiting",
"unfamiliar layout", "hoping to be called", "trying to endure",
"wondering when this will end", "fear of the space".${detail ? `\n\nRole detail: "${detail}". Reflect the specific task/context where natural.` : ""}`;
  }

  if (cat === "patient") {
    return `ROLE BEHAVIOUR FRAMING (overrides default dwelling language):
The agent is a CLIENT (patient / customer / passenger / visitor) — they
are WAITING or BEING SEEN / SERVED. They may be unfamiliar or only
semi-familiar with the space. Perception is dominated by:
  - their own body, symptoms, or reason for being here
  - anticipation of being called / served
  - the wait itself (boredom, time-pressure, fatigue)
  - any worry tied to their reason for visit

${detail ? `Reason / context implied by the role: "${detail}". The narrative
should reference the specific complaint or situation naturally — they're
aware of the affected area, the appointment they came for, or the
specific concern they walked in with.\n\n` : ""}DO NOT have the agent take on staff duties or behave with operational
authority over the space.`;
  }

  if (cat === "companion") {
    return `ROLE BEHAVIOUR FRAMING (overrides default dwelling language):
The agent is ATTENDING to someone else — the person they're with. Their
perception centres on the COMPANIONED person, not on themselves:
  - monitoring the other person's comfort, mood, or symptoms
  - tracking the queue and staff signals on their behalf
  - holding paperwork, ID, medication lists, belongings
  - small caretaking actions (adjusting blanket, calming a child,
    helping read forms)

Their own thermal / noise / fatigue discomforts are present but
secondary — surface them only when they actually intrude on the
caretaking task.${detail ? `\n\nCompanion context: "${detail}". Anchor the
narrative around this relationship.` : ""}`;
  }

  // Unspecified — soft fallback.
  return `ROLE BEHAVIOUR FRAMING:
Role unspecified. Infer the most plausible role from the zone program
and the agent's demographics. Default to the perception of a
client / visitor in the space (waiting, anticipating, body-aware) unless
the zone program clearly implies a working occupant.`;
}

/** Plain-English band for Green View Index (Jing 2024 + Song 2022 thresholds). */
function gviBand(gvi: number): string {
  if (gvi <= 0.05) return "barren — almost no greenery in view";
  if (gvi < 0.15) return "sparse greenery in the periphery";
  if (gvi < 0.25) return "moderate greenery — restorative effect rising";
  if (gvi <= 0.30) return "OPTIMAL biophilic exposure (peak stress recovery, Jing 2024 sweet spot)";
  if (gvi < 0.50) return "lush greenery — restorative plateau, shade and visual relief";
  if (gvi < 0.75) return "very leafy / forested feel — calming";
  if (gvi < 0.85) return "fully immersed in vegetation";
  return "near-total green canopy — possibly over-saturated, may feel claustrophobic";
}

/**
 * Optional situated-cognition context: who else is in this agent's zone
 * RIGHT NOW, and rich detail on whoever the agent has declared a
 * relationship with. The prompt builder is happy with both omitted (e.g.
 * the legacy single-persona `callLLM` path); when present, they drive
 * the "WHAT YOU SENSE" → "people in this zone with you" block and the
 * "WHAT YOU KNOW" → "people you know in this building today" block.
 */
export interface SituatedContext {
  /** Other agents currently in the same zone as the perceiving agent. */
  coZoneAgents?: SituatedAgentInfo[];
  /** Resolved details for this agent's declared relationships. */
  relationshipDetails?: SituatedAgentInfo[];
}

/**
 * Methodology v2 system prompt — verbatim-shaped port of the demo's
 * `buildSystemPrompt`. Sections (in order):
 *   1. Character header (name, age, role, MBTI, ASI score+level,
 *      vision/hearing/mobility, purpose_at_centre).
 *   2. WHO YOU ARE — dispositionLine (role-class → staff/companion/client)
 *      + registerLine (ASI band → 4 verbatim register paragraphs).
 *   3. Zone identity + (optional) zone description.
 *   4. Social block (co-zone agents, joined to relationship type via
 *      RELATION_PHRASE).
 *   5. Synthesis instruction.
 *   6. LAYER 1 — PHYSICAL READOUT (raw env + spatial + duration).
 *
 * The LLM then receives `SCORING_TASK` as the user message and returns
 * the 6-dim assessment + narration JSON.
 */
export function buildAssessmentSystemPrompt(
  persona: PersonaData,
  computed: ComputedOutputs,
  zones: Zone[] = [],
  situated: SituatedContext = {},
): string {
  const a = persona.agent;
  const env = persona.environment;
  const sp = persona.spatial;

  const agentX = persona.position.cell[0] * 1000;
  const agentY = persona.position.cell[1] * 1000;
  const currentZone = getZoneAtPosition(agentX, agentY, zones);
  const zoneLabel = currentZone ? (currentZone.label || currentZone.id) : "(undefined area)";
  const zoneDescription = currentZone?.program?.trim() ?? "";

  const pct = (n: number) => Math.round((n || 0) * 100);
  const pmvWord = computed.PMV <= -0.5 ? "cool" : computed.PMV >= 0.5 ? "warm" : "neutral";
  const exitTxt = sp.dist_to_exit < 0
    ? "no exit visible from where you are"
    : `nearest exit ≈ ${sp.dist_to_exit} m`;
  const windowTxt = sp.dist_to_window < 0
    ? "no window in sight"
    : `a window ≈ ${sp.dist_to_window} m away`;
  const dur = persona.position.duration_in_cell || 0;
  const seen = sp.visible_agents;
  const gvi = sp.green_visibility ?? 0;

  // Role class drives the disposition line. Plan maps `patient` → demo's
  // CLIENT block; `companion` → companion; `staff` → staff; `unspecified`
  // → falls back to CLIENT (same as the demo's non-staff/non-comp default).
  const roleCat = categoriseRole(a.role);
  const dispositionLine =
    roleCat === "staff"
      ? `You are STAFF here — this is your daily workplace. Your purpose is to work, and that purpose OWNS your time here: long stretches in these rooms are professional routine, not an ordeal to endure. You read the space operationally — how it serves or fails the people you work with — from a steady baseline. You do NOT narrate yourself like a distressed patient; composure is your default.`
    : roleCat === "companion"
      ? `You are here ACCOMPANYING someone (a relative/partner), not as a client yourself. Your purpose is THEM — your attention sits on the person you came with and how this space treats them. Your own time here is on-hold and peripheral; your state is comparatively settled.`
      : `You are a CLIENT here today. Your purpose is the reason you came — to be seen, to wait for it, to get through it — and that makes time here something you ENDURE: minutes in this space are felt, not owned, because you are here out of need, not choice. The environment acts on you through your condition and that purpose — a legitimate, personal lens.`;

  const anxiety = a.anxiety ?? defaultAnxiety;
  const lvl = anxiety.asi_level;
  const asiScore = anxiety.asi_score;
  const registerLine = (
    lvl === "normal"
      ? `ANXIETY SENSITIVITY — NORMAL (ASI-3 ${asiScore}/72). You are composed and low-reactive. Notice the space matter-of-factly; you have mild preferences and passing observations, NOT distress. Do NOT write a racing heart, dread, a "knot of anxiety", or shoulders heavy with the unknown unless the environment is objectively extreme. Default to understated, neutral, even slightly detached.`
    : lvl === "mild"
      ? `ANXIETY SENSITIVITY — MILD (ASI-3 ${asiScore}/72). Largely steady; at most a faint edge on the single strongest pressure. Not visceral, not spiralling.`
    : lvl === "moderate"
      ? `ANXIETY SENSITIVITY — MODERATE (ASI-3 ${asiScore}/72). The loaded dimensions register as genuine, nameable unease, but you can still self-regulate. Honest discomfort, not panic.`
    : lvl === "severe"
      ? `ANXIETY SENSITIVITY — SEVERE (ASI-3 ${asiScore}/72). The top driver(s) reach your body — breath, pulse, the pull toward the way out. This is lived clinical anxiety; let it show on the dimensions that are actually loaded (only those).`
    : `ANXIETY SENSITIVITY — ${lvl} (ASI-3 ${asiScore}/72).`
  );

  const coZoneAgents = situated.coZoneAgents ?? [];
  const socialBlock = coZoneAgents.length > 0
    ? "WHO IS IN THIS ROOM WITH YOU:\n" + coZoneAgents.map((s) => {
        const phrase = s.relation
          ? (RELATION_PHRASE[s.relation] || `relationship: ${s.relation}`)
          : "no particular connection to you — a stranger sharing the space";
        const name = s.name?.trim() || s.id;
        const role = s.role?.trim() || "role unspecified";
        return `  · ${name} (${role}) — ${phrase}`;
      }).join("\n")
    : "You are alone in this room right now.";

  const headerLines = [
    `You are ${a.name?.trim() || a.id}, ${a.age}, ${a.role?.trim() || "occupant"} at a small mental-health centre in Hong Kong.`,
    a.purpose_at_centre?.trim() ? `YOUR OBJECTIVE TODAY: ${a.purpose_at_centre.trim()}` : ``,
    `MBTI ${a.mbti}. Vision ${a.vision}; hearing ${a.hearing}; mobility ${a.mobility}.`,
    ``,
    `WHO YOU ARE — this governs how the space lands on you:`,
    `· ${dispositionLine}`,
    `· ${registerLine}`,
    ``,
    `You are standing in: "${zoneLabel}". ${zoneDescription}`,
    socialBlock,
    `Work out — from your objective, this room's purpose, and who is here with you — what you are actually DOING right now (in session, waiting, working, supporting someone). Read the space THROUGH that activity and those relationships: the same room is not the same to someone alone, someone with their own therapist, or someone among strangers.`,
    ``,
    `═══ LAYER 1 — PHYSICAL READOUT (objective; instrument-measured) ═══`,
    `Geometry and physics only — identical for every body, whoever feels it. These are NOT feelings and NOT a verdict on how you are doing. They are the raw facts you must INTERPRET into felt experience.`,
    `  · air — PMV ${computed.PMV} (${pmvWord})${env.air_temp != null ? `, ${env.air_temp}°C` : ``}${env.humidity != null ? `, ${env.humidity}% RH` : ``}`,
    `  · light — ${env.lux} lux`,
    `  · sound — ${env.dB} dB(A)`,
    `  · ${exitTxt}; ${windowTxt}; enclosure ${sp.enclosure_ratio}; green-in-view ${pct(gvi)}%`,
    `  · ${seen} other ${seen === 1 ? "person" : "people"} within sight`,
    `  · you have been in this spot about ${dur} min`,
    `═══ END LAYER 1 ═══`,
  ];
  return headerLines.filter(Boolean).join("\n");
}

// Methodology v2: legacy buildLLMPrompt body + deterministicScoreBlock
// removed. The Layer-2 LLM no longer self-scores or receives an engine
// baseline block — it BECOMES the character via
// buildAssessmentSystemPrompt and emits 6 felt-dim scores via SCORING_TASK.
//
// The thin wrapper below preserves the export for any external caller
// (currently only buildWalkPrompt/buildDwellPrompt) — the shapes /
// localTriggers / scores parameters are kept on the signature but ignored.
export function buildLLMPrompt(
  persona: PersonaData,
  computed: ComputedOutputs,
  _shapes: Shape[],
  zones: Zone[] = [],
  _localTriggers: PromptTrigger[] = [],
  situated: SituatedContext = {},
): string {
  return buildAssessmentSystemPrompt(persona, computed, zones, situated);
}

// ---- MBTI Cognitive-Function Profiles (for prompt enrichment) ----
// Compact one-liner per type so the LLM has a concrete differentiator instead
// of inferring from the 4-letter code. Dominant function + perception flavour.
const MBTI_PROFILE_FALLBACK = { dominant: "balanced", flavour: "general adult perception, no strong cognitive bias to flag" };
const MBTI_PROFILE: Record<string, { dominant: string; flavour: string }> = {
  // NT
  INTJ: { dominant: "Ni (Introverted Intuition)", flavour: "scans for underlying patterns and inefficiencies; mentally re-plans the space; people-noise drains energy quickly" },
  INTP: { dominant: "Ti (Introverted Thinking)", flavour: "analyses sensory inputs as system variables; tolerates discomfort if intellectually engaged; crowd-averse" },
  ENTJ: { dominant: "Te (Extraverted Thinking)", flavour: "evaluates the space against goals and timetables; impatient with friction; takes charge mentally" },
  ENTP: { dominant: "Ne (Extraverted Intuition)", flavour: "notices novel possibilities and design failures; energised by stimulation up to overload" },
  // NF
  INFJ: { dominant: "Ni (Introverted Intuition)", flavour: "absorbs atmosphere and others' moods; needs visual refuge; quietly overwhelmed by uncontrolled stimulation" },
  INFP: { dominant: "Fi (Introverted Feeling)", flavour: "filters environment through personal values and aesthetics; introvert energy budget shrinks in crowds" },
  ENFJ: { dominant: "Fe (Extraverted Feeling)", flavour: "tunes into group emotional climate; warmth/coldness of social field colours physical comfort" },
  ENFP: { dominant: "Ne (Extraverted Intuition)", flavour: "scans for interesting people and possibilities; tolerates noise/heat well if scene is lively" },
  // SJ
  ISTJ: { dominant: "Si (Introverted Sensing)", flavour: "compares present sensory state to remembered standards; tidiness and quiet matter; resents disorder" },
  ISFJ: { dominant: "Si (Introverted Sensing)", flavour: "highly attuned to bodily comfort signals (temp, pressure, light); seeks settled spot; worry-prone" },
  ESTJ: { dominant: "Te (Extraverted Thinking)", flavour: "judges the space against rules and schedules; voices complaints; pragmatic body language" },
  ESFJ: { dominant: "Fe (Extraverted Feeling)", flavour: "monitors others for cues; feels socially responsible; uncomfortable when group climate is tense" },
  // SP
  ISTP: { dominant: "Ti (Introverted Thinking)", flavour: "treats the space mechanically; quietly works around discomfort; minimal verbal complaint" },
  ISFP: { dominant: "Fi (Introverted Feeling)", flavour: "experiences the moment sensually; aesthetic dissonance feels personal; retreats inward under stress" },
  ESTP: { dominant: "Se (Extraverted Sensing)", flavour: "lives in present sensory detail; actively explores, scans, repositions; high stimulation tolerance" },
  ESFP: { dominant: "Se (Extraverted Sensing)", flavour: "soaks in colour/sound/texture; enjoys lively crowds; physical discomfort lands hard and visibly" },
};

// ---- Walk / Dwell LLM Prompts ----
export interface RouteTiming {
  cumulativeMin: number;   // dwelling minutes elapsed before/including this step
  totalBudgetMin: number;  // persona.position.duration_in_cell — the visit budget
  legIndex: number;        // 1-based index of this leg
  legCount: number;        // total number of legs
}

function timingBlock(t: RouteTiming, legType: "walking" | "dwelling", legMinutes: number): string {
  const remaining = Math.max(0, t.totalBudgetMin - t.cumulativeMin);
  const legLine = legType === "dwelling"
    ? `THIS STEP: dwelling at this waypoint for ${legMinutes} minute(s).`
    : `THIS STEP: walking transit (no dwell time counted).`;
  return `
ROUTE TIMING (authoritative — IGNORE the "Total stay budget" line above when describing time; use ONLY these values):
- Leg ${t.legIndex} of ${t.legCount}.
- ${legLine}
- Cumulative dwelling time so far (including this step): ${t.cumulativeMin} min of ${t.totalBudgetMin} min total visit budget.
- Remaining budget after this step: ${remaining} min.
Do NOT invent durations. Reference time only via the values above.`;
}

/**
 * Methodology v2: walk legs never call the LLM. Returns null so callers
 * can branch directly to the engine-baseline PerceptionLogEntry path.
 */
export function buildWalkPrompt(
  _persona: PersonaData, _computed: ComputedOutputs,
  _zones: Zone[] = [], _situated: SituatedContext = {},
): null {
  return null;
}

/**
 * Methodology v2: dwell legs call the LLM ONLY at the terminal dwell of
 * a route / trajectory. Returns `buildAssessmentSystemPrompt(...)` when
 * `terminal` is true, else `null` so the caller skips the LLM.
 */
export function buildDwellPrompt(
  persona: PersonaData, computed: ComputedOutputs,
  zones: Zone[] = [], situated: SituatedContext = {},
  terminal: boolean = false,
): string | null {
  if (!terminal) return null;
  return buildAssessmentSystemPrompt(persona, computed, zones, situated);
}

/**
 * Methodology v2 LLM call result. The LLM BECOMES the character and
 * emits the 6 felt-dimension assessment + narration in one structured
 * JSON response, then steps out as Layer-3 design critic and emits up
 * to 3 falsifiable observations on the same call. `ruleTriggers` is
 * retained on the shape (v2 has no rule-trigger merging) so existing
 * callers don't branch on missing keys.
 */
export interface LLMAssessmentResult {
  assessment: LLMAssessment | null;
  ruleTriggers: string[];
  observations: LLMObservation[];
}

/**
 * Methodology v2 LLM call. Three transports:
 *   - Ollama (local): direct browser → http://localhost:11434/api/chat,
 *     using Ollama's native shape (`format: "json"`, `options.num_predict`).
 *   - DeepSeek / OpenAI (proxied): browser → /api/llm (Vercel function)
 *     → upstream. The proxy adds the server-side API key from
 *     DEEPSEEK_API_KEY / OPENAI_API_KEY env vars; the browser never sees
 *     a key, and CORS doesn't apply because the request is same-origin.
 *   - Anything else (anthropic, custom): falls back to engine baseline.
 * Parses the model's response through `parseAssessment` regardless.
 */
export async function callLLMWithPrompt(
  system: string,
  user: string = SCORING_TASK,
): Promise<LLMAssessmentResult | null> {
  const config = getLLMConfig();
  if (!config) {
    console.warn("[SentiArch] LLM call skipped: no llm_config saved (Settings page).");
    return null;
  }
  const url = (config.apiUrl ?? "").toLowerCase();
  const isOllama = config.provider === "ollama"
    || url.includes("localhost:11434")
    || url.includes("127.0.0.1:11434")
    || url.endsWith("/api/chat");
  const proxiedProvider: "deepseek" | "openai" | null =
    config.provider === "deepseek" ? "deepseek"
    : config.provider === "openai" ? "openai"
    : null;

  if (!isOllama && !proxiedProvider) {
    console.warn(
      `[SentiArch] provider "${config.provider ?? "unknown"}" not supported by Layer-2; falling back to engine baseline. ` +
      `Use Ollama (local), DeepSeek, or OpenAI.`,
    );
    return null;
  }

  try {
    let response: Response;
    if (isOllama) {
      response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          keep_alive: "30m",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          format: "json",
          options: { temperature: 0.6, num_predict: 800 },
        }),
      });
    } else {
      const isDeepSeek = proxiedProvider === "deepseek";
      response = await fetch("/api/llm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-llm-provider": proxiedProvider!,
          // BYOK: forward the visitor's own key (from Settings → localStorage).
          ...(config.apiKey ? { "x-llm-key": config.apiKey } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.6,
          max_tokens: 800,
          response_format: { type: "json_object" },
          // DeepSeek V4 ships with thinking enabled by default; force it off
          // so the JSON arrives in `message.content` instead of reasoning.
          ...(isDeepSeek ? { thinking: { type: "disabled" } } : {}),
        }),
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(could not read body)");
      console.error(
        `[SentiArch] LLM HTTP ${response.status} ${response.statusText}\n` +
        `  provider: ${config.provider ?? "(unset)"}\n` +
        `  model:    ${config.model}\n` +
        `  body:     ${bodyText.slice(0, 500)}${bodyText.length > 500 ? "…" : ""}`,
      );
      return null;
    }

    const data = await response.json();
    let content: string | undefined;
    if (isOllama) {
      content = typeof data?.message?.content === "string" ? data.message.content : undefined;
    } else {
      content = data?.choices?.[0]?.message?.content;
      if (!content) {
        const reasoning = data?.choices?.[0]?.message?.reasoning_content;
        if (typeof reasoning === "string" && reasoning.trim()) {
          console.warn("[SentiArch] Falling back to reasoning_content (thinking mode forced on).");
          content = reasoning;
        }
      }
    }
    if (!content) {
      console.error(
        `[SentiArch] LLM response missing content:`,
        `\n  provider: ${config.provider ?? "(unset)"}`,
        `\n  model:    ${config.model}`,
        `\n  raw:      ${JSON.stringify(data).slice(0, 500)}`,
      );
      return null;
    }
    // Models that ignore `response_format` sometimes wrap JSON in markdown
    // fences; strip them before parseAssessment runs.
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = parseAssessment(cleaned);
    if (!parsed) {
      console.error(
        `[SentiArch] LLM returned content but parseAssessment failed:\n` +
        `  raw: ${content.slice(0, 500)}`,
      );
      return null;
    }
    return { assessment: parsed, ruleTriggers: [], observations: parsed.observations };
  } catch (err) {
    console.error(
      `[SentiArch] LLM call threw exception:\n` +
      `  provider: ${config.provider ?? "(unset)"}\n` +
      `  model:    ${config.model}\n` +
      `  err:      ${err instanceof Error ? err.message : String(err)}\n` +
      `  Likely network failure or malformed JSON in response.`,
      err,
    );
    return null;
  }
}

/**
 * Single-shot helper: builds the Layer-2 system prompt and calls the
 * LLM. Kept for ad-hoc usage; the route engine in Legacy.tsx wires
 * `buildAssessmentSystemPrompt` → `callLLMWithPrompt` directly.
 */
export async function callLLM(
  persona: PersonaData, computed: ComputedOutputs, _shapes: Shape[] = [], zones: Zone[] = []
): Promise<{
  experience: ExperienceData;
  accumulatedState: AccumulatedState;
  ruleTriggers: string[];
} | null> {
  const accState_engine = applyRoleAccStateConstraints(
    computePerceptualLoad(persona, computed, zones),
    persona.agent.role,
  );
  const baselineComfort = computeComfortScore(accState_engine);
  const system = buildAssessmentSystemPrompt(persona, computed, zones, {});
  const result = await callLLMWithPrompt(system);
  if (!result?.assessment) {
    return {
      experience: { summary: "", comfort_score: baselineComfort, trend: "stable", llm: null },
      accumulatedState: accState_engine,
      ruleTriggers: [],
    };
  }
  const { assessment } = result;
  return {
    experience: {
      summary: assessment.narration,
      comfort_score: assessment.comfort,
      trend: "stable",
      llm: assessment,
    },
    accumulatedState: dimsToAccState(assessment.dims),
    ruleTriggers: [],
  };
}

// ============================================================
// ---- Layer 3 · "The Critique" ------------------------------
// ============================================================
// The thesis (slide 19, renamed from "The God's Eye" per Hongshan
// feedback, PR #26) frames Layer 3 as the LLM stepping back to
// read the WHOLE COHORT at once — surfacing patterns that no
// single Layer-2 narrative could see from inside its own viewpoint.
//
// Slide 20 ("Beyond Comfort") motivates this layer explicitly:
// Layer 2 tells me how each PERSON feels; I wanted something that
// tells me where the DESIGN will fail.
//
// The Critique answers three categories of question simultaneously:
//   1. PRACTICAL PROBLEMS  — concrete issues multiple agents will
//                            run into.
//   2. LATENT RISKS        — risks no single agent can name (e.g.
//                            nobody complained, but everyone slowed).
//   3. GEOMETRIC FAILURE   — failures the geometry has invited in
//      MODES                 (long sightlines without refuge,
//                            dead-end wayfinding, etc.).
//
// Each finding cites specific agents + waypoints (falsifiability),
// proposes a mechanism, and surfaces a design implication an
// architect can act on. Output is JSON for parseable downstream
// rendering.

export interface CritiqueFinding {
  category: "practical_problem" | "latent_risk" | "geometric_failure_mode";
  pattern: string;            // short title — what's happening
  evidence: string;           // which agents / waypoints / readings demonstrate it
  mechanism: string;          // why this happens; link environment to experience
  design_implication: string; // concrete architectural suggestion
}

export interface CritiqueReport {
  population_summary: string; // 2-3 sentence overview of the cohort experience
  findings: CritiqueFinding[];
  generated_at: string;       // ISO timestamp
  model: string;              // LLM model that produced this report
  canvas_id: string;          // which canvas this critique scored
  agent_count: number;        // how many agents fed the prompt
}

/**
 * Input shape for `callTheCritique`. Carries per-agent context (persona
 * + route summary + a truncated perception-log slice) for a single
 * canvas. The caller is responsible for filtering out agents that have
 * not yet simulated (those contribute no signal).
 */
export interface CritiqueAgentInput {
  persona: PersonaData;
  summary: RouteSummary | null;
  log: PerceptionLogEntry[];
}

/**
 * Build the per-agent narrative bullet that the Critique prompt receives.
 * Truncates each leg's experience.summary to 200 chars and caps to at
 * most 6 dwell-phase entries to keep total prompt size under ~12k
 * tokens for typical 5-agent canvases.
 */
function summariseAgentForCritique(input: CritiqueAgentInput, index: number): string {
  const { persona, summary, log } = input;
  const agent = persona.agent;
  // Objective summary draws from agent.role / agent.purpose_at_centre /
  // agent.goal_progress (the canonical flat fields; the legacy
  // persona.objective block was deduped).
  const objHasRole = !!agent.role;
  const objHasPurpose = !!agent.purpose_at_centre;
  const hasProgress = typeof agent.goal_progress === "number" && Number.isFinite(agent.goal_progress);
  const objLine = (objHasRole || objHasPurpose || hasProgress)
    ? `objective: ${agent.role || "—"} · ${agent.purpose_at_centre || "—"}${hasProgress ? ` (${Math.round((agent.goal_progress as number) * 100)}% complete)` : ""}`
    : `objective: (unspecified)`;

  const summaryLine = summary
    ? `route: ${summary.legCount} leg(s), avgComfort=${summary.avgComfort}/10, avgStress=${summary.avgStress}/10, trend=${summary.trend} (${summary.startComfort}→${summary.endComfort})`
    : "route: did not simulate";

  const trunc = (s: string, n: number): string => s.length > n ? s.slice(0, n - 1) + "…" : s;
  const dwells = log
    .filter((e) => e.phase === "dwelling")
    .slice(-6) // newest 6 dwell entries — recency matters more than recency for cohort patterns
    .map((e) => {
      const tag = e.triggers.slice(0, 2).join(", ");
      return `    • @${e.waypoint_id} (${e.position.x},${e.position.y}) comfort=${e.experience.comfort_score}/10 stress=${computeStressScore(e.accState).toFixed(1)}/10${tag ? ` [${tag}]` : ""}: ${trunc(e.experience.summary || "(no summary)", 200)}`;
    })
    .join("\n");

  return [
    `[${index + 1}] ${agent.id}${agent.name ? ` "${agent.name}"` : ""} — ${agent.age}yo ${agent.gender}, MBTI=${agent.mbti}, ASI=${agent.anxiety.asi_score} (${agent.anxiety.asi_level})${agent.role ? `, role=${agent.role}` : ""}${agent.mobility !== "normal" ? `, mobility=${agent.mobility}` : ""}${agent.vision !== "normal" ? `, vision=${agent.vision}` : ""}${agent.hearing !== "normal" ? `, hearing=${agent.hearing}` : ""}`,
    `    ${objLine}`,
    `    ${summaryLine}`,
    dwells || "    (no dwell-phase log entries)",
  ].join("\n");
}

/**
 * Build the user prompt sent to the LLM for The Critique. Exported for
 * testability and so the same shape can be re-used if a streaming
 * variant is added later.
 */
export function buildCritiquePrompt(
  canvas: CanvasData,
  inputs: CritiqueAgentInput[],
): string {
  const zonesSummary = canvas.zones.length === 0
    ? "  (no zones declared)"
    : canvas.zones.map((z) => `  - ${z.label || z.id}${z.program ? ` · program="${z.program}"` : ""}`).join("\n");

  const shapesSummary = (() => {
    const counts: Record<string, number> = {};
    for (const s of canvas.shapes) counts[s.type] = (counts[s.type] ?? 0) + 1;
    const parts = Object.entries(counts).map(([t, n]) => `${t}×${n}`);
    return parts.length > 0 ? parts.join(", ") : "(no shapes)";
  })();

  const cohort = inputs.map(summariseAgentForCritique).join("\n\n");

  return `You are "The Critique" — Layer 3 of the SentiArch methodology.
Layer 2 (the per-agent simulations below) tells you how each PERSON felt.
Your job is to step back and tell the architect where the DESIGN will fail.

You are looking at a single canvas (one architectural scheme). Each agent
walked or sat through it and produced a comfort score, a stress score,
and a first-person summary at each waypoint. Read the whole cohort at
once and surface patterns that no single agent could see from inside
their own narrative.

== CANVAS ==
Name: ${canvas.name}
Shapes: ${shapesSummary}
Zones:
${zonesSummary}

== COHORT (Layer-2 narratives) ==
${cohort}

== YOUR TASK ==
Produce a structured report with TWO parts:

A. POPULATION SUMMARY — 2-3 sentences. What did this canvas do to the
   cohort as a whole? Tone-match the data: if average comfort was high,
   say so; if widely-varying, say so; if a sub-population suffered,
   say so. Do NOT generalise — describe THIS cohort on THIS canvas.

B. FINDINGS — 3-8 findings total, distributed across THREE categories:

   1. practical_problem      — concrete issues that multiple agents
                               (≥2) actually ran into here. Cite each
                               agent by id and waypoint.
   2. latent_risk            — risks the cohort exhibits but no single
                               agent named (e.g. comfort scores stayed
                               OK but stress accumulated; agents
                               disengaged silently; an outlier ASI
                               agent slowly degraded while the others
                               were fine).
   3. geometric_failure_mode — failures the GEOMETRY of this canvas
                               has invited in. Examples: long
                               sight-line without refuge; dead-end
                               wayfinding; emotional-contagion-prone
                               adjacency; circulation forced through
                               a high-stress zone.

For each finding, return:
  pattern             — the short title (one sentence; what's happening)
  evidence            — WHICH agents, WHICH waypoints, WHICH readings
                        demonstrate it. Cite by id (e.g. "persona_03 at
                        wp_4 reported comfort=3/10 with social_overload
                        trigger; persona_05 at same wp reported
                        comfort=8/10 — the variance is the signal").
                        Cite at least 2 distinct agents OR 1 agent +
                        1 environmental reading.
  mechanism           — WHY this happens. Connect environment / spatial
                        / role / ASI to the experience. Cite a
                        literature direction if relevant (e.g. "Ulrich
                        1991 supportive design", "Hatfield 1994
                        emotional contagion") — but treat this as a
                        hypothesis, not a research finding.
  design_implication  — what a designer could CHANGE on this canvas to
                        address the finding. Be specific to the
                        geometry / program / spatial position. Avoid
                        generic ("add more windows", "improve
                        wayfinding") — say WHICH window, WHICH path.

DO NOT INVENT findings to fill the quota. If the cohort genuinely shows
fewer than 3 distinct patterns, return only what you can defend with
evidence. Empty findings array is acceptable.

Respond as a single JSON object (no markdown fences). Schema:
{
  "population_summary": "<2-3 sentences>",
  "findings": [
    {
      "category": "practical_problem" | "latent_risk" | "geometric_failure_mode",
      "pattern": "<one sentence>",
      "evidence": "<which agents/waypoints/readings>",
      "mechanism": "<why this happens; literature direction if relevant>",
      "design_implication": "<specific architectural change>"
    }
  ]
}`;
}

/**
 * Layer 3 call. Reads all agents on a canvas and surfaces cross-agent
 * patterns. Returns null when no LLM is configured, when no agent has
 * a perception log, or when the LLM call fails. Errors are logged to
 * console — the UI should render a generic "could not complete" state
 * when null is returned, and the developer can read console for
 * diagnostics.
 */
export async function callTheCritique(
  canvas: CanvasData,
  personas: PersonaData[],
  perceptionLogs: Record<number, PerceptionLogEntry[]>,
  waypoints: Record<number, Waypoint[]>,
): Promise<CritiqueReport | null> {
  const config = getLLMConfig();
  if (!config) {
    console.warn("[SentiArch · Critique] LLM call skipped: no llm_config saved (Settings page).");
    return null;
  }

  // Build per-agent inputs. Skip agents with empty perception logs —
  // they contribute no signal, and including them would dilute the
  // prompt.
  const inputs: CritiqueAgentInput[] = personas
    .map((persona, idx): CritiqueAgentInput => ({
      persona,
      log: perceptionLogs[idx] ?? [],
      summary: computeRouteSummary(perceptionLogs[idx] ?? [], waypoints[idx] ?? [], persona),
    }))
    .filter((input) => input.log.length > 0);

  if (inputs.length === 0) {
    console.warn("[SentiArch · Critique] No agents have a perception log — skipping call.");
    return null;
  }

  const prompt = buildCritiquePrompt(canvas, inputs);
  const systemMessage =
    "You are 'The Critique' — Layer 3 of the SentiArch agent-based environmental simulator. " +
    "You read the whole agent cohort at once and surface cross-agent failure patterns " +
    "(practical problems, latent risks, geometric failure modes) that no single Layer-2 " +
    "narrative could see. Always respond with a single JSON object, no markdown fences. " +
    "Cite agents by id; cite evidence with at least 2 sources; treat literature pointers as " +
    "hypotheses, not research findings.";

  const url = (config.apiUrl ?? "").toLowerCase();
  const isOllama = config.provider === "ollama"
    || url.includes("localhost:11434")
    || url.includes("127.0.0.1:11434")
    || url.endsWith("/api/chat");
  const proxiedProvider: "deepseek" | "openai" | null =
    config.provider === "deepseek" ? "deepseek"
    : config.provider === "openai" ? "openai"
    : null;

  if (!isOllama && !proxiedProvider) {
    console.warn(
      `[SentiArch · Critique] provider "${config.provider ?? "unknown"}" not supported; ` +
      `use Ollama (local), DeepSeek, or OpenAI.`,
    );
    return null;
  }

  try {
    let response: Response;
    if (isOllama) {
      response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          keep_alive: "30m",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          format: "json",
          options: { temperature: 0.5, num_predict: 2400 },
        }),
      });
    } else {
      const isDeepSeek = proxiedProvider === "deepseek";
      response = await fetch("/api/llm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-llm-provider": proxiedProvider!,
          // BYOK: forward the visitor's own key (from Settings → localStorage).
          ...(config.apiKey ? { "x-llm-key": config.apiKey } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 2400,
          response_format: { type: "json_object" },
          ...(isDeepSeek ? { thinking: { type: "disabled" } } : {}),
        }),
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(could not read body)");
      console.error(
        `[SentiArch · Critique] LLM HTTP ${response.status} ${response.statusText}\n` +
        `  provider: ${config.provider ?? "(unset)"}\n` +
        `  model:    ${config.model}\n` +
        `  body:     ${bodyText.slice(0, 500)}${bodyText.length > 500 ? "…" : ""}`,
      );
      return null;
    }

    const data = await response.json();
    let content: string | undefined;
    if (isOllama) {
      content = typeof data?.message?.content === "string" ? data.message.content : undefined;
    } else {
      content = data?.choices?.[0]?.message?.content;
      if (!content) {
        const reasoning = data?.choices?.[0]?.message?.reasoning_content;
        if (typeof reasoning === "string" && reasoning.trim()) {
          console.warn("[SentiArch · Critique] Falling back to reasoning_content (thinking mode forced on).");
          content = reasoning;
        }
      }
    }
    if (!content) {
      console.error("[SentiArch · Critique] LLM response missing content. raw:", JSON.stringify(data).slice(0, 500));
      return null;
    }
    content = content.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const populationSummary = typeof parsed.population_summary === "string"
      ? parsed.population_summary.trim()
      : "";

    const rawFindings: unknown = parsed.findings;
    const validCategories = new Set(["practical_problem", "latent_risk", "geometric_failure_mode"]);
    const findings: CritiqueFinding[] = Array.isArray(rawFindings)
      ? rawFindings
          .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
          .map((f) => ({
            category: typeof f.category === "string" && validCategories.has(f.category)
              ? (f.category as CritiqueFinding["category"])
              : "practical_problem",
            pattern: typeof f.pattern === "string" ? f.pattern.trim() : "",
            evidence: typeof f.evidence === "string" ? f.evidence.trim() : "",
            mechanism: typeof f.mechanism === "string" ? f.mechanism.trim() : "",
            design_implication: typeof f.design_implication === "string" ? f.design_implication.trim() : "",
          }))
          .filter((f) => f.pattern && f.evidence && f.mechanism && f.design_implication)
          .slice(0, 8)
      : [];

    return {
      population_summary: populationSummary,
      findings,
      generated_at: new Date().toISOString(),
      model: config.model,
      canvas_id: canvas.id,
      agent_count: inputs.length,
    };
  } catch (err) {
    console.error(
      `[SentiArch · Critique] LLM call threw exception:\n` +
      `  provider: ${config.provider ?? "(unset)"}\n` +
      `  model:    ${config.model}\n` +
      `  err:      ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    return null;
  }
}
