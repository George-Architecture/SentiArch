// ============================================================
// CoordinateInput Component - Rhino/GH coordinate data entry + Zone Editor
// Design: Neumorphism-lite warm beige
// ============================================================

import { useState } from "react";
import type { Shape, Zone, ZoneEnv } from "@/lib/store";
import { defaultZoneEnv } from "@/lib/store";
import { toast } from "sonner";

const BOUNDARY_EXAMPLE = `0. {5000, 0}
1. {5000, 5000}
2. {0, 5000}
3. {0, 0}`;

const WINDOW_EXAMPLE = `0. {5000, 1000}
1. {5000, 4000}`;

function parseCoordinates(text: string): [number, number][] {
  const points: [number, number][] = [];
  const lines = text.trim().split("\n");
  for (const line of lines) {
    const match = line.match(/\{?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}?/);
    if (match) {
      points.push([parseFloat(match[1]), parseFloat(match[2])]);
    }
  }
  return points;
}

// ---- Zone Editor Sub-Component ----
function ZoneEditor({
  zones,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onSplitZone,
}: {
  zones: Zone[];
  onAddZone: (zone: Zone) => void;
  onUpdateZone: (id: string, updates: Partial<Zone>) => void;
  onRemoveZone: (id: string) => void;
  onSplitZone?: (id: string, direction: "horizontal" | "vertical", count: number) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newBounds, setNewBounds] = useState({ x: "0", y: "0", width: "5000", height: "5000" });
  const [newEnv, setNewEnv] = useState<ZoneEnv>({ ...defaultZoneEnv });
  const [newProgram, setNewProgram] = useState("");
  const [newInfluence, setNewInfluence] = useState(0);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  // Per-zone split controls (direction + piece count). Keyed by zone id so
  // each row remembers its last-used config until re-render.
  const [splitConfig, setSplitConfig] = useState<Record<string, { direction: "horizontal" | "vertical"; count: number }>>({});
  const getSplitCfg = (id: string) => splitConfig[id] ?? { direction: "vertical" as const, count: 2 };
  const setSplitCfg = (id: string, cfg: Partial<{ direction: "horizontal" | "vertical"; count: number }>) =>
    setSplitConfig((prev) => ({ ...prev, [id]: { ...getSplitCfg(id), ...cfg } }));

  const handleAddZone = () => {
    const bounds = {
      x: parseFloat(newBounds.x) || 0,
      y: parseFloat(newBounds.y) || 0,
      width: parseFloat(newBounds.width) || 5000,
      height: parseFloat(newBounds.height) || 5000,
    };
    if (bounds.width <= 0 || bounds.height <= 0) {
      toast.error("Zone width and height must be positive");
      return;
    }
    const trimmedProgram = newProgram.trim();
    const zone: Zone = {
      id: `zone_${Date.now()}`,
      label: newLabel || `Zone ${zones.length + 1}`,
      bounds,
      env: { ...newEnv },
      ...(trimmedProgram ? { program: trimmedProgram } : {}),
      ...(newInfluence > 0 ? { influence_radius_mm: newInfluence } : {}),
    };
    onAddZone(zone);
    setNewLabel("");
    setNewProgram("");
    setNewInfluence(0);
    toast.success(`Zone "${zone.label}" added`);
  };

  const envFields: { key: "temperature" | "humidity" | "light" | "noise" | "air_velocity"; label: string; unit: string; min: number; max: number; step: number }[] = [
    { key: "temperature", label: "Temp", unit: "°C", min: 10, max: 40, step: 0.5 },
    { key: "humidity", label: "RH", unit: "%", min: 0, max: 100, step: 1 },
    { key: "light", label: "Lux", unit: "lx", min: 0, max: 2000, step: 10 },
    { key: "noise", label: "Noise", unit: "dB", min: 0, max: 120, step: 1 },
    { key: "air_velocity", label: "Air V.", unit: "m/s", min: 0, max: 2, step: 0.01 },
  ];

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold tracking-wider" style={{ color: "var(--muted-foreground)" }}>
        ZONE ENVIRONMENT EDITOR
      </div>

      {/* Existing Zones */}
      {zones.length > 0 && (
        <div className="space-y-2">
          {zones.map((z) => (
            <div key={z.id} className="sa-card p-3" style={{ background: "var(--background)" }}>
              <div className="flex items-center justify-between mb-2">
                {editingLabelId === z.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingLabelValue}
                    onChange={(e) => setEditingLabelValue(e.target.value)}
                    onBlur={() => {
                      const trimmed = editingLabelValue.trim();
                      if (trimmed) onUpdateZone(z.id, { label: trimmed });
                      setEditingLabelId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = editingLabelValue.trim();
                        if (trimmed) onUpdateZone(z.id, { label: trimmed });
                        setEditingLabelId(null);
                      } else if (e.key === "Escape") {
                        setEditingLabelId(null);
                      }
                    }}
                    className="text-sm font-semibold px-1 py-0.5 rounded"
                    style={{
                      color: "var(--foreground)",
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      fontFamily: "inherit",
                      minWidth: "80px",
                      maxWidth: "160px",
                    }}
                  />
                ) : (
                  <span
                    className="text-sm font-semibold cursor-pointer hover:underline"
                    style={{ color: "var(--foreground)" }}
                    title="Click to rename"
                    onClick={() => {
                      setEditingLabelId(z.id);
                      setEditingLabelValue(z.label || z.id);
                    }}
                  >
                    {z.label || z.id} ✎
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
                    ({z.bounds.x}, {z.bounds.y}) {z.bounds.width}×{z.bounds.height}mm
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "#D94F4F20", color: "#D94F4F", border: "1px solid #D94F4F40" }}
                    onClick={() => onRemoveZone(z.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {envFields.map((f) => (
                  <div key={f.key} className="text-center">
                    <div className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>{f.label}</div>
                    <input
                      type="number"
                      value={z.env[f.key]}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          onUpdateZone(z.id, { env: { ...z.env, [f.key]: val } });
                        }
                      }}
                      className="w-full text-center text-xs p-1 rounded"
                      style={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        color: "var(--foreground)",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                    />
                    <div className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{f.unit}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-5 gap-2 mt-2">
                <div className="col-span-2 text-center">
                  <div className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Ceiling</div>
                  <input
                    type="number"
                    value={z.env.ceiling_height}
                    disabled={z.env.open_space}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val >= 0) {
                        onUpdateZone(z.id, { env: { ...z.env, ceiling_height: val } });
                      }
                    }}
                    className="w-full text-center text-xs p-1 rounded"
                    style={{
                      background: z.env.open_space ? "var(--muted)" : "var(--card)",
                      border: "1px solid var(--border)",
                      color: z.env.open_space ? "var(--muted-foreground)" : "var(--foreground)",
                      fontFamily: "'JetBrains Mono', monospace",
                      opacity: z.env.open_space ? 0.5 : 1,
                    }}
                    min={0}
                    max={20000}
                    step={100}
                    title={z.env.open_space ? "Open space — no roof; ceiling is informational only" : "Overhead clearance in millimetres"}
                  />
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>mm</div>
                </div>
                <div className="col-span-2 text-center">
                  <div className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Influence</div>
                  <input
                    type="number"
                    value={z.influence_radius_mm ?? 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val >= 0) {
                        onUpdateZone(z.id, { influence_radius_mm: val });
                      }
                    }}
                    className="w-full text-center text-xs p-1 rounded"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    min={0}
                    max={50000}
                    step={500}
                    title="How far this zone's env values bleed beyond its perimeter (mm). 0 = hard edge. Try 5000–15000 for noise/heat sources like roads or sun-baked surfaces."
                  />
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>mm bleed</div>
                </div>
                <div className="col-span-1 text-center">
                  <div className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Open</div>
                  <label className="flex items-center justify-center gap-1 text-xs p-1 rounded cursor-pointer"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                    }}
                    title={z.env.open_space ? "OPEN — no overhead enclosure (agents perceive open sky)" : "ENCLOSED — ceiling above"}
                  >
                    <input
                      type="checkbox"
                      checked={z.env.open_space}
                      onChange={(e) => onUpdateZone(z.id, { env: { ...z.env, open_space: e.target.checked } })}
                    />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                      {z.env.open_space ? "OPEN" : "ENCL"}
                    </span>
                  </label>
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {z.env.open_space ? "open sky" : "ceiling"}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
                  Program / Activity
                </label>
                <input
                  type="text"
                  value={z.program ?? ""}
                  list="zone-program-suggestions"
                  placeholder="e.g. Light rail platform — waiting for train"
                  maxLength={120}
                  onChange={(e) => onUpdateZone(z.id, { program: e.target.value })}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== (z.program ?? "")) {
                      onUpdateZone(z.id, { program: trimmed || undefined });
                    }
                  }}
                  className="w-full text-xs p-1.5 rounded"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                  title="Free text — what is this space for, and what is the agent doing here?"
                />
              </div>
              {onSplitZone && (() => {
                const cfg = getSplitCfg(z.id);
                return (
                  <div
                    className="mt-2 p-2 rounded flex items-center gap-2 flex-wrap"
                    style={{ background: "var(--card)", border: "1px dashed var(--border)" }}
                  >
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: "var(--muted-foreground)", letterSpacing: "0.08em" }}
                      title="Manually split this zone into N axis-aligned sub-zones. Each child inherits env, program, and influence radius from the parent."
                    >
                      SPLIT
                    </span>
                    <div className="flex items-center gap-1" role="group" aria-label="Split direction">
                      {(["vertical", "horizontal"] as const).map((d) => {
                        const active = cfg.direction === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setSplitCfg(z.id, { direction: d })}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{
                              background: active ? "var(--foreground)" : "var(--background)",
                              color: active ? "var(--background)" : "var(--foreground)",
                              border: "1px solid var(--border)",
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                            title={d === "vertical" ? "Slice into vertical columns (left → right)" : "Slice into horizontal rows (top → bottom)"}
                          >
                            {d === "vertical" ? "↔ Cols" : "↕ Rows"}
                          </button>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      <span>Pieces</span>
                      <input
                        type="number"
                        min={2}
                        max={10}
                        step={1}
                        value={cfg.count}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (!isNaN(n)) setSplitCfg(z.id, { count: Math.max(2, Math.min(10, n)) });
                        }}
                        className="w-12 text-center text-xs p-1 rounded"
                        style={{
                          background: "var(--background)",
                          border: "1px solid var(--border)",
                          color: "var(--foreground)",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      />
                    </label>
                    <div className="flex-1" />
                    <button
                      type="button"
                      className="sa-btn sa-btn-primary text-[10px] px-3 py-1"
                      onClick={() => {
                        onSplitZone(z.id, cfg.direction, cfg.count);
                        setSplitConfig((prev) => {
                          const { [z.id]: _drop, ...rest } = prev;
                          return rest;
                        });
                      }}
                      title={`Replace this zone with ${cfg.count} ${cfg.direction === "vertical" ? "side-by-side columns" : "stacked rows"}`}
                    >
                      Split into {cfg.count}
                    </button>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* Suggested presets shared by both inputs (existing zones + new zone form) */}
      <datalist id="zone-program-suggestions">
        <option value="Light rail platform — waiting for train" />
        <option value="Bus stop — waiting" />
        <option value="Hospital waiting room" />
        <option value="Open-plan office desk" />
        <option value="Coffee shop — seated" />
        <option value="Library reading area" />
        <option value="Retail aisle — browsing" />
        <option value="Classroom — lecture" />
        <option value="Park / public seating" />
        <option value="Residential living room" />
      </datalist>

      {/* Add New Zone */}
      <div className="p-3 rounded-lg" style={{ background: "var(--background)", border: "1px dashed var(--border)" }}>
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--muted-foreground)" }}>
          ADD NEW ZONE
        </div>

        <div className="grid grid-cols-5 gap-2 mb-3">
          <div className="col-span-1">
            <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Zone A"
              className="w-full text-xs p-1.5 rounded"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
            />
          </div>
          {(["x", "y", "width", "height"] as const).map((k) => (
            <div key={k}>
              <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
                {k === "x" ? "X (mm)" : k === "y" ? "Y (mm)" : k === "width" ? "W (mm)" : "H (mm)"}
              </label>
              <input
                type="number"
                value={newBounds[k]}
                onChange={(e) => setNewBounds({ ...newBounds, [k]: e.target.value })}
                className="w-full text-xs p-1.5 rounded"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-2 mb-3">
          {envFields.map((f) => (
            <div key={f.key}>
              <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
                {f.label} ({f.unit})
              </label>
              <input
                type="number"
                value={newEnv[f.key]}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) setNewEnv({ ...newEnv, [f.key]: val });
                }}
                className="w-full text-xs p-1.5 rounded"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
                min={f.min}
                max={f.max}
                step={f.step}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-2 mb-3">
          <div className="col-span-2">
            <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
              Ceiling (mm)
            </label>
            <input
              type="number"
              value={newEnv.ceiling_height}
              disabled={newEnv.open_space}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) setNewEnv({ ...newEnv, ceiling_height: val });
              }}
              className="w-full text-xs p-1.5 rounded"
              style={{
                background: newEnv.open_space ? "var(--muted)" : "var(--card)",
                border: "1px solid var(--border)",
                color: newEnv.open_space ? "var(--muted-foreground)" : "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
                opacity: newEnv.open_space ? 0.5 : 1,
              }}
              min={0}
              max={20000}
              step={100}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
              Influence (mm)
            </label>
            <input
              type="number"
              value={newInfluence}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) setNewInfluence(val);
              }}
              className="w-full text-xs p-1.5 rounded"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              min={0}
              max={50000}
              step={500}
              title="How far this zone's env values bleed beyond its perimeter (mm). 0 = hard edge. Try 5000–15000 for noise/heat sources like roads or sun-baked surfaces."
            />
          </div>
          <div className="col-span-1">
            <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
              Open
            </label>
            <label className="flex items-center justify-center gap-1 text-xs p-1.5 rounded cursor-pointer"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
              title={newEnv.open_space ? "OPEN — no overhead enclosure" : "ENCLOSED — ceiling above"}
            >
              <input
                type="checkbox"
                checked={newEnv.open_space}
                onChange={(e) => setNewEnv({ ...newEnv, open_space: e.target.checked })}
              />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                {newEnv.open_space ? "OPEN" : "ENCL"}
              </span>
            </label>
          </div>
        </div>

        <div className="mb-3">
          <label className="text-[10px] block mb-1" style={{ color: "var(--muted-foreground)" }}>
            Program / Activity (optional)
          </label>
          <input
            type="text"
            value={newProgram}
            list="zone-program-suggestions"
            placeholder="e.g. Light rail platform — waiting for train"
            maxLength={120}
            onChange={(e) => setNewProgram(e.target.value)}
            className="w-full text-xs p-1.5 rounded"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
            title="Free text — what is this space for, and what is the agent doing here?"
          />
        </div>

        <button className="sa-btn sa-btn-primary w-full text-xs py-2" onClick={handleAddZone}>
          + Add Zone
        </button>
      </div>
    </div>
  );
}

// ---- Main Component ----
export default function CoordinateInput({
  onAddShape,
  onClearAll,
  zones = [],
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onSplitZone,
}: {
  onAddShape: (shape: Shape) => void;
  onClearAll: () => void;
  zones?: Zone[];
  onAddZone?: (zone: Zone) => void;
  onUpdateZone?: (id: string, updates: Partial<Zone>) => void;
  onRemoveZone?: (id: string) => void;
  onSplitZone?: (id: string, direction: "horizontal" | "vertical", count: number) => void;
}) {
  const [text, setText] = useState("");
  const [shapeType, setShapeType] = useState<"site" | "wall" | "column" | "door" | "window" | "green" | "special">("site");
  const [label, setLabel] = useState("");
  const [activeSection, setActiveSection] = useState<"shapes" | "zones">("shapes");

  const handleAdd = () => {
    const points = parseCoordinates(text);
    if (points.length < 2) {
      toast.error("Need at least 2 points");
      return;
    }
    onAddShape({ type: shapeType, points, label: label || undefined });
    setText("");
    setLabel("");
    toast.success("Shape added to map");
  };

  return (
    <div className="space-y-4">
      {/* Section Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          className="sa-btn text-xs"
          style={{
            background: activeSection === "shapes" ? "var(--primary)" : "var(--card)",
            color: activeSection === "shapes" ? "#fff" : "var(--foreground)",
          }}
          onClick={() => setActiveSection("shapes")}
        >
          Shapes / Coordinates
        </button>
        <button
          className="sa-btn text-xs"
          style={{
            background: activeSection === "zones" ? "var(--primary)" : "var(--card)",
            color: activeSection === "zones" ? "#fff" : "var(--foreground)",
          }}
          onClick={() => setActiveSection("zones")}
        >
          Zone Environment
        </button>
      </div>

      {/* Shapes Section */}
      {activeSection === "shapes" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider" style={{ color: "var(--muted-foreground)" }}>
              RHINO/GH COORDINATE DATA
            </span>
            <div className="flex gap-2">
              <button className="sa-btn text-xs" onClick={() => setText(BOUNDARY_EXAMPLE)}>
                BOUNDARY EXAMPLE
              </button>
              <button className="sa-btn text-xs" onClick={() => setText(WINDOW_EXAMPLE)}>
                WINDOW EXAMPLE
              </button>
            </div>
          </div>

          <div className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)", letterSpacing: "0.5px" }}>
            FORMAT: INDEX. {"{X, Y}"} — ONE POINT PER LINE — LAST POINT CONNECTS BACK TO FIRST (BOUNDARY)
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Paste Rhino/GH coordinates...\n0. {5000, 0}\n1. {5000, 5000}\n2. {0, 5000}\n3. {0, 0}\n\nPoints connect in order. Boundaries close automatically.`}
            className="w-full h-32 text-sm p-3 resize-none rounded-lg"
            style={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              fontFamily: "'JetBrains Mono', monospace",
              boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04)",
            }}
          />

          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>SHAPE TYPE</span>
            {((["site", "wall", "column", "door", "window", "green", "special"] as const)).map((t) => (
              <button
                key={t}
                className="sa-btn text-xs"
                style={{
                  background: shapeType === t ? "var(--primary)" : "var(--card)",
                  color: shapeType === t ? "#fff" : "var(--foreground)",
                }}
                onClick={() => setShapeType(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>LABEL (OPTIONAL)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Room A"
              className="text-sm px-3 py-1.5 flex-1 rounded-lg"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>

          <div className="flex gap-3">
            <button className="sa-btn sa-btn-primary flex-1 text-xs" onClick={handleAdd}>
              + ADD SHAPE
            </button>
            <button
              className="sa-btn text-xs"
              style={{ background: "#D94F4F20", color: "#D94F4F", borderColor: "#D94F4F40" }}
              onClick={onClearAll}
            >
              CLEAR ALL
            </button>
          </div>
        </div>
      )}

      {/* Zones Section */}
      {activeSection === "zones" && onAddZone && onUpdateZone && onRemoveZone && (
        <ZoneEditor
          zones={zones}
          onAddZone={onAddZone}
          onUpdateZone={onUpdateZone}
          onRemoveZone={onRemoveZone}
          onSplitZone={onSplitZone}
        />
      )}
    </div>
  );
}
