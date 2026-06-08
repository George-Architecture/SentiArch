// ============================================================
// Home Page - Multi-Agent Occupant Perception Map
// Clean neumorphism UI with Inter font
// Waypoint route system + agent animation + perception log
// Dynamic agent tabs (unlimited)
// ============================================================

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PersonaMindMap, { type PeerAgentReaction } from "@/components/PersonaMindMap";
import SpatialMap from "@/components/SpatialMap";
import CoordinateInput from "@/components/CoordinateInput";
import {
  type PersonaData,
  type ExperienceData,
  type AccumulatedState,
  type ComputedOutputs,
  type Shape,
  type SpatialData,
  type AgentPosition,
  type PersonaState,
  type Zone,
  type Waypoint,
  type PerceptionLogEntry,
  type AgentRoute,
  type CanvasData,
  type CanvasStore,
  type LLMAssessment,
  defaultPersonas,
  defaultExperience,
  defaultAccumulatedState,
  defaultComputedOutputs,
  computeOutputs,
  computePerceptualLoad,
  computeSpatialFromAgent,
  computeVisibleAgents,
  computeStressScore,
  computeComfortScore,
  deriveComfortDrivers,
  deriveTrend,
  posToCell,
  saveShapes,
  loadShapes,
  saveMultiAgent,
  loadMultiAgent,
  saveZones,
  loadZones,
  saveWaypoints,
  saveAllPerceptionLogs,
  loadWaypoints,
  getLLMConfig,
  callLLMWithPrompt,
  buildDwellPrompt,
  dimsToAccState,
  isAgentCoreChange,
  getEnvAtPosition,
  zoneEnvToEnvironment,
  getPersonaColor,
  createNewPersona,
  type HeatmapPoint,
  DEFAULT_LAYOUT,
  LAYOUT_PRESETS,
  type LayoutPreset,
  loadAllWaypoints,
  MAX_CANVASES,
  cloneCanvas,
  loadCanvasesWithMigration,
  saveCanvasStore,
  savePersonas,
  migrateLegacyShapes,
  migrateZoneEnv,
  parseImportedPersonas,
  parseScenarioImport,
  getZoneAtPosition,
  computeCoZoneAgents,
  resolveRelationshipDetails,
  distanceForExport,
  applyRoleAccStateConstraints,
  blendCarriedState,
  splitZoneIntoParts,
  splitZoneByLine,
  findZoneForLineCut,
  splitZoneByPolyline,
  findZoneForPolylineCut,
} from "@/lib/store";
import { evaluateRules, tagsOnly } from "@/lib/rules";

function createDefaultState(persona: PersonaData): PersonaState {
  return {
    persona,
    experience: defaultExperience,
    accState: defaultAccumulatedState,
    computed: defaultComputedOutputs,
    triggers: [],
    prevExperience: null,
    prevAccState: null,
    agentPos: null,
    hasSimulated: false,
    route: { waypoints: [], perceptionLog: [] },
  };
}

// Interpolate position along a line from A to B by t (0-1)
function lerpPos(a: AgentPosition, b: AgentPosition, t: number): AgentPosition {
  return {
    x: Math.round(a.x + (b.x - a.x) * t),
    y: Math.round(a.y + (b.y - a.y) * t),
  };
}

// Distance between two positions (mm)
function posDist(a: AgentPosition, b: AgentPosition): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Rescale waypoint dwell_minutes proportionally so their sum fits within `budget`.
// Treats `budget` as the upper limit defined by persona.position.duration_in_cell.
// Returns the original list unchanged if already within budget or budget <= 0.
function rescaleWaypointsToBudget(wps: Waypoint[], budget: number): Waypoint[] {
  if (wps.length === 0 || budget <= 0) return wps;
  const total = wps.reduce((s, w) => s + Math.max(0, w.dwell_minutes), 0);
  if (total <= budget) return wps;
  const ratio = budget / total;
  const rounded = wps.map((w) => ({
    ...w,
    dwell_minutes: Math.max(0, Math.round(w.dwell_minutes * ratio)),
  }));
  // Absorb rounding drift in the last waypoint so the sum equals `budget` exactly.
  const newSum = rounded.reduce((s, w) => s + w.dwell_minutes, 0);
  const drift = budget - newSum;
  if (drift !== 0) {
    const last = rounded[rounded.length - 1];
    last.dwell_minutes = Math.max(0, last.dwell_minutes + drift);
  }
  return rounded;
}

export default function Home() {
  const [, navigate] = useLocation();

  // Bootstrap canvases + shared personas in one shot. Migrates legacy
  // single-canvas data into a Canvas 1 on first load after the upgrade.
  const initialBoot = useMemo(() => loadCanvasesWithMigration(), []);

  // Canvas state — list of schemes, plus index of the one currently being edited.
  const [canvases, setCanvases] = useState<CanvasData[]>(initialBoot.store.canvases);
  const [activeCanvasIdx, setActiveCanvasIdx] = useState(initialBoot.store.activeIdx);

  // Live editor state for the active canvas. The active canvas's data is the
  // source of truth in the editor; other canvases live in `canvases` until
  // selected. A snapshot effect below mirrors live state back into
  // canvases[activeCanvasIdx] on every change.
  const [states, setStates] = useState<PersonaState[]>(() => {
    const personas = initialBoot.personas;
    const c0 = initialBoot.store.canvases[initialBoot.store.activeIdx];
    return personas.map((p, i) => {
      const log = c0.perceptionLogs[i] ?? [];
      // Hydrate the LIVE experience / accState / triggers from the
      // last perception_log entry. Without this the user navigating
      // away from the page (e.g. into Settings) and coming back would
      // see the live experience reset to defaultExperience — Layer-2
      // observations and the LLM-written summary visibly disappear
      // even though the perception_log itself is intact in localStorage.
      const lastEntry = log.length > 0 ? log[log.length - 1] : null;
      return {
        ...createDefaultState(p),
        agentPos: c0.agentPositions[i] ?? null,
        route: { waypoints: c0.waypoints[i] ?? [], perceptionLog: log },
        hasSimulated: log.length > 0,
        ...(lastEntry ? {
          experience: lastEntry.experience,
          accState: lastEntry.accState,
          computed: lastEntry.computed,
          triggers: lastEntry.triggers ?? [],
        } : {}),
      };
    });
  });

  const [shapes, setShapes] = useState<Shape[]>(() => initialBoot.store.canvases[initialBoot.store.activeIdx].shapes);
  const [zones, setZones] = useState<Zone[]>(() => initialBoot.store.canvases[initialBoot.store.activeIdx].zones);
  const [activeTab, setActiveTab] = useState(0);
  const [simChecked, setSimChecked] = useState<boolean[]>(() => states.map(() => true));
  const [running, setRunning] = useState(false);
  // Inline rename: index of the canvas tab currently being edited, or null.
  const [renamingCanvasIdx, setRenamingCanvasIdx] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Route animation state
  const [animatingAgents, setAnimatingAgents] = useState<Record<number, AgentPosition>>({});
  const [pathTrails, setPathTrails] = useState<Record<number, AgentPosition[]>>({});
  const [routeRunning, setRouteRunning] = useState(false);
  const routeAbortRef = useRef(false);
  // Stores each agent's position as it was just before a route simulation started.
  // Used by resetAgents to restore the pre-route starting position.
  const originalAgentPositionsRef = useRef<Record<number, AgentPosition | null>>({});

  // Current active persona state
  const current = states[activeTab];

  // Hidden file-input element used by the Import button.
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Persona Import (agents only) ----
  // Replace all current personas with those parsed from a JSON file —
  // agents only. Map geometry (shapes + zones) is intentionally NEVER
  // touched here, even when the file happens to be a full scenario
  // export carrying shapes and zones; this button is for "swap in a
  // different cast on the same set". Use Cloud Load when you want a
  // full scenario restore including geometry.
  //
  // Resets every canvas's per-agent slots (positions / waypoints / logs)
  // so indices stay aligned with the new persona array. If the file
  // includes per-agent positions, those are restored on the active
  // canvas; otherwise agents are unplaced and need to be put on the map.
  const importPersonasFromFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast.error("Could not read file");
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const parsed = parseScenarioImport(json);
        if (parsed.personas.length === 0) {
          toast.error("File contained no valid personas");
          return;
        }
        const placedCount = parsed.agentPositions
          ? parsed.agentPositions.filter((p) => p !== null).length
          : 0;
        const ignoredShapes = parsed.shapes?.length ?? 0;
        const ignoredZones = parsed.zones?.length ?? 0;
        const ignoredNote = ignoredShapes > 0 || ignoredZones > 0
          ? `\n\nThe file also contains ${ignoredShapes} shape(s) and ${ignoredZones} zone(s) — these will be IGNORED. Use Cloud Load if you want a full scenario restore including map geometry.`
          : "";

        const ok = window.confirm(
          `Replace current agents with ${parsed.personas.length} persona${parsed.personas.length === 1 ? "" : "s"} from ${file.name}?\n\n` +
          `Map geometry (shapes + zones) will be kept exactly as it is now. Waypoints and simulation results in every canvas will be cleared.` +
          ignoredNote,
        );
        if (!ok) return;

        const positions = parsed.agentPositions ?? parsed.personas.map(() => null);
        setStates(parsed.personas.map((p, i) => ({
          ...createDefaultState(p),
          agentPos: positions[i] ?? null,
        })));
        setSimChecked(parsed.personas.map(() => true));
        setActiveTab(0);
        // No setShapes / setZones — geometry stays put.
        setCanvases((prev) => prev.map((c, idx) => ({
          ...c,
          agentPositions: idx === activeCanvasIdx
            ? positions.slice(0, parsed.personas.length)
            : parsed.personas.map(() => null),
          waypoints: {},
          perceptionLogs: {},
        })));
        setPathTrails({});
        setAnimatingAgents({});

        const summary: string[] = [`${parsed.personas.length} agents`];
        if (placedCount > 0) summary.push(`${placedCount} placed`);
        if (ignoredShapes > 0 || ignoredZones > 0) {
          summary.push(`${ignoredShapes} shapes / ${ignoredZones} zones in file ignored`);
        } else {
          summary.push("geometry preserved");
        }
        toast.success(`Imported ${summary.join(" · ")}`);
      } catch (err) {
        toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }, [activeCanvasIdx]);

  // ---- Dynamic Agent Management ----
  const addAgent = useCallback(() => {
    const newIdx = states.length;
    const newPersona = createNewPersona(newIdx);
    setStates((prev) => [...prev, createDefaultState(newPersona)]);
    setSimChecked((prev) => [...prev, true]);
    // Append a slot in every canvas's agentPositions so indices stay aligned.
    setCanvases((prev) => prev.map((c) => ({
      ...c,
      agentPositions: [...c.agentPositions, null],
    })));
    setActiveTab(newIdx);
    toast.success(`Agent P${newIdx + 1} added`);
  }, [states.length]);

  const removeAgent = useCallback((idx: number) => {
    if (states.length <= 1) {
      toast.error("Cannot remove the last agent");
      return;
    }
    setStates((prev) => prev.filter((_, i) => i !== idx));
    setSimChecked((prev) => prev.filter((_, i) => i !== idx));
    // Drop this agent from every canvas's positions/waypoints/logs and
    // shift higher indices down by one to keep the alignment with `states`.
    setCanvases((prev) => prev.map((c) => {
      const positions = c.agentPositions.filter((_, i) => i !== idx);
      const wps: Record<number, Waypoint[]> = {};
      Object.entries(c.waypoints).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < idx) wps[ki] = v;
        else if (ki > idx) wps[ki - 1] = v;
      });
      const logs: Record<number, PerceptionLogEntry[]> = {};
      Object.entries(c.perceptionLogs).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < idx) logs[ki] = v;
        else if (ki > idx) logs[ki - 1] = v;
      });
      return { ...c, agentPositions: positions, waypoints: wps, perceptionLogs: logs };
    }));
    setPathTrails((prev) => {
      const next: Record<number, AgentPosition[]> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      });
      return next;
    });
    setAnimatingAgents((prev) => {
      const next: Record<number, AgentPosition> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      });
      return next;
    });
    if (activeTab >= idx && activeTab > 0) {
      setActiveTab(activeTab - 1);
    }
    toast.info(`Agent P${idx + 1} removed`);
  }, [states.length, activeTab]);

  // ---- Canvas (Scheme) Management ----
  // Switch to a different canvas. Snapshots the live editor state into the
  // current canvas first, then loads the target canvas's data into the editor.
  const switchCanvas = useCallback((newIdx: number) => {
    if (newIdx === activeCanvasIdx) return;
    if (newIdx < 0 || newIdx >= canvases.length) return;
    const target = canvases[newIdx];

    // Snapshot the live state into the OLD canvas synchronously.
    setCanvases((prev) => {
      if (!prev[activeCanvasIdx]) return prev;
      const wps: Record<number, Waypoint[]> = {};
      const logs: Record<number, PerceptionLogEntry[]> = {};
      states.forEach((s, i) => {
        if (s.route.waypoints.length > 0) wps[i] = s.route.waypoints;
        if (s.route.perceptionLog.length > 0) logs[i] = s.route.perceptionLog;
      });
      const updated = [...prev];
      updated[activeCanvasIdx] = {
        ...prev[activeCanvasIdx],
        shapes,
        zones,
        agentPositions: states.map((s) => s.agentPos),
        waypoints: wps,
        perceptionLogs: logs,
      };
      saveCanvasStore({ canvases: updated, activeIdx: newIdx });
      return updated;
    });

    // Load the target canvas's content into the live editor.
    setShapes(target.shapes);
    setZones(target.zones);
    setStates((prev) => prev.map((s, i) => {
      const log = target.perceptionLogs[i] ?? [];
      // Hydrate live experience from last log entry (mirrors the
      // initial-mount logic). When the target canvas has a saved sim
      // for this agent, carry forward the per-leg experience instead
      // of wiping to defaultExperience.
      const lastEntry = log.length > 0 ? log[log.length - 1] : null;
      return {
        ...s,
        agentPos: target.agentPositions[i] ?? null,
        route: { waypoints: target.waypoints[i] ?? [], perceptionLog: log },
        experience: lastEntry ? lastEntry.experience : defaultExperience,
        accState: lastEntry ? lastEntry.accState : defaultAccumulatedState,
        triggers: lastEntry ? (lastEntry.triggers ?? []) : [],
        prevExperience: null,
        prevAccState: null,
        hasSimulated: log.length > 0,
      };
    }));
    setPathTrails({});
    setAnimatingAgents({});
    setActiveCanvasIdx(newIdx);
  }, [activeCanvasIdx, canvases, shapes, zones, states]);

  const addCanvas = useCallback(() => {
    if (canvases.length >= MAX_CANVASES) {
      toast.error(`Maximum ${MAX_CANVASES} canvases reached`);
      return;
    }
    // Clone the active canvas so users iterate on a baseline. Perception logs
    // are intentionally not carried — the new scheme has not been simulated yet.
    const baseline = canvases[activeCanvasIdx];
    const newName = `Canvas ${canvases.length + 1}`;
    const cloned = cloneCanvas(baseline, newName);
    const newIdx = canvases.length;

    setCanvases((prev) => {
      const next = [...prev, cloned];
      saveCanvasStore({ canvases: next, activeIdx: newIdx });
      return next;
    });
    // Switch to the new canvas. Live state is loaded from the cloned data
    // (which mirrors current state, but with logs cleared).
    setStates((prev) => prev.map((s, i) => ({
      ...s,
      agentPos: cloned.agentPositions[i] ?? null,
      route: { waypoints: cloned.waypoints[i] ?? [], perceptionLog: [] },
      experience: defaultExperience,
      accState: defaultAccumulatedState,
      triggers: [],
      prevExperience: null,
      prevAccState: null,
      hasSimulated: false,
    })));
    setPathTrails({});
    setAnimatingAgents({});
    setActiveCanvasIdx(newIdx);
    toast.success(`${newName} added (cloned from ${baseline.name})`);
  }, [canvases, activeCanvasIdx]);

  // Spawn a new canvas seeded from a bundled preset (instead of cloning the
  // active canvas). Persona-position binding is positional: agent index N
  // gets preset.agentPositions[N], or null if the preset has fewer slots.
  const addCanvasFromPreset = useCallback((preset: LayoutPreset) => {
    if (canvases.length >= MAX_CANVASES) {
      toast.error(`Maximum ${MAX_CANVASES} canvases reached`);
      return;
    }
    const newName = preset.name;
    const newIdx = canvases.length;
    const seeded = {
      id: `canvas_${Date.now()}`,
      name: newName,
      shapes: preset.data.shapes.map((s) => ({ ...s, points: s.points.map((p) => [...p] as [number, number]) })),
      zones: preset.data.zones.map((z) => ({ ...z, env: { ...z.env }, bounds: { ...z.bounds } })),
      agentPositions: states.map((_, i) => preset.data.agentPositions[i] ?? null),
      waypoints: { ...(preset.data.waypoints ?? {}) },
      perceptionLogs: states.map(() => []),
    };

    setCanvases((prev) => {
      const next = [...prev, seeded];
      saveCanvasStore({ canvases: next, activeIdx: newIdx });
      return next;
    });
    setStates((prev) => prev.map((s, i) => ({
      ...s,
      agentPos: seeded.agentPositions[i] ?? null,
      route: { waypoints: seeded.waypoints[i] ?? [], perceptionLog: [] },
      experience: defaultExperience,
      accState: defaultAccumulatedState,
      triggers: [],
      prevExperience: null,
      prevAccState: null,
      hasSimulated: false,
    })));
    setPathTrails({});
    setAnimatingAgents({});
    setActiveCanvasIdx(newIdx);
    toast.success(`${newName} added from preset`);
  }, [canvases, states]);

  // Replace the active canvas with a layout JSON (Rhino → Grasshopper export,
  // a previously exported SentiArch layout, or any file matching the schema).
  // Bypasses Add-Canvas / preset flow because users typically want to ITERATE
  // on the current canvas, not accumulate ten near-duplicates.
  const importLayout = useCallback((data: {
    shapes: Shape[];
    zones?: Zone[];
    agentPositions?: (AgentPosition | null)[];
    waypoints?: Record<number, Waypoint[]>;
  }) => {
    if (!Array.isArray(data?.shapes)) {
      toast.error("Layout JSON missing shapes array");
      return;
    }
    const target = canvases[activeCanvasIdx];
    const ok = window.confirm(
      `Import will REPLACE "${target.name}" with ${data.shapes.length} shape(s) and ${data.zones?.length ?? 0} zone(s). Continue?`
    );
    if (!ok) return;

    // Migrate so old / GH-emitted JSON without new fields doesn't poison
    // env arithmetic (NaN propagation) or shape rendering (legacy "boundary"
    // → "site").
    const migShapes = migrateLegacyShapes(data.shapes);
    const migZones = (data.zones ?? []).map(migrateZoneEnv);
    const positions = states.map((_, i) => data.agentPositions?.[i] ?? null);
    const incomingWps = data.waypoints ?? {};

    const replaced = {
      ...target,
      shapes: migShapes,
      zones: migZones,
      agentPositions: positions,
      waypoints: incomingWps,
      // Imports always invalidate prior simulation logs — the geometry no
      // longer matches.
      perceptionLogs: states.map(() => []),
    };

    setCanvases((prev) => {
      const next = prev.map((c, i) => (i === activeCanvasIdx ? replaced : c));
      saveCanvasStore({ canvases: next, activeIdx: activeCanvasIdx });
      return next;
    });
    setShapes(migShapes);
    setZones(migZones);
    setStates((prev) => prev.map((s, i) => ({
      ...s,
      agentPos: positions[i] ?? null,
      route: { waypoints: incomingWps[i] ?? [], perceptionLog: [] },
      experience: defaultExperience,
      accState: defaultAccumulatedState,
      triggers: [],
      prevExperience: null,
      prevAccState: null,
      hasSimulated: false,
    })));
    setPathTrails({});
    setAnimatingAgents({});
    toast.success(
      `Imported: ${migShapes.length} shape(s), ${migZones.length} zone(s), ${positions.filter(Boolean).length} agent(s)`
    );
  }, [activeCanvasIdx, canvases, states]);

  const removeCanvas = useCallback((idx: number) => {
    if (canvases.length <= 1) {
      toast.error("Cannot remove the last canvas");
      return;
    }
    const removingActive = idx === activeCanvasIdx;
    const newActive = removingActive
      ? Math.max(0, idx - 1)
      : idx < activeCanvasIdx
      ? activeCanvasIdx - 1
      : activeCanvasIdx;

    setCanvases((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      saveCanvasStore({ canvases: next, activeIdx: newActive });
      return next;
    });

    if (removingActive) {
      // Load the new active canvas (which is canvases[newActive] AFTER the
      // filter — but at this point our local `canvases` is stale, so derive it).
      const list = canvases.filter((_, i) => i !== idx);
      const target = list[newActive];
      setShapes(target.shapes);
      setZones(target.zones);
      setStates((prev) => prev.map((s, i) => {
        const log = target.perceptionLogs[i] ?? [];
        return {
          ...s,
          agentPos: target.agentPositions[i] ?? null,
          route: { waypoints: target.waypoints[i] ?? [], perceptionLog: log },
          experience: defaultExperience,
          accState: defaultAccumulatedState,
          triggers: [],
          prevExperience: null,
          prevAccState: null,
          hasSimulated: log.length > 0,
        };
      }));
      setPathTrails({});
      setAnimatingAgents({});
    }
    setActiveCanvasIdx(newActive);
    toast.info(`${canvases[idx].name} removed`);
  }, [canvases, activeCanvasIdx]);

  const renameCanvas = useCallback((idx: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCanvases((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], name: trimmed.slice(0, 24) };
      saveCanvasStore({ canvases: next, activeIdx: activeCanvasIdx });
      return next;
    });
  }, [activeCanvasIdx]);

  // Persist shared persona configs (independent of which canvas is active).
  // Stringify personas in the dep so the effect only fires when persona data
  // actually changes — not on every position/route mutation.
  const personasFingerprint = useMemo(
    () => states.map((s) => JSON.stringify(s.persona)).join("|"),
    [states],
  );
  useEffect(() => {
    savePersonas(states.map((s) => s.persona));
    // Also keep the legacy multi-agent key in sync so older code paths and
    // exports continue to work; positions sent here are the active-canvas view.
    saveMultiAgent({
      personas: states.map((s) => s.persona),
      positions: states.map((s) => s.agentPos),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personasFingerprint]);

  // Snapshot live editor state into canvases[activeCanvasIdx] on every change,
  // and persist the full canvas store. Other canvases stay untouched.
  useEffect(() => {
    setCanvases((prev) => {
      if (!prev[activeCanvasIdx]) return prev;
      const wps: Record<number, Waypoint[]> = {};
      const logs: Record<number, PerceptionLogEntry[]> = {};
      states.forEach((s, i) => {
        if (s.route.waypoints.length > 0) wps[i] = s.route.waypoints;
        if (s.route.perceptionLog.length > 0) logs[i] = s.route.perceptionLog;
      });
      const next = [...prev];
      next[activeCanvasIdx] = {
        ...prev[activeCanvasIdx],
        shapes,
        zones,
        agentPositions: states.map((s) => s.agentPos),
        waypoints: wps,
        perceptionLogs: logs,
      };
      saveCanvasStore({ canvases: next, activeIdx: activeCanvasIdx });
      // Mirror to legacy keys for any code paths still reading them.
      saveShapes(shapes);
      saveZones(zones);
      saveAllPerceptionLogs(logs);
      return next;
    });
  }, [shapes, zones, states, activeCanvasIdx]);

  // When zones or shapes change, update environment for all placed agents
  useEffect(() => {
    setStates((prev) => prev.map((s) => {
      if (!s.agentPos) return s;
      const zoneEnv = getEnvAtPosition(s.agentPos.x, s.agentPos.y, zones, shapes);
      const newEnv = zoneEnvToEnvironment(zoneEnv);
      const spatial = computeSpatialFromAgent(s.agentPos, shapes, s.persona.spatial, zones);
      return { ...s, persona: { ...s.persona, environment: newEnv, spatial } };
    }));
  }, [zones, shapes]);

  // Recompute PMV/PPD + perceptual load whenever the agent, the
  // environment they're sensing, or their spatial readings change.
  // Spatial is critical here: dropping a green shape changes
  // green_visibility (and dist_to_window etc.), which downstream
  // affects perceived_air_temp, anxiety_perceived_dB, social/visual/
  // fatigue damping. Without spatial in the deps the panel would
  // show a stale comfort score after the user added or removed
  // shapes — which was exactly the "green has no effect" bug.
  //
  // We also drop the prior `hasSimulated ? frozen : recompute` guard:
  // the deterministic load is now the canonical source and should
  // always reflect the current persona × spatial × env state. Saved
  // sim narrative still lives in `experience.summary` per leg.
  useEffect(() => {
    setStates((prev) => prev.map((s) => {
      const c = computeOutputs(s.persona);
      const load = applyRoleAccStateConstraints(
        computePerceptualLoad(s.persona, c, zones),
        s.persona.agent.role,
      );
      return { ...s, computed: c, accState: load };
    }));
  }, [
    ...states.map((s) => JSON.stringify(s.persona.environment)),
    ...states.map((s) => JSON.stringify(s.persona.agent)),
    ...states.map((s) => JSON.stringify(s.persona.spatial)),
  ]);

  // Recompute vis.agents when any agent position changes
  useEffect(() => {
    const positions = states.map((s) => s.agentPos);
    setStates((prev) => prev.map((s, i) => {
      const vis = computeVisibleAgents(i, positions, shapes);
      if (s.persona.spatial.visible_agents === vis) return s;
      return {
        ...s,
        persona: { ...s.persona, spatial: { ...s.persona.spatial, visible_agents: vis } },
      };
    }));
  }, [
    ...states.map((s) => `${s.agentPos?.x},${s.agentPos?.y}`),
    shapes,
  ]);

  // Shape management. Auto-zone generation has been disabled — drawing
  // sites / walls / columns NO LONGER creates zones automatically. Users
  // add zones manually via the Zone, Zone Poly, or Coordinate Input panel
  // tools, which gives them full control over zone boundaries / labels /
  // env values without the auto-zoner's grid-tracing artefacts getting
  // in the way.
  const addShape = useCallback((shape: Shape) => {
    setShapes((s) => [...s, shape]);
  }, []);

  const updateShapes = useCallback((newShapes: Shape[]) => {
    setShapes(newShapes);
  }, []);

  const deleteShape = useCallback((idx: number) => {
    setShapes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Zone management
  const addZone = useCallback((zone: Zone) => {
    setZones((z) => [...z, zone]);
  }, []);

  const updateZone = useCallback((id: string, updates: Partial<Zone>) => {
    setZones((prev) => prev.map((z) => z.id === id ? { ...z, ...updates } : z));
  }, []);

  const removeZone = useCallback((id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id));
  }, []);

  const splitZone = useCallback(
    (id: string, direction: "horizontal" | "vertical", count: number) => {
      setZones((prev) => {
        const idx = prev.findIndex((z) => z.id === id);
        if (idx < 0) return prev;
        const target = prev[idx];
        const parts = splitZoneIntoParts(target, direction, count);
        if (parts.length === 0) return prev;
        const next = [...prev];
        next.splice(idx, 1, ...parts);
        toast.success(
          `Split "${target.label || target.id}" into ${parts.length} ${direction === "horizontal" ? "row" : "column"} zones`,
        );
        return next;
      });
    },
    [],
  );

  // Canvas hook: takes the two endpoints of a free-angle cut line, picks
  // the zone the cut runs through, replaces it in-place with the clipped
  // child zones, and emits a toast. Concave zones (e.g. auto-zones from
  // contour tracing) can yield more than two children when the cut crosses
  // the boundary >2 times — all are inserted in the original zone's slot
  // so layer order is preserved. No-ops cleanly when the cut misses every
  // zone or fails to produce valid pieces, so the user can simply re-draw
  // without state corruption.
  const splitZoneByLineHandler = useCallback(
    (p1: [number, number], p2: [number, number]) => {
      setZones((prev) => {
        const target = findZoneForLineCut(p1, p2, prev);
        if (!target) {
          toast.error("Cut line doesn't touch any zone — draw the cut so it crosses (or starts/ends inside) a zone.");
          return prev;
        }
        const parts = splitZoneByLine(target, p1, p2);
        if (!parts || parts.length < 2) {
          toast.error(`Cut didn't fully split "${target.label || target.id}" — try a line that crosses its interior end-to-end.`);
          return prev;
        }
        const idx = prev.findIndex((z) => z.id === target.id);
        if (idx < 0) return prev;
        const next = [...prev];
        next.splice(idx, 1, ...parts);
        toast.success(
          `Split "${target.label || target.id}" along cut line into ${parts.length} pieces`,
        );
        return next;
      });
    },
    [],
  );

  // Multi-segment polyline cut handler. The polyline acts as a "knife"
  // — each segment of the path slices through the underlying zone's
  // polygon. polygon-clipping in store.ts handles the geometric work and
  // automatically extends the polyline endpoints past the polygon, so
  // endpoints inside the zone still produce a clean split rather than
  // just a notch.
  const splitZoneByPolylineHandler = useCallback(
    (polyline: [number, number][]) => {
      setZones((prev) => {
        const target = findZoneForPolylineCut(polyline, prev);
        if (!target) {
          toast.error("Cut path must pass through a zone — start or end inside a zone, or cross its interior.");
          return prev;
        }
        const parts = splitZoneByPolyline(target, polyline);
        if (!parts || parts.length < 2) {
          toast.error("Cut path didn't fully split the zone — try a path that crosses the interior end-to-end.");
          return prev;
        }
        const idx = prev.findIndex((z) => z.id === target.id);
        if (idx < 0) return prev;
        const next = [...prev];
        next.splice(idx, 1, ...parts);
        toast.success(
          `Split "${target.label || target.id}" along cut path into ${parts.length} pieces`,
        );
        return next;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setShapes([]);
    setZones([]);
    setStates((prev) => prev.map((s) => ({
      ...s,
      agentPos: null,
      route: { waypoints: [], perceptionLog: [] },
    })));
    setPathTrails({});
    setAnimatingAgents({});
    toast.info("Map cleared");
  }, []);

  // ---- Reset All Agents to Pre-Route Starting Positions ----
  const resetAgents = useCallback(() => {
    // Abort any running route simulation
    routeAbortRef.current = true;
    setRouteRunning(false);

    const savedPositions = originalAgentPositionsRef.current;

    setStates((prev) => prev.map((s, i) => {
      // Restore order of preference:
      //  1. pre-route snapshot (set on the run before this reset)
      //  2. the agent's AUTHORED scenario cell (persona.position.cell) —
      //     stable across runs, and the correct fallback when the ref is
      //     empty (e.g. a Cloud Save loaded already in post-run state,
      //     agentPos sitting at the last waypoint). Without this, reset
      //     only clears data and the agent stays stuck at WP4.
      //  3. current agentPos (last resort).
      const hasSnapshot = Object.prototype.hasOwnProperty.call(savedPositions, i);
      const cell = s.persona.position?.cell;
      const cellHome: AgentPosition | null = Array.isArray(cell)
        ? { x: cell[0] * 1000, y: cell[1] * 1000 }
        : null;
      const startPos = hasSnapshot ? savedPositions[i] : (cellHome ?? s.agentPos);

      // Recompute spatial and environment from the restored position
      let updatedPersona = s.persona;
      if (startPos) {
        const cell = posToCell(startPos.x, startPos.y);
        const spatial = computeSpatialFromAgent(startPos, shapes, s.persona.spatial, zones);
        const zoneEnv = getEnvAtPosition(startPos.x, startPos.y, zones, shapes);
        const newEnv = zoneEnvToEnvironment(zoneEnv);
        updatedPersona = {
          ...s.persona,
          position: { ...s.persona.position, cell },
          spatial,
          environment: newEnv,
        };
      }

      return {
        ...s,
        persona: updatedPersona,
        agentPos: startPos,
        // Clear perception log but keep waypoints so routes can be re-run
        route: { ...s.route, perceptionLog: [] },
        // Reset experience/perception state so agents are fresh
        experience: defaultExperience,
        accState: defaultAccumulatedState,
        triggers: [],
        prevExperience: null,
        prevAccState: null,
        hasSimulated: false,
      };
    }));

    // Clear animation overlays and path trails
    setPathTrails({});
    setAnimatingAgents({});

    // Drop the snapshot so the NEXT run captures a fresh pre-run position
    // (otherwise a stale snapshot would override a newly-placed agent).
    originalAgentPositionsRef.current = {};

    toast.success("All agents reset to starting positions");
  }, [shapes, zones]);

  // ---- Waypoint Management ----
  const addWaypoint = useCallback((agentIdx: number, wp: Waypoint) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[agentIdx]) return prev;

      // Requirement: Must place agent first
      if (!next[agentIdx].agentPos) {
        toast.error("Please place the agent on the map first before adding waypoints.");
        return prev;
      }

      const route = { ...next[agentIdx].route };
      const budget = next[agentIdx].persona.position.duration_in_cell;
      // Trajectory agents derive dwell from authored t_min deltas, so dwell
      // rescaling does not apply — keep waypoints verbatim.
      route.waypoints = next[agentIdx].persona.agent.trajectory_mode
        ? [...route.waypoints, wp]
        : rescaleWaypointsToBudget([...route.waypoints, wp], budget);
      next[agentIdx] = { ...next[agentIdx], route };
      saveWaypoints(agentIdx, route.waypoints);
      return next;
    });
  }, []);

  const removeWaypoint = useCallback((agentIdx: number, wpId: string) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[agentIdx]) return prev;
      const route = { ...next[agentIdx].route };
      route.waypoints = route.waypoints.filter((w) => w.id !== wpId);
      next[agentIdx] = { ...next[agentIdx], route };
      saveWaypoints(agentIdx, route.waypoints);
      return next;
    });
  }, []);

  const updateWaypointDwell = useCallback((agentIdx: number, wpId: string, minutes: number) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[agentIdx]) return prev;
      const route = { ...next[agentIdx].route };
      const budget = next[agentIdx].persona.position.duration_in_cell;
      const mapped = route.waypoints.map((w) => (w.id === wpId ? { ...w, dwell_minutes: minutes } : w));
      route.waypoints = next[agentIdx].persona.agent.trajectory_mode
        ? mapped
        : rescaleWaypointsToBudget(mapped, budget);
      next[agentIdx] = { ...next[agentIdx], route };
      saveWaypoints(agentIdx, route.waypoints);
      return next;
    });
  }, []);

  // Set an arbitrary waypoint field (t_min / context / narrative_seed) for a
  // trajectory agent. Never rescales — authored t_min is authoritative.
  const updateWaypointField = useCallback(
    (agentIdx: number, wpId: string, field: "t_min" | "context" | "narrative_seed", value: number | string) => {
      setStates((prev) => {
        const next = [...prev];
        if (!next[agentIdx]) return prev;
        const route = { ...next[agentIdx].route };
        route.waypoints = route.waypoints.map((w) =>
          w.id === wpId ? { ...w, [field]: value } : w,
        );
        next[agentIdx] = { ...next[agentIdx], route };
        saveWaypoints(agentIdx, route.waypoints);
        return next;
      });
    },
    [],
  );

  // Toggle waypoint-trajectory mode for an agent. Persists the agent profile
  // so the flag round-trips through scenario save/load.
  const setTrajectoryMode = useCallback((agentIdx: number, enabled: boolean) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[agentIdx]) return prev;
      const persona = {
        ...next[agentIdx].persona,
        agent: { ...next[agentIdx].persona.agent, trajectory_mode: enabled },
      };
      next[agentIdx] = { ...next[agentIdx], persona };
      savePersonas(next.map((st) => st.persona));
      return next;
    });
  }, []);

  const clearWaypoints = useCallback((agentIdx: number) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[agentIdx]) return prev;
      next[agentIdx] = {
        ...next[agentIdx],
        route: { waypoints: [], perceptionLog: [] },
      };
      saveWaypoints(agentIdx, []);
      return next;
    });
    setPathTrails((prev) => {
      const next = { ...prev };
      delete next[agentIdx];
      return next;
    });
  }, []);

  // ---- Agent placement on spatial map ----
  const placeAgent = useCallback((idx: number, pos: AgentPosition) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const cell = posToCell(pos.x, pos.y);
      const spatial = computeSpatialFromAgent(pos, shapes, next[idx].persona.spatial, zones);
      const zoneEnv = getEnvAtPosition(pos.x, pos.y, zones, shapes);
      const newEnv = zoneEnvToEnvironment(zoneEnv);
      next[idx] = {
        ...next[idx],
        agentPos: pos,
        persona: {
          ...next[idx].persona,
          position: { ...next[idx].persona.position, cell },
          spatial,
          environment: newEnv,
        },
      };
      return next;
    });
  }, [shapes, zones]);

  // Update persona with baseline reset logic
  const updatePersona = useCallback((idx: number, newPersona: PersonaData) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const old = next[idx];
      if (isAgentCoreChange(old.persona.agent, newPersona.agent)) {
        next[idx] = {
          ...old,
          persona: newPersona,
          experience: defaultExperience,
          accState: defaultAccumulatedState,
          prevExperience: null,
          prevAccState: null,
          triggers: [],
          hasSimulated: false,
        };
        return next;
      }
      next[idx] = { ...old, persona: newPersona };
      return next;
    });
  }, []);

  // Environment sync (no longer syncs across agents - each agent gets zone-based env)
  const updatePersonaWithEnvSync = useCallback((idx: number, newPersona: PersonaData) => {
    setStates((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const old = next[idx];

      // The position duration is a SHARED clock: all agents inhabit the same
      // time budget. When it changes for one, propagate to every agent and
      // re-clamp each agent's waypoint dwells against the new budget.
      const oldBudget = old.persona.position.duration_in_cell;
      const newBudget = newPersona.position.duration_in_cell;
      const budgetChanged = oldBudget !== newBudget;

      const route = (budgetChanged && !old.persona.agent.trajectory_mode)
        ? { ...old.route, waypoints: rescaleWaypointsToBudget(old.route.waypoints, newBudget) }
        : old.route;
      if (budgetChanged && route.waypoints !== old.route.waypoints) {
        saveWaypoints(idx, route.waypoints);
      }

      if (isAgentCoreChange(old.persona.agent, newPersona.agent)) {
        next[idx] = {
          ...old,
          persona: newPersona,
          experience: defaultExperience,
          accState: defaultAccumulatedState,
          prevExperience: null,
          prevAccState: null,
          triggers: [],
          hasSimulated: false,
          route,
        };
      } else {
        next[idx] = { ...old, persona: newPersona, route };
      }

      // Propagate the shared budget to every other agent.
      if (budgetChanged) {
        for (let i = 0; i < next.length; i++) {
          if (i === idx) continue;
          const other = next[i];
          const rescaled = other.persona.agent.trajectory_mode
            ? other.route.waypoints
            : rescaleWaypointsToBudget(other.route.waypoints, newBudget);
          if (rescaled !== other.route.waypoints) {
            saveWaypoints(i, rescaled);
          }
          next[i] = {
            ...other,
            persona: {
              ...other.persona,
              position: { ...other.persona.position, duration_in_cell: newBudget },
            },
            route: { ...other.route, waypoints: rescaled },
          };
        }
      }

      return next;
    });
  }, []);

  // Build the situated-cognition context for one focus agent at a given
  // position: who else is in their zone right now, plus details on
  // anyone they have a declared relationship with. Used to thread
  // co-location into every walk / dwell / stationary prompt so the LLM
  // sees who is — and isn't — actually with them.
  //
  // Multi-agent simulation runs sequentially per agent and there is no
  // shared time clock; we approximate "right now" by snapshotting every
  // OTHER agent at their last placed `agentPos` and overriding the
  // focus agent's position to whatever the current leg has them at.
  const buildSituatedContextForAgent = useCallback(
    (focusIdx: number, focusPos: AgentPosition) => {
      const personasView = states.map((s) => ({ agent: s.persona.agent }));
      const positions: (AgentPosition | null)[] = states.map((s, i) =>
        i === focusIdx ? focusPos : s.agentPos,
      );
      const focusAgent = states[focusIdx]?.persona.agent;
      return {
        coZoneAgents: computeCoZoneAgents(focusIdx, personasView, positions, zones),
        relationshipDetails: focusAgent ? resolveRelationshipDetails(focusAgent, personasView) : [],
      };
    },
    [states, zones],
  );

  // ---- Route Playback Engine ----
  //
  // Methodology v2: walks and intermediate dwells run the engine ONLY
  // (no LLM call) — they produce engine-baseline PerceptionLogEntry
  // records so the timeline survives. The TERMINAL dwell of the route
  // (the agent's final waypoint) is the single LLM call: it becomes the
  // character via buildAssessmentSystemPrompt and emits the 6 felt-dim
  // assessment + narration. Failed LLM at terminal → fall back to
  // engine baseline with status "failed".
  const runRouteForAgent = async (idx: number): Promise<PerceptionLogEntry[]> => {
    const s = states[idx];
    if (!s || !s.agentPos) return [];
    const wps = s.route.waypoints;
    if (wps.length < 1) return [];

    const log: PerceptionLogEntry[] = [];
    const fullPath: AgentPosition[] = [s.agentPos, ...wps.map(w => w.position)];
    let currentAccState: typeof s.accState = { ...s.accState };
    const legCount = fullPath.length - 1;

    for (let i = 0; i < fullPath.length - 1; i++) {
      if (routeAbortRef.current) break;

      const fromPos = fullPath[i];
      const toPos = fullPath[i + 1];
      const fromID = i === 0 ? "agent-start" : wps[i - 1].id;
      const toID = wps[i].id;
      const targetWP = wps[i];
      const isTerminalDwell = i === fullPath.length - 2;

      // ---- WALK leg (engine baseline only; no LLM call ever) ----
      const midPos = lerpPos(fromPos, toPos, 0.5);
      const walkEnv = getEnvAtPosition(midPos.x, midPos.y, zones, shapes);
      const walkEnvData = zoneEnvToEnvironment(walkEnv);
      const walkSpatial = computeSpatialFromAgent(midPos, shapes, s.persona.spatial, zones);
      const walkPersona = { ...s.persona, environment: walkEnvData, spatial: walkSpatial };
      const walkComputed = computeOutputs(walkPersona);

      const walkLocalTriggers = evaluateRules({
        persona: walkPersona,
        computed: walkComputed,
        accState: currentAccState,
        env: walkEnvData,
        spatial: walkSpatial,
        zone: getZoneAtPosition(midPos.x, midPos.y, zones),
        dwellMinutes: 0,
      });
      const walkAccState = applyRoleAccStateConstraints(
        computePerceptualLoad(walkPersona, walkComputed, zones),
        walkPersona.agent.role,
      );
      const walkComfort = computeComfortScore(walkAccState);
      const prevWalkComfort = log.length > 0 ? log[log.length - 1].experience.comfort_score : null;
      const walkTrend = deriveTrend(prevWalkComfort, walkComfort);
      const walkExperience: ExperienceData = {
        summary: "",
        comfort_score: walkComfort,
        trend: walkTrend,
        llm: null,
        llm_call_status: "baseline",
        accState_llm: walkAccState,
      };
      const walkEntry: PerceptionLogEntry = {
        waypoint_id: toID,
        phase: "walking",
        from: fromID,
        to: toID,
        position: midPos,
        environment: walkEnvData,
        spatial: walkSpatial,
        computed: walkComputed,
        experience: walkExperience,
        accState: walkAccState,
        accState_engine: walkAccState,
        triggers: tagsOnly(walkLocalTriggers),
        timestamp: new Date().toISOString(),
      };
      log.push(walkEntry);

      currentAccState = walkAccState;
      setStates((prev) => {
        const next = [...prev];
        if (!next[idx]) return prev;
        next[idx] = {
          ...next[idx],
          experience: walkExperience,
          accState: walkAccState,
          triggers: tagsOnly(walkLocalTriggers),
          hasSimulated: true,
        };
        return next;
      });

      if (routeAbortRef.current) break;

      // ---- DWELL leg ----
      const arrivalPos = targetWP.position;
      const dwellEnv = getEnvAtPosition(arrivalPos.x, arrivalPos.y, zones, shapes);
      const dwellEnvData = zoneEnvToEnvironment(dwellEnv);
      const dwellSpatial = computeSpatialFromAgent(arrivalPos, shapes, s.persona.spatial, zones);
      const dwellPersona = { ...s.persona, environment: dwellEnvData, spatial: dwellSpatial };
      const dwellComputed = computeOutputs(dwellPersona);

      const dwellLocalTriggers = evaluateRules({
        persona: dwellPersona,
        computed: dwellComputed,
        accState: currentAccState,
        env: dwellEnvData,
        spatial: dwellSpatial,
        zone: getZoneAtPosition(arrivalPos.x, arrivalPos.y, zones),
        dwellMinutes: targetWP.dwell_minutes,
      });
      const dwellAccState = applyRoleAccStateConstraints(
        computePerceptualLoad(dwellPersona, dwellComputed, zones),
        dwellPersona.agent.role,
      );
      const dwellEngineComfort = computeComfortScore(dwellAccState);
      const prevDwellComfort = log.length > 0 ? log[log.length - 1].experience.comfort_score : null;

      // Terminal-only LLM call. Intermediate dwells: engine baseline.
      let dwellExperience: ExperienceData;
      let dwellAccFinal: AccumulatedState;
      if (isTerminalDwell) {
        const dwellSituated = buildSituatedContextForAgent(idx, arrivalPos);
        const system = buildDwellPrompt(dwellPersona, dwellComputed, zones, dwellSituated, true);
        const result = system ? await callLLMWithPrompt(system) : null;
        if (result?.assessment) {
          const a: LLMAssessment = result.assessment;
          dwellAccFinal = dimsToAccState(a.dims);
          dwellExperience = {
            summary: a.narration,
            comfort_score: a.comfort,
            trend: deriveTrend(prevDwellComfort, a.comfort),
            llm: a,
            llm_call_status: "ok",
            llm_observations: result.observations,
            accState_llm: dwellAccState,
          };
        } else {
          dwellAccFinal = dwellAccState;
          dwellExperience = {
            summary: "(reading unavailable)",
            comfort_score: dwellEngineComfort,
            trend: deriveTrend(prevDwellComfort, dwellEngineComfort),
            llm: null,
            llm_call_status: "failed",
            accState_llm: dwellAccState,
          };
        }
      } else {
        dwellAccFinal = dwellAccState;
        dwellExperience = {
          summary: "",
          comfort_score: dwellEngineComfort,
          trend: deriveTrend(prevDwellComfort, dwellEngineComfort),
          llm: null,
          llm_call_status: "baseline",
          accState_llm: dwellAccState,
        };
      }

      const dwellEntry: PerceptionLogEntry = {
        waypoint_id: targetWP.id,
        phase: "dwelling",
        position: arrivalPos,
        environment: dwellEnvData,
        spatial: dwellSpatial,
        computed: dwellComputed,
        experience: dwellExperience,
        accState: dwellAccFinal,
        accState_engine: dwellAccState,
        triggers: tagsOnly(dwellLocalTriggers),
        timestamp: new Date().toISOString(),
      };
      log.push(dwellEntry);

      currentAccState = dwellAccFinal;
      setStates((prev) => {
        const next = [...prev];
        if (!next[idx]) return prev;
        const prevTemporal = next[idx].persona.temporal ?? { total_dwell_min: 0, fatigue_accumulated: 0 };
        const currentLoad = (dwellAccFinal.fatigue + dwellAccFinal.thermal_discomfort + dwellAccFinal.noise_stress) / 3;
        const nextTemporal = {
          total_dwell_min: prevTemporal.total_dwell_min + targetWP.dwell_minutes,
          fatigue_accumulated: Math.min(
            1,
            prevTemporal.fatigue_accumulated + 0.02 * targetWP.dwell_minutes * (0.5 + currentLoad),
          ),
        };
        next[idx] = {
          ...next[idx],
          experience: dwellExperience,
          accState: dwellAccFinal,
          triggers: tagsOnly(dwellLocalTriggers),
          hasSimulated: true,
          agentPos: arrivalPos,
          persona: { ...next[idx].persona, temporal: nextTemporal },
        };
        return next;
      });
    }
    // Reference `legCount` to keep the signature documented; not used now.
    void legCount;

    return log;
  };

  // Waypoint-trajectory simulation. The agent is a moving visitor: one
  // INDEPENDENT perception snapshot per waypoint, NO walking legs. A bounded
  // bidirectional carry-over (blendCarriedState) threads affective state
  // between waypoints — restorative spaces pull stress down, stressful
  // spaces push it up; fatigue is monotonic. computePerceptualLoad stays
  // snapshot-pure (untouched). Mirrors the runRouteForAgent dwell block but
  // skips the walk block and writes no persona.temporal accumulator.
  const runTrajectoryForAgent = async (idx: number): Promise<PerceptionLogEntry[]> => {
    const s = states[idx];
    if (!s || !s.agentPos) return [];
    const wps = s.route.waypoints;
    if (wps.length < 1) return [];

    // Implicit T0 origin: the agent's placed position IS the t=0 arrival
    // snapshot — same semantics as the legacy route engine
    // (runRouteForAgent prepends s.agentPos). Authored waypoints are the
    // moves AFTER arrival, so we synthesise a T0 at the agent's current
    // position unless the user already authored an explicit t_min=0
    // waypoint (in which case that one is the origin and we don't double
    // it). The origin's narrative context defaults to the agent's stated
    // purpose for being here.
    const hasExplicitOrigin = typeof wps[0]?.t_min === "number" && wps[0]!.t_min === 0;
    const originWp: Waypoint = {
      id: "traj-origin",
      label: "Start",
      position: s.agentPos,
      dwell_minutes: 0,
      t_min: 0,
      context: s.persona.agent.purpose_at_centre?.trim() || "arriving at the centre",
    };
    const effWps: Waypoint[] = hasExplicitOrigin ? wps : [originWp, ...wps];

    const log: PerceptionLogEntry[] = [];
    // Seeded with the same baseline the rest of the app uses so trajectory
    // comfort is directly comparable to route / stationary results.
    let carried = { ...defaultAccumulatedState };

    for (let i = 0; i < effWps.length; i++) {
      if (routeAbortRef.current) break;
      const wp = effWps[i];
      const pos = wp.position;
      const isTerminal = i === effWps.length - 1;

      // Engine dwell for this waypoint = Δt_min to the next waypoint
      // (authored timeline). Last waypoint falls back to its dwell_minutes.
      const nextT = i < effWps.length - 1 ? effWps[i + 1].t_min : undefined;
      const dwellMin = (typeof wp.t_min === "number" && typeof nextT === "number")
        ? Math.max(0, nextT - wp.t_min)
        : wp.dwell_minutes;

      const dwellEnv = getEnvAtPosition(pos.x, pos.y, zones, shapes);
      const dwellEnvData = zoneEnvToEnvironment(dwellEnv);
      const dwellSpatial = computeSpatialFromAgent(pos, shapes, s.persona.spatial, zones);
      const dwellPersona = {
        ...s.persona,
        environment: dwellEnvData,
        spatial: dwellSpatial,
        position: { ...s.persona.position, duration_in_cell: dwellMin },
      };
      const dwellComputed = computeOutputs(dwellPersona);

      const instant = applyRoleAccStateConstraints(
        computePerceptualLoad(dwellPersona, dwellComputed, zones),
        dwellPersona.agent.role,
      );
      carried = blendCarriedState(carried, instant);

      const engineComfort = computeComfortScore(carried);
      const prevComfort = log.length > 0 ? log[log.length - 1].experience.comfort_score : null;

      const dwellLocalTriggers = evaluateRules({
        persona: dwellPersona,
        computed: dwellComputed,
        accState: carried,
        env: dwellEnvData,
        spatial: dwellSpatial,
        zone: getZoneAtPosition(pos.x, pos.y, zones),
        dwellMinutes: dwellMin,
      });

      // Terminal-only LLM call.
      let experience: ExperienceData;
      let accFinal: AccumulatedState;
      if (isTerminal) {
        const dwellSituated = buildSituatedContextForAgent(idx, pos);
        const system = buildDwellPrompt(dwellPersona, dwellComputed, zones, dwellSituated, true);
        const result = system ? await callLLMWithPrompt(system) : null;
        if (result?.assessment) {
          const a: LLMAssessment = result.assessment;
          accFinal = dimsToAccState(a.dims);
          experience = {
            summary: a.narration,
            comfort_score: a.comfort,
            trend: deriveTrend(prevComfort, a.comfort),
            llm: a,
            llm_call_status: "ok",
            llm_observations: result.observations,
            accState_llm: carried,
          };
        } else {
          accFinal = carried;
          experience = {
            summary: "(reading unavailable)",
            comfort_score: engineComfort,
            trend: deriveTrend(prevComfort, engineComfort),
            llm: null,
            llm_call_status: "failed",
            accState_llm: carried,
          };
        }
      } else {
        accFinal = carried;
        experience = {
          summary: "",
          comfort_score: engineComfort,
          trend: deriveTrend(prevComfort, engineComfort),
          llm: null,
          llm_call_status: "baseline",
          accState_llm: carried,
        };
      }

      const entry: PerceptionLogEntry = {
        waypoint_id: wp.id,
        phase: "dwelling",
        position: pos,
        environment: dwellEnvData,
        spatial: dwellSpatial,
        computed: dwellComputed,
        experience,
        accState: accFinal,
        accState_engine: carried,
        triggers: tagsOnly(dwellLocalTriggers),
        timestamp: new Date().toISOString(),
      };
      log.push(entry);

      carried = accFinal;

      setStates((prev) => {
        const next = [...prev];
        if (!next[idx]) return prev;
        next[idx] = {
          ...next[idx],
          experience,
          accState: accFinal,
          triggers: tagsOnly(dwellLocalTriggers),
          hasSimulated: true,
          agentPos: pos,
        };
        return next;
      });
    }

    return log;
  };

  // Stationary "stay-in-place" simulation: agent has no waypoints, so we
  // simulate dwelling at their current position for the full duration budget.
  // Methodology v2: stationary IS the terminal leg (only one leg), so the
  // LLM is always called.
  const simulateStationary = async (idx: number): Promise<PerceptionLogEntry[]> => {
    const s = states[idx];
    if (!s || !s.agentPos) return [];

    const pos = s.agentPos;
    const dwellEnv = getEnvAtPosition(pos.x, pos.y, zones, shapes);
    const dwellEnvData = zoneEnvToEnvironment(dwellEnv);
    const dwellSpatial = computeSpatialFromAgent(pos, shapes, s.persona.spatial, zones);
    const dwellPersona = { ...s.persona, environment: dwellEnvData, spatial: dwellSpatial };
    const dwellComputed = computeOutputs(dwellPersona);
    const totalBudgetMin = s.persona.position.duration_in_cell;

    const stationaryWP: Waypoint = {
      id: "stationary",
      label: "Position",
      position: pos,
      dwell_minutes: totalBudgetMin,
    };

    const stationaryLocalTriggers = evaluateRules({
      persona: dwellPersona,
      computed: dwellComputed,
      accState: s.accState,
      env: dwellEnvData,
      spatial: dwellSpatial,
      zone: getZoneAtPosition(pos.x, pos.y, zones),
      dwellMinutes: totalBudgetMin,
    });
    const stationaryAccState = applyRoleAccStateConstraints(
      computePerceptualLoad(dwellPersona, dwellComputed, zones),
      dwellPersona.agent.role,
    );
    const stationaryEngineComfort = computeComfortScore(stationaryAccState);

    const stationarySituated = buildSituatedContextForAgent(idx, pos);
    const system = buildDwellPrompt(dwellPersona, dwellComputed, zones, stationarySituated, true);
    const result = system ? await callLLMWithPrompt(system) : null;

    let stationaryExperience: ExperienceData;
    let stationaryAccFinal: AccumulatedState;
    if (result?.assessment) {
      const a: LLMAssessment = result.assessment;
      stationaryAccFinal = dimsToAccState(a.dims);
      stationaryExperience = {
        summary: a.narration,
        comfort_score: a.comfort,
        trend: deriveTrend(null, a.comfort),
        llm: a,
        llm_call_status: "ok",
        llm_observations: result.observations,
        accState_llm: stationaryAccState,
      };
    } else {
      stationaryAccFinal = stationaryAccState;
      stationaryExperience = {
        summary: "(reading unavailable)",
        comfort_score: stationaryEngineComfort,
        trend: deriveTrend(null, stationaryEngineComfort),
        llm: null,
        llm_call_status: "failed",
        accState_llm: stationaryAccState,
      };
    }

    const entry: PerceptionLogEntry = {
      waypoint_id: stationaryWP.id,
      phase: "dwelling",
      position: pos,
      environment: dwellEnvData,
      spatial: dwellSpatial,
      computed: dwellComputed,
      experience: stationaryExperience,
      accState: stationaryAccFinal,
      accState_engine: stationaryAccState,
      triggers: tagsOnly(stationaryLocalTriggers),
      timestamp: new Date().toISOString(),
    };

    setStates((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const prevTemporal = next[idx].persona.temporal ?? { total_dwell_min: 0, fatigue_accumulated: 0 };
      const currentLoad = (stationaryAccFinal.fatigue + stationaryAccFinal.thermal_discomfort + stationaryAccFinal.noise_stress) / 3;
      const nextTemporal = {
        total_dwell_min: prevTemporal.total_dwell_min + totalBudgetMin,
        fatigue_accumulated: Math.min(
          1,
          prevTemporal.fatigue_accumulated + 0.02 * totalBudgetMin * (0.5 + currentLoad),
        ),
      };
      next[idx] = {
        ...next[idx],
        experience: stationaryExperience,
        accState: stationaryAccFinal,
        triggers: tagsOnly(stationaryLocalTriggers),
        hasSimulated: true,
        persona: { ...next[idx].persona, temporal: nextTemporal },
      };
      return next;
    });

    return [entry];
  };

  // Unified run: every selected agent gets simulated. Agents with waypoints
  // run the full route; agents without waypoints dwell in place for the
  // shared duration budget. Both feed the same Route Summary in §07.
  const runUnifiedSimulation = async () => {
    const cfg = getLLMConfig();
    if (!cfg) {
      toast.error("Please configure API key first");
      navigate("/settings");
      return;
    }
    // Methodology v2 supports Ollama (local, direct), DeepSeek and OpenAI
    // (via the /api/llm Vercel proxy). Anthropic / Custom configs have no
    // Layer-2 transport and silently fall back to engine baseline — warn
    // up front so the user isn't surprised by missing narration.
    const url = (cfg.apiUrl ?? "").toLowerCase();
    const isOllama = cfg.provider === "ollama"
      || url.includes("localhost:11434")
      || url.includes("127.0.0.1:11434")
      || url.endsWith("/api/chat");
    const isProxied = cfg.provider === "deepseek" || cfg.provider === "openai";
    if (!isOllama && !isProxied) {
      toast(`Provider "${cfg.provider ?? "unknown"}" has no Layer-2 transport. Running engine baseline only.`);
    }

    const toRun = states
      .map((s, i) => ({ idx: i, s }))
      .filter(({ s, idx }) => simChecked[idx] && !!s.agentPos);

    if (toRun.length === 0) {
      toast.error("Place at least one selected agent on the map first.");
      return;
    }

    // Three-way dispatch. Trajectory mode requires an explicit per-agent
    // flag AND ≥1 waypoint. The 19 stationary agents (no waypoints,
    // trajectory_mode falsy) and any legacy route agent are unaffected —
    // they keep their existing code path byte-for-byte.
    const isTraj = (st: typeof states[number]) =>
      !!st.persona.agent.trajectory_mode && st.route.waypoints.length >= 1;
    const trajectory = toRun.filter(({ s }) => isTraj(s));
    const withRoute = toRun.filter(({ s }) => !isTraj(s) && s.route.waypoints.length >= 1);
    const stationary = toRun.filter(({ s }) => !isTraj(s) && s.route.waypoints.length === 0);

    // Snapshot positions of moving agents so resetAgents can restore them.
    // Only capture an agent's PRE-run position once and keep it across
    // re-runs: a route/trajectory agent ends at its last waypoint, so a
    // second run (without an intervening reset) must NOT overwrite the
    // original start with the post-run waypoint position. resetAgents
    // clears this ref, so the next run snapshots fresh.
    const snapshot = originalAgentPositionsRef.current;
    [...withRoute, ...trajectory].forEach(({ idx }) => {
      if (!Object.prototype.hasOwnProperty.call(snapshot, idx)) {
        snapshot[idx] = states[idx]?.agentPos ?? null;
      }
    });
    originalAgentPositionsRef.current = snapshot;

    setRouteRunning(true);
    routeAbortRef.current = false;
    setPathTrails({});
    toast.info(`Simulating ${trajectory.length} trajectory + ${withRoute.length} route(s) + ${stationary.length} stationary...`);

    const results = await Promise.all([
      ...trajectory.map(async ({ idx }) => {
        try {
          const log = await runTrajectoryForAgent(idx);
          return { idx, log };
        } catch (err) {
          console.error(`Trajectory failed for agent ${idx}:`, err);
          return { idx, log: [] };
        }
      }),
      ...withRoute.map(async ({ idx }) => {
        try {
          const log = await runRouteForAgent(idx);
          return { idx, log };
        } catch (err) {
          console.error(`Route failed for agent ${idx}:`, err);
          return { idx, log: [] };
        }
      }),
      ...stationary.map(async ({ idx }) => {
        try {
          const log = await simulateStationary(idx);
          return { idx, log };
        } catch (err) {
          console.error(`Stationary failed for agent ${idx}:`, err);
          return { idx, log: [] };
        }
      }),
    ]);

    setStates((prev) => {
      const next = [...prev];
      const home = originalAgentPositionsRef.current;
      for (const { idx, log } of results) {
        if (!next[idx]) continue;
        const s = next[idx];
        // Keep the simulation RESULTS (perception log → Panel / route
        // summary), but snap the agent marker back to where it started
        // so the canvas doesn't stay stuck at the final waypoint and the
        // next run begins from the real start. Stationary agents have no
        // snapshot entry → startPos = current pos (they never moved).
        const startPos = Object.prototype.hasOwnProperty.call(home, idx)
          ? home[idx]
          : s.agentPos;
        let persona = s.persona;
        if (startPos) {
          const cell = posToCell(startPos.x, startPos.y);
          const spatial = computeSpatialFromAgent(startPos, shapes, s.persona.spatial, zones);
          const env = zoneEnvToEnvironment(getEnvAtPosition(startPos.x, startPos.y, zones, shapes));
          persona = { ...s.persona, position: { ...s.persona.position, cell }, spatial, environment: env };
        }
        next[idx] = {
          ...s,
          persona,
          agentPos: startPos,
          route: { ...s.route, perceptionLog: log },
        };
      }
      return next;
    });

    setAnimatingAgents({});
    // Snapshot consumed — clear so the next run captures a fresh pre-run
    // position (e.g. if the user re-places an agent before re-running).
    originalAgentPositionsRef.current = {};

    const total = results.reduce((s, r) => s + r.log.length, 0);
    toast.success(`Simulation complete: ${total} entries logged. Agents returned to start.`);
    setRouteRunning(false);
  };

  const stopRoutes = () => {
    routeAbortRef.current = true;
    setRouteRunning(false);
    setAnimatingAgents({});
    toast.info("Route simulation stopped");
  };

  // Build the same payload used by both Export JSON (downloads to disk)
  // and Cloud Save (PUTs to /api/scenarios/save). Slim top-level
  // (agent + position + summary), per-step env/spatial/computed/accState
  // live only inside route.perception_log entries; sentinel `-1`
  // distances are normalised to `null` for clarity.
  const buildExportPayload = useCallback(() => {
    const sanitiseSpatial = (sp: SpatialData) => ({
      ...sp,
      dist_to_window: distanceForExport(sp.dist_to_window),
      dist_to_exit: distanceForExport(sp.dist_to_exit),
    });

    // Per-export audit: track every perception-log leg where the agent's
    // cell didn't resolve to any zone. We surface these as explicit
    // (undefined area) markers in the export AND log a warning per
    // agent so the scenario designer can see which cells need a zone
    // drawn — instead of silently feeding default env to the LLM.
    const undefinedAreaWarnings: { agentId: string; cell: [number, number]; phase: string }[] = [];

    const data = states.map((s) => {
      const log = s.route.perceptionLog;
      const dwellEntries = log.filter((e) => e.phase === "dwelling");
      const summary = log.length === 0
        ? null
        : {
            leg_count: s.route.waypoints.length || 1,
            total_dwell_min: s.route.waypoints.length > 0
              ? s.route.waypoints.reduce((acc, w) => acc + (w.dwell_minutes || 0), 0)
              : s.persona.position.duration_in_cell,
            avg_comfort: Math.round(
              (log.reduce((acc, e) => acc + e.experience.comfort_score, 0) / log.length) * 10
            ) / 10,
            avg_stress: dwellEntries.length === 0
              ? null
              : Math.round(
                  (dwellEntries.reduce((acc, e) => acc + computeStressScore(e.accState), 0) / dwellEntries.length) * 10
                ) / 10,
            start_comfort: log[0].experience.comfort_score,
            end_comfort: log[log.length - 1].experience.comfort_score,
          };

      return {
        agent: s.persona.agent,
        position: s.persona.position,
        route_summary: summary,
        route: {
          waypoints: s.route.waypoints,
          perception_log: log.map((entry) => {
            // Resolve the zone the agent is in at this leg, so program /
            // open_space / ceiling are visible in the exported record.
            // When the cell resolves to no zone, we DO NOT silently
            // pretend a successful lookup — we emit an explicit marker
            // (undefined_area: true, label: "(undefined area)") so the
            // distinction between "agent is in Therapy 1" and "agent
            // fell back to default env" is visible in the export.
            const zoneAtEntry = getZoneAtPosition(entry.position.x, entry.position.y, zones);
            if (!zoneAtEntry) {
              const cell = posToCell(entry.position.x, entry.position.y);
              undefinedAreaWarnings.push({
                agentId: s.persona.agent.id,
                cell,
                phase: entry.phase,
              });
            }
            // Deterministic comfort-drivers explainer — labels which
            // dimensions of accumulated_state are driving comfort down
            // at this leg, with the sensor reading that explains each.
            // Derived from accState / computed / env / spatial; no LLM.
            const comfortDrivers = deriveComfortDrivers(
              entry.accState,
              entry.computed,
              entry.environment,
              entry.spatial,
            );
            return {
              ...entry,
              experience: {
                ...entry.experience,
                comfort_drivers: comfortDrivers,
              },
              spatial: sanitiseSpatial(entry.spatial),
              stress_score: computeStressScore(entry.accState),
              zone: zoneAtEntry
                ? {
                    id: zoneAtEntry.id,
                    label: zoneAtEntry.label ?? null,
                    program: zoneAtEntry.program ?? null,
                    open_space: zoneAtEntry.env.open_space,
                    ceiling_height_mm: zoneAtEntry.env.ceiling_height,
                    influence_radius_mm: zoneAtEntry.influence_radius_mm ?? 0,
                    undefined_area: false,
                  }
                : {
                    id: null,
                    label: "(undefined area)",
                    program: null,
                    open_space: null,
                    ceiling_height_mm: null,
                    influence_radius_mm: 0,
                    undefined_area: true,
                  },
            };
          }),
        },
      };
    });

    // Top-level scenario block: include shapes (geometry) + zones (env)
    // so the export is a self-contained snapshot that can be re-imported
    // to restore the entire canvas, not just the persona list.
    const scenario = {
      shapes: shapes.map((s) => ({
        type: s.type,
        points: s.points,
        ...(s.label !== undefined ? { label: s.label } : {}),
        ...(s.meta !== undefined ? { meta: s.meta } : {}),
      })),
      zones: zones.map((z) => ({
        id: z.id,
        label: z.label ?? null,
        program: z.program ?? null,
        bounds: z.bounds,
        env: z.env,
        influence_radius_mm: z.influence_radius_mm ?? 0,
      })),
    };

    // Surface unresolved cells once per export, both to the JS console
    // (with full per-leg detail for debugging) and to the user via a
    // toast counting how many agents were affected. Silent default-env
    // fallback was the bug we were debugging — exporting must NOT pretend
    // every cell resolved successfully.
    if (undefinedAreaWarnings.length > 0) {
      const byAgent = new Map<string, typeof undefinedAreaWarnings>();
      for (const w of undefinedAreaWarnings) {
        const arr = byAgent.get(w.agentId) ?? [];
        arr.push(w);
        byAgent.set(w.agentId, arr);
      }
      console.warn(
        `[SentiArch] ${undefinedAreaWarnings.length} perception leg(s) across ${byAgent.size} agent(s) ` +
        `landed in (undefined area) — no zone covers their cell. ` +
        `These legs received the scenario default env (lux 300 / dB 55 / 24°C) ` +
        `and are tagged with undefined_area: true in the export.`,
      );
      byAgent.forEach((ws, agentId) => {
        const cells = ws.map((w: typeof undefinedAreaWarnings[number]) => `[${w.cell[0]}, ${w.cell[1]}] (${w.phase})`).join(", ");
        console.warn(`  · ${agentId}: ${cells}`);
      });
    }

    return {
      scenario,
      agents: data,
      undefined_area_warnings: undefinedAreaWarnings,
    };
  }, [states, shapes, zones]);

  const exportJSON = () => {
    // Agents-only export: persona definitions + placement + each agent's
    // PER-AGENT REACTION to the current environment (their Env.
    // Satisfaction read, Layer 3 · The Critique observations, accumulated
    // stress).
    //
    // What's intentionally excluded (= "environment parameters"):
    //   - top-level scenario block (shapes / zones / geometry)
    //   - the agent's own environment / spatial sensor readings
    //   - per-leg perception_log (env + spatial + computed per waypoint)
    //   - route_summary derived from running through a layout
    //
    // What's kept under each agent (= "agent's reaction TO the
    // environment"):
    //   - experience: comfort_score (final + engine baseline +
    //     LLM adjustment + reasoning), trend, summary, llm_observations
    //     (Layer 3 · The Critique), llm_call_status.
    //   - accState: 6-dim accumulated_state (the stress numbers shown
    //     in PersonaMindMap Section 08), only present once the agent
    //     has simulated.
    //   - stress_score: weighted scalar derived from accState.
    //
    // Also attaches each agent's authored `waypoints` when present (so a
    // trajectory agent's full route — incl. t_min / context /
    // narrative_seed — round-trips for inspection). Emitted as a bare
    // array — round-trips through parseImportedPersonas which ignores the
    // extra fields (waypoints + the agent.trajectory_mode flag).
    const agents = states.map((s) => {
      const entry: {
        agent: typeof s.persona.agent;
        position: typeof s.persona.position;
        experience?: typeof s.experience;
        accState?: typeof s.accState;
        stress_score?: number;
        waypoints?: typeof s.route.waypoints;
      } = {
        agent: s.persona.agent,
        position: s.persona.position,
      };
      // Only attach reaction data once a simulation has actually run —
      // otherwise we'd be emitting the zeroed defaultExperience and a
      // 0-vector accState, both of which are noise rather than signal.
      if (s.hasSimulated) {
        entry.experience = s.experience;
        entry.accState = s.accState;
        entry.stress_score = computeStressScore(s.accState);
      }
      // Attach the route only for agents that actually have waypoints —
      // the 19 stationary agents stay byte-identical to before.
      if (s.route.waypoints.length > 0) {
        entry.waypoints = s.route.waypoints;
      }
      return entry;
    });
    const blob = new Blob([JSON.stringify(agents, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rpgarchitecture_agents.json";
    a.click();
    URL.revokeObjectURL(url);
    const simulatedCount = agents.filter((a) => a.experience !== undefined).length;
    const suffix = simulatedCount === agents.length
      ? "with reactions"
      : `${simulatedCount}/${agents.length} with reactions`;
    toast.success(`Exported ${agents.length} agent${agents.length === 1 ? "" : "s"} (${suffix}).`);
  };

  // Apply a parsed scenario / persona import to live state. Shared by
  // local file import and cloud load; mirrors the `importPersonasFromFile`
  // behaviour but takes a parsed object directly.
  //
  // Geometry-replacement rule: a "scenario-export" file (i.e. one with a
  // top-level `scenario` wrapper) overwrites shapes and zones — but ONLY
  // when the file actually carries non-empty arrays. Empty / missing
  // arrays preserve whatever the user has already drawn on the canvas
  // so that "refresh the personas in this scenario" doesn't wipe their
  // manually authored zones, which was a frequent footgun.
  const applyImportedScenario = useCallback(
    (parsed: ReturnType<typeof parseScenarioImport>) => {
      const isFull = parsed.source === "scenario-export";
      const positions = parsed.agentPositions ?? parsed.personas.map(() => null);
      const replaceShapes = isFull && Array.isArray(parsed.shapes) && parsed.shapes.length > 0;
      const replaceZones = isFull && Array.isArray(parsed.zones) && parsed.zones.length > 0;

      setStates(parsed.personas.map((p, i) => ({
        ...createDefaultState(p),
        agentPos: positions[i] ?? null,
      })));
      setSimChecked(parsed.personas.map(() => true));
      setActiveTab(0);

      if (replaceShapes) setShapes(parsed.shapes!);
      if (replaceZones) setZones(parsed.zones!);

      setCanvases((prev) => prev.map((c, idx) => ({
        ...c,
        ...(idx === activeCanvasIdx && replaceShapes ? { shapes: parsed.shapes! } : {}),
        ...(idx === activeCanvasIdx && replaceZones ? { zones: parsed.zones! } : {}),
        agentPositions: idx === activeCanvasIdx
          ? positions.slice(0, parsed.personas.length)
          : parsed.personas.map(() => null),
        waypoints: {},
        perceptionLogs: {},
      })));

      setPathTrails({});
      setAnimatingAgents({});

      // Surface what the import actually changed, so users notice when
      // they have replaced their geometry vs. only the personas.
      if (isFull) {
        const parts: string[] = [`${parsed.personas.length} agents imported`];
        if (replaceShapes) parts.push(`${parsed.shapes!.length} shapes replaced`);
        if (replaceZones) parts.push(`${parsed.zones!.length} zones replaced`);
        if (!replaceShapes && !replaceZones) parts.push("existing shapes / zones preserved");
        toast.info(parts.join(" · "));
      } else {
        toast.info(`${parsed.personas.length} agents imported · existing shapes / zones preserved`);
      }
    },
    [activeCanvasIdx],
  );

  // ---- Cloud Save / Load via /api/scenarios ----
  // Slug-as-credential: any string 3–64 chars [A-Za-z0-9_-]. We remember
  // the last-used slug in localStorage so users don't have to retype.
  const CLOUD_SLUG_KEY = "rpgarchitecture_cloud_slug_v1";
  const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;

  const cloudSaveScenario = useCallback(async () => {
    const lastSlug = (() => { try { return localStorage.getItem(CLOUD_SLUG_KEY) ?? ""; } catch { return ""; } })();
    const slug = window.prompt(
      "Cloud Save — enter a slug for this scenario:\n" +
      "(3–64 chars, letters / digits / dash / underscore;\n" +
      "anyone with this slug can read or overwrite — pick something unguessable for private work)",
      lastSlug,
    );
    if (!slug) return;
    if (!SLUG_RE.test(slug)) {
      toast.error("Invalid slug — letters, digits, dash, underscore, 3–64 chars");
      return;
    }
    const payload = buildExportPayload();
    const sizeKb = Math.round(JSON.stringify(payload).length / 1024);
    toast.info(`Uploading "${slug}" (${sizeKb} KB)…`);
    try {
      const res = await fetch("/api/scenarios/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, payload }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const errMsg = typeof json === "object" && json && "error" in json
          ? String((json as { error: unknown }).error)
          : `HTTP ${res.status}`;
        toast.error(`Cloud save failed: ${errMsg}`);
        return;
      }
      try { localStorage.setItem(CLOUD_SLUG_KEY, slug); } catch { /* ignore */ }
      toast.success(`Saved "${slug}" to cloud (${sizeKb} KB). Use the same slug from another machine to load.`);
    } catch (err) {
      toast.error(`Cloud save error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [buildExportPayload]);

  const cloudLoadScenario = useCallback(async () => {
    const lastSlug = (() => { try { return localStorage.getItem(CLOUD_SLUG_KEY) ?? ""; } catch { return ""; } })();
    const slug = window.prompt(
      "Cloud Load — enter the slug to load:",
      lastSlug,
    );
    if (!slug) return;
    if (!SLUG_RE.test(slug)) {
      toast.error("Invalid slug — letters, digits, dash, underscore, 3–64 chars");
      return;
    }
    toast.info(`Loading "${slug}"…`);
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(slug)}`);
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const errMsg = typeof json === "object" && json && "error" in json
          ? String((json as { error: unknown }).error)
          : `HTTP ${res.status}`;
        toast.error(`Cloud load failed: ${errMsg}`);
        return;
      }
      const payload = (json as { payload?: unknown }).payload;
      const parsed = parseScenarioImport(payload);
      if (parsed.personas.length === 0) {
        toast.error("Loaded scenario contained no personas");
        return;
      }
      const summaryParts: string[] = [`${parsed.personas.length} agents`];
      if (parsed.shapes) summaryParts.push(`${parsed.shapes.length} shapes`);
      if (parsed.zones) summaryParts.push(`${parsed.zones.length} zones`);
      const ok = window.confirm(
        `Replace current canvas with cloud scenario "${slug}"?\n\n` +
        `Loaded: ${summaryParts.join(", ")}.\n` +
        `Geometry, agents, and positions will be replaced. Waypoints and simulation results in every canvas cleared.`,
      );
      if (!ok) return;
      applyImportedScenario(parsed);
      try { localStorage.setItem(CLOUD_SLUG_KEY, slug); } catch { /* ignore */ }
      toast.success(`Loaded "${slug}" — ${summaryParts.join(", ")}.`);
    } catch (err) {
      toast.error(`Cloud load error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [applyImportedScenario]);

  const agentPositions = useMemo(() => states.map((s) => s.agentPos), [states]);
  const allWaypoints = useMemo(() => {
    const wps: Record<number, Waypoint[]> = {};
    states.forEach((s, i) => {
      if (s.route.waypoints.length > 0) wps[i] = s.route.waypoints;
    });
    return wps;
  }, [states]);

  // Heatmap toggle
  const [showHeatmap, setShowHeatmap] = useState(false);

  const heatmapPoints = useMemo<HeatmapPoint[]>(() => {
    if (!showHeatmap) return [];
    const points: HeatmapPoint[] = [];
    states.forEach((s, agentIdx) => {
      for (const entry of s.route.perceptionLog) {
        if (entry.phase === "dwelling") {
          points.push({
            x: entry.position.x,
            y: entry.position.y,
            value: computeStressScore(entry.accState),
            agentIdx,
          });
        }
      }
    });
    return points;
  }, [states, showHeatmap]);

  const activeWPs = states[activeTab]?.route.waypoints || [];
  const activeLog = states[activeTab]?.route.perceptionLog || [];

  // Roll the per-leg perception log into a single Env. Satisfaction summary.
  // Works for both route runs (multi-leg) and stationary runs (single dwell).
  const activeRouteSummary = useMemo(() => {
    if (!current || activeLog.length === 0) return null;
    const dwellEntries = activeLog.filter((e) => e.phase === "dwelling");
    if (dwellEntries.length === 0) return null;
    const avgComfort = Math.round(
      (activeLog.reduce((s, e) => s + e.experience.comfort_score, 0) / activeLog.length) * 10
    ) / 10;
    const avgStress = Math.round(
      (dwellEntries.reduce((s, e) => s + computeStressScore(e.accState), 0) / dwellEntries.length) * 10
    ) / 10;
    const hasRoute = activeWPs.length > 0;
    const totalBudgetMin = current.persona.position.duration_in_cell;
    const totalDwellMin = hasRoute
      ? activeWPs.reduce((s, w) => s + (w.dwell_minutes || 0), 0)
      : totalBudgetMin;
    const legCount = hasRoute ? activeWPs.length : 1;
    const startComfort = activeLog[0].experience.comfort_score;
    const endComfort = activeLog[activeLog.length - 1].experience.comfort_score;
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
  }, [activeLog, activeWPs, current]);

  if (!current) return null;

  // ---- Derived values for bottom bar / comfort strip ----
  const comfortScore = current.experience.comfort_score || 0;
  const comfortColor = comfortScore >= 7 ? "var(--calm)" : comfortScore >= 4 ? "var(--amber)" : "var(--brick)";
  const simLiveLabel = running ? "CALC" : routeRunning ? "ROUTE" : current.hasSimulated ? "READY" : "IDLE";
  const simulatedCount = states.filter((s) => s.hasSimulated).length;
  const totalWaypoints = Object.values(allWaypoints).reduce((acc, wps) => acc + wps.length, 0);

  return (
    <div className="sa-shell">
      {/* ============================================================ */}
      {/* TOP BAR                                                      */}
      {/* ============================================================ */}
      <div className="sa-topbar">
        <div className="flex items-center gap-5" style={{ minWidth: 0 }}>
          <div className="sa-brand">
            <svg viewBox="0 0 22 22" fill="none" width="22" height="22" style={{ flexShrink: 0 }}>
              <rect x="2" y="2" width="18" height="18" stroke="var(--amber)" strokeWidth="1.2" />
              <path d="M2 11 L20 11 M11 2 L11 20" stroke="var(--amber)" strokeWidth="0.6" strokeDasharray="1.5 1.5" />
              <circle cx="11" cy="11" r="3.2" fill="var(--amber)" opacity="0.85" />
            </svg>
            <span>SentiArch</span>
          </div>
          <div className="sa-crumb" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span>Project</span>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <b>SENTIARCH / Multi-Agent</b>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <span>Scenario</span>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <b>{states.length} agent{states.length !== 1 ? "s" : ""}</b>
          </div>
        </div>
        <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
          <span className="sa-session-tag">
            <span className="sa-live-dot"></span>SIM · {simLiveLabel}
          </span>
          <button className="sa-btn" onClick={cloudLoadScenario} title="Load a scenario from cloud by slug (cross-device sync)">☁ Load</button>
          <button className="sa-btn" onClick={cloudSaveScenario} title="Save the current scenario to cloud under a slug (cross-device sync)">☁ Save</button>
          <button className="sa-btn" onClick={exportJSON} title="Download a JSON of the agent roster: persona definitions + placement + each agent's reaction to the current environment (Env. Satisfaction comfort score, accumulated stress, Layer 3 · The Critique observations). Each trajectory agent's waypoints (t_min / context / narrative_seed) are included. Shapes / zones / per-leg env / perception logs are not — use ☁ Save for a full scenario snapshot.">Export Agents JSON</button>
          <button
            className="sa-btn sa-btn-primary"
            onClick={runUnifiedSimulation}
            disabled={running || routeRunning}
            style={{ opacity: (running || routeRunning) ? 0.5 : 1 }}
          >
            {routeRunning ? "Simulating…" : "Run Simulation"}
          </button>
          <button className="sa-btn" onClick={() => navigate("/satisfaction")}>Satisfaction</button>
          <button className="sa-btn" onClick={() => navigate("/settings")}>Settings</button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* LEFT PANEL — persona tabs, mind map, waypoints, logs         */}
      {/* ============================================================ */}
      <div className="sa-left-panel">
        {/* --- Canvas (scheme) tabs --- */}
        <div className="sa-section">
          <div className="sa-section-head">
            <span className="sa-section-title">
              <span className="sa-section-dot" style={{ background: "var(--brick)" }} />
              <span><span className="sa-section-title-num">00</span> · Canvas</span>
            </span>
            <span className="sa-section-meta">{canvases.length} / {MAX_CANVASES}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
            {canvases.map((c, i) => {
              const isActive = activeCanvasIdx === i;
              const isRenaming = renamingCanvasIdx === i;
              const startRename = () => {
                setRenamingCanvasIdx(i);
                setRenameDraft(c.name);
              };
              const commitRename = () => {
                if (renamingCanvasIdx === null) return;
                const trimmed = renameDraft.trim();
                if (trimmed && trimmed !== c.name) renameCanvas(i, trimmed);
                setRenamingCanvasIdx(null);
                setRenameDraft("");
              };
              const cancelRename = () => {
                setRenamingCanvasIdx(null);
                setRenameDraft("");
              };
              if (isRenaming) {
                return (
                  <input
                    key={c.id}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    maxLength={24}
                    style={{
                      padding: "4px 8px",
                      border: "1px solid var(--brick)",
                      background: "var(--bg-1)",
                      color: "var(--ink-0)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      borderRadius: 2,
                      width: 140,
                      outline: "none",
                    }}
                  />
                );
              }
              return (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => switchCanvas(i)}
                    onDoubleClick={startRename}
                    title="Click to switch · Double-click or pencil to rename"
                    style={{
                      padding: "4px 10px",
                      border: `1px solid ${isActive ? "var(--brick)" : "var(--line-1)"}`,
                      background: isActive ? "rgba(196,98,58,0.12)" : "var(--bg-2)",
                      color: isActive ? "var(--brick)" : "var(--ink-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      borderRadius: 2,
                      cursor: "pointer",
                      maxWidth: 140,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(); }}
                    className="absolute -top-1.5 -left-1.5 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "var(--ink-2)", color: "#fff", fontSize: 9, lineHeight: 1, borderRadius: 2 }}
                    title={`Rename ${c.name}`}
                  >✎</button>
                  {canvases.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove ${c.name}?`)) removeCanvas(i);
                      }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "var(--brick)", color: "#fff", fontSize: 9, lineHeight: 1, borderRadius: 2 }}
                      title={`Remove ${c.name}`}
                    >×</button>
                  )}
                </div>
              );
            })}
            {canvases.length < MAX_CANVASES && (
              <>
                <button
                  onClick={addCanvas}
                  title={`Clone current canvas (max ${MAX_CANVASES})`}
                  style={{
                    padding: "4px 10px",
                    border: "1px dashed var(--line-2)",
                    background: "transparent",
                    color: "var(--ink-2)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >+ ADD</button>
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const preset = LAYOUT_PRESETS.find((p) => p.id === id);
                    if (preset) addCanvasFromPreset(preset);
                    e.target.value = "";
                  }}
                  title="Spawn a new canvas seeded from a bundled preset (instead of cloning the active one)"
                  style={{
                    padding: "4px 8px",
                    border: "1px dashed var(--line-2)",
                    background: "transparent",
                    color: "var(--ink-2)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  <option value="">+ FROM PRESET…</option>
                  {LAYOUT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Compare schemes · agents are shared across canvases
          </div>
        </div>

        {/* --- Agent tabs & comparison toggle --- */}
        <div className="sa-section">
          <div className="sa-section-head">
            <span className="sa-section-title">
              <span className="sa-section-dot" style={{ background: "var(--amber)" }} />
              <span><span className="sa-section-title-num">01</span> · Agents</span>
            </span>
            <span className="sa-section-meta">{states.length} agent{states.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
            {states.map((s, i) => {
              const color = getPersonaColor(i);
              const isActive = activeTab === i;
              return (
                <div key={i} className="relative group">
                  <button
                    onClick={() => setActiveTab(i)}
                    style={{
                      padding: "4px 10px",
                      border: `1px solid ${isActive ? color.primary : "var(--line-1)"}`,
                      background: isActive ? `${color.primary}22` : "var(--bg-2)",
                      color: isActive ? color.primary : "var(--ink-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      borderRadius: 2,
                      cursor: "pointer",
                    }}
                    title={s.persona.agent.name?.trim() ? `${s.persona.agent.name} · ${s.persona.agent.id}` : s.persona.agent.id}
                  >
                    {s.persona.agent.name?.trim() || s.persona.agent.id}
                  </button>
                  {states.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeAgent(i); }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "var(--brick)", color: "#fff", fontSize: 9, lineHeight: 1, borderRadius: 2 }}
                      title={`Remove ${s.persona.agent.name?.trim() || s.persona.agent.id}`}
                    >×</button>
                  )}
                </div>
              );
            })}
            <button
              onClick={addAgent}
              style={{
                padding: "4px 10px",
                border: "1px dashed var(--line-2)",
                background: "transparent",
                color: "var(--ink-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
                borderRadius: 2,
                cursor: "pointer",
              }}
              title="Add new agent"
            >+ ADD</button>
            <button
              onClick={() => importFileInputRef.current?.click()}
              style={{
                padding: "4px 10px",
                border: "1px solid var(--line-2)",
                background: "var(--bg-2)",
                color: "var(--ink-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
                borderRadius: 2,
                cursor: "pointer",
              }}
              title="Import agents from a JSON file (replaces current agents only — map geometry is preserved). Use Cloud Load for full scenario restore."
            >IMPORT AGENTS</button>
            <input
              ref={importFileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importPersonasFromFile(file);
                // Reset value so picking the same file twice in a row still fires onChange.
                e.target.value = "";
              }}
            />
            <div className="flex-1" />
            <button
              onClick={() => navigate("/satisfaction")}
              style={{
                padding: "4px 10px",
                border: "1px solid var(--line-2)",
                background: "var(--bg-2)",
                color: "var(--ink-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                borderRadius: 2,
                cursor: "pointer",
              }}
              title="Open the cross-canvas Env. Satisfaction matrix — replaces the legacy Compare All toggle"
            >
              Compare All →
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
            <span style={{ color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Simulate</span>
            {states.map((s, i) => {
              const color = getPersonaColor(i);
              return (
                <label key={i} className="flex items-center gap-1.5" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={simChecked[i] ?? true}
                    onChange={(e) => {
                      const next = [...simChecked];
                      next[i] = e.target.checked;
                      setSimChecked(next);
                    }}
                    style={{ width: 12, height: 12, accentColor: color.primary }}
                  />
                  <span
                    style={{ color: color.primary, fontFamily: "var(--font-mono)", fontSize: 11 }}
                    title={s.persona.agent.name?.trim() ? `${s.persona.agent.name} · ${s.persona.agent.id}` : s.persona.agent.id}
                  >
                    {s.persona.agent.name?.trim() || s.persona.agent.id}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* --- Active persona mind map ---
            (Previous Compare All toggle / ComparisonView removed during
            dedup pass — `/satisfaction` is the canonical cross-agent
            comparison surface.) The cohort prop gives the active
            agent's Section 07 + Layer 2 panels visibility into how
            ALL other agents are reading the same environment, so the
            per-agent panel doubles as a quick cross-agent comparison
            without a separate compare-mode toggle. */}
        <PersonaMindMap
          persona={current.persona}
          experience={current.experience}
          accumulatedState={current.accState}
          computedOutputs={current.computed}
          ruleTriggers={current.triggers}
          prevExperience={current.prevExperience}
          prevAccumulatedState={current.prevAccState}
          onPersonaChange={(p) => updatePersonaWithEnvSync(activeTab, p)}
          hasSimulated={current.hasSimulated}
          personaColor={getPersonaColor(activeTab)}
          agentPlaced={current.agentPos !== null}
          routeSummary={activeRouteSummary}
          cohort={states
            .map((s, i): PeerAgentReaction | null => {
              if (i === activeTab) return null;
              return {
                agentIdx: i,
                agentId: s.persona.agent.id,
                agentName: s.persona.agent.name,
                hasSimulated: s.hasSimulated,
                experience: s.experience,
                accState: s.accState,
                color: getPersonaColor(i),
              };
            })
            .filter((p): p is PeerAgentReaction => p !== null)}
        />

        {/* --- Waypoint Route section --- */}
        <div className="sa-section">
          <div className="sa-section-head">
            <span className="sa-section-title">
              <span className="sa-section-dot" style={{ background: "var(--brick)" }} />
              <span><span className="sa-section-title-num">09</span> · Waypoint Route</span>
            </span>
            <span className="sa-section-meta">{activeWPs.length} WP</span>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {routeRunning ? (
              <button className="sa-btn sa-btn-danger" style={{ flex: 1, fontSize: 11 }} onClick={stopRoutes}>Stop Routes</button>
            ) : (
              <button className="sa-btn sa-btn-primary" style={{ flex: 1, fontSize: 11 }} disabled={running} onClick={runUnifiedSimulation}>Run Simulation</button>
            )}
            {activeWPs.length > 0 && (
              <button className="sa-btn" style={{ fontSize: 11, color: "var(--brick)", borderColor: "var(--brick)" }} onClick={() => clearWaypoints(activeTab)}>Clear</button>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 11, color: "var(--ink-2)", fontFamily: "var(--font-mono)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!current.persona.agent.trajectory_mode}
              onChange={(e) => setTrajectoryMode(activeTab, e.target.checked)}
            />
            <span>Trajectory mode</span>
            <span style={{ color: "var(--ink-3)", fontSize: 10 }}>
              {current.persona.agent.trajectory_mode
                ? "one snapshot / waypoint · t_min timeline · carry-over"
                : "off · stationary / legacy route (dwell min)"}
            </span>
          </label>

          {activeWPs.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
              Select the Waypoint tool on the map toolbar and click to place waypoints for {current.persona.agent.id}. At least 2 waypoints are needed.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {activeWPs.map((wp, i) => (
                <div key={wp.id} style={{
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                  padding: "6px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: getPersonaColor(activeTab).primary, minWidth: 20, fontWeight: 600 }}>{i + 1}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-0)", minWidth: 40 }}>{wp.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>({wp.position.x}, {wp.position.y})</span>
                  <div className="flex-1" />
                  {current.persona.agent.trajectory_mode ? (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
                      <span>T_MIN</span>
                      <input
                        type="number" min={0} max={600}
                        value={typeof wp.t_min === "number" ? wp.t_min : ""}
                        placeholder={String(i * 15)}
                        onChange={(e) => updateWaypointField(activeTab, wp.id, "t_min", parseInt(e.target.value) || 0)}
                        style={{
                          width: 48, padding: "2px 4px", textAlign: "center",
                          background: "var(--bg-1)", border: "1px solid var(--line-1)",
                          color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 11,
                        }}
                      />
                      <span style={{ color: "var(--ink-3)" }}>min</span>
                    </label>
                  ) : (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
                      <span>DWELL</span>
                      <input
                        type="number" min={0} max={120} value={wp.dwell_minutes}
                        onChange={(e) => updateWaypointDwell(activeTab, wp.id, parseInt(e.target.value) || 0)}
                        style={{
                          width: 44, padding: "2px 4px", textAlign: "center",
                          background: "var(--bg-1)", border: "1px solid var(--line-1)",
                          color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 11,
                        }}
                      />
                      <span style={{ color: "var(--ink-3)" }}>min</span>
                    </label>
                  )}
                  <button
                    onClick={() => removeWaypoint(activeTab, wp.id)}
                    style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", color: "var(--brick)", border: "1px solid var(--line-1)", fontSize: 11, cursor: "pointer" }}
                    title="Remove waypoint"
                  >×</button>
                  {current.persona.agent.trajectory_mode && (
                    <div style={{ flexBasis: "100%", display: "flex", gap: 6, marginTop: 2 }}>
                      <input
                        type="text"
                        value={wp.context ?? ""}
                        placeholder="context — e.g. doorway hesitation"
                        onChange={(e) => updateWaypointField(activeTab, wp.id, "context", e.target.value)}
                        style={{
                          flex: 2, padding: "3px 6px",
                          background: "var(--bg-1)", border: "1px solid var(--line-1)",
                          color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 10,
                        }}
                      />
                      <input
                        type="text"
                        value={wp.narrative_seed ?? ""}
                        placeholder="narrative seed (optional)"
                        onChange={(e) => updateWaypointField(activeTab, wp.id, "narrative_seed", e.target.value)}
                        style={{
                          flex: 2, padding: "3px 6px",
                          background: "var(--bg-1)", border: "1px solid var(--line-1)",
                          color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 10,
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* --- Route results summary --- */}
        {activeLog.length > 0 && (() => {
          const dwellEntries = activeLog.filter((e) => e.phase === "dwelling");
          const walkEntries = activeLog.filter((e) => e.phase === "walking");
          const avgComfort = activeLog.length > 0
            ? Math.round((activeLog.reduce((s, e) => s + e.experience.comfort_score, 0) / activeLog.length) * 10) / 10
            : 0;
          const avgStress = dwellEntries.length > 0
            ? Math.round((dwellEntries.reduce((s, e) => s + computeStressScore(e.accState), 0) / dwellEntries.length) * 10) / 10
            : 0;

          const pillColor = (good: boolean, mid: boolean) => good ? "var(--calm)" : mid ? "var(--amber)" : "var(--brick)";

          return (
            <div className="sa-section">
              <div className="sa-section-head">
                <span className="sa-section-title">
                  <span className="sa-section-dot" style={{ background: "var(--calm)" }} />
                  <span><span className="sa-section-title-num">10</span> · Route Results</span>
                </span>
                <span className="sa-section-meta">{activeLog.length} entries</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Avg Comfort</div>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: pillColor(avgComfort >= 7, avgComfort >= 4), lineHeight: 1 }}>{avgComfort}<span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2 }}>/10</span></div>
                </div>
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Avg Stress</div>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: pillColor(avgStress <= 3, avgStress <= 6), lineHeight: 1 }}>{avgStress}<span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2 }}>/10</span></div>
                </div>
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Entries</div>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: "var(--ink-0)", lineHeight: 1 }}>{activeLog.length}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dwellEntries.map((entry, i) => {
                  const wp = activeWPs.find((w) => w.id === entry.waypoint_id);
                  const stress = computeStressScore(entry.accState);
                  const stressCol = stress <= 3 ? "var(--calm)" : stress <= 6 ? "var(--amber)" : "var(--brick)";
                  const comfortCol = entry.experience.comfort_score >= 7 ? "var(--calm)" : entry.experience.comfort_score >= 4 ? "var(--amber)" : "var(--brick)";
                  const walkEntry = walkEntries.find((w) => w.to === entry.waypoint_id);
                  return (
                    <div key={i} style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: getPersonaColor(activeTab).primary, fontWeight: 600 }}>{wp?.label || `WP${i+1}`}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>({entry.position.x}, {entry.position.y})</span>
                        <div className="flex-1" />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: comfortCol }}>C {entry.experience.comfort_score}/10</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: stressCol }}>S {stress}/10</span>
                      </div>
                      <div style={{ padding: "8px 10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px", marginBottom: 8 }}>
                          {([
                            { key: "thermal_discomfort", label: "Thermal" },
                            { key: "visual_strain",      label: "Visual"  },
                            { key: "noise_stress",       label: "Noise"   },
                            { key: "social_overload",    label: "Social"  },
                            { key: "fatigue",            label: "Fatigue" },
                            { key: "wayfinding_anxiety", label: "Wayfind" },
                          ] as const).map(({ key, label }) => {
                            const val = entry.accState[key];
                            const col = val <= 0.3 ? "var(--calm)" : val <= 0.6 ? "var(--amber)" : "var(--brick)";
                            return (
                              <div key={key}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                                  <span style={{ color: "var(--ink-3)" }}>{label}</span>
                                  <span style={{ color: col }}>{val.toFixed(1)}</span>
                                </div>
                                <div style={{ width: "100%", height: 2, background: "var(--line-1)", marginTop: 2 }}>
                                  <div style={{ width: `${Math.min(100, val*100)}%`, height: "100%", background: col }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-1)", fontFamily: "var(--font-serif)", borderLeft: "2px solid var(--amber)", paddingLeft: 10, margin: 0 }}>{entry.experience.summary}</p>
                        {walkEntry && (
                          <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--bg-1)", border: "1px solid var(--line-1)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--teal)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                              <span style={{ border: "1px solid var(--teal)", padding: "1px 5px" }}>WALK</span>
                              <span style={{ color: "var(--ink-3)" }}>en route to {wp?.label || "?"}</span>
                            </div>
                            <p style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-2)", margin: 0 }}>{walkEntry.experience.summary}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Full Perception Log — {activeLog.length} entries
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                  {activeLog.map((entry, i) => (
                    <div key={i} style={{ padding: "6px 8px", background: entry.phase === "walking" ? "rgba(122,166,196,0.08)" : "rgba(138,166,118,0.08)", border: `1px solid ${entry.phase === "walking" ? "rgba(122,166,196,0.2)" : "rgba(138,166,118,0.2)"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, fontFamily: "var(--font-mono)", fontSize: 9 }}>
                        <span style={{ padding: "1px 5px", border: `1px solid ${entry.phase === "walking" ? "var(--teal)" : "var(--calm)"}`, color: entry.phase === "walking" ? "var(--teal)" : "var(--calm)", letterSpacing: "0.1em" }}>
                          {entry.phase === "walking" ? "WALK" : "DWELL"}
                        </span>
                        {entry.phase === "walking" && entry.from && entry.to && (
                          <span style={{ color: "var(--ink-3)" }}>
                            {activeWPs.find((w) => w.id === entry.from)?.label || "?"} → {activeWPs.find((w) => w.id === entry.to)?.label || "?"}
                          </span>
                        )}
                        {entry.phase === "dwelling" && (
                          <span style={{ color: "var(--ink-3)" }}>@ {activeWPs.find((w) => w.id === entry.waypoint_id)?.label || "?"}</span>
                        )}
                        <div className="flex-1" />
                        <span style={{ color: "var(--ink-3)" }}>S {computeStressScore(entry.accState).toFixed(1)}</span>
                        <span style={{ color: entry.experience.comfort_score >= 7 ? "var(--calm)" : entry.experience.comfort_score >= 4 ? "var(--amber)" : "var(--brick)" }}>C {entry.experience.comfort_score}/10</span>
                      </div>
                      <p style={{ fontSize: 11, lineHeight: 1.4, color: "var(--ink-1)", margin: 0 }}>{entry.experience.summary}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          );
        })()}

        {/* --- Coordinate Input section --- */}
        <div className="sa-section" style={{ borderBottom: "none" }}>
          <div className="sa-section-head">
            <span className="sa-section-title">
              <span className="sa-section-dot" style={{ background: "var(--teal)" }} />
              <span><span className="sa-section-title-num">11</span> · Coordinate Input</span>
            </span>
          </div>
          <CoordinateInput
            onAddShape={addShape}
            onClearAll={clearAll}
            zones={zones}
            onAddZone={addZone}
            onUpdateZone={updateZone}
            onRemoveZone={removeZone}
            onSplitZone={splitZone}
          />
        </div>
      </div>

      {/* ============================================================ */}
      {/* MAP AREA                                                     */}
      {/* ============================================================ */}
      <div className="sa-map-area">
        {/* Map action bar — sits above the canvas, never overlaps toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginRight: 4 }}>Map</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Active</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {states.map((s, i) => {
              const color = getPersonaColor(i);
              const isActive = activeTab === i;
              return (
                <button
                  key={i}
                  onClick={() => setActiveTab(i)}
                  title={s.persona.agent.name?.trim() ? `${s.persona.agent.name} · ${s.persona.agent.id}` : s.persona.agent.id}
                  style={{
                    padding: "3px 9px",
                    border: `1px solid ${isActive ? color.primary : "var(--line-1)"}`,
                    background: isActive ? `${color.primary}22` : "var(--bg-2)",
                    color: isActive ? color.primary : "var(--ink-2)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    borderRadius: 2,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span style={{ width: 7, height: 7, background: color.primary, borderRadius: 1 }} />
                  {s.persona.agent.name?.trim() || s.persona.agent.id}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className="sa-tool-btn"
            data-active={showHeatmap}
          >
            {showHeatmap ? "Hide Heatmap" : "Stress Heatmap"}
          </button>
          <button
            onClick={resetAgents}
            disabled={routeRunning}
            className="sa-tool-btn"
            style={{ opacity: routeRunning ? 0.5 : 1 }}
          >
            Reset Agents
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", overflow: "auto" }}>
          <SpatialMap
            shapes={shapes}
            zones={zones}
            agentPositions={agentPositions}
            agentLabels={states.map((s) => s.persona.agent.name?.trim() || s.persona.agent.id)}
            activeAgentIdx={activeTab}
            onAgentPlace={(pos) => placeAgent(activeTab, pos)}
            onAgentRemove={(idx) => {
              setStates((prev) => prev.map((s, i) => i === idx ? { ...s, agentPos: null } : s));
            }}
            onAddShape={addShape}
            onAddZone={addZone}
            onSplitZoneByLine={splitZoneByLineHandler}
            onSplitZoneByPolyline={splitZoneByPolylineHandler}
            onUpdateShapes={updateShapes}
            onDeleteShape={deleteShape}
            onImportLayout={importLayout}
            allWaypoints={allWaypoints}
            onAddWaypoint={addWaypoint}
            onRemoveWaypoint={removeWaypoint}
            animatingAgents={animatingAgents}
            pathTrails={pathTrails}
            heatmapPoints={heatmapPoints}
            showHeatmap={showHeatmap}
          />



        </div>

        {/* Comfort strip between map and bottom bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 18px", height: 40, borderTop: "1px solid var(--line-1)", background: "var(--bg-1)", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.1em" }}>COMFORT</span>
          <span style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: comfortColor }}>{comfortScore}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>/10</span>
          <div style={{ flex: 1, height: 3, background: "var(--line-1)", position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${comfortScore * 10}%`, background: comfortColor, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.06em" }}>{current.persona.agent.name?.trim() || current.persona.agent.id} · {current.experience.trend}</span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* BOTTOM BAR — transport, timeline, status pills               */}
      {/* ============================================================ */}
      <div className="sa-bottom-bar">
        <div className="sa-transport">
          <button
            className="sa-transport-btn"
            onClick={resetAgents}
            disabled={routeRunning}
            title="Reset all agents"
          >⏮</button>
          <button
            className="sa-transport-btn sa-transport-btn-primary"
            onClick={() => {
              if (routeRunning) stopRoutes();
              else runUnifiedSimulation();
            }}
            disabled={running}
            title={routeRunning ? "Stop simulation" : "Run simulation (route + stationary)"}
          >{routeRunning ? "❚❚" : "▶"}</button>
          <button
            className="sa-transport-btn"
            onClick={runUnifiedSimulation}
            disabled={running || routeRunning}
            title="Run simulation"
          >⏭</button>
          <button
            className="sa-transport-btn"
            onClick={clearAll}
            title="Clear map"
          >↻</button>
        </div>

        <div className="sa-timeline">
          <div className="sa-timeline-track" />
          <div className="sa-timeline-fill" style={{ width: `${Math.min(100, simulatedCount / Math.max(1, states.length) * 100)}%` }} />
          {states.map((s, i) => (
            <div
              key={i}
              className={`sa-timeline-event ${s.hasSimulated ? "sa-timeline-event-amber" : ""}`}
              style={{ left: `${((i + 0.5) / states.length) * 100}%` }}
              title={s.persona.agent.id}
            />
          ))}
          <span style={{ position: "absolute", bottom: -2, left: 0, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>AGENT 1</span>
          <span style={{ position: "absolute", bottom: -2, right: 0, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)" }}>AGENT {states.length}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="sa-status-pill"><span className="sa-live-dot" />LLM SYNC</span>
          <span className="sa-status-pill">WAYPOINTS · {totalWaypoints}</span>
          <span className="sa-status-pill">SHAPES · {shapes.length}</span>
          <span className="sa-status-pill">ZONES · {zones.length}</span>
        </div>
      </div>
    </div>
  );
}
