# =============================================================================
# SentiArch Layout Exporter — Grasshopper Python 3 Script Component
# =============================================================================
# Drop this script into a "Python 3 Script" component in Grasshopper (Rhino 8+).
# Configure each input parameter's type & access as listed below, then connect
# Rhino curves / points from the model. The component emits a JSON string that
# the SentiArch app can consume via "Import Layout" in one shot — no more pasting
# coordinates one shape at a time.
#
# -----------------------------------------------------------------------------
# INPUTS (right-click the component pin to set type & list/item access)
# -----------------------------------------------------------------------------
#   Site          : Curve   list   — closed site polygons (perimeter walls auto)
#   Wall          : Curve   list   — wall centerlines (lines / 2-pt polylines)
#   WallThickness : int     list   — thickness per wall in mm (default 100)
#   Column        : Curve   list   — column rect curves (closed)
#   Door          : Curve   list   — door centerlines (lines / 2-pt polylines)
#   Window        : Curve   list   — window line segments (2 endpoints)
#   Green         : Curve   list   — green / softscape polygons (closed)
#   Special       : Curve   list   — off-site context polygons (closed)
#   Zone          : Curve   list   — zone rect curves (bounding box used)
#   ZoneLabel     : str     list   — labels per zone (optional)
#   Agent         : Point3d list   — agent start positions
#   Scale         : float   item   — multiply XY by this (use 1000 if doc=metres)
#   YFlip         : bool    item   — multiply Y by -1 (default False)
#   Round         : bool    item   — round coords to int mm (default True)
#   WriteTo       : str     item   — optional file path to write JSON
#
# OUTPUTS
#   JSON          : str            — the SentiArch layout JSON
#   Path          : str            — file path written (if WriteTo given)
#   Summary       : str            — counts + diagnostics
#
# -----------------------------------------------------------------------------
# WORKFLOW
# -----------------------------------------------------------------------------
#   1. Group your Rhino geometry by layer (or selection): one layer per type
#      (e.g. "site", "wall", "door", ...). Use Grasshopper's "Geometry Pipeline"
#      or "Layer" component to feed each input.
#   2. Set Scale=1000 if your Rhino doc unit is metres; leave 1.0 for mm.
#   3. Right-click the JSON output → "Stream Contents" to a .json file, or
#      copy via clipboard. Alternatively, set WriteTo to a file path.
#   4. In SentiArch, open the spatial canvas, click the "↑ Import Layout"
#      button (next to "Export Layout") and pick the JSON file. The current
#      canvas is REPLACED (with confirmation).
# =============================================================================

import json
import math
from datetime import datetime, timezone

import Rhino.Geometry as rg


# -----------------------------------------------------------------------------
# Coordinate helpers
# -----------------------------------------------------------------------------
def _xy(pt):
    """Drop Z, return (x, y) tuple."""
    return (pt.X, pt.Y)


def _coord(p, scale, yflip, round_):
    """Apply scale, optional Y-flip, and rounding. Returns [x, y] list (JSON)."""
    x = p[0] * scale
    y = p[1] * scale * (-1.0 if yflip else 1.0)
    if round_:
        return [int(round(x)), int(round(y))]
    return [round(x, 3), round(y, 3)]


def curve_to_polyline_points(crv):
    """Extract polyline vertex points from a closed/open curve.

    Polyline / line curves: returns their vertices directly.
    Spline / arc curves: discretises at span endpoints — for the level of
    detail SentiArch needs, vertices are sufficient (rooms are polygonal)."""
    if crv is None:
        return []
    success, poly = crv.TryGetPolyline()
    if success and poly is not None:
        pts = list(poly)
        if len(pts) >= 2 and pts[0].DistanceTo(pts[-1]) < 1e-6:
            pts = pts[:-1]  # drop duplicated closing vertex
        return [_xy(p) for p in pts]
    pts = []
    for i in range(crv.SpanCount):
        seg = crv.Trim(crv.SpanDomain(i))
        if seg is not None:
            pts.append(seg.PointAt(seg.Domain.T0))
    if not crv.IsClosed:
        pts.append(crv.PointAtEnd)
    return [_xy(p) for p in pts]


def line_endpoints(crv):
    """Return ((x0, y0), (x1, y1)) for a line / 2-pt polyline; None otherwise."""
    if crv is None:
        return None
    success, line = crv.TryGetLine()
    if success:
        return (_xy(line.From), _xy(line.To))
    pts = curve_to_polyline_points(crv)
    if len(pts) >= 2:
        return (pts[0], pts[-1])
    return None


def thick_rect(p0, p1, thickness):
    """4-corner symmetric thick rectangle from centerline + thickness."""
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-6:
        return None
    nx, ny = -dy / length, dx / length
    h = thickness / 2.0
    return [
        [x0 + nx * h, y0 + ny * h],
        [x1 + nx * h, y1 + ny * h],
        [x1 - nx * h, y1 - ny * h],
        [x0 - nx * h, y0 - ny * h],
    ]


def bbox_xy(crv):
    """Return (x0, y0, x1, y1) — Rhino-space bbox before scale/flip."""
    bb = crv.GetBoundingBox(True)
    return bb.Min.X, bb.Min.Y, bb.Max.X, bb.Max.Y


def _round_pair(p, round_):
    if round_:
        return [int(round(p[0])), int(round(p[1]))]
    return [round(p[0], 3), round(p[1], 3)]


# -----------------------------------------------------------------------------
# Layout builder
# -----------------------------------------------------------------------------
DEFAULT_ENV = {
    "temperature": 24,
    "humidity": 55,
    "light": 300,
    "noise": 55,
    "air_velocity": 0.1,
    "ceiling_height": 2800,
    "open_space": False,
}


def build_layout(
    site, wall, wall_thickness, column, door, window_, green, special,
    zone, zone_label, agent, scale=1.0, yflip=False, round_=True,
):
    """Return the SentiArch layout dict (JSON-ready)."""
    shapes = []

    # ---- Sites: closed polygons; default hasWalls=True (perimeter blocks LOS) ----
    for crv in (site or []):
        if crv is None:
            continue
        pts = curve_to_polyline_points(crv)
        if len(pts) < 3:
            continue
        coords = [_coord(p, scale, yflip, round_) for p in pts]
        shapes.append({
            "type": "site",
            "points": coords,
            "meta": {"hasWalls": True},
        })

    # ---- Walls: centerline + thickness → 4-corner rect + meta.centerline ----
    walls = wall or []
    thicks = wall_thickness or []
    for i, crv in enumerate(walls):
        if crv is None:
            continue
        ends = line_endpoints(crv)
        if ends is None:
            continue
        thickness = int(thicks[i]) if i < len(thicks) else 100
        c0 = _coord(ends[0], scale, yflip, round_)
        c1 = _coord(ends[1], scale, yflip, round_)
        rect = thick_rect(c0, c1, thickness)
        if rect is None:
            continue
        rect = [_round_pair(p, round_) for p in rect]
        shapes.append({
            "type": "wall",
            "points": rect,
            "meta": {"thickness": thickness, "centerline": [c0, c1]},
        })

    # ---- Columns: closed rect curve → 4 corners (or bbox fallback) ----
    for crv in (column or []):
        if crv is None:
            continue
        pts = curve_to_polyline_points(crv)
        if len(pts) < 3:
            continue
        if len(pts) == 4:
            coords = [_coord(p, scale, yflip, round_) for p in pts]
        else:
            x0, y0, x1, y1 = bbox_xy(crv)
            coords = [
                _coord((x0, y0), scale, yflip, round_),
                _coord((x1, y0), scale, yflip, round_),
                _coord((x1, y1), scale, yflip, round_),
                _coord((x0, y1), scale, yflip, round_),
            ]
        xs = [p[0] for p in coords]
        ys = [p[1] for p in coords]
        meta = {
            "width": int(round(max(xs) - min(xs))),
            "depth": int(round(max(ys) - min(ys))),
        }
        shapes.append({"type": "column", "points": coords, "meta": meta})

    # ---- Doors: centerline + 100mm thickness (fixed in SentiArch schema) ----
    for crv in (door or []):
        if crv is None:
            continue
        ends = line_endpoints(crv)
        if ends is None:
            continue
        c0 = _coord(ends[0], scale, yflip, round_)
        c1 = _coord(ends[1], scale, yflip, round_)
        rect = thick_rect(c0, c1, 100)
        if rect is None:
            continue
        rect = [_round_pair(p, round_) for p in rect]
        shapes.append({
            "type": "door",
            "points": rect,
            "meta": {"thickness": 100, "centerline": [c0, c1]},
        })

    # ---- Windows: 2-point line, no thickness ----
    for crv in (window_ or []):
        if crv is None:
            continue
        ends = line_endpoints(crv)
        if ends is None:
            continue
        coords = [
            _coord(ends[0], scale, yflip, round_),
            _coord(ends[1], scale, yflip, round_),
        ]
        shapes.append({"type": "window", "points": coords})

    # ---- Green: closed polygon ----
    for crv in (green or []):
        if crv is None:
            continue
        pts = curve_to_polyline_points(crv)
        if len(pts) < 3:
            continue
        coords = [_coord(p, scale, yflip, round_) for p in pts]
        shapes.append({"type": "green", "points": coords})

    # ---- Special: closed polygon (off-site environmental context) ----
    for crv in (special or []):
        if crv is None:
            continue
        pts = curve_to_polyline_points(crv)
        if len(pts) < 3:
            continue
        coords = [_coord(p, scale, yflip, round_) for p in pts]
        shapes.append({"type": "special", "points": coords})

    # ---- Zones: bbox → SentiArch ZoneBounds ----
    zones_out = []
    zlabels = zone_label or []
    for i, crv in enumerate(zone or []):
        if crv is None:
            continue
        x0, y0, x1, y1 = bbox_xy(crv)
        c_lo = _coord((x0, y0), scale, yflip, round_)
        c_hi = _coord((x1, y1), scale, yflip, round_)
        x_min = min(c_lo[0], c_hi[0])
        y_min = min(c_lo[1], c_hi[1])
        x_max = max(c_lo[0], c_hi[0])
        y_max = max(c_lo[1], c_hi[1])
        label = (zlabels[i] if i < len(zlabels) and zlabels[i] else f"Zone {i + 1}")
        zones_out.append({
            "id": f"zone_gh_{i + 1}_{int(datetime.now().timestamp())}",
            "label": str(label),
            "bounds": {
                "x": x_min, "y": y_min,
                "width": x_max - x_min, "height": y_max - y_min,
            },
            "env": dict(DEFAULT_ENV),
        })

    # ---- Agents: world point → {x, y} ----
    agents = []
    for p in (agent or []):
        if p is None:
            agents.append(None)
            continue
        c = _coord((p.X, p.Y), scale, yflip, round_)
        agents.append({"x": c[0], "y": c[1]})

    return {
        "shapes": shapes,
        "zones": zones_out,
        "agentPositions": agents,
        "waypoints": {},
        "exportedAt": datetime.now(timezone.utc).isoformat(),
    }


# -----------------------------------------------------------------------------
# GH input bridge — variables Site / Wall / etc. are auto-injected by the
# component's input parameters. Defaults guard against unconnected pins.
# -----------------------------------------------------------------------------
_scale = float(Scale) if Scale is not None else 1.0
_yflip = bool(YFlip) if YFlip is not None else False
_round = bool(Round) if Round is not None else True

layout = build_layout(
    site=Site, wall=Wall, wall_thickness=WallThickness,
    column=Column, door=Door, window_=Window,
    green=Green, special=Special,
    zone=Zone, zone_label=ZoneLabel,
    agent=Agent,
    scale=_scale, yflip=_yflip, round_=_round,
)

JSON = json.dumps(layout, indent=2)
Path = ""

if WriteTo:
    p = str(WriteTo)
    try:
        with open(p, "w", encoding="utf-8") as f:
            f.write(JSON)
        Path = p
    except Exception as e:
        Path = "ERROR: " + str(e)

# Build a tidy summary
by_type = {}
for s in layout["shapes"]:
    by_type[s["type"]] = by_type.get(s["type"], 0) + 1
type_str = ", ".join(f"{k}={v}" for k, v in sorted(by_type.items())) or "—"
agent_count = sum(1 for a in layout["agentPositions"] if a is not None)
Summary = (
    f"Shapes: {len(layout['shapes'])}  ({type_str})\n"
    f"Zones:  {len(layout['zones'])}\n"
    f"Agents: {agent_count}\n"
    f"Scale:  {_scale}   YFlip: {_yflip}   Round: {_round}\n"
    f"Bytes:  {len(JSON)}"
)
