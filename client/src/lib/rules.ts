// ============================================================
// SentiArch — Local Rule Layer
// ============================================================
// Deterministic threshold-based triggers that fire BEFORE the LLM call.
// Their tags are:
//   1. injected into the LLM prompt as `LOCAL RULE TRIGGERS`, so the LLM
//      grounds its narrative in objective stress signals, and
//   2. merged with any narrative-driven tags the LLM emits in its
//      `rule_triggers` field, then stored in the PerceptionLogEntry.
//
// Adding a new rule: append a Rule to RULES with a stable `tag` (snake_case).
// Keep conditions cheap and side-effect free — they run before every prompt.

import type {
  PersonaData,
  ComputedOutputs,
  AccumulatedState,
  EnvironmentData,
  SpatialData,
  Zone,
  AnxietyData,
} from "./store";

export interface RuleContext {
  persona: PersonaData;
  computed: ComputedOutputs;
  accState: AccumulatedState;
  env: EnvironmentData;
  spatial: SpatialData;
  /** Current zone the agent is in, if any (drives program/open_space rules). */
  zone?: Zone | null;
  /** Dwell time at this leg in minutes; lets greenery starvation rules fire only after sustained low-GVI exposure. */
  dwellMinutes?: number;
}

export interface Rule {
  id: string;
  tag: string;
  description: string;
  condition: (ctx: RuleContext) => boolean;
  /**
   * Optional callback that produces the underlying numeric reason for a
   * firing rule (e.g. "anxiety_perceived_dB=85.4 dB ≥ 75 threshold").
   * Passed into the LLM prompt so the model grounds narrative in real
   * sensor values instead of just reacting to abstract tag labels.
   */
  reason?: (ctx: RuleContext) => string;
}

/** Tag plus optional reason — what `evaluateRules` returns. */
export interface FiredRule {
  tag: string;
  reason?: string;
}

const subtype = (a: AnxietyData | undefined, label: string): boolean =>
  !!a && a.subtype_label === label;

export const RULES: Rule[] = [
  // ---------------- Environmental thresholds ----------------
  {
    id: "noise_high",
    tag: "noise_high",
    description: "Anxiety-scaled perceived dB exceeds 75 (loud-conversation level).",
    condition: (c) => c.computed.anxiety_perceived_dB > 75,
    reason: (c) => `anxiety_perceived_dB=${c.computed.anxiety_perceived_dB.toFixed(1)} dB > 75`,
  },
  {
    id: "noise_severe",
    tag: "noise_severe",
    description: "Anxiety-scaled perceived dB exceeds 85 (rail/road traffic levels).",
    condition: (c) => c.computed.anxiety_perceived_dB > 85,
    reason: (c) => `anxiety_perceived_dB=${c.computed.anxiety_perceived_dB.toFixed(1)} dB > 85`,
  },
  {
    id: "thermal_extreme",
    tag: "thermal_extreme",
    description: "PMV magnitude exceeds 1.5 — clearly outside comfort envelope.",
    condition: (c) => Math.abs(c.computed.PMV) > 1.5,
    reason: (c) => `PMV=${c.computed.PMV.toFixed(2)} (|PMV|>1.5); air_temp=${c.env.air_temp}°C, RH=${c.env.humidity}%, v=${c.env.air_velocity} m/s`,
  },
  {
    id: "ppd_high",
    tag: "ppd_high",
    description: "Predicted Percentage Dissatisfied exceeds 25%.",
    condition: (c) => c.computed.PPD > 25,
    reason: (c) => `PPD=${c.computed.PPD.toFixed(1)}% > 25`,
  },
  {
    id: "glare_risk",
    tag: "glare_risk",
    description: "Lux exceeds 5000 — direct sun / high-glare condition.",
    condition: (c) => c.env.lux > 5000,
    reason: (c) => `lux=${Math.round(c.env.lux)} > 5000 (direct sun band)`,
  },
  {
    id: "low_light",
    tag: "low_light",
    description: "Lux below 100 — perceptibly dim.",
    condition: (c) => c.env.lux < 100,
    reason: (c) => `lux=${Math.round(c.env.lux)} < 100 (dim)`,
  },

  // ---------------- Spatial / wayfinding ----------------
  {
    id: "exit_far",
    tag: "exit_far",
    description: "Anxiety-scaled distance to exit exceeds 15 m.",
    condition: (c) => c.computed.anxiety_personal_space > 15,
    reason: (c) => `anxiety_personal_space=${c.computed.anxiety_personal_space.toFixed(1)} m > 15`,
  },
  {
    id: "no_exit_visible",
    tag: "no_exit_visible",
    description: "No door/exit detected (dist_to_exit sentinel).",
    condition: (c) => c.spatial.dist_to_exit < 0,
    reason: () => `dist_to_exit=-1 (no door shape in line of sight)`,
  },
  {
    id: "crowd_overload",
    tag: "crowd_overload",
    description: "More than 10 other agents visible.",
    condition: (c) => c.spatial.visible_agents > 10,
    reason: (c) => `visible_agents=${c.spatial.visible_agents} > 10`,
  },

  // ---------------- Anxiety-subtype combos ----------------
  {
    id: "panic_open_far_from_exit",
    tag: "panic_open_far_from_exit",
    description: "Panic_Agoraphobic agent in open space and far (>8 m) from any exit.",
    condition: (c) =>
      subtype(c.persona.agent.anxiety, "Panic_Agoraphobic") &&
      (c.zone?.env.open_space ?? true) &&
      c.spatial.dist_to_exit > 8,
    reason: (c) => `Panic_Agoraphobic + open_space=${c.zone?.env.open_space ?? true} + dist_to_exit=${c.spatial.dist_to_exit.toFixed(1)} m > 8`,
  },
  {
    id: "panic_enclosed_low_ceiling",
    tag: "panic_enclosed_low_ceiling",
    description: "Panic_Agoraphobic agent indoors with ceiling below 2.4 m.",
    condition: (c) =>
      subtype(c.persona.agent.anxiety, "Panic_Agoraphobic") &&
      !(c.zone?.env.open_space ?? false) &&
      (c.zone?.env.ceiling_height ?? 2800) < 2400,
    reason: (c) => `Panic_Agoraphobic + open_space=false + ceiling_height=${c.zone?.env.ceiling_height ?? 2800} mm < 2400`,
  },
  {
    id: "sad_social_pressure",
    tag: "sad_social_pressure",
    description: "Social_Anxiety agent with 5+ visible agents nearby.",
    condition: (c) =>
      subtype(c.persona.agent.anxiety, "Social_Anxiety") && c.spatial.visible_agents >= 5,
    reason: (c) => `Social_Anxiety + visible_agents=${c.spatial.visible_agents} >= 5`,
  },
  {
    id: "sad_no_refuge",
    tag: "sad_no_refuge",
    description: "Social_Anxiety agent in fully open zone (low enclosure_ratio < 0.2).",
    condition: (c) =>
      subtype(c.persona.agent.anxiety, "Social_Anxiety") && c.spatial.enclosure_ratio < 0.2,
    reason: (c) => `Social_Anxiety + enclosure_ratio=${c.spatial.enclosure_ratio.toFixed(2)} < 0.2`,
  },
  {
    id: "gad_uncertain_environment",
    tag: "gad_uncertain_environment",
    description: "GAD agent in zone with no labelled program (ambiguity trigger).",
    condition: (c) =>
      subtype(c.persona.agent.anxiety, "GAD") &&
      (!c.zone || !c.zone.program || !c.zone.program.trim()),
    reason: (c) => `GAD + zone="${c.zone?.label ?? "none"}" has no program/activity label`,
  },

  // ---------------- Greenery (Jing 2024 / Song 2022 / Li 2024) ----------------
  // Note: GVI bands are research-derived. biophilic_optimal is the 25%
  // sweet spot from Jing et al. 2024 (RCT, plateau effect after 25%).
  // green_oversaturation flags the mild-decline zone past 75–85% per Jing.
  // green_starvation only fires after 10+ min sustained low-GVI exposure
  // — short transits past barren areas don't trigger fatigue claims.
  {
    id: "biophilic_restoration",
    tag: "biophilic_restoration",
    description: "GVI in 0.15–0.50 band — meaningful greenery contributes to restoration (Song 2022).",
    condition: (c) => {
      const g = c.spatial.green_visibility ?? 0;
      return g > 0.15 && g < 0.50;
    },
    reason: (c) => `green_visibility=${(c.spatial.green_visibility ?? 0).toFixed(2)} in 0.15–0.50 (restorative band, Song 2022)`,
  },
  {
    id: "biophilic_optimal",
    tag: "biophilic_optimal",
    description: "GVI in 0.20–0.30 sweet spot — peak stress recovery per Jing 2024 RCT.",
    condition: (c) => {
      const g = c.spatial.green_visibility ?? 0;
      return g > 0.20 && g < 0.30;
    },
    reason: (c) => `green_visibility=${(c.spatial.green_visibility ?? 0).toFixed(2)} in 0.20–0.30 (Jing 2024 RCT optimum)`,
  },
  {
    id: "green_oversaturation",
    tag: "green_oversaturation",
    description: "GVI > 0.85 — past plateau; mild decline in restorative effect.",
    condition: (c) => (c.spatial.green_visibility ?? 0) > 0.85,
    reason: (c) => `green_visibility=${(c.spatial.green_visibility ?? 0).toFixed(2)} > 0.85 (post-plateau, Jing 2024)`,
  },
  {
    id: "green_starvation",
    tag: "green_starvation",
    description: "Sustained low GVI (<0.05) for 10+ minutes — restorative deficit (Song 2022 fatigue effect).",
    condition: (c) =>
      (c.spatial.green_visibility ?? 0) < 0.05 && (c.dwellMinutes ?? 0) > 10,
    reason: (c) => `green_visibility=${(c.spatial.green_visibility ?? 0).toFixed(2)} < 0.05 with dwell=${c.dwellMinutes ?? 0} min > 10`,
  },

  // ---------------- Accumulated state escalation ----------------
  {
    id: "fatigue_high",
    tag: "fatigue_high",
    description: "Accumulated fatigue exceeds 0.7.",
    condition: (c) => c.accState.fatigue > 0.7,
    reason: (c) => `accumulated fatigue=${c.accState.fatigue.toFixed(2)} > 0.7`,
  },
  {
    id: "social_overload_high",
    tag: "social_overload_high",
    description: "Accumulated social overload exceeds 0.7.",
    condition: (c) => c.accState.social_overload > 0.7,
    reason: (c) => `accumulated social_overload=${c.accState.social_overload.toFixed(2)} > 0.7`,
  },
];

/**
 * Run every rule against the supplied context and return the firing
 * rules with tag + numeric reason. Order preserved (declaration order
 * in RULES).
 */
export function evaluateRules(ctx: RuleContext): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of RULES) {
    try {
      if (rule.condition(ctx)) {
        fired.push({
          tag: rule.tag,
          reason: rule.reason ? rule.reason(ctx) : undefined,
        });
      }
    } catch {
      // Defensive: malformed context shouldn't kill the simulation.
    }
  }
  return fired;
}

/** Just the tag strings — convenience for the merge step. */
export function tagsOnly(fired: FiredRule[]): string[] {
  return fired.map((f) => f.tag);
}

/** Merge local rule tags with LLM-generated tags, dedupe, preserve order. */
export function mergeTriggers(local: string[], llm: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of local) {
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  for (const t of llm ?? []) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
