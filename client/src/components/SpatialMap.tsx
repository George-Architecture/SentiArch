// ============================================================
// SpatialMap Component - Multi-Agent 2D Canvas
// World coordinate system with pan + zoom (zoom to cursor)
// Toolbar for placing walls, windows, doors, zones, waypoints
// Object selection, drag-move, Ctrl+Z undo
// Window/Door snap-to-wall
// Agent route animation with path trails
// Clean neumorphism UI with circle agents
// ============================================================

import { useRef, useCallback, useEffect, useState } from "react";
import type { Shape, ShapeType, AgentPosition, Zone, Waypoint, HeatmapPoint } from "@/lib/store";
import { getPersonaColor, defaultZoneEnv, isPointInBoundary, isShapeInsideSite, buildThickRect } from "@/lib/store";
import { toast } from "sonner";

// ---- Types ----
type ToolMode = "select" | "site" | "wall" | "column" | "door" | "window" | "green" | "special" | "zone" | "zone_poly" | "zone_split" | "zone_cut_path" | "waypoint";

// Wall + door thickness options (mm). Columns use width/depth set via dialog.
type WallThickness = 100 | 300;
// (DOOR_THICKNESS removed — doors and windows now share the wallThickness
//  toggle so users can pick 100mm or 300mm for any opening.)

// ---- Undo action types ----
interface UndoAction {
  type: "add_shape" | "add_zone" | "add_waypoint" | "move_shape" | "delete_shape" | "place_agent" | "remove_agent";
  payload: any;
}

// ---- World / Screen Transform ----
interface Camera {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

const MIN_ZOOM = 0.005;
const MAX_ZOOM = 2;
const INITIAL_ZOOM = 0.03;
const GRID_LEVELS = [500, 1000, 2000, 5000, 10000];
const SNAP_GRID = 100; // mm snap
const WALL_SNAP_DIST = 500; // mm — max distance to snap window/door to wall
const DOOR_LENGTH_MM = 850; // standard interior-door clear width; fixed at creation
const ENDPOINT_HANDLE_PX = 8; // half-size of the square handle drawn at wall/window endpoints
const ENDPOINT_HIT_TOL_PX = 10; // tolerance for hit-testing those handles

function getGridStep(zoom: number): number {
  for (const step of GRID_LEVELS) {
    const px = step * zoom;
    if (px >= 40 && px <= 200) return step;
  }
  return zoom > 0.1 ? 500 : 5000;
}

function worldToScreen(wx: number, wy: number, cam: Camera): [number, number] {
  return [
    (wx - cam.offsetX) * cam.zoom,
    (cam.offsetY - wy) * cam.zoom,
  ];
}

function screenToWorld(sx: number, sy: number, cam: Camera): [number, number] {
  return [
    sx / cam.zoom + cam.offsetX,
    cam.offsetY - sy / cam.zoom,
  ];
}

// Snap point to 0/45/90 degree angles from a reference point (for Shift key)
function snapToAngle(fromX: number, fromY: number, toX: number, toY: number): [number, number] {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Snap to nearest 45-degree multiple
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return [
    Math.round(fromX + Math.cos(snappedAngle) * dist),
    Math.round(fromY + Math.sin(snappedAngle) * dist),
  ];
}

function snapToGrid(v: number): number {
  return Math.round(v / SNAP_GRID) * SNAP_GRID;
}

/**
 * Force the second endpoint of a 2-point shape to be axis-aligned with
 * the first — picks horizontal vs vertical based on which delta is
 * larger. Used by wall and window drawing so every wall/window in the
 * scene is either purely horizontal or purely vertical (no diagonals).
 * Call AFTER any opportunistic wall-snap so the snap point itself is
 * also axis-aligned to the first click.
 */
function axisAlignTo(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx >= dy ? [bx, ay] : [ax, by];
}

/** Return the two world-coord centerline endpoints of a wall or window.
 *  Both shapes now use 4-corner rectangles with the user-clicked centerline
 *  stored in `meta.centerline`. Doors are intentionally fixed-length and
 *  excluded from resize. Returns null for any shape lacking a centerline. */
function getResizeEndpoints(shape: Shape): [[number, number], [number, number]] | null {
  if (shape.type === "wall" || shape.type === "window") {
    const cl = shape.meta?.centerline;
    if (cl && cl.length === 2) return [cl[0], cl[1]];
    // Legacy fallback: 2-point windows that haven't been migrated yet.
    if (shape.type === "window" && shape.points.length === 2) {
      return [shape.points[0], shape.points[1]];
    }
  }
  return null;
}

// ---- Geometry helpers ----
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
}

function projectOntoSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): [number, number] {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [x1, y1];
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return [x1 + t * dx, y1 + t * dy];
}

/** Snap candidate types — what edges does this snap consider? */
type SnapTargetType = "wall" | "column" | "site";

/**
 * Find the nearest snap point on a wall / column / site edge to (px,py).
 * Used by the wall / door / window drawing tools so users only need to click
 * roughly near a target — the click locks onto the exact edge.
 *
 * targetTypes filters which shape types qualify as snap targets.
 *  - wall tool:   snap to wall, column, site edges
 *  - door tool:   snap to wall edges only (doors are inserted into walls)
 *  - window tool: snap to wall + column edges (windows must terminate on these)
 */
function findNearestWallSnap(
  px: number, py: number, shapes: Shape[],
  targetTypes: SnapTargetType[] = ["wall", "column", "site"],
): { point: [number, number]; dist: number; wallIdx: number; segIdx: number; targetType: ShapeType } | null {
  let best: { point: [number, number]; dist: number; wallIdx: number; segIdx: number; targetType: ShapeType } | null = null;

  shapes.forEach((shape, shapeIdx) => {
    if (!targetTypes.includes(shape.type as SnapTargetType)) return;
    const pts = shape.points;
    const len = pts.length;
    if (len < 2) return;
    for (let i = 0; i < len; i++) {
      const j = (i + 1) % pts.length;
      // Window-style 2-pt lines have no closing edge
      if (len === 2 && i === 1) break;
      const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      if (!best || d < best.dist) {
        const proj = projectOntoSegment(px, py, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
        best = { point: [proj[0], proj[1]], dist: d, wallIdx: shapeIdx, segIdx: i, targetType: shape.type };
      }
    }
  });

  return best;
}

/**
 * Snap target finder for the cut tools. Tests every polygon edge of every
 * zone (using its `points` array if present, or the rectangle bounds) plus
 * every site / wall / column shape, and returns the closest projection
 * onto any edge. Lets a casual click "near a wall" land exactly on the
 * boundary so the cut endpoint sits on the zone perimeter and the line
 * is guaranteed to enter the zone interior.
 *
 * Returns null when nothing is in range; the caller compares `dist`
 * against the current zoom-derived snap radius to decide whether to use
 * the snap point.
 */
function findNearestCutSnap(
  px: number, py: number, zones: Zone[], shapes: Shape[],
): { point: [number, number]; dist: number; sourceLabel: string } | null {
  let best: { point: [number, number]; dist: number; sourceLabel: string } | null = null;

  const considerSegment = (
    ax: number, ay: number, bx: number, by: number, label: string,
  ) => {
    const d = distToSegment(px, py, ax, ay, bx, by);
    if (!best || d < best.dist) {
      const proj = projectOntoSegment(px, py, ax, ay, bx, by);
      best = { point: [proj[0], proj[1]], dist: d, sourceLabel: label };
    }
  };

  // Zone polygon edges (the most important targets — these ARE the cuttable zones).
  for (const z of zones) {
    const pts = z.bounds.points && z.bounds.points.length >= 3
      ? z.bounds.points
      : ([
          [z.bounds.x, z.bounds.y],
          [z.bounds.x + z.bounds.width, z.bounds.y],
          [z.bounds.x + z.bounds.width, z.bounds.y + z.bounds.height],
          [z.bounds.x, z.bounds.y + z.bounds.height],
        ] as [number, number][]);
    const label = z.label || z.id;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      considerSegment(pts[i][0], pts[i][1], pts[j][0], pts[j][1], label);
    }
  }

  // Site / wall / column edges — useful when a cut should align with a
  // physical partition that doesn't yet have its own zone outline.
  for (const shape of shapes) {
    if (shape.type !== "site" && shape.type !== "wall" && shape.type !== "column") continue;
    const pts = shape.points;
    const len = pts.length;
    if (len < 2) continue;
    for (let i = 0; i < len; i++) {
      const j = (i + 1) % len;
      if (len === 2 && i === 1) break;
      considerSegment(pts[i][0], pts[i][1], pts[j][0], pts[j][1], shape.type);
    }
  }

  return best;
}

/**
 * Build a wall / door rectangle from a clicked face line A→B + thickness.
 * The click line A→B is one FACE of the wall (NOT the centreline) — thickness
 * extends perpendicular to A→B. `side` selects which perpendicular:
 *   "left"  = 90° CCW of A→B (world coords, Y-up)
 *   "right" = 90° CW
 * Adjacent walls can meet flush at corners because click points sit on the edge.
 */
// buildThickRect lives in @/lib/store now (shared with the migration logic).

/** Pick the side ("left" or "right" of A→B) for which the resulting wall
 *  rectangle's far-side corners lie inside any site polygon. Used so users
 *  can draw walls in either direction along a site edge — the wall thickness
 *  always extends INWARD into the site automatically.
 *
 *  Returns null if the user has no sites yet (containment doesn't apply),
 *  "left" if the left side is preferred, "right" if right is preferred,
 *  or "none" if neither side fits inside (caller should error).
 */
function pickThicknessSide(
  ax: number, ay: number, bx: number, by: number, thickness: number,
  shapes: Shape[],
): "left" | "right" | "none" | null {
  const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
  if (sites.length === 0) return null; // no constraint
  const leftRect = buildThickRect(ax, ay, bx, by, thickness, "left");
  const rightRect = buildThickRect(ax, ay, bx, by, thickness, "right");
  const leftFits = isShapeInsideSite(leftRect, shapes);
  const rightFits = isShapeInsideSite(rightRect, shapes);
  if (leftFits && rightFits) return "left";  // both fit — default to left
  if (leftFits) return "left";
  if (rightFits) return "right";
  return "none";
}

/**
 * Build a column rectangle (axis-aligned) centred at (cx,cy) with the given
 * width (X-axis) and depth (Y-axis). Returns 4 CCW corners.
 */
function buildColumnRect(
  cx: number, cy: number, width: number, depth: number
): [number, number][] {
  const hw = width / 2, hd = depth / 2;
  return [
    [Math.round(cx - hw), Math.round(cy - hd)],
    [Math.round(cx + hw), Math.round(cy - hd)],
    [Math.round(cx + hw), Math.round(cy + hd)],
    [Math.round(cx - hw), Math.round(cy + hd)],
  ];
}

// ---- Shape styles ----
// site = drawable site area perimeter (light dashed outline)
// wall + column = solid fills with the SAME colour and NO individual stroke,
//                 so touching / overlapping rectangles visually fuse into one
//                 continuous mass. (Matches user request: "wall column 接觸會融合".)
// door = warm brown opening (no fill stroke seam either)
// window = single blue line
const WALL_FILL_COLOR = "#3C3228";
const SHAPE_STYLES: Record<string, { fill: string; stroke: string; label: string; lineWidth: number; dash: number[] }> = {
  site:   { fill: "rgba(184, 176, 160, 0.20)", stroke: "#1D6B5E",       label: "Site",   lineWidth: 1.5, dash: [10, 5] },
  wall:   { fill: WALL_FILL_COLOR,             stroke: WALL_FILL_COLOR, label: "Wall",   lineWidth: 0,   dash: [] },
  column: { fill: WALL_FILL_COLOR,             stroke: WALL_FILL_COLOR, label: "Column", lineWidth: 0,   dash: [] },
  door:   { fill: "rgba(245, 220, 190, 0.95)", stroke: "#B47846",       label: "Door",   lineWidth: 2,   dash: [] },
  window: { fill: "rgba(59, 130, 246, 0.30)",  stroke: "#3B82F6",       label: "Window", lineWidth: 1.5, dash: [] },
  green:  { fill: "rgba(125, 176, 96, 0.32)",  stroke: "#5C8E4A",       label: "Green",  lineWidth: 1,   dash: [] },
  special:{ fill: "rgba(168, 85, 247, 0.15)",  stroke: "#A855F7",       label: "Special",lineWidth: 1.5, dash: [6, 4] },
};

// ---- Tool definitions ----
const TOOLS: { mode: ToolMode; label: string; icon: string; hint: string }[] = [
  { mode: "select",   label: "Select",   icon: "↖", hint: "Click to place agent · Click shape to select · Drag to move" },
  { mode: "site",     label: "Site",     icon: "▢", hint: "Click points to define the site area (drawable region) · double-click or click first point to close" },
  { mode: "wall",     label: "Wall",     icon: "▮", hint: "Click 2 points to draw a wall · constrained to horizontal / vertical only · auto-snaps to nearby walls / columns / site edges (within 500mm)" },
  { mode: "column",   label: "Column",   icon: "■", hint: "Set X×Y dimensions, then click to place column" },
  { mode: "door",     label: "Door",     icon: "◫", hint: "Click 2 points on a wall to place an 850mm door (current wallThickness 100/300mm) · horizontal / vertical only · second click sets direction · the wall section under it becomes a passable opening" },
  { mode: "window",   label: "Window",   icon: "▭", hint: "Click 2 endpoints on a wall — drawn as a glass block at current wallThickness (100/300mm) · horizontal / vertical only · the wall section under it becomes transparent for LOS but still blocks movement" },
  { mode: "green",    label: "Green",    icon: "❀", hint: "Mark a planted / softscape area inside the site (does not block agents or LOS)" },
  { mode: "special",  label: "Special",  icon: "✦", hint: "Click 2 corners — off-site environmental factor (can be drawn outside the site, does not block agents or LOS)" },
  { mode: "zone",     label: "Zone",     icon: "▭", hint: "Click 2 corners to define zone rectangle" },
  { mode: "zone_poly",label: "Zone Poly",icon: "▦", hint: "Click points to draw zone polygon, double-click to close" },
  { mode: "zone_split",label: "Zone Split",icon: "✂", hint: "Click 2 points to draw a cutting line — splits the zone whose interior the cut passes through into two pieces along that line (any angle)" },
  { mode: "zone_cut_path",label: "Cut Path",icon: "⌒", hint: "Click multiple points to draw a multi-segment cutting path; double-click to commit. The path acts as a knife slicing the underlying zone along its full length (handles concave / auto-zones)" },
  { mode: "waypoint", label: "Waypoint", icon: "◉", hint: "Click to place waypoint for active agent's route" },
];

// ---- Hit testing for shape selection ----
const HIT_THRESHOLD = 12; // pixels

function hitTestShape(
  sx: number, sy: number, shape: Shape, cam: Camera
): boolean {
  const pts = shape.points;
  if (pts.length < 2) return false;

  // Test distance to each segment
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = worldToScreen(pts[i][0], pts[i][1], cam);
    const [bx, by] = worldToScreen(pts[i + 1][0], pts[i + 1][1], cam);
    const d = distToSegmentScreen(sx, sy, ax, ay, bx, by);
    if (d < HIT_THRESHOLD) return true;
  }
  // For closed polygons (site, wall, column, door), test closing segment too.
  // Window is a 2-point line — no closing edge.
  if (shape.type !== "window" && pts.length >= 3) {
    const [ax, ay] = worldToScreen(pts[pts.length - 1][0], pts[pts.length - 1][1], cam);
    const [bx, by] = worldToScreen(pts[0][0], pts[0][1], cam);
    const d = distToSegmentScreen(sx, sy, ax, ay, bx, by);
    if (d < HIT_THRESHOLD) return true;
  }
  return false;
}

function distToSegmentScreen(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
}

// ---- Draw circle agent ----
function drawAgent(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  index: number,
  isActive: boolean,
  zoom: number,
  label?: string,
) {
  const color = getPersonaColor(index);
  const r = Math.max(6, Math.min(14, 10 / (zoom * 50)));

  if (isActive) {
    ctx.beginPath();
    ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = `${color.primary}18`;
    ctx.fill();
    ctx.strokeStyle = color.primary;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color.primary;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sx - r * 0.25, sy - r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.strokeStyle = isActive ? "#FFFFFF" : "rgba(255,255,255,0.5)";
  ctx.lineWidth = isActive ? 2 : 1;
  ctx.stroke();

  ctx.font = `600 ${Math.max(10, r)}px 'Inter', sans-serif`;
  ctx.fillStyle = color.primary;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(label && label.trim() ? label.trim() : `P${index + 1}`, sx, sy + r + 4);
  ctx.textBaseline = "alphabetic";
}

// ---- Animated agent (smaller, pulsing) ----
function drawAnimatedAgent(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  index: number,
  zoom: number,
  pulse: number,
  label?: string,
) {
  const color = getPersonaColor(index);
  const r = Math.max(5, Math.min(12, 8 / (zoom * 50)));
  const pulseR = r + 3 * Math.sin(pulse * Math.PI * 2);

  ctx.beginPath();
  ctx.arc(sx, sy, pulseR + 4, 0, Math.PI * 2);
  ctx.fillStyle = `${color.primary}10`;
  ctx.fill();
  ctx.strokeStyle = `${color.primary}40`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color.primary;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `600 ${Math.max(9, r - 1)}px 'Inter', sans-serif`;
  ctx.fillStyle = color.primary;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(label && label.trim() ? label.trim() : `P${index + 1}`, sx, sy + r + 3);
  ctx.textBaseline = "alphabetic";
}

export default function SpatialMap({
  shapes,
  zones = [],
  agentPositions,
  agentLabels = [],
  activeAgentIdx,
  onAgentPlace,
  onAgentRemove,
  onAddShape,
  onAddZone,
  onSplitZoneByLine,
  onSplitZoneByPolyline,
  onUpdateShapes,
  onDeleteShape,
  onImportLayout,
  // Waypoint props
  allWaypoints = {},
  onAddWaypoint,
  onRemoveWaypoint,
  // Animation props
  animatingAgents = {},
  pathTrails = {},
  // Heatmap props
  heatmapPoints = [],
  showHeatmap = false,
}: {
  shapes: Shape[];
  zones?: Zone[];
  agentPositions: (AgentPosition | null)[];
  /** Per-agent display label for the canvas (e.g. agent.name). Falls back to "Pn" when missing. */
  agentLabels?: (string | undefined)[];
  activeAgentIdx: number;
  onAgentPlace: (pos: AgentPosition) => void;
  onAgentRemove?: (idx: number) => void;
  onAddShape?: (shape: Shape) => void;
  onAddZone?: (zone: Zone) => void;
  /** Slice the zone whose interior contains the cut line's midpoint along
   *  the directed line p1→p2. Implementation lives in Legacy.tsx. */
  onSplitZoneByLine?: (p1: [number, number], p2: [number, number]) => void;
  /** Slice the zone the polyline passes through along the entire poly-
   *  line path. The polyline is treated as a "knife"; endpoints are
   *  extended past the polygon by Legacy.tsx so endpoints inside the
   *  zone still produce a clean split. */
  onSplitZoneByPolyline?: (polyline: [number, number][]) => void;
  onUpdateShapes?: (shapes: Shape[]) => void;
  onDeleteShape?: (idx: number) => void;
  /** Bulk-replace the current canvas's layout from a JSON file (Rhino → GH
   *  pipeline, or a previously exported SentiArch layout). Schema is identical
   *  to handleExportLayout's output. */
  onImportLayout?: (layout: {
    shapes: Shape[];
    zones?: Zone[];
    agentPositions?: (AgentPosition | null)[];
    waypoints?: Record<number, Waypoint[]>;
  }) => void;
  // Waypoint props
  allWaypoints?: Record<number, Waypoint[]>;
  onAddWaypoint?: (agentIdx: number, wp: Waypoint) => void;
  onRemoveWaypoint?: (agentIdx: number, wpId: string) => void;
  // Animation props
  animatingAgents?: Record<number, AgentPosition>;
  pathTrails?: Record<number, AgentPosition[]>;
  // Heatmap props
  heatmapPoints?: HeatmapPoint[];
  showHeatmap?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(700);
  const [canvasH, setCanvasH] = useState(500);

  // Camera state
  const camRef = useRef<Camera>({
    offsetX: -1000,
    offsetY: 21000,
    zoom: INITIAL_ZOOM,
  });
  const [cam, setCam] = useState<Camera>({ ...camRef.current });

  // Tool state
  const [activeTool, setActiveTool] = useState<ToolMode>("select");
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);

  // Selection state
  const [selectedShapeIdx, setSelectedShapeIdx] = useState<number | null>(null);

  // Drag-move state
  const isDraggingShape = useRef(false);
  const dragShapeIdx = useRef<number | null>(null);
  const dragStartWorld = useRef<[number, number]>([0, 0]);
  const dragOriginalPoints = useRef<[number, number][]>([]);

  // Endpoint resize state — drags one end of a wall or window centerline,
  // keeping the other end pinned, while preserving axis-aligned orientation.
  // Doors are intentionally NOT resizable (length fixed at 850mm).
  const isResizingEndpoint = useRef<boolean>(false);
  const resizeShapeIdx = useRef<number | null>(null);
  const resizeEndpointIdx = useRef<0 | 1 | null>(null);
  const resizeOriginalShape = useRef<Shape | null>(null);

  // Undo stack
  const undoStack = useRef<UndoAction[]>([]);
  const MAX_UNDO = 50;

  // Wall snap preview (for wall/door/window tools)
  const [wallSnapPreview, setWallSnapPreview] = useState<{ point: [number, number]; wallIdx: number; targetType: ShapeType } | null>(null);
  // Cut snap preview — populated only while zone_split / zone_cut_path is
  // active and the cursor is within snap range of any zone edge / site /
  // wall. The recorded `point` is what gets used when the user clicks, so
  // a cut endpoint lands EXACTLY on the boundary instead of needing
  // pixel-perfect aim.
  const [cutSnapPreview, setCutSnapPreview] = useState<{ point: [number, number]; sourceLabel: string } | null>(null);

  // Copy / paste clipboard (in-component, not OS clipboard).
  // Held in a ref so Ctrl+V handlers don't need to be re-bound when contents change.
  const copiedShapeRef = useRef<Shape | null>(null);
  const PASTE_OFFSET_MM = 500; // each paste shifts the copy +500 mm in x & y

  // ---- Drawing options ----
  // Wall thickness (mm) toggle — only 100 or 300 allowed.
  const [wallThickness, setWallThickness] = useState<WallThickness>(300);
  // Column dimensions (mm) — set by user via popover before placing.
  const [columnWidth, setColumnWidth] = useState<number>(500);
  const [columnDepth, setColumnDepth] = useState<number>(500);
  // Whether the next site polygon should auto-include perimeter walls.
  const [siteHasWalls, setSiteHasWalls] = useState<boolean>(true);
  // Site drawing mode: free-form polygon (click points + close) or
  // 2-corner rectangle. Shared with the Green tool (same modes).
  const [siteShapeMode, setSiteShapeMode] = useState<"polygon" | "rectangle">("polygon");
  // Wall/Door thickness side flip: persistent toggle (single Shift press
  // toggles, or click the toolbar Flip button). When true, the auto-picked
  // side is reversed. Stays on until toggled again.
  const [wallFlipSide, setWallFlipSide] = useState<boolean>(false);

  // Interaction state
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const [hoverWorld, setHoverWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoveredAgentIdx, setHoveredAgentIdx] = useState<number | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  // Shift key tracking — `shiftHeld` is the live held-down state. For wall /
  // door tools we ALSO toggle `wallFlipSide` on each Shift keydown press
  // (single-press toggle, not hold), so users can flip the thickness side
  // without keeping Shift held while clicking.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      if (e.repeat) return; // ignore key auto-repeat
      setShiftHeld(true);
      if (activeTool === "wall" || activeTool === "door") {
        setWallFlipSide((v) => !v);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [activeTool]);

  // Animation pulse
  const [animPulse, setAnimPulse] = useState(0);
  const [showZoneLabels, setShowZoneLabels] = useState(true);
  const hasAnimating = Object.keys(animatingAgents).length > 0;

  useEffect(() => {
    if (!hasAnimating) return;
    let frame: number;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - start) / 1000;
      setAnimPulse(elapsed % 1);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [hasAnimating]);

  // ---- Push undo ----
  const pushUndo = useCallback((action: UndoAction) => {
    undoStack.current.push(action);
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.shift();
    }
  }, []);

  // ---- Undo handler ----
  const handleUndo = useCallback(() => {
    const action = undoStack.current.pop();
    if (!action) return;

    switch (action.type) {
      case "add_shape":
        // Remove the last added shape
        if (onDeleteShape) {
          onDeleteShape(action.payload.index);
        }
        break;
      case "move_shape":
        // Restore original points (and meta when the action was an
        // endpoint resize that also rewrote centerline / side).
        if (onUpdateShapes) {
          const restored = [...shapes];
          restored[action.payload.index] = {
            ...restored[action.payload.index],
            points: action.payload.originalPoints,
            ...(action.payload.originalMeta !== undefined
              ? { meta: action.payload.originalMeta }
              : {}),
          };
          onUpdateShapes(restored);
        }
        break;
      case "delete_shape":
        // Re-add the deleted shape
        if (onAddShape) {
          onAddShape(action.payload.shape);
        }
        break;
      default:
        break;
    }
    toast.info("Undo");
  }, [shapes, onDeleteShape, onUpdateShapes, onAddShape]);

  // ---- Resize observer ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.max(400, Math.min(700, Math.floor(w * 0.7)));
        setCanvasW(w);
        setCanvasH(h);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ---- Fit to content ----
  const fitToContent = useCallback(() => {
    const allPoints: [number, number][] = [];
    for (const s of shapes) {
      for (const p of s.points) allPoints.push(p);
    }
    for (const z of zones) {
      allPoints.push([z.bounds.x, z.bounds.y]);
      allPoints.push([z.bounds.x + z.bounds.width, z.bounds.y + z.bounds.height]);
    }
    for (const wps of Object.values(allWaypoints)) {
      for (const wp of wps) {
        allPoints.push([wp.position.x, wp.position.y]);
      }
    }

    let minX = 0, minY = 0, maxX = 20000, maxY = 20000;
    if (allPoints.length > 0) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const [px, py] of allPoints) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const padX = (maxX - minX) * 0.15 || 2000;
      const padY = (maxY - minY) * 0.15 || 2000;
      minX -= padX; minY -= padY; maxX += padX; maxY += padY;
    }
    const rangeX = maxX - minX || 20000;
    const rangeY = maxY - minY || 20000;
    const zoom = Math.min(canvasW / rangeX, canvasH / rangeY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const newCam: Camera = {
      offsetX: cx - canvasW / (2 * zoom),
      offsetY: cy + canvasH / (2 * zoom),
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
    };
    camRef.current = newCam;
    setCam({ ...newCam });
  }, [shapes, zones, allWaypoints, canvasW, canvasH]);

  // Auto fit-to-content removed — only triggered by manual Fit View button click.

  // ---- Import Layout from JSON file (Rhino → GH pipeline, or prior export) ----
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportLayoutFile = useCallback(async (file: File) => {
    if (!onImportLayout) {
      toast.error("Import handler not wired");
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.shapes)) {
        toast.error("Not a valid SentiArch layout JSON (missing shapes array)");
        return;
      }
      onImportLayout(data);
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onImportLayout]);

  // ---- Export Layout as JSON ----
  const handleExportLayout = useCallback(() => {
    const layoutData = {
      shapes,
      zones,
      agentPositions,
      waypoints: allWaypoints,
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(layoutData, null, 2);
    // Copy to clipboard
    navigator.clipboard.writeText(json).then(() => {
      toast.success("Layout JSON copied to clipboard!");
    }).catch(() => {
      // Fallback: open in a new window
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rpgarchitecture-layout-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Layout JSON downloaded!");
    });
  }, [shapes, zones, agentPositions, allWaypoints]);

  // Deep-clone a shape and offset every geometric coord by (dx, dy). Used by
  // paste so the duplicate doesn't sit exactly on top of the original. Walls /
  // doors carry a `meta.centerline` that mirrors the polygon corners, so it
  // must be offset in lockstep — otherwise the click-to-edit logic would point
  // at the original location.
  const cloneShapeOffset = useCallback((src: Shape, dx: number, dy: number): Shape => {
    const points = src.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
    const meta = src.meta ? { ...src.meta } : undefined;
    if (meta?.centerline) {
      meta.centerline = [
        [meta.centerline[0][0] + dx, meta.centerline[0][1] + dy],
        [meta.centerline[1][0] + dx, meta.centerline[1][1] + dy],
      ];
    }
    return { ...src, points, ...(meta ? { meta } : {}) };
  }, []);

  const handleCopyShape = useCallback(() => {
    if (selectedShapeIdx === null) return;
    const src = shapes[selectedShapeIdx];
    if (!src) return;
    copiedShapeRef.current = cloneShapeOffset(src, 0, 0); // snapshot
    toast.success(`Copied ${src.label || src.type}`);
  }, [selectedShapeIdx, shapes, cloneShapeOffset]);

  const handlePasteShape = useCallback(() => {
    const src = copiedShapeRef.current;
    if (!src || !onAddShape) {
      toast.error("Nothing to paste — copy a shape first (Ctrl/Cmd+C)");
      return;
    }
    const newShape = cloneShapeOffset(src, PASTE_OFFSET_MM, PASTE_OFFSET_MM);
    onAddShape(newShape);
    pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
    // Advance the clipboard to the new offset so successive pastes "stagger"
    // outward instead of stacking on the same position.
    copiedShapeRef.current = newShape;
    setSelectedShapeIdx(shapes.length);
    toast.success(`Pasted ${newShape.label || newShape.type}`);
  }, [onAddShape, shapes.length, cloneShapeOffset, pushUndo]);

  // ---- Keyboard: Escape to cancel, Ctrl+Z to undo, Delete to remove selected,
  //                Ctrl+C/V to copy & paste a selected shape ----
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawingPoints([]);
        setSelectedShapeIdx(null);
        if (activeTool !== "select") {
          setActiveTool("select");
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
      // Don't hijack copy/paste while the user is typing in a form field.
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && !isTypingTarget(e.target) && selectedShapeIdx !== null) {
        e.preventDefault();
        handleCopyShape();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V") && !isTypingTarget(e.target)) {
        e.preventDefault();
        handlePasteShape();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedShapeIdx !== null) {
        e.preventDefault();
        if (onDeleteShape) {
          pushUndo({ type: "delete_shape", payload: { shape: shapes[selectedShapeIdx], index: selectedShapeIdx } });
          onDeleteShape(selectedShapeIdx);
          setSelectedShapeIdx(null);
          toast.info("Shape deleted");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, handleUndo, selectedShapeIdx, shapes, onDeleteShape, pushUndo, handleCopyShape, handlePasteShape]);

  // ---- Draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const c = camRef.current;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#FAFAF6";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Grid
    const gridStep = getGridStep(c.zoom);
    ctx.strokeStyle = "#E8E3DA";
    ctx.lineWidth = 0.5;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#C0BAB0";
    ctx.textBaseline = "top";

    const worldLeft = c.offsetX;
    const worldRight = c.offsetX + canvasW / c.zoom;
    const worldTop = c.offsetY;
    const worldBottom = c.offsetY - canvasH / c.zoom;
    const startX = Math.floor(worldLeft / gridStep) * gridStep;
    for (let wx = startX; wx <= worldRight; wx += gridStep) {
      const [sx] = worldToScreen(wx, 0, c);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvasH);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(`${(wx / 1000).toFixed(wx % 1000 === 0 ? 0 : 1)}m`, sx + 3, canvasH - 16);
    }
    const startY = Math.floor(worldBottom / gridStep) * gridStep;
    for (let wy = startY; wy <= worldTop; wy += gridStep) {
      const [, sy] = worldToScreen(0, wy, c);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvasW, sy);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(`${(wy / 1000).toFixed(wy % 1000 === 0 ? 0 : 1)}m`, 4, sy + 3);
    }

    // Origin crosshair
    const [ox, oy] = worldToScreen(0, 0, c);
    ctx.strokeStyle = "#D0CBC2";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, canvasH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(canvasW, oy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold 11px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#B0AAA0";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("O", ox + 4, oy - 4);
    ctx.textBaseline = "alphabetic";

    // Draw zones
    zones.forEach((zone) => {
      const b = zone.bounds;
      let zx1, zy1, zw, zh;

      if (b.points && b.points.length >= 3) {
        ctx.beginPath();
        const [p0x, p0y] = worldToScreen(b.points[0][0], b.points[0][1], c);
        ctx.moveTo(p0x, p0y);
        for (let i = 1; i < b.points.length; i++) {
          const [px, py] = worldToScreen(b.points[i][0], b.points[i][1], c);
          ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(29, 107, 94, 0.04)";
        ctx.fill();
        ctx.strokeStyle = "rgba(29, 107, 94, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label position for polygon (centroid-ish)
        zx1 = b.points.reduce((s, p) => s + p[0], 0) / b.points.length;
        zy1 = b.points.reduce((s, p) => s + p[1], 0) / b.points.length;
        const [lsx, lsy] = worldToScreen(zx1, zy1, c);
        zx1 = lsx; zy1 = lsy;
      } else {
        const [x1, y1] = worldToScreen(b.x, b.y + b.height, c);
        const [x2, y2] = worldToScreen(b.x + b.width, b.y, c);
        zx1 = x1; zy1 = y1;
        zw = x2 - x1;
        zh = y2 - y1;

        ctx.fillStyle = "rgba(29, 107, 94, 0.04)";
        ctx.fillRect(zx1, zy1, zw, zh);
        ctx.strokeStyle = "rgba(29, 107, 94, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(zx1, zy1, zw, zh);
        ctx.setLineDash([]);
      }

      if (showZoneLabels) {
        const zlabel = zone.label || zone.id;
        ctx.font = "bold 14px 'Inter', sans-serif";
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(zlabel, zx1, zy1);
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillText(`${zone.env.temperature}°C  ${zone.env.light}lx  ${zone.env.noise}dB`, zx1, zy1 + 18);
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
      }
    });

    // Draw shapes — ordered so site renders first (background), then doors,
    // then walls / columns / windows on top.
    const orderOf = (t: string) =>
      t === "site"   ? 0 :
      t === "green"  ? 1 :   // softscape on top of site, below structure
      t === "door"   ? 2 :
      t === "wall"   ? 3 :
      t === "column" ? 4 :
      t === "window" ? 5 : 6;
    const shapeRenderOrder = shapes
      .map((shape, shapeIdx) => ({ shape, shapeIdx }))
      .sort((a, b) => orderOf(a.shape.type) - orderOf(b.shape.type));

    // First pass — paint all wall + column polygons individually with the
    // SAME fill colour. Painting them separately (instead of combining into
    // one Path2D) avoids winding-rule cancellation when polygons drawn in
    // opposite directions overlap (which would punch holes in the union).
    // Same colour + source-over composite = visual merge with no seams.
    {
      ctx.fillStyle = WALL_FILL_COLOR;
      for (const shape of shapes) {
        if (shape.type !== "wall" && shape.type !== "column") continue;
        if (shape.points.length < 3) continue;
        ctx.beginPath();
        const [fx0, fy0] = worldToScreen(shape.points[0][0], shape.points[0][1], c);
        ctx.moveTo(fx0, fy0);
        for (let i = 1; i < shape.points.length; i++) {
          const [fx, fy] = worldToScreen(shape.points[i][0], shape.points[i][1], c);
          ctx.lineTo(fx, fy);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    shapeRenderOrder.forEach(({ shape, shapeIdx }) => {
      if (shape.points.length < 2) return;
      const style = SHAPE_STYLES[shape.type] || SHAPE_STYLES.site;
      const isSelected = shapeIdx === selectedShapeIdx;
      // 3+ vertices → closed/filled. (Old 2-point line windows still pass
      //  through here as un-closed strokes; new 4-corner windows fill like walls.)
      const isClosed = shape.points.length >= 3;
      // Wall + column are already drawn fused above. Skip their per-shape
      // fill / stroke unless the user has selected one (then show highlight).
      const isFused = (shape.type === "wall" || shape.type === "column");
      if (isFused && !isSelected) return;

      // Path
      ctx.beginPath();
      const [sx0, sy0] = worldToScreen(shape.points[0][0], shape.points[0][1], c);
      ctx.moveTo(sx0, sy0);
      for (let i = 1; i < shape.points.length; i++) {
        const [px, py] = worldToScreen(shape.points[i][0], shape.points[i][1], c);
        ctx.lineTo(px, py);
      }
      if (isClosed) {
        ctx.closePath();
        ctx.fillStyle = isSelected ? "rgba(255, 107, 53, 0.25)" : style.fill;
        ctx.fill();
      }

      // Stroke — only for shapes that need an outline (site, door, window)
      // or for the currently selected shape.
      const wantStroke = isSelected || style.lineWidth > 0;
      if (wantStroke) {
        ctx.strokeStyle = isSelected ? "#FF6B35" : style.stroke;
        ctx.lineWidth = isSelected ? Math.max(style.lineWidth, 1) + 1.5 : style.lineWidth;
        ctx.setLineDash(style.dash);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Door swing arc — visual cue that it's an opening
      if (shape.type === "door" && shape.meta?.centerline) {
        const [[ax, ay], [bx, by]] = shape.meta.centerline;
        const [asx, asy] = worldToScreen(ax, ay, c);
        const [bsx, bsy] = worldToScreen(bx, by, c);
        const len = Math.sqrt((bsx - asx) ** 2 + (bsy - asy) ** 2);
        if (len > 4) {
          ctx.beginPath();
          ctx.arc(asx, asy, len, Math.atan2(bsy - asy, bsx - asx) - Math.PI / 2, Math.atan2(bsy - asy, bsx - asx));
          ctx.strokeStyle = isSelected ? "#FF6B35" : "#B47846";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Selection halo
      if (isSelected) {
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < shape.points.length; i++) {
          const [px, py] = worldToScreen(shape.points[i][0], shape.points[i][1], c);
          ctx.lineTo(px, py);
        }
        if (isClosed) ctx.closePath();
        ctx.strokeStyle = "rgba(255, 107, 53, 0.25)";
        ctx.lineWidth = style.lineWidth + 6;
        ctx.stroke();
      }

      // Vertex dots — only for sites and selected shapes (clutter reduction).
      if (shape.type === "site" || isSelected) {
        shape.points.forEach((pt: [number, number]) => {
          const [vx, vy] = worldToScreen(pt[0], pt[1], c);
          ctx.beginPath();
          ctx.arc(vx, vy, isSelected ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#FF6B35" : style.stroke;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(vx, vy, isSelected ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fillStyle = "#FAFAF6";
          ctx.fill();
        });
      }

      // Special-item label — always rendered so users (and downstream agent
      // analysis) can see what each off-site factor represents. Centered on
      // the polygon's bounding-box centroid.
      if (shape.type === "special" && shape.label) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of shape.points) {
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
        const [cxs, cys] = worldToScreen((minX + maxX) / 2, (minY + maxY) / 2, c);
        ctx.font = "bold 13px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // White halo for legibility on any background
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.strokeText(shape.label, cxs, cys);
        ctx.fillStyle = "#6B21A8";
        ctx.fillText(shape.label, cxs, cys);
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
      }
    });

    // (Old boundary-overlap hatching removed — walls / columns are now their
    //  own first-class solid shapes and don't need overlap-based shading.)

    // ---- Endpoint resize handles for the selected wall / window ----
    // Drawn after the main shape pass so the handle squares sit on top.
    if (selectedShapeIdx !== null && activeTool === "select") {
      const sel = shapes[selectedShapeIdx];
      if (sel) {
        const eps = getResizeEndpoints(sel);
        if (eps) {
          for (const [ex, ey] of eps) {
            const [hx, hy] = worldToScreen(ex, ey, c);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "var(--amber, #e8a04a)";
            // Canvas doesn't resolve CSS variables; use a literal warm accent.
            ctx.strokeStyle = "#e8a04a";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(hx - ENDPOINT_HANDLE_PX, hy - ENDPOINT_HANDLE_PX, ENDPOINT_HANDLE_PX * 2, ENDPOINT_HANDLE_PX * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }

    // ---- Draw wall snap preview (for wall / door / window tools) ----
    if (wallSnapPreview && (activeTool === "wall" || activeTool === "door" || activeTool === "window")) {
      const [spx, spy] = worldToScreen(wallSnapPreview.point[0], wallSnapPreview.point[1], c);
      const target = shapes[wallSnapPreview.wallIdx];
      if (target) {
        ctx.beginPath();
        const [wx0, wy0] = worldToScreen(target.points[0][0], target.points[0][1], c);
        ctx.moveTo(wx0, wy0);
        for (let i = 1; i < target.points.length; i++) {
          const [wpx, wpy] = worldToScreen(target.points[i][0], target.points[i][1], c);
          ctx.lineTo(wpx, wpy);
        }
        if (target.type !== "window") ctx.closePath();
        ctx.strokeStyle = "#FF6B3580";
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Snap point indicator
      ctx.beginPath();
      ctx.arc(spx, spy, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 107, 53, 0.2)";
      ctx.fill();
      ctx.strokeStyle = "#FF6B35";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(spx, spy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#FF6B35";
      ctx.fill();
    }

    // ---- Draw cut snap preview (for zone_split / zone_cut_path tools) ----
    if (cutSnapPreview && (activeTool === "zone_split" || activeTool === "zone_cut_path")) {
      const [spx, spy] = worldToScreen(cutSnapPreview.point[0], cutSnapPreview.point[1], c);
      ctx.beginPath();
      ctx.arc(spx, spy, 9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217, 79, 79, 0.18)";
      ctx.fill();
      ctx.strokeStyle = "#D94F4F";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(spx, spy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#D94F4F";
      ctx.fill();
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(217, 79, 79, 0.85)";
      ctx.textAlign = "left";
      ctx.fillText(`SNAP→${cutSnapPreview.sourceLabel}`, spx + 12, spy - 10);
    }

    // ---- Draw path trails (history) ----
    for (const [idxStr, trail] of Object.entries(pathTrails)) {
      const idx = parseInt(idxStr);
      const color = getPersonaColor(idx);
      if (!trail || trail.length < 2) continue;

      ctx.beginPath();
      const [tx0, ty0] = worldToScreen(trail[0].x, trail[0].y, c);
      ctx.moveTo(tx0, ty0);
      for (let i = 1; i < trail.length; i++) {
        const [tx, ty] = worldToScreen(trail[i].x, trail[i].y, c);
        ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = `${color.primary}60`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- Draw waypoints for all agents ----
    for (const [idxStr, wps] of Object.entries(allWaypoints)) {
      const idx = parseInt(idxStr);
      const color = getPersonaColor(idx);
      if (!wps || wps.length === 0) continue;

      const agentPos = agentPositions[idx];
      const points: AgentPosition[] = [];
      // Only prepend agentPos when it is not coinciding with any waypoint
      // (threshold: 500 mm). After a route run the agent ends up at the last
      // waypoint, which would otherwise create a loop back to that position.
      const WAYPOINT_COINCIDE_THRESHOLD = 500;
      const agentNearWaypoint = agentPos && wps.some(wp => {
        const dx = wp.position.x - agentPos.x;
        const dy = wp.position.y - agentPos.y;
        return Math.sqrt(dx * dx + dy * dy) < WAYPOINT_COINCIDE_THRESHOLD;
      });
      if (agentPos && !agentNearWaypoint) points.push(agentPos);
      wps.forEach(wp => points.push(wp.position));

      if (points.length >= 2) {
        ctx.beginPath();
        const [lx0, ly0] = worldToScreen(points[0].x, points[0].y, c);
        ctx.moveTo(lx0, ly0);
        for (let i = 1; i < points.length; i++) {
          const [lxi, lyi] = worldToScreen(points[i].x, points[i].y, c);
          ctx.lineTo(lxi, lyi);
        }
        ctx.strokeStyle = `${color.primary}50`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        for (let i = 0; i < points.length - 1; i++) {
          const [ax1, ay1] = worldToScreen(points[i].x, points[i].y, c);
          const [ax2, ay2] = worldToScreen(points[i + 1].x, points[i + 1].y, c);
          const mx = (ax1 + ax2) / 2;
          const my = (ay1 + ay2) / 2;
          const angle = Math.atan2(ay2 - ay1, ax2 - ax1);
          const arrowSize = 6;
          ctx.beginPath();
          ctx.moveTo(mx + Math.cos(angle) * arrowSize, my + Math.sin(angle) * arrowSize);
          ctx.lineTo(mx + Math.cos(angle + 2.5) * arrowSize, my + Math.sin(angle + 2.5) * arrowSize);
          ctx.lineTo(mx + Math.cos(angle - 2.5) * arrowSize, my + Math.sin(angle - 2.5) * arrowSize);
          ctx.closePath();
          ctx.fillStyle = `${color.primary}70`;
          ctx.fill();
        }
      }

      wps.forEach((wp, wpIdx) => {
        const [wpx, wpy] = worldToScreen(wp.position.x, wp.position.y, c);

        ctx.beginPath();
        ctx.arc(wpx, wpy, 10, 0, Math.PI * 2);
        ctx.fillStyle = `${color.primary}15`;
        ctx.fill();
        ctx.strokeStyle = `${color.primary}80`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(wpx, wpy, 4, 0, Math.PI * 2);
        ctx.fillStyle = color.primary;
        ctx.fill();

        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.fillStyle = color.primary;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(`${wpIdx + 1}`, wpx, wpy - 12); // Already starting from 1 in original code, confirmed.

        ctx.font = "500 9px 'Inter', sans-serif";
        ctx.fillStyle = `${color.primary}90`;
        ctx.textBaseline = "top";
        ctx.fillText(wp.label, wpx, wpy + 14);
        ctx.textBaseline = "alphabetic";

        if (wp.dwell_minutes > 0) {
          const dwellTxt = `${wp.dwell_minutes}min`;
          const dtw = ctx.measureText(dwellTxt);
          ctx.fillStyle = `${color.primary}15`;
          ctx.beginPath();
          ctx.roundRect(wpx - dtw.width / 2 - 3, wpy + 24, dtw.width + 6, 14, 3);
          ctx.fill();
          ctx.font = "8px 'JetBrains Mono', monospace";
          ctx.fillStyle = `${color.primary}80`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(dwellTxt, wpx, wpy + 26);
          ctx.textBaseline = "alphabetic";
        }
      });
    }

    // Column tool: render a placement ghost at hover (no clicks needed)
    if (activeTool === "column" && hoverWorld) {
      const ghostRect = buildColumnRect(snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y), columnWidth, columnDepth);
      ctx.beginPath();
      const [g0x, g0y] = worldToScreen(ghostRect[0][0], ghostRect[0][1], c);
      ctx.moveTo(g0x, g0y);
      for (let i = 1; i < ghostRect.length; i++) {
        const [gx, gy] = worldToScreen(ghostRect[i][0], ghostRect[i][1], c);
        ctx.lineTo(gx, gy);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(40, 35, 30, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "#28201A";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw in-progress drawing for click-by-click tools
    if (drawingPoints.length > 0 && activeTool !== "select" && activeTool !== "waypoint" && activeTool !== "column") {
      const toolType = (activeTool === "zone" || activeTool === "zone_poly") ? "site" : activeTool;
      const style = SHAPE_STYLES[toolType] || SHAPE_STYLES.site;

      if ((activeTool === "wall" || activeTool === "door") && drawingPoints.length >= 1 && hoverWorld) {
        // Wall / Door preview: build the thick rectangle from first click → hover.
        // Auto-pick thickness side, with Shift flipping it. Mirrors final
        // placement logic so the ghost accurately shows where the wall lands.
        const p0 = drawingPoints[0];
        let previewEnd = wallSnapPreview ? wallSnapPreview.point : [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        // Walls and doors are both constrained to axis-aligned (horizontal
        // or vertical only). Doors additionally clamp the length to a fixed
        // 850mm; the hover only indicates direction.
        if (activeTool === "wall" || activeTool === "door") {
          previewEnd = axisAlignTo(p0[0], p0[1], previewEnd[0], previewEnd[1]);
        }
        if (activeTool === "door") {
          const dx = previewEnd[0] - p0[0];
          const dy = previewEnd[1] - p0[1];
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            previewEnd = [
              p0[0] + (dx / len) * DOOR_LENGTH_MM,
              p0[1] + (dy / len) * DOOR_LENGTH_MM,
            ];
          }
        }
        const thickness = wallThickness;
        const sideChoice = pickThicknessSide(p0[0], p0[1], previewEnd[0], previewEnd[1], thickness, shapes);
        let side: "left" | "right" = sideChoice === "right" ? "right" : "left";
        if (wallFlipSide) side = side === "left" ? "right" : "left";
        const rect = buildThickRect(p0[0], p0[1], previewEnd[0], previewEnd[1], thickness, side);
        ctx.beginPath();
        const [r0x, r0y] = worldToScreen(rect[0][0], rect[0][1], c);
        ctx.moveTo(r0x, r0y);
        for (let i = 1; i < rect.length; i++) {
          const [rx, ry] = worldToScreen(rect[i][0], rect[i][1], c);
          ctx.lineTo(rx, ry);
        }
        ctx.closePath();
        ctx.fillStyle = activeTool === "door" ? "rgba(180, 120, 70, 0.30)" : "rgba(60, 50, 40, 0.55)";
        ctx.fill();
        ctx.strokeStyle = activeTool === "door" ? "#B47846" : "#3C3228";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if ((activeTool === "site" || activeTool === "green") && siteShapeMode === "rectangle" && drawingPoints.length >= 1 && hoverWorld) {
        // Site / Green rectangle preview: from first click corner to hover.
        const p0 = drawingPoints[0];
        const p1: [number, number] = [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        const minX = Math.min(p0[0], p1[0]);
        const minY = Math.min(p0[1], p1[1]);
        const maxX = Math.max(p0[0], p1[0]);
        const maxY = Math.max(p0[1], p1[1]);
        const [rx1, ry1] = worldToScreen(minX, maxY, c);
        const [rx2, ry2] = worldToScreen(maxX, minY, c);
        const previewStyle = SHAPE_STYLES[activeTool];
        ctx.fillStyle = previewStyle.fill;
        ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
        ctx.strokeStyle = previewStyle.stroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
        ctx.setLineDash([]);
      } else if (activeTool === "window" && drawingPoints.length >= 1 && hoverWorld) {
        // Window preview: blue glass-block ghost (matches the wall/door
        // ghost shape so users see the actual placed footprint).
        // Axis-aligned only.
        const p0 = drawingPoints[0];
        let previewEnd = wallSnapPreview ? wallSnapPreview.point : [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        previewEnd = axisAlignTo(p0[0], p0[1], previewEnd[0], previewEnd[1]);
        const thickness = wallThickness;
        const sideChoice = pickThicknessSide(p0[0], p0[1], previewEnd[0], previewEnd[1], thickness, shapes);
        let side: "left" | "right" = sideChoice === "right" ? "right" : "left";
        if (wallFlipSide) side = side === "left" ? "right" : "left";
        const rect = buildThickRect(p0[0], p0[1], previewEnd[0], previewEnd[1], thickness, side);
        ctx.beginPath();
        const [r0x, r0y] = worldToScreen(rect[0][0], rect[0][1], c);
        ctx.moveTo(r0x, r0y);
        for (let i = 1; i < rect.length; i++) {
          const [rx, ry] = worldToScreen(rect[i][0], rect[i][1], c);
          ctx.lineTo(rx, ry);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(59, 130, 246, 0.30)";
        ctx.fill();
        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (activeTool === "special" && drawingPoints.length >= 1 && hoverWorld) {
        // Special rectangle preview: from first click corner to hover.
        const p0 = drawingPoints[0];
        const p1: [number, number] = [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        const minX = Math.min(p0[0], p1[0]);
        const minY = Math.min(p0[1], p1[1]);
        const maxX = Math.max(p0[0], p1[0]);
        const maxY = Math.max(p0[1], p1[1]);
        const [rx1, ry1] = worldToScreen(minX, maxY, c);
        const [rx2, ry2] = worldToScreen(maxX, minY, c);
        const previewStyle = SHAPE_STYLES.special;
        ctx.fillStyle = previewStyle.fill;
        ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
        ctx.strokeStyle = previewStyle.stroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
        ctx.setLineDash([]);
      } else if (activeTool === "zone" && drawingPoints.length >= 1 && hoverWorld) {
        const p0 = drawingPoints[0];
        const p1: [number, number] = [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        const minXz = Math.min(p0[0], p1[0]);
        const minYz = Math.min(p0[1], p1[1]);
        const maxXz = Math.max(p0[0], p1[0]);
        const maxYz = Math.max(p0[1], p1[1]);
        const [zx1, zy1] = worldToScreen(minXz, maxYz, c);
        const [zx2, zy2] = worldToScreen(maxXz, minYz, c);
        ctx.fillStyle = "rgba(29, 107, 94, 0.08)";
        ctx.fillRect(zx1, zy1, zx2 - zx1, zy2 - zy1);
        ctx.strokeStyle = "rgba(29, 107, 94, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(zx1, zy1, zx2 - zx1, zy2 - zy1);
        ctx.setLineDash([]);
      } else if (activeTool === "zone_split" && drawingPoints.length >= 1 && hoverWorld) {
        // Cutting-line preview: red dashed segment from the first click to
        // the cursor + small endpoint markers. Rendered in screen space so
        // the line stays visually consistent regardless of zoom. When a
        // snap target is in range, the preview endpoint follows the snap
        // point — so the user can see exactly where the click will land.
        const p0 = drawingPoints[0];
        const p1: [number, number] = cutSnapPreview
          ? [cutSnapPreview.point[0], cutSnapPreview.point[1]]
          : [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)];
        const [s0x, s0y] = worldToScreen(p0[0], p0[1], c);
        const [s1x, s1y] = worldToScreen(p1[0], p1[1], c);
        ctx.strokeStyle = "rgba(217, 79, 79, 0.85)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(s0x, s0y);
        ctx.lineTo(s1x, s1y);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [vx, vy] of [[s0x, s0y], [s1x, s1y]]) {
          ctx.beginPath();
          ctx.arc(vx, vy, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#D94F4F";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(vx, vy, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        }
      } else if (activeTool === "zone_cut_path" && drawingPoints.length >= 1) {
        // Multi-segment cut-path preview: red dashed polyline from each
        // committed point to the next, ending at the cursor (or snap
        // point when in range). Vertex markers at every committed point
        // + cursor. A small "Double-click to commit" hint appears once
        // 2+ points are placed.
        const tipWorld: [number, number] | null = hoverWorld
          ? cutSnapPreview
            ? [cutSnapPreview.point[0], cutSnapPreview.point[1]]
            : [snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y)]
          : null;
        ctx.strokeStyle = "rgba(217, 79, 79, 0.85)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        const [sx0, sy0] = worldToScreen(drawingPoints[0][0], drawingPoints[0][1], c);
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < drawingPoints.length; i++) {
          const [px, py] = worldToScreen(drawingPoints[i][0], drawingPoints[i][1], c);
          ctx.lineTo(px, py);
        }
        if (tipWorld) {
          const [hx, hy] = worldToScreen(tipWorld[0], tipWorld[1], c);
          ctx.lineTo(hx, hy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [wx, wy] of drawingPoints) {
          const [vx, vy] = worldToScreen(wx, wy, c);
          ctx.beginPath();
          ctx.arc(vx, vy, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#D94F4F";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(vx, vy, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        }
        if (drawingPoints.length >= 2 && tipWorld) {
          const [hx, hy] = worldToScreen(tipWorld[0], tipWorld[1], c);
          ctx.font = "10px 'JetBrains Mono', monospace";
          ctx.fillStyle = "rgba(217, 79, 79, 0.85)";
          ctx.textAlign = "left";
          ctx.fillText("double-click to cut", hx + 10, hy - 8);
        }
      } else {
        ctx.beginPath();
        const [sx0, sy0] = worldToScreen(drawingPoints[0][0], drawingPoints[0][1], c);
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < drawingPoints.length; i++) {
          const [px, py] = worldToScreen(drawingPoints[i][0], drawingPoints[i][1], c);
          ctx.lineTo(px, py);
        }
        if (hoverWorld) {
          let hx2: number, hy2: number;
          if ((activeTool === "window" || activeTool === "door") && wallSnapPreview) {
            [hx2, hy2] = worldToScreen(wallSnapPreview.point[0], wallSnapPreview.point[1], c);
          } else {
            [hx2, hy2] = worldToScreen(snapToGrid(hoverWorld.x), snapToGrid(hoverWorld.y), c);
          }
          ctx.lineTo(hx2, hy2);
        }
        ctx.strokeStyle = (activeTool === "zone_poly" || activeTool === "zone") ? "rgba(29, 107, 94, 0.5)" : style.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        drawingPoints.forEach(([wx, wy], idx) => {
          const [vx, vy] = worldToScreen(wx, wy, c);
          const isFirst = idx === 0;
          const isPolyTool = activeTool === "zone_poly" || activeTool === "site" || activeTool === "green";
          // Highlight first point when polygon can be closed (>= 3 points)
          if (isFirst && isPolyTool && drawingPoints.length >= 3) {
            ctx.beginPath();
            ctx.arc(vx, vy, 8, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(29, 107, 94, 0.15)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(vx, vy, 6, 0, Math.PI * 2);
            ctx.strokeStyle = (activeTool === "zone_poly") ? "rgba(29, 107, 94, 0.9)" : style.stroke;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.arc(vx, vy, isFirst && isPolyTool && drawingPoints.length >= 3 ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = (activeTool === "zone_poly" || activeTool === "zone") ? "rgba(29, 107, 94, 0.8)" : style.stroke;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(vx, vy, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        });
      }
    }

    // ---- Draw agents (static positions) ----
    const drawOrder = agentPositions
      .map((pos, i) => ({ pos, i }))
      .filter((a) => a.pos !== null && !animatingAgents[a.i])
      .sort((a, b) => (a.i === activeAgentIdx ? 1 : 0) - (b.i === activeAgentIdx ? 1 : 0));

    drawOrder.forEach(({ pos, i }) => {
      if (!pos) return;
      const [ax, ay] = worldToScreen(pos.x, pos.y, c);
      drawAgent(ctx, ax, ay, i, i === activeAgentIdx, c.zoom, agentLabels[i]);
    });

    // ---- Draw animating agents ----
    for (const [idxStr, pos] of Object.entries(animatingAgents)) {
      const idx = parseInt(idxStr);
      const [ax, ay] = worldToScreen(pos.x, pos.y, c);
      drawAnimatedAgent(ctx, ax, ay, idx, c.zoom, animPulse, agentLabels[idx]);
    }

    // ---- Draw heatmap overlay (on top of agents) ----
    if (showHeatmap && heatmapPoints.length > 0) {
      for (const hp of heatmapPoints) {
        const [hx, hy] = worldToScreen(hp.x, hp.y, c);
        const radius = Math.max(50, 3500 * c.zoom);
        const intensity = Math.min(1, hp.value / 10);

        // Green (low stress) → Yellow → Orange → Red (high stress)
        let r: number, g: number, b: number;
        if (intensity < 0.2) {
          // Low stress: vivid green
          r = 30; g = 200; b = 60;
        } else if (intensity < 0.4) {
          // Green → Yellow
          const t = (intensity - 0.2) / 0.2;
          r = Math.round(30 + (240 - 30) * t);
          g = Math.round(200 + (200 - 200) * t);
          b = Math.round(60 + (0 - 60) * t);
        } else if (intensity < 0.65) {
          // Yellow → Orange
          const t = (intensity - 0.4) / 0.25;
          r = Math.round(240 + (240 - 240) * t);
          g = Math.round(200 + (100 - 200) * t);
          b = Math.round(0 + (0 - 0) * t);
        } else {
          // Orange → Deep red
          const t = (intensity - 0.65) / 0.35;
          r = Math.round(240 + (200 - 240) * t);
          g = Math.round(100 + (20 - 100) * t);
          b = Math.round(0 + (20 - 0) * t);
        }

        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.65)`);
        grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.35)`);
        grad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.12)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(hx, hy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Text with dark outline for readability
        ctx.font = "bold 22px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 3;
        ctx.strokeText(hp.value.toFixed(1), hx, hy - radius * 0.15);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillText(hp.value.toFixed(1), hx, hy - radius * 0.15);
        ctx.font = "bold 14px 'Inter', sans-serif";
        ctx.strokeText("stress", hx, hy + radius * 0.15);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillText("stress", hx, hy + radius * 0.15);
        ctx.textBaseline = "alphabetic";
      }
    }

    // Hover crosshair
    if (hoverWorld && (activeTool === "select" || activeTool === "waypoint")) {
      const color = activeTool === "waypoint" ? "#E67E22" : getPersonaColor(activeAgentIdx).primary;
      const [hx, hy] = worldToScreen(hoverWorld.x, hoverWorld.y, c);
      ctx.strokeStyle = `${color}30`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, canvasH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(canvasW, hy); ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "11px 'JetBrains Mono', monospace";
      const txt = `(${Math.round(hoverWorld.x)}, ${Math.round(hoverWorld.y)})`;
      const tw2 = ctx.measureText(txt);
      const tx = Math.min(hx + 12, canvasW - tw2.width - 10);
      const ty = Math.max(hy - 12, 18);
      ctx.fillStyle = "rgba(60,50,40,0.7)";
      ctx.beginPath();
      ctx.roundRect(tx - 4, ty - 14, tw2.width + 8, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "left";
      ctx.fillText(txt, tx, ty);
    }

    // Coordinate tooltip for drawing tools
    if (hoverWorld && activeTool !== "select" && activeTool !== "waypoint") {
      let displayX: number, displayY: number;
      const snapsToEdge = (activeTool === "wall" || activeTool === "door" || activeTool === "window") && wallSnapPreview;
      if (snapsToEdge && wallSnapPreview) {
        displayX = Math.round(wallSnapPreview.point[0]);
        displayY = Math.round(wallSnapPreview.point[1]);
      } else {
        displayX = snapToGrid(hoverWorld.x);
        displayY = snapToGrid(hoverWorld.y);
      }
      const [hx, hy] = worldToScreen(displayX, displayY, c);

      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      const tooltipKey =
        activeTool === "zone" || activeTool === "zone_poly" || activeTool === "zone_split" || activeTool === "zone_cut_path"
          ? "site"
          : activeTool;
      ctx.strokeStyle = SHAPE_STYLES[tooltipKey]?.stroke || "#555";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = "11px 'JetBrains Mono', monospace";
      const snapLabel = snapsToEdge && wallSnapPreview ? ` [SNAP→${wallSnapPreview.targetType}]` : "";
      const txt = `(${displayX}, ${displayY})${snapLabel}`;
      const tw2 = ctx.measureText(txt);
      const tx = Math.min(hx + 12, canvasW - tw2.width - 10);
      const ty = Math.max(hy - 12, 18);
      ctx.fillStyle = "rgba(60,50,40,0.7)";
      ctx.beginPath();
      ctx.roundRect(tx - 4, ty - 14, tw2.width + 8, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "left";
      ctx.fillText(txt, tx, ty);
    }
  }, [shapes, zones, agentPositions, agentLabels, activeAgentIdx, hoverWorld, canvasW, canvasH, cam, drawingPoints, activeTool, allWaypoints, animatingAgents, pathTrails, animPulse, heatmapPoints, showHeatmap, selectedShapeIdx, wallSnapPreview, cutSnapPreview, showZoneLabels]);

  useEffect(() => { draw(); }, [draw]);

  // ---- Mouse handlers ----
  const getMouseWorld = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvasW / rect.width);
    const sy = (e.clientY - rect.top) * (canvasH / rect.height);
    return screenToWorld(sx, sy, camRef.current);
  };

  const getMouseScreen = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (canvasW / rect.width),
      (e.clientY - rect.top) * (canvasH / rect.height),
    ];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Pan
      isPanning.current = true;
      dragMoved.current = false;
      panStart.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    } else if (e.button === 0 && activeTool === "select") {
      dragMoved.current = false;

      // Endpoint resize takes priority over body drag for the selected shape.
      // Walls / windows show square handles at their endpoints; clicking one
      // pins the other endpoint and lets the user drag this end to extend or
      // shorten the segment, locked to the shape's existing axis orientation.
      if (selectedShapeIdx !== null) {
        const [sx, sy] = getMouseScreen(e);
        const sel = shapes[selectedShapeIdx];
        const eps = getResizeEndpoints(sel);
        if (eps) {
          for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
            const [ex, ey] = worldToScreen(eps[i][0], eps[i][1], camRef.current);
            if (Math.hypot(sx - ex, sy - ey) <= ENDPOINT_HIT_TOL_PX) {
              isResizingEndpoint.current = true;
              resizeShapeIdx.current = selectedShapeIdx;
              resizeEndpointIdx.current = i;
              resizeOriginalShape.current = sel;
              e.preventDefault();
              return;
            }
          }
        }
      }

      // Check if clicking on a selected shape to start drag
      if (selectedShapeIdx !== null) {
        const [sx, sy] = getMouseScreen(e);
        if (hitTestShape(sx, sy, shapes[selectedShapeIdx], camRef.current)) {
          // Start dragging the selected shape
          isDraggingShape.current = true;
          dragShapeIdx.current = selectedShapeIdx;
          const [wx, wy] = getMouseWorld(e);
          dragStartWorld.current = [wx, wy];
          dragOriginalPoints.current = shapes[selectedShapeIdx].points.map(p => [...p] as [number, number]);
          e.preventDefault();
          return;
        }
      }

      // Check if clicking on any shape to select it
      const [sx, sy] = getMouseScreen(e);
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTestShape(sx, sy, shapes[i], camRef.current)) {
          setSelectedShapeIdx(i);
          // Start drag immediately
          isDraggingShape.current = true;
          dragShapeIdx.current = i;
          const [wx, wy] = getMouseWorld(e);
          dragStartWorld.current = [wx, wy];
          dragOriginalPoints.current = shapes[i].points.map(p => [...p] as [number, number]);
          e.preventDefault();
          return;
        }
      }
    } else if (e.button === 0) {
      dragMoved.current = false;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      const c = camRef.current;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleRatio = canvasW / rect.width;
      c.offsetX -= (dx * scaleRatio) / c.zoom;
      c.offsetY += (dy * scaleRatio) / c.zoom;
      setCam({ ...c });
      return;
    }

    // Dragging a shape
    if (isDraggingShape.current && dragShapeIdx.current !== null && onUpdateShapes) {
      const [wx, wy] = getMouseWorld(e);
      const dxW = snapToGrid(wx - dragStartWorld.current[0]);
      const dyW = snapToGrid(wy - dragStartWorld.current[1]);
      if (Math.abs(dxW) > 0 || Math.abs(dyW) > 0) {
        dragMoved.current = true;
        const newShapes = [...shapes];
        const newPoints = dragOriginalPoints.current.map(
          ([px, py]) => [px + dxW, py + dyW] as [number, number]
        );
        newShapes[dragShapeIdx.current] = {
          ...newShapes[dragShapeIdx.current],
          points: newPoints,
        };
        onUpdateShapes(newShapes);
      }
      return;
    }

    // Resizing an endpoint of a wall or window. Locked to the shape's
    // existing horizontal/vertical axis: only the coordinate that varies
    // along that axis is updated; the perpendicular coordinate stays
    // pinned to the OTHER endpoint.
    if (isResizingEndpoint.current && resizeShapeIdx.current !== null
        && resizeEndpointIdx.current !== null && resizeOriginalShape.current
        && onUpdateShapes) {
      const orig = resizeOriginalShape.current;
      const epIdx = resizeEndpointIdx.current;
      const eps = getResizeEndpoints(orig);
      if (!eps) return;
      const [fixedX, fixedY] = eps[epIdx === 0 ? 1 : 0];
      const [movX, movY] = eps[epIdx];
      const wasHorizontal = Math.abs(movX - fixedX) >= Math.abs(movY - fixedY);
      const [wx, wy] = getMouseWorld(e);
      const newX = wasHorizontal ? snapToGrid(wx) : fixedX;
      const newY = wasHorizontal ? fixedY : snapToGrid(wy);
      if (newX === fixedX && newY === fixedY) return; // refuse zero-length
      dragMoved.current = true;

      const newShapes = [...shapes];
      if (orig.type === "wall" || orig.type === "window") {
        const newCenterline: [[number, number], [number, number]] = epIdx === 0
          ? [[newX, newY], [fixedX, fixedY]]
          : [[fixedX, fixedY], [newX, newY]];
        const thickness = (orig.meta?.thickness ?? 100) as 100 | 300;
        const side: "left" | "right" = orig.meta?.side ?? "left";
        const [ax, ay] = newCenterline[0];
        const [bx, by] = newCenterline[1];
        const rect = buildThickRect(ax, ay, bx, by, thickness, side);
        newShapes[resizeShapeIdx.current] = {
          ...orig,
          points: rect,
          meta: { ...orig.meta, thickness, centerline: newCenterline, side },
        };
      }
      onUpdateShapes(newShapes);
      return;
    }

    const [wx, wy] = getMouseWorld(e);
    // Shift = angle snap (0°/45°/90°) for polygon tools. For wall/door,
    // Shift is captured at keydown to TOGGLE the flip-side state instead.
    let finalX = snapToGrid(wx);
    let finalY = snapToGrid(wy);
    if (e.shiftKey && drawingPoints.length > 0 && activeTool !== "wall" && activeTool !== "door") {
      const lastPt = drawingPoints[drawingPoints.length - 1];
      [finalX, finalY] = snapToAngle(lastPt[0], lastPt[1], finalX, finalY);
    }
    setHoverWorld({ x: finalX, y: finalY });

    // Compute wall-snap preview for tools that snap to existing edges.
    // - wall:   snaps to wall + column + site
    // - door:   snaps to wall only (doors live on walls)
    // - window: snaps to wall + column (must terminate on a wall/column)
    if (activeTool === "wall" || activeTool === "door" || activeTool === "window") {
      const targets: SnapTargetType[] =
        activeTool === "door" ? ["wall"] :
        activeTool === "window" ? ["wall", "column"] :
        ["wall", "column", "site"];
      const snap = findNearestWallSnap(wx, wy, shapes, targets);
      if (snap && snap.dist <= WALL_SNAP_DIST) {
        setWallSnapPreview({ point: snap.point, wallIdx: snap.wallIdx, targetType: snap.targetType });
      } else {
        setWallSnapPreview(null);
      }
    } else {
      setWallSnapPreview(null);
    }

    // Cut-tool snap: when zone_split or zone_cut_path is active, search
    // every zone polygon edge AND every site/wall/column edge for the
    // nearest projection within a zoom-derived screen radius. Snap radius
    // is set in screen pixels (≈25px) and converted to mm via the current
    // zoom — so it stays the same on-screen at any zoom level. This lets
    // a casual click near a small zone still land precisely on its
    // boundary.
    if (activeTool === "zone_split" || activeTool === "zone_cut_path") {
      const SCREEN_SNAP_PX = 25;
      const snapRadiusWorld = SCREEN_SNAP_PX / Math.max(camRef.current.zoom, 1e-6);
      const cutSnap = findNearestCutSnap(wx, wy, zones, shapes);
      if (cutSnap && cutSnap.dist <= snapRadiusWorld) {
        setCutSnapPreview({ point: cutSnap.point, sourceLabel: cutSnap.sourceLabel });
      } else {
        setCutSnapPreview(null);
      }
    } else {
      setCutSnapPreview(null);
    }

    // Check hover over agents (only in select mode)
    if (activeTool === "select") {
      const [sx, sy] = getMouseScreen(e);
      let hovIdx: number | null = null;
      for (let i = 0; i < agentPositions.length; i++) {
        const pos = agentPositions[i];
        if (!pos) continue;
        const [ax, ay] = worldToScreen(pos.x, pos.y, camRef.current);
        const dist = Math.sqrt((sx - ax) ** 2 + (sy - ay) ** 2);
        if (dist < 18) { hovIdx = i; break; }
      }
      setHoveredAgentIdx(hovIdx);
    } else {
      setHoveredAgentIdx(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }

    // End shape drag
    if (isDraggingShape.current && dragShapeIdx.current !== null) {
      isDraggingShape.current = false;
      if (dragMoved.current) {
        // Push undo for the move
        pushUndo({
          type: "move_shape",
          payload: {
            index: dragShapeIdx.current,
            originalPoints: dragOriginalPoints.current,
          },
        });
        toast.success("Shape moved");
      }
      dragShapeIdx.current = null;
      if (dragMoved.current) return; // Don't process as click if we dragged
    }

    // End endpoint resize
    if (isResizingEndpoint.current && resizeShapeIdx.current !== null
        && resizeOriginalShape.current) {
      const wasMoved = dragMoved.current;
      const idx = resizeShapeIdx.current;
      const orig = resizeOriginalShape.current;
      isResizingEndpoint.current = false;
      resizeShapeIdx.current = null;
      resizeEndpointIdx.current = null;
      resizeOriginalShape.current = null;
      if (wasMoved) {
        // Reuse move_shape undo: restore original points (and meta via cast).
        pushUndo({
          type: "move_shape",
          payload: { index: idx, originalPoints: orig.points, originalMeta: orig.meta },
        });
        toast.success(orig.type === "wall" ? "Wall resized" : "Window resized");
        return; // skip click handling
      }
    }

    if (e.button !== 0 || e.altKey || dragMoved.current) return;

    const [wx, wy] = getMouseWorld(e);
    let snappedX = snapToGrid(wx);
    let snappedY = snapToGrid(wy);
    // Shift key: angle-snap (0°/45°/90°) for polygon tools only.
    if (e.shiftKey && drawingPoints.length > 0 && activeTool !== "wall" && activeTool !== "door") {
      const lastPt = drawingPoints[drawingPoints.length - 1];
      [snappedX, snappedY] = snapToAngle(lastPt[0], lastPt[1], snappedX, snappedY);
    }

    if (activeTool === "select") {
      // Check if clicking on a shape
      const [sx, sy] = getMouseScreen(e);
      let clickedShape = false;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTestShape(sx, sy, shapes[i], camRef.current)) {
          setSelectedShapeIdx(i);
          clickedShape = true;
          break;
        }
      }

      if (!clickedShape) {
        // Deselect if clicking on empty space
        if (selectedShapeIdx !== null) {
          setSelectedShapeIdx(null);
        } else {
          // Agents must be inside a site polygon (or have no site defined).
          const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
          if (sites.length > 0) {
            const inSite = sites.some((s) => isPointInBoundary(snappedX, snappedY, s.points));
            if (!inSite) {
              toast.error("Agent must be placed inside the site area");
              return;
            }
          }
          // Cannot place inside a wall / column (impassable solid).
          const solids = shapes.filter((s) => (s.type === "wall" || s.type === "column") && s.points.length >= 3);
          const inSolid = solids.some((s) => isPointInBoundary(snappedX, snappedY, s.points));
          if (inSolid) {
            toast.error("Cannot place agent inside a wall or column");
            return;
          }
          onAgentPlace({ x: snappedX, y: snappedY });
        }
      }
    } else if (activeTool === "waypoint") {
      if (!agentPositions[activeAgentIdx]) {
        toast.error("Please place agent first before adding waypoints");
        return;
      }
      if (onAddWaypoint) {
        const existingWps = allWaypoints[activeAgentIdx] || [];
        const wpNum = existingWps.length + 1;
        const wp: Waypoint = {
          id: `wp_${activeAgentIdx}_${Date.now()}`,
          label: `WP${wpNum}`,
          position: { x: snappedX, y: snappedY },
          dwell_minutes: 5,
        };
        onAddWaypoint(activeAgentIdx, wp);
        pushUndo({ type: "add_waypoint", payload: { agentIdx: activeAgentIdx, wp } });
        toast.success(`Waypoint ${wpNum} placed for P${activeAgentIdx + 1}`);
      }
    } else if (activeTool === "special") {
      // Special rectangle: click 2 opposite corners. Skips the site-inside
      // check — Special items represent off-site environmental factors that
      // agents may reference when analysing surroundings (neighbouring
      // buildings, noise sources, view targets, etc.).
      const newPoints: [number, number][] = [...drawingPoints, [snappedX, snappedY]];
      if (newPoints.length >= 2 && onAddShape) {
        const [x1, y1] = newPoints[0];
        const [x2, y2] = newPoints[1];
        if (x1 === x2 || y1 === y2) {
          toast.error("Shape must have non-zero width and height");
          setDrawingPoints([]);
          return;
        }
        const rect: [number, number][] = [
          [Math.min(x1, x2), Math.min(y1, y2)],
          [Math.max(x1, x2), Math.min(y1, y2)],
          [Math.max(x1, x2), Math.max(y1, y2)],
          [Math.min(x1, x2), Math.max(y1, y2)],
        ];
        const specialCount = shapes.filter((s) => s.type === "special").length;
        const rawLabel = window.prompt(
          "Define this special item — describe what it represents so agents can read it during environmental analysis (e.g. 'neighbouring high-rise', 'noise source: construction site', 'view: harbour')",
          ""
        );
        if (rawLabel === null) {
          // User cancelled — abort creation.
          setDrawingPoints([]);
          return;
        }
        const label = rawLabel.trim() || `Special ${specialCount + 1}`;
        const newShape: Shape = { type: "special", points: rect, label };
        onAddShape(newShape);
        pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
        toast.success(`Special item created: ${label}`);
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "zone") {
      const newPoints = [...drawingPoints, [snappedX, snappedY] as [number, number]];
      if (newPoints.length >= 2) {
        const p0 = newPoints[0];
        const p1 = newPoints[1];
        const minXz = Math.min(p0[0], p1[0]);
        const minYz = Math.min(p0[1], p1[1]);
        const maxXz = Math.max(p0[0], p1[0]);
        const maxYz = Math.max(p0[1], p1[1]);
        const w = maxXz - minXz;
        const h = maxYz - minYz;
        if (w > 0 && h > 0 && onAddZone) {
          const zone: Zone = {
            id: `zone_${Date.now()}`,
            label: `Zone ${zones.length + 1}`,
            bounds: { x: minXz, y: minYz, width: w, height: h },
            env: { ...defaultZoneEnv },
          };
          onAddZone(zone);
          pushUndo({ type: "add_zone", payload: { zone } });
          toast.success(`Zone created: ${w}mm × ${h}mm`);
        }
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "zone_split") {
      // Two clicks define an arbitrary-angle cut line; the second click
      // delegates to the parent which slices the underlying zone. We
      // recompute snap from the ACTUAL click coordinates instead of
      // reading cutSnapPreview state — the mousemove handler that
      // populates that state may not have fired between rapid clicks
      // (or between programmatic clicks), so the cached snap can point
      // at the previous mouse position. Recomputing here is what the
      // wall-snap path does too.
      const SCREEN_SNAP_PX = 25;
      const snapRadiusWorld = SCREEN_SNAP_PX / Math.max(camRef.current.zoom, 1e-6);
      const clickSnap = findNearestCutSnap(wx, wy, zones, shapes);
      const usedPoint: [number, number] = clickSnap && clickSnap.dist <= snapRadiusWorld
        ? [Math.round(clickSnap.point[0]), Math.round(clickSnap.point[1])]
        : [snappedX, snappedY];
      const newPoints = [...drawingPoints, usedPoint];
      if (newPoints.length >= 2) {
        const a = newPoints[0];
        const b = newPoints[1];
        if (a[0] === b[0] && a[1] === b[1]) {
          toast.error("Cut line is degenerate — pick two distinct points");
        } else if (onSplitZoneByLine) {
          onSplitZoneByLine(a, b);
        }
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "zone_cut_path") {
      // Multi-click polyline cut. Each click adds a vertex; double-click
      // commits the path. Single click only ever appends — committal is
      // handled in handleDoubleClick. Same snap-from-click-coords
      // pattern as zone_split, for the same reason: cutSnapPreview state
      // may be stale when click fires without a fresh mousemove.
      const SCREEN_SNAP_PX = 25;
      const snapRadiusWorld = SCREEN_SNAP_PX / Math.max(camRef.current.zoom, 1e-6);
      const clickSnap = findNearestCutSnap(wx, wy, zones, shapes);
      const usedPoint: [number, number] = clickSnap && clickSnap.dist <= snapRadiusWorld
        ? [Math.round(clickSnap.point[0]), Math.round(clickSnap.point[1])]
        : [snappedX, snappedY];
      setDrawingPoints([...drawingPoints, usedPoint]);
    } else if ((activeTool === "site" || activeTool === "green") && siteShapeMode === "rectangle") {
      // Site / Green rectangle: click 2 opposite corners.
      const newPoints: [number, number][] = [...drawingPoints, [snappedX, snappedY]];
      if (newPoints.length >= 2 && onAddShape) {
        const [x1, y1] = newPoints[0];
        const [x2, y2] = newPoints[1];
        if (x1 === x2 || y1 === y2) {
          toast.error("Shape must have non-zero width and height");
          setDrawingPoints([]);
          return;
        }
        const rect: [number, number][] = [
          [Math.min(x1, x2), Math.min(y1, y2)],
          [Math.max(x1, x2), Math.min(y1, y2)],
          [Math.max(x1, x2), Math.max(y1, y2)],
          [Math.min(x1, x2), Math.max(y1, y2)],
        ];
        if (activeTool === "site") {
          const newShape: Shape = { type: "site", points: rect, meta: { hasWalls: siteHasWalls } };
          onAddShape(newShape);
          pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
          toast.success(`Site rectangle created${siteHasWalls ? " (with walls)" : ""}`);
        } else {
          // Green: must be inside a site if any sites exist.
          const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
          if (sites.length > 0 && !isShapeInsideSite(rect, shapes)) {
            toast.error("Green area must be inside a site");
            setDrawingPoints([]);
            return;
          }
          const newShape: Shape = { type: "green", points: rect };
          onAddShape(newShape);
          pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
          toast.success("Green area created");
        }
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "site" || activeTool === "zone_poly" || activeTool === "green") {
      // Polygon tools: site (drawable area) and zone_poly. Click points,
      // double-click or click first point to close.
      if (drawingPoints.length >= 3) {
        const firstPt = drawingPoints[0];
        const CLOSE_DIST = SNAP_GRID * 1.5;
        const dx = snappedX - firstPt[0];
        const dy = snappedY - firstPt[1];
        if (Math.sqrt(dx * dx + dy * dy) <= CLOSE_DIST) {
          if (activeTool === "site" && onAddShape) {
            const newShape: Shape = {
              type: "site",
              points: drawingPoints,
              meta: { hasWalls: siteHasWalls },
            };
            onAddShape(newShape);
            pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
            toast.success(`Site area created (${drawingPoints.length} pts${siteHasWalls ? ", with perimeter walls" : ""})`);
            setDrawingPoints([]);
            return;
          } else if (activeTool === "green" && onAddShape) {
            const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
            if (sites.length > 0 && !isShapeInsideSite(drawingPoints, shapes)) {
              toast.error("Green area must be inside a site");
              setDrawingPoints([]);
              return;
            }
            const newShape: Shape = { type: "green", points: drawingPoints };
            onAddShape(newShape);
            pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
            toast.success(`Green area created (${drawingPoints.length} pts)`);
            setDrawingPoints([]);
            return;
          } else if (activeTool === "zone_poly" && onAddZone) {
            const minX = Math.min(...drawingPoints.map(p => p[0]));
            const minY = Math.min(...drawingPoints.map(p => p[1]));
            const maxX = Math.max(...drawingPoints.map(p => p[0]));
            const maxY = Math.max(...drawingPoints.map(p => p[1]));
            const zone: Zone = {
              id: `zone_${Date.now()}`,
              label: `Zone ${zones.length + 1}`,
              bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY, points: drawingPoints.map(p => [...p] as [number, number]) },
              env: { ...defaultZoneEnv },
            };
            onAddZone(zone);
            pushUndo({ type: "add_zone", payload: { zone } });
            toast.success(`Polygon zone created with ${drawingPoints.length} points`);
            setDrawingPoints([]);
            return;
          }
        }
      }
      setDrawingPoints([...drawingPoints, [snappedX, snappedY]]);
    } else if (activeTool === "wall" || activeTool === "door") {
      // Wall / Door: click 2 points. Walls snap opportunistically to walls /
      // columns / site edges within 500mm. Doors MUST snap to a wall or
      // column (a door is an opening cut out of a wall — it has no meaning
      // on its own). Both are axis-aligned (horizontal / vertical only).
      const targets: SnapTargetType[] =
        activeTool === "door" ? ["wall", "column"] :
        ["wall", "column", "site"];
      const snap = findNearestWallSnap(wx, wy, shapes, targets);
      let ptX = snappedX, ptY = snappedY;
      if (snap && snap.dist <= WALL_SNAP_DIST) {
        ptX = Math.round(snap.point[0]);
        ptY = Math.round(snap.point[1]);
      } else if (activeTool === "door") {
        toast.error("Door endpoints must snap to a wall or column");
        return;
      }
      if ((activeTool === "wall" || activeTool === "door") && drawingPoints.length === 1) {
        const [ax, ay] = drawingPoints[0];
        const aligned = axisAlignTo(ax, ay, ptX, ptY);
        ptX = aligned[0];
        ptY = aligned[1];
      }
      const newPoints: [number, number][] = [...drawingPoints, [ptX, ptY]];
      if (newPoints.length >= 2) {
        if (onAddShape) {
          const [ax, ay] = newPoints[0];
          let bx = newPoints[1][0];
          let by = newPoints[1][1];
          if (ax === bx && ay === by) {
            toast.error("Endpoints must be different");
            setDrawingPoints([]);
            return;
          }
          // Doors: clamp the second endpoint to a fixed 850mm distance from
          // the first, preserving direction. The user's drag indicates the
          // facing of the door; length is standardised.
          if (activeTool === "door") {
            const dx = bx - ax;
            const dy = by - ay;
            const len = Math.hypot(dx, dy);
            if (len > 1) {
              bx = Math.round(ax + (dx / len) * DOOR_LENGTH_MM);
              by = Math.round(ay + (dy / len) * DOOR_LENGTH_MM);
            }
          }
          // Doors and walls share the wall-thickness toggle (100 / 300 mm).
          const thickness = wallThickness;
          // Auto-pick the side so thickness extends INWARD into the site.
          // The persistent `wallFlipSide` toggle (Shift / Flip button) inverts.
          const sideChoice = pickThicknessSide(ax, ay, bx, by, thickness, shapes);
          if (sideChoice === "none" && !wallFlipSide) {
            toast.error("Must draw inside a site area (Flip / Shift to invert side)");
            setDrawingPoints([]);
            return;
          }
          let side: "left" | "right" = sideChoice === "right" ? "right" : "left";
          if (wallFlipSide) side = side === "left" ? "right" : "left";
          const rect = buildThickRect(ax, ay, bx, by, thickness, side);
          const newShape: Shape = {
            type: activeTool,
            points: rect,
            meta: { thickness, centerline: [[ax, ay], [bx, by]], side },
          };
          onAddShape(newShape);
          pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
          toast.success(`${activeTool === "door" ? "Door" : "Wall"} placed (${thickness}mm)`);
        }
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "window") {
      // Window: click 2 endpoints, both MUST snap to a wall or column.
      // A window now renders as a glass block (4-corner rect with the
      // current wallThickness) so it visually fits into the wall it
      // covers. Constrained to horizontal / vertical only.
      const snap = findNearestWallSnap(wx, wy, shapes, ["wall", "column"]);
      if (!snap || snap.dist > WALL_SNAP_DIST) {
        toast.error("Window endpoints must snap to a wall or column");
        return;
      }
      let ptX = Math.round(snap.point[0]);
      let ptY = Math.round(snap.point[1]);
      if (drawingPoints.length === 1) {
        const [ax, ay] = drawingPoints[0];
        const aligned = axisAlignTo(ax, ay, ptX, ptY);
        ptX = aligned[0];
        ptY = aligned[1];
      }
      const newPoints: [number, number][] = [...drawingPoints, [ptX, ptY]];
      if (newPoints.length >= 2) {
        if (onAddShape) {
          const [ax, ay] = newPoints[0];
          const [bx, by] = newPoints[1];
          if (ax === bx && ay === by) {
            toast.error("Window endpoints must be different");
            setDrawingPoints([]);
            return;
          }
          const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
          if (sites.length > 0 && !isShapeInsideSite(newPoints, shapes)) {
            toast.error("Must draw inside a site area");
            setDrawingPoints([]);
            return;
          }
          // Window block: same construction as walls/doors so it visually
          // fits into the wall it covers and behaves uniformly downstream.
          const thickness = wallThickness;
          const sideChoice = pickThicknessSide(ax, ay, bx, by, thickness, shapes);
          let side: "left" | "right" = sideChoice === "right" ? "right" : "left";
          if (wallFlipSide) side = side === "left" ? "right" : "left";
          const rect = buildThickRect(ax, ay, bx, by, thickness, side);
          const newShape: Shape = {
            type: "window",
            points: rect,
            meta: { thickness, centerline: [[ax, ay], [bx, by]], side },
          };
          onAddShape(newShape);
          pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
          toast.success(`Window placed (${thickness}mm)`);
        }
        setDrawingPoints([]);
      } else {
        setDrawingPoints(newPoints);
      }
    } else if (activeTool === "column") {
      // Column: single click placement at center, dimensions from state.
      if (columnWidth <= 0 || columnDepth <= 0) {
        toast.error("Set valid column dimensions first");
        return;
      }
      const rect = buildColumnRect(snappedX, snappedY, columnWidth, columnDepth);
      const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
      if (sites.length > 0 && !isShapeInsideSite(rect, shapes)) {
        toast.error("Must place inside a site area");
        return;
      }
      if (onAddShape) {
        const newShape: Shape = {
          type: "column",
          points: rect,
          meta: { width: columnWidth, depth: columnDepth },
        };
        onAddShape(newShape);
        pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
        toast.success(`Column placed (${columnWidth}×${columnDepth}mm)`);
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === "site" && drawingPoints.length >= 3 && onAddShape) {
      const newShape: Shape = {
        type: "site",
        points: drawingPoints,
        meta: { hasWalls: siteHasWalls },
      };
      onAddShape(newShape);
      pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
      toast.success(`Site area created (${drawingPoints.length} pts${siteHasWalls ? ", with perimeter walls" : ""})`);
      setDrawingPoints([]);
      e.preventDefault();
    } else if (activeTool === "green" && drawingPoints.length >= 3 && onAddShape) {
      const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
      if (sites.length > 0 && !isShapeInsideSite(drawingPoints, shapes)) {
        toast.error("Green area must be inside a site");
        setDrawingPoints([]);
        e.preventDefault();
        return;
      }
      const newShape: Shape = { type: "green", points: drawingPoints };
      onAddShape(newShape);
      pushUndo({ type: "add_shape", payload: { shape: newShape, index: shapes.length } });
      toast.success(`Green area created (${drawingPoints.length} pts)`);
      setDrawingPoints([]);
      e.preventDefault();
    } else if (activeTool === "zone_poly" && drawingPoints.length >= 3 && onAddZone) {
      // Find bounding box for polygon zone
      const minX = Math.min(...drawingPoints.map(p => p[0]));
      const minY = Math.min(...drawingPoints.map(p => p[1]));
      const maxX = Math.max(...drawingPoints.map(p => p[0]));
      const maxY = Math.max(...drawingPoints.map(p => p[1]));
      
      const zone: Zone = {
        id: `zone_${Date.now()}`,
        label: `Zone ${zones.length + 1}`,
        bounds: { 
          x: minX, 
          y: minY, 
          width: maxX - minX, 
          height: maxY - minY,
          points: drawingPoints.map(p => [...p] as [number, number])
        },
        env: { ...defaultZoneEnv },
      };
      onAddZone(zone);
      pushUndo({ type: "add_zone", payload: { zone } });
      toast.success(`Polygon zone created with ${drawingPoints.length} points`);
      setDrawingPoints([]);
      e.preventDefault();
    } else if (activeTool === "zone_cut_path" && drawingPoints.length >= 2 && onSplitZoneByPolyline) {
      // Commit the multi-segment cut path. Browsers fire dblclick AFTER
      // two click events, so the second click already appended a vertex —
      // we just need to dispatch the accumulated polyline.
      const polyline = drawingPoints.map((p) => [p[0], p[1]] as [number, number]);
      onSplitZoneByPolyline(polyline);
      setDrawingPoints([]);
      e.preventDefault();
    }
  };

  // ---- Zoom to cursor (native wheel listener with passive:false) ----
  // We use a native event listener instead of React onWheel because
  // React registers wheel events as passive, making preventDefault() impossible.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvasW / rect.width);
      const sy = (e.clientY - rect.top) * (canvasH / rect.height);

      const c = camRef.current;

      // Get world position under cursor BEFORE zoom
      const [wxBefore, wyBefore] = screenToWorld(sx, sy, c);

      // Apply zoom factor
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      c.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor));

      // Adjust offset so the world position under cursor stays at the same screen position
      c.offsetX = wxBefore - sx / c.zoom;
      c.offsetY = wyBefore + sy / c.zoom;

      setCam({ ...c });
    };

    canvas.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheelNative);
    };
  }, [canvasW, canvasH]);

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (activeTool !== "select") {
      setDrawingPoints([]);
      return;
    }

    // Delete selected shape on right-click
    if (selectedShapeIdx !== null && onDeleteShape) {
      pushUndo({ type: "delete_shape", payload: { shape: shapes[selectedShapeIdx], index: selectedShapeIdx } });
      onDeleteShape(selectedShapeIdx);
      setSelectedShapeIdx(null);
      toast.info("Shape deleted");
      return;
    }

    if (hoveredAgentIdx !== null && onAgentRemove) {
      onAgentRemove(hoveredAgentIdx);
      setHoveredAgentIdx(null);
    }
  };

  const getCursor = (): string => {
    if (isPanning.current) return "grabbing";
    if (isDraggingShape.current) return "move";
    if (activeTool === "select") {
      if (hoveredAgentIdx !== null) return "pointer";
      // Check if hovering over a shape
      if (hoverWorld) {
        const canvas = canvasRef.current;
        if (canvas) {
          // Use approximate screen coords from hover
          const [sx, sy] = worldToScreen(hoverWorld.x, hoverWorld.y, camRef.current);
          for (let i = shapes.length - 1; i >= 0; i--) {
            if (hitTestShape(sx, sy, shapes[i], camRef.current)) {
              return selectedShapeIdx === i ? "move" : "pointer";
            }
          }
        }
      }
      return "crosshair";
    }
    return "crosshair";
  };

  const currentToolInfo = TOOLS.find((t) => t.mode === activeTool);

  return (
    <div ref={containerRef} className="w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {TOOLS.map((tool) => (
          <button
            key={tool.mode}
            onClick={() => { setActiveTool(tool.mode); setDrawingPoints([]); setSelectedShapeIdx(null); }}
            className="sa-tool-btn"
            style={{
              background: activeTool === tool.mode ? "var(--primary)" : "var(--card)",
              color: activeTool === tool.mode ? "#fff" : "var(--foreground)",
              border: `1.5px solid ${activeTool === tool.mode ? "var(--primary)" : "var(--border)"}`,
              boxShadow: activeTool === tool.mode
                ? "0 2px 8px rgba(29, 107, 94, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)"
                : "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8), inset 0 1px 0 rgba(255,255,255,0.6)",
              padding: "6px 12px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
            title={tool.hint}
          >
            <span style={{ fontSize: "14px", lineHeight: 1 }}>{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
        ))}

        <div className="flex-1" />

        {/* Undo button */}
        <button
          onClick={handleUndo}
          className="sa-tool-btn"
          style={{
            background: "var(--card)",
            color: "var(--muted-foreground)",
            border: "1.5px solid var(--border)",
            boxShadow: "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8)",
            padding: "6px 10px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 500,
          }}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>

        {/* Drawing status */}
        {drawingPoints.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded" style={{
              background: "var(--primary-light)",
              color: "var(--primary)",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {drawingPoints.length} point{drawingPoints.length > 1 ? "s" : ""}
            </span>
            <button
              className="sa-btn text-xs px-2 py-1"
              style={{ background: "#D94F4F20", color: "#D94F4F", borderColor: "#D94F4F40" }}
              onClick={() => setDrawingPoints([])}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Selected shape info */}
        {selectedShapeIdx !== null && (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded" style={{
              background: "#FF6B3515",
              color: "#FF6B35",
              fontFamily: "'JetBrains Mono', monospace",
              border: "1px solid #FF6B3530",
            }}>
              Selected: {shapes[selectedShapeIdx]?.label || shapes[selectedShapeIdx]?.type}
            </span>
            <button
              className="sa-btn text-xs px-2 py-1"
              onClick={handleCopyShape}
              title="Copy this shape (Ctrl/Cmd+C). Paste with Ctrl/Cmd+V — paste offsets the copy by 500mm so it lands beside the original."
            >
              Copy
            </button>
            {shapes[selectedShapeIdx]?.type === "special" && onUpdateShapes && (
              <button
                className="sa-btn text-xs px-2 py-1"
                onClick={() => {
                  const cur = shapes[selectedShapeIdx];
                  if (!cur) return;
                  const next = window.prompt(
                    "Rename special item — describe what it represents (agents will read this label):",
                    cur.label || ""
                  );
                  if (next === null) return;
                  const label = next.trim();
                  if (!label) {
                    toast.error("Label cannot be empty");
                    return;
                  }
                  const updated = shapes.map((s, i) => (i === selectedShapeIdx ? { ...s, label } : s));
                  onUpdateShapes(updated);
                  toast.success(`Renamed to: ${label}`);
                }}
              >
                Rename
              </button>
            )}
            <button
              className="sa-btn text-xs px-2 py-1"
              style={{ background: "#D94F4F20", color: "#D94F4F", borderColor: "#D94F4F40" }}
              onClick={() => {
                if (onDeleteShape && selectedShapeIdx !== null) {
                  pushUndo({ type: "delete_shape", payload: { shape: shapes[selectedShapeIdx], index: selectedShapeIdx } });
                  onDeleteShape(selectedShapeIdx);
                  setSelectedShapeIdx(null);
                  toast.info("Shape deleted");
                }
              }}
            >
              Delete
            </button>
            <button
              className="sa-btn text-xs px-2 py-1"
              onClick={() => setSelectedShapeIdx(null)}
            >
              Deselect
            </button>
          </div>
        )}

        <button
          onClick={fitToContent}
          className="sa-tool-btn"
          style={{
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1.5px solid var(--border)",
            boxShadow: "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8)",
            padding: "6px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 500,
          }}
          title="Fit view to content"
        >
          Fit View
        </button>
        {/* Export Layout button */}
        <button
          onClick={handleExportLayout}
          className="sa-tool-btn"
          style={{
            background: "var(--card)",
            color: "var(--primary)",
            border: "1.5px solid var(--primary)",
            boxShadow: "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8)",
            padding: "6px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
          title="Export layout data as JSON (shapes, zones, agents, waypoints)"
        >
          <span style={{ fontSize: "13px" }}>⬇</span>
          Export Layout
        </button>
        {/* Import Layout button (Rhino → Grasshopper → JSON pipeline, or prior export) */}
        {onImportLayout && (
          <>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportLayoutFile(file);
                // Reset so picking the same file twice still triggers onChange.
                e.target.value = "";
              }}
            />
            <button
              onClick={() => importFileRef.current?.click()}
              className="sa-tool-btn"
              style={{
                background: "var(--card)",
                color: "var(--primary)",
                border: "1.5px solid var(--primary)",
                boxShadow: "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8)",
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
              title="Import layout JSON — replaces this canvas with shapes/zones/agents from a file (e.g. Rhino → Grasshopper export, or a prior SentiArch export)"
            >
              <span style={{ fontSize: "13px" }}>⬆</span>
              Import Layout
            </button>
          </>
        )}
        {/* Zone Labels toggle */}
        <button
          onClick={() => setShowZoneLabels((v) => !v)}
          className="sa-tool-btn"
          style={{
            background: showZoneLabels ? "var(--primary)" : "var(--card)",
            color: showZoneLabels ? "#fff" : "var(--muted-foreground)",
            border: `1.5px solid ${showZoneLabels ? "var(--primary)" : "var(--border)"}`,
            boxShadow: "2px 2px 6px rgba(0,0,0,0.05), -1px -1px 4px rgba(255,255,255,0.8)",
            padding: "6px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
          title={showZoneLabels ? "Hide zone labels" : "Show zone labels"}
        >
          <span style={{ fontSize: "13px" }}>{showZoneLabels ? "💬" : "🔇"}</span>
          Zone Labels
        </button>
      </div>

      {/* Contextual tool options */}
      {(activeTool === "site" || activeTool === "wall" || activeTool === "column" || activeTool === "door" || activeTool === "window" || activeTool === "green") && (
        <div
          className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg flex-wrap"
          style={{
            background: "var(--card)",
            border: "1.5px solid var(--border)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 1px 1px 4px rgba(0,0,0,0.04)",
          }}
        >
          {activeTool === "site" && (
            <>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Shape:</span>
              <button
                onClick={() => { setSiteShapeMode("polygon"); setDrawingPoints([]); }}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: siteShapeMode === "polygon" ? "var(--primary)" : "transparent",
                  color: siteShapeMode === "polygon" ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${siteShapeMode === "polygon" ? "var(--primary)" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                Polygon
              </button>
              <button
                onClick={() => { setSiteShapeMode("rectangle"); setDrawingPoints([]); }}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: siteShapeMode === "rectangle" ? "var(--primary)" : "transparent",
                  color: siteShapeMode === "rectangle" ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${siteShapeMode === "rectangle" ? "var(--primary)" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                Rectangle
              </button>
              <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>·  Perimeter:</span>
              <button
                onClick={() => setSiteHasWalls(true)}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: siteHasWalls ? "var(--primary)" : "transparent",
                  color: siteHasWalls ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${siteHasWalls ? "var(--primary)" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                With walls
              </button>
              <button
                onClick={() => setSiteHasWalls(false)}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: !siteHasWalls ? "var(--primary)" : "transparent",
                  color: !siteHasWalls ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${!siteHasWalls ? "var(--primary)" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                No walls
              </button>
            </>
          )}

          {activeTool === "green" && (
            <>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Shape:</span>
              <button
                onClick={() => { setSiteShapeMode("polygon"); setDrawingPoints([]); }}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: siteShapeMode === "polygon" ? "#5C8E4A" : "transparent",
                  color: siteShapeMode === "polygon" ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${siteShapeMode === "polygon" ? "#5C8E4A" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                Polygon
              </button>
              <button
                onClick={() => { setSiteShapeMode("rectangle"); setDrawingPoints([]); }}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: siteShapeMode === "rectangle" ? "#5C8E4A" : "transparent",
                  color: siteShapeMode === "rectangle" ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${siteShapeMode === "rectangle" ? "#5C8E4A" : "var(--border)"}`,
                  fontWeight: 500,
                }}
              >
                Rectangle
              </button>
            </>
          )}

          {(["wall", "door", "window"] as ToolMode[]).includes(activeTool) && (
            <>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {activeTool === "wall" ? "Wall thickness:" : activeTool === "door" ? "Door thickness:" : "Window thickness:"}
              </span>
              {[300, 100].map((t) => (
                <button
                  key={t}
                  onClick={() => setWallThickness(t as WallThickness)}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: wallThickness === t ? "var(--primary)" : "transparent",
                    color: wallThickness === t ? "#fff" : "var(--muted-foreground)",
                    border: `1px solid ${wallThickness === t ? "var(--primary)" : "var(--border)"}`,
                    fontWeight: 500,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                  title={`${t}mm — applies to walls, doors, and windows`}
                >
                  {t}mm
                </button>
              ))}
              <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>·</span>
              <button
                onClick={() => setWallFlipSide((v) => !v)}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: wallFlipSide ? "#FF6B35" : "transparent",
                  color: wallFlipSide ? "#fff" : "var(--muted-foreground)",
                  border: `1px solid ${wallFlipSide ? "#FF6B35" : "var(--border)"}`,
                  fontWeight: 500,
                }}
                title={`Flip ${activeTool} thickness to the opposite side of the centerline (Shift toggles)`}
              >
                ⇄ Flip side {wallFlipSide ? "(on)" : ""}
              </button>
            </>
          )}

          {activeTool === "column" && (
            <>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Column size (mm):</span>
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                W
                <input
                  type="number"
                  value={columnWidth}
                  min={100}
                  step={50}
                  onChange={(e) => setColumnWidth(Math.max(50, parseInt(e.target.value) || 0))}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    width: "70px",
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              </label>
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                D
                <input
                  type="number"
                  value={columnDepth}
                  min={100}
                  step={50}
                  onChange={(e) => setColumnDepth(Math.max(50, parseInt(e.target.value) || 0))}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    width: "70px",
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              </label>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>· click on map to place</span>
            </>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{
          width: `${canvasW}px`,
          height: `${canvasH}px`,
          cursor: getCursor(),
          borderRadius: "12px",
          border: "1.5px solid var(--border)",
          boxShadow: "4px 4px 14px rgba(0,0,0,0.07), -2px -2px 8px rgba(255,255,255,0.8), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onMouseLeave={() => {
          setHoverWorld(null);
          if (isResizingEndpoint.current) {
            // Snap-back: restore the original shape if the user drags off canvas mid-resize.
            const idx = resizeShapeIdx.current;
            const orig = resizeOriginalShape.current;
            if (idx !== null && orig && onUpdateShapes) {
              const restored = [...shapes];
              restored[idx] = orig;
              onUpdateShapes(restored);
            }
            isResizingEndpoint.current = false;
            resizeShapeIdx.current = null;
            resizeEndpointIdx.current = null;
            resizeOriginalShape.current = null;
          }
          setHoveredAgentIdx(null);
          isPanning.current = false;
          if (isDraggingShape.current) {
            isDraggingShape.current = false;
            dragShapeIdx.current = null;
          }
        }}
        onContextMenu={handleContextMenu}
      />

      {/* Controls hint */}
      <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: "#8A847A" }}>
        <span>Alt+drag to pan</span>
        <span>Scroll to zoom (to cursor)</span>
        {activeTool === "select" && <span>Click shape to select · Drag to move · Del to delete · Click empty to place agent</span>}
        {activeTool === "site" && siteShapeMode === "rectangle" && <span>Click 2 opposite corners to draw a rectangular site</span>}
        {activeTool === "site" && siteShapeMode === "polygon" && <span>Click points · double-click or click first point to close · Hold Shift to snap to 0°/45°/90°</span>}
        {activeTool === "green" && siteShapeMode === "rectangle" && <span>Click 2 opposite corners to draw a green / planted area (must be inside a site)</span>}
        {activeTool === "green" && siteShapeMode === "polygon" && <span>Click points to draw green area · double-click to close · must be inside a site</span>}
        {activeTool === "zone_poly" && <span>Click first point (or double-click) to close polygon · Hold Shift to snap to 0°/45°/90°</span>}
        {activeTool === "waypoint" && <span>Click to place waypoint for P{activeAgentIdx + 1} (requires agent placed)</span>}
        {activeTool === "wall" && <span>Click 2 points · horizontal / vertical only · auto-snap to walls / columns / site within 500mm · Press Shift or click Flip to toggle thickness side</span>}
        {activeTool === "door" && <span>Click 2 points ON A WALL to place an 850mm door at the current wallThickness (100/300mm) · horizontal / vertical only · second click sets direction · the wall section beneath becomes a passable opening · Press Shift or click Flip to toggle side</span>}
        {activeTool === "window" && <span>Click 2 endpoints ON A WALL to place a glass block at the current wallThickness (100/300mm) · horizontal / vertical only · the wall section beneath becomes transparent for LOS / heat (movement still blocked by glass)</span>}
        {activeTool === "column" && <span>Set W × D dimensions above, then click on map to place</span>}
      </div>
    </div>
  );
}
