// ============================================================
// Auto-Zone Detection — Walkable-space with contour tracing (v7)
//
// Spatial model (post-refactor):
//   - SITE polygon = the walkable container (was: outermost boundary)
//   - WALL / COLUMN polygons = solid / inaccessible
//   - Walkable space = inside any SITE but NOT inside any wall/column
//   - Auto-zones are generated only in walkable space
//
// Every shape change triggers a FULL re-computation:
//   1. Find the (outermost) site polygon
//   2. Grid: mark EXTERIOR / SOLID / EMPTY cells
//   3. Flood-fill EMPTY → connected walkable regions
//   4. Contour-trace each region → polygon vertices
//   5. Merge with existing zones (preserve user edits by closest centroid distance)
//
// v6 fixes:
//   - Bug 1: Centroid matching uses nearest-distance instead of key-hash
//   - Bug 2: Outermost boundary uses containment check, not just largest area
//   - Bug 3: Grid padding increased to 6 cells to avoid touchesBorder false positives
// ============================================================

import type { Shape, Zone } from "./store";
import { defaultZoneEnv } from "./store";

// ---- Configuration ----
const CELL_SIZE = 500;        // mm per grid cell
const MIN_REGION_CELLS = 4;   // minimum cells for a valid zone
const SIMPLIFY_TOLERANCE = 0.8; // Douglas-Peucker tolerance in grid cells
const GRID_PAD_CELLS = 6;     // padding around outermost boundary (increased from 2)
const CENTROID_MATCH_DIST = 3000; // mm — max distance to match old zone centroid

// ---- Grid cell states ----
const EMPTY = 0;
const SOLID = -1;     // inside a boundary polygon (inaccessible)
const EXTERIOR = -2;  // outside the outermost boundary

// ---- Geometry helpers ----

function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonArea(pts: [number, number][]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Check if polygon A contains all vertices of polygon B.
 */
function polygonContainsAll(outer: [number, number][], inner: [number, number][]): boolean {
  return inner.every(([px, py]) => pointInPolygon(px, py, outer));
}

// ---- Douglas-Peucker line simplification ----

function perpendicularDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  return Math.sqrt((p[0] - projX) ** 2 + (p[1] - projY) ** 2);
}

function simplifyDP(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length <= 3) return pts;

  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyDP(pts.slice(0, maxIdx + 1), tolerance);
    const right = simplifyDP(pts.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// ---- Contour tracing (Moore neighborhood) ----

function traceContour(
  grid: Int32Array,
  cols: number,
  rows: number,
  regionId: number,
  _startX: number,
  _startY: number
): [number, number][] {
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];

  const isRegion = (x: number, y: number): boolean => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
    return grid[y * cols + x] === regionId;
  };

  // Find the topmost-leftmost cell of the region as start
  let sx = _startX, sy = _startY;
  outer:
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y * cols + x] === regionId) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }

  const contourPoints: [number, number][] = [];
  let cx = sx, cy = sy;
  let dir = 0;

  const maxSteps = grid.length * 2;
  let steps = 0;
  let firstDir = -1;

  do {
    contourPoints.push([cx, cy]);

    const startDir = (dir + 5) % 8;
    let found = false;

    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (isRegion(nx, ny)) {
        dir = d;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }

    if (!found) break;

    if (contourPoints.length === 1) {
      firstDir = dir;
    }

    steps++;
    if (steps > maxSteps) break;
  } while (!(cx === sx && cy === sy && dir === firstDir) && steps < maxSteps);

  if (contourPoints.length > 1) {
    const last = contourPoints[contourPoints.length - 1];
    if (last[0] === contourPoints[0][0] && last[1] === contourPoints[0][1]) {
      contourPoints.pop();
    }
  }

  return contourPoints;
}

function contourToWorldPolygon(
  contour: [number, number][],
  originX: number,
  originY: number
): [number, number][] {
  const worldPts: [number, number][] = contour.map(([gx, gy]) => [
    originX + (gx + 0.5) * CELL_SIZE,
    originY + (gy + 0.5) * CELL_SIZE,
  ]);

  const simplified = simplifyDP(worldPts, SIMPLIFY_TOLERANCE * CELL_SIZE);
  if (simplified.length < 3) return worldPts.length >= 3 ? worldPts : [];
  return simplified;
}

/**
 * Sanity-check a contour-simplified polygon against the cell-region's
 * actual bbox. Moore-neighbourhood tracing on solid (filled) regions
 * occasionally pinches itself: the trace returns to the start cell with
 * the same heading after only a few steps and emits a tiny self-
 * intersecting polygon clustered near one corner — visually correct
 * looking bounds but a polygon that fails point-in-polygon tests for
 * most of the zone's interior, which then breaks the cut tools' zone
 * detection. When we detect that pathology (the polygon's AABB covers
 * less than half of the cell-bbox in either axis), we drop the polygon
 * and let the caller fall back to the rectangle bounds — that's an
 * over-approximation for genuinely concave rooms but safe for the
 * common rectangular case and keeps cuts working.
 */
function polygonCoversBounds(
  polygon: [number, number][],
  bx: number, by: number, bw: number, bh: number,
): boolean {
  if (polygon.length < 3) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const polyW = maxX - minX;
  const polyH = maxY - minY;
  // Allow a small slack (CELL_SIZE) since contour points sit at cell
  // CENTRES, so a perfect trace's bbox is one cell smaller than the
  // cell-bbox in each dimension.
  const slack = CELL_SIZE * 1.5;
  return polyW + slack >= bw * 0.5 && polyH + slack >= bh * 0.5;
}

// ---- Flood fill ----

interface FloodFillResult {
  count: number;
  touchesBorder: boolean;
  gMinX: number;
  gMinY: number;
  gMaxX: number;
  gMaxY: number;
  startX: number;
  startY: number;
}

function floodFill(
  grid: Int32Array,
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  regionId: number
): FloodFillResult {
  const startIdx = sy * cols + sx;
  if (grid[startIdx] !== EMPTY) {
    return { count: 0, touchesBorder: false, gMinX: sx, gMinY: sy, gMaxX: sx, gMaxY: sy, startX: sx, startY: sy };
  }

  grid[startIdx] = regionId;
  const stack: number[] = [startIdx];
  let count = 0;
  let touchesBorder = false;
  let gMinX = sx, gMinY = sy, gMaxX = sx, gMaxY = sy;

  while (stack.length > 0) {
    const ci = stack.pop()!;
    count++;
    const cx = ci % cols;
    const cy = (ci - cx) / cols;

    if (cx < gMinX) gMinX = cx;
    if (cx > gMaxX) gMaxX = cx;
    if (cy < gMinY) gMinY = cy;
    if (cy > gMaxY) gMaxY = cy;

    if (cx === 0 || cx === cols - 1 || cy === 0 || cy === rows - 1) {
      touchesBorder = true;
    }

    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as [number, number][]) {
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
        const ni = ny * cols + nx;
        if (grid[ni] === EMPTY) {
          grid[ni] = regionId;
          stack.push(ni);
        }
      }
    }
  }

  return { count, touchesBorder, gMinX, gMinY, gMaxX, gMaxY, startX: sx, startY: sy };
}

// ---- Centroid calculation ----

function regionCentroid(
  grid: Int32Array,
  cols: number,
  regionId: number,
  originX: number,
  originY: number
): [number, number] {
  let sumX = 0, sumY = 0, count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === regionId) {
      const gx = i % cols;
      const gy = (i - gx) / cols;
      sumX += gx;
      sumY += gy;
      count++;
    }
  }
  if (count === 0) return [originX, originY];
  return [
    originX + (sumX / count + 0.5) * CELL_SIZE,
    originY + (sumY / count + 0.5) * CELL_SIZE,
  ];
}

// ---- Public types ----

export interface DetectedRegion {
  id: number;
  cellCount: number;
  centroid: [number, number];
  bounds: { x: number; y: number; width: number; height: number };
  polygon: [number, number][];
}

// ---- Bresenham's line rasterization ----

/**
 * Rasterize a line segment from world coordinates (x0,y0) to (x1,y1)
 * onto the grid, marking every cell the line passes through as SOLID.
 * Uses Bresenham's line algorithm in grid space.
 */
function rasterizeSegment(
  grid: Int32Array,
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  wx0: number, wy0: number,
  wx1: number, wy1: number
): void {
  // Convert world coords to grid coords (integer cell indices)
  let gx0 = Math.floor((wx0 - originX) / CELL_SIZE);
  let gy0 = Math.floor((wy0 - originY) / CELL_SIZE);
  const gx1 = Math.floor((wx1 - originX) / CELL_SIZE);
  const gy1 = Math.floor((wy1 - originY) / CELL_SIZE);

  const dx = Math.abs(gx1 - gx0);
  const dy = Math.abs(gy1 - gy0);
  const sx = gx0 < gx1 ? 1 : -1;
  const sy = gy0 < gy1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (gx0 >= 0 && gx0 < cols && gy0 >= 0 && gy0 < rows) {
      grid[gy0 * cols + gx0] = SOLID;
    }
    if (gx0 === gx1 && gy0 === gy1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; gx0 += sx; }
    if (e2 < dx)  { err += dx; gy0 += sy; }
  }
}

/**
 * Rasterize all edges of a boundary polygon onto the grid.
 * This ensures thin boundaries (thinner than CELL_SIZE) still block flood-fill.
 */
function rasterizeBoundaryEdges(
  grid: Int32Array,
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  pts: [number, number][]
): void {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    rasterizeSegment(grid, cols, rows, originX, originY, x0, y0, x1, y1);
  }
}

// ---- Outermost boundary detection (v6: containment-based) ----

// ---- Main detection ----

/**
 * Group sites into nesting families. Each top-level entry is a site that
 * is NOT contained by any other site; its `inner` array holds sites that
 * ARE contained by it (and become exterior holes when zoning the parent).
 * Disjoint sites end up as separate top-level entries — each becomes its
 * own independent zoning context, so a layout with multiple buildings on
 * a plot generates auto-zones for ALL of them rather than just the
 * largest.
 */
function groupSiteFamilies(sites: Shape[]): { outer: Shape; inner: Shape[] }[] {
  if (sites.length === 0) return [];
  if (sites.length === 1) return [{ outer: sites[0], inner: [] }];

  // For each site, find the smallest other site that contains it (its
  // immediate parent in the nesting tree). If none, it's a root.
  const parentIdx: number[] = sites.map(() => -1);
  for (let i = 0; i < sites.length; i++) {
    let bestParent = -1;
    let bestParentArea = Infinity;
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      // Does j contain i? Test via i's centroid (cheap) — full polygonContainsAll
      // is the rigorous test but expensive; centroid containment plus area
      // ordering is correct in the typical no-overlap case.
      const cx = sites[i].points.reduce((s, p) => s + p[0], 0) / sites[i].points.length;
      const cy = sites[i].points.reduce((s, p) => s + p[1], 0) / sites[i].points.length;
      if (!pointInPolygon(cx, cy, sites[j].points)) continue;
      const aJ = polygonArea(sites[j].points);
      if (aJ < bestParentArea) {
        bestParent = j;
        bestParentArea = aJ;
      }
    }
    parentIdx[i] = bestParent;
  }

  // Build families: each root collects its DIRECT children.
  const families: { outer: Shape; inner: Shape[] }[] = [];
  const rootIdxOf = new Map<Shape, number>();
  for (let i = 0; i < sites.length; i++) {
    if (parentIdx[i] === -1) {
      rootIdxOf.set(sites[i], families.length);
      families.push({ outer: sites[i], inner: [] });
    }
  }
  for (let i = 0; i < sites.length; i++) {
    if (parentIdx[i] === -1) continue;
    // Walk up the parent chain to the root.
    let p = parentIdx[i];
    while (parentIdx[p] !== -1) p = parentIdx[p];
    const fIdx = rootIdxOf.get(sites[p]);
    if (fIdx !== undefined) families[fIdx].inner.push(sites[i]);
  }

  return families;
}

/**
 * Run the grid-based region detection for one site family. The outer
 * polygon defines the walkable container; inner sites are EXTERIOR holes
 * (cut out) and walls/columns are SOLID obstacles. Returns DetectedRegion
 * objects for every sufficiently-large enclosed walkable area.
 */
function detectRegionsForSite(
  outermost: Shape,
  innerSites: Shape[],
  innerBoundaries: Shape[],
): DetectedRegion[] {
  // ---- Build grid covering the outermost boundary bbox ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of outermost.points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const pad = CELL_SIZE * GRID_PAD_CELLS;
  const originX = minX - pad;
  const originY = minY - pad;
  const cols = Math.ceil((maxX + pad - originX) / CELL_SIZE) + 2;
  const rows = Math.ceil((maxY + pad - originY) / CELL_SIZE) + 2;

  if (cols * rows > 4_000_000) {
    console.warn("Auto-zone: grid too large, skipping site");
    return [];
  }

  const grid = new Int32Array(cols * rows); // all EMPTY (0)

  // ---- Classify each cell ----
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const wx = originX + (gx + 0.5) * CELL_SIZE;
      const wy = originY + (gy + 0.5) * CELL_SIZE;

      // Outside the outermost site → EXTERIOR.
      if (!pointInPolygon(wx, wy, outermost.points)) {
        grid[gy * cols + gx] = EXTERIOR;
        continue;
      }

      // Inside one of the inner (nested) sites → also EXTERIOR (treated as a
      // hole carved out of the outermost site, e.g. a courtyard).
      let inHole = false;
      for (const innerSite of innerSites) {
        if (pointInPolygon(wx, wy, innerSite.points)) {
          inHole = true;
          break;
        }
      }
      if (inHole) {
        grid[gy * cols + gx] = EXTERIOR;
        continue;
      }

      let isSolid = false;
      for (const b of innerBoundaries) {
        if (pointInPolygon(wx, wy, b.points)) {
          isSolid = true;
          break;
        }
      }
      if (isSolid) {
        grid[gy * cols + gx] = SOLID;
      }
    }
  }

  // ---- Rasterize boundary edges (handle thin boundaries < CELL_SIZE) ----
  for (const b of innerBoundaries) {
    rasterizeBoundaryEdges(grid, cols, rows, originX, originY, b.points);
  }
  rasterizeBoundaryEdges(grid, cols, rows, originX, originY, outermost.points);

  // ---- Flood fill all walkable (EMPTY) cells ----
  let nextId = 1;
  const regionMeta: Map<number, FloodFillResult> = new Map();

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y * cols + x] === EMPTY) {
        const meta = floodFill(grid, cols, rows, x, y, nextId);
        regionMeta.set(nextId, meta);
        nextId++;
      }
    }
  }

  // ---- Build results with contour polygons ----
  const results: DetectedRegion[] = [];
  for (const [regionId, meta] of Array.from(regionMeta.entries())) {
    if (meta.count < MIN_REGION_CELLS) continue;
    if (meta.touchesBorder) continue;

    const centroid = regionCentroid(grid, cols, regionId, originX, originY);
    const wx1 = originX + meta.gMinX * CELL_SIZE;
    const wy1 = originY + meta.gMinY * CELL_SIZE;
    const wx2 = originX + (meta.gMaxX + 1) * CELL_SIZE;
    const wy2 = originY + (meta.gMaxY + 1) * CELL_SIZE;

    const contour = traceContour(grid, cols, rows, regionId, meta.startX, meta.startY);
    const polygon = contourToWorldPolygon(contour, originX, originY);

    // Defend against Moore-tracing pathologies. If the simplified polygon
    // doesn't actually cover the cell region, downstream point-in-polygon
    // tests (used by findZoneForLineCut) reject clicks that are clearly
    // inside the room. Drop the polygon in that case and fall back to
    // the 4-corner cell-bbox rectangle.
    const cellW = wx2 - wx1;
    const cellH = wy2 - wy1;
    const usePolygon = polygon.length >= 3 && polygonCoversBounds(polygon, wx1, wy1, cellW, cellH);
    const finalPolygon: [number, number][] = usePolygon
      ? polygon
      : [
          [wx1, wy1],
          [wx2, wy1],
          [wx2, wy2],
          [wx1, wy2],
        ];

    results.push({
      id: regionId,
      cellCount: meta.count,
      centroid,
      bounds: { x: wx1, y: wy1, width: cellW, height: cellH },
      polygon: finalPolygon,
    });
  }
  return results;
}

export function detectEnclosedRegions(shapes: Shape[]): DetectedRegion[] {
  // Spatial model: every "site" polygon defines an INDEPENDENT walkable
  // container (e.g. each building on a multi-building site). "wall" /
  // "column" polygons are solid obstacles inside any container they fall
  // in. Detection runs per-site so a layout with N disjoint sites
  // produces zones for ALL of them — the previous implementation only
  // used the outermost site and silently dropped the rest, which is what
  // the user observed when extra site rectangles failed to auto-zone.
  const sites = shapes.filter((s) => s.type === "site" && s.points.length >= 3);
  if (sites.length === 0) return [];

  const innerBoundaries = shapes.filter(
    (s) => (s.type === "wall" || s.type === "column") && s.points.length >= 3,
  );

  const families = groupSiteFamilies(sites);
  const allResults: DetectedRegion[] = [];
  let idOffset = 0;
  for (const family of families) {
    const regions = detectRegionsForSite(family.outer, family.inner, innerBoundaries);
    // Re-id so families don't collide when multiple sites are processed
    // (each detectRegionsForSite call restarts numbering from 1).
    for (const r of regions) r.id += idOffset;
    idOffset += regions.length + 1;
    allResults.push(...regions);
  }

  // Sort top-left to bottom-right for consistent numbering across all sites.
  allResults.sort((a, b) => {
    const dy = a.centroid[1] - b.centroid[1];
    if (Math.abs(dy) > 2000) return dy;
    return a.centroid[0] - b.centroid[0];
  });

  return allResults;
}

// ---- Zone generation (v6: distance-based centroid matching) ----

/**
 * Compute centroid of an existing auto-zone from its polygon or bounds.
 */
function zoneCentroid(z: Zone): [number, number] {
  if (z.bounds.points && z.bounds.points.length >= 3) {
    const pts = z.bounds.points;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [cx, cy];
  }
  return [z.bounds.x + z.bounds.width / 2, z.bounds.y + z.bounds.height / 2];
}

/**
 * Euclidean distance between two points.
 */
function dist2d(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/**
 * Generate auto-zones from detected walkable regions.
 * FULL re-computation: all auto-zones are replaced.
 * User edits (label, env) are preserved by matching closest centroids (v6).
 */
export function generateAutoZones(shapes: Shape[], existingZones: Zone[]): Zone[] {
  const regions = detectEnclosedRegions(shapes);

  const manualZones = existingZones.filter((z) => !z.id.startsWith("auto_zone_"));
  const autoZones   = existingZones.filter((z) =>  z.id.startsWith("auto_zone_"));

  // v6: Build list of existing auto-zones with their centroids for distance matching
  const availableOld: { zone: Zone; centroid: [number, number]; matched: boolean }[] =
    autoZones.map((z) => ({ zone: z, centroid: zoneCentroid(z), matched: false }));

  const newAutoZones: Zone[] = [];
  let labelCounter = 1;

  for (const region of regions) {
    const rc = region.centroid;

    // v6: Find the closest unmatched existing auto-zone within threshold
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < availableOld.length; i++) {
      if (availableOld[i].matched) continue;
      const d = dist2d(rc, availableOld[i].centroid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestDist <= CENTROID_MATCH_DIST) {
      // Matched an existing zone — preserve user edits
      const existing = availableOld[bestIdx].zone;
      availableOld[bestIdx].matched = true;

      const userModifiedLabel = existing.label && !existing.label.match(/^Zone \d+$/);
      const userModifiedEnv = JSON.stringify(existing.env) !== JSON.stringify(defaultZoneEnv);

      newAutoZones.push({
        ...existing,
        bounds: {
          x:      region.bounds.x,
          y:      region.bounds.y,
          width:  region.bounds.width,
          height: region.bounds.height,
          points: region.polygon,
        },
        label: userModifiedLabel ? existing.label : `Zone ${labelCounter}`,
        env: userModifiedEnv ? existing.env : { ...defaultZoneEnv },
      });
    } else {
      // New zone
      newAutoZones.push({
        id:    `auto_zone_${Date.now()}_${labelCounter}`,
        label: `Zone ${labelCounter}`,
        bounds: {
          x:      region.bounds.x,
          y:      region.bounds.y,
          width:  region.bounds.width,
          height: region.bounds.height,
          points: region.polygon,
        },
        env: { ...defaultZoneEnv },
      });
    }
    labelCounter++;
  }

  // Re-number default labels sequentially (only those not user-modified)
  let num = 1;
  for (const z of newAutoZones) {
    if (z.label?.match(/^Zone \d+$/)) {
      z.label = `Zone ${num}`;
    }
    num++;
  }

  return [...manualZones, ...newAutoZones];
}
