# Rhino → SentiArch (Grasshopper exporter)

One-shot pipeline for getting a Rhino layout into SentiArch without pasting
coordinates one shape at a time.

## What you get

```
Rhino curves on layered geometry
        │
        ▼   (rpgarchitecture_export.py running in a GH Python 3 component)
SentiArch layout JSON
        │
        ▼   (Import Layout button in SentiArch — replaces current canvas)
Working canvas with sites, walls, columns, doors, windows, green, special,
zones, and agent start positions all populated at once.
```

## Setup (one-time)

Tested on **Rhino 8 + Grasshopper 1.0** with the new **Python 3 Script** component.

1. Open Grasshopper.
2. Drop a **Python 3 Script** component (`Maths` ▸ `Script` ▸ `Python 3 Script`).
3. Double-click → paste the contents of [`rpgarchitecture_export.py`](./rpgarchitecture_export.py).
4. **Configure the input pins** (right-click each pin):

   | Pin | Type | Access | Notes |
   |---|---|---|---|
   | `Site` | Curve | List | closed polygons; perimeter walls auto-on |
   | `Wall` | Curve | List | line / 2-pt polyline centrelines |
   | `WallThickness` | Integer | List | mm; 100 or 300 (default 100 if blank) |
   | `Column` | Curve | List | closed rect curves |
   | `Door` | Curve | List | line / 2-pt polyline centrelines |
   | `Window` | Curve | List | line / 2-pt polyline (window line, not rect) |
   | `Green` | Curve | List | closed polygons |
   | `Special` | Curve | List | closed polygons (off-site context) |
   | `Zone` | Curve | List | closed rect curves; bbox is taken |
   | `ZoneLabel` | Text | List | optional, in matching order |
   | `Agent` | Point | List | agent start positions |
   | `Scale` | Number | Item | `1.0` if Rhino doc is mm; `1000` if metres |
   | `YFlip` | Boolean | Item | flip Y axis (default off) |
   | `Round` | Boolean | Item | round to integer mm (default on) |
   | `WriteTo` | Text | Item | optional path; if set, writes JSON to disk |

5. Output pins:
   - `JSON` — the layout JSON string. Right-click → *Stream Contents* to a
     `.json` file, or pipe through a `Panel` and copy.
   - `Path` — file path written when `WriteTo` is set.
   - `Summary` — counts + diagnostics (handy for sanity-checking).

## Pulling geometry out of Rhino layers

Easiest: use Grasshopper's **Geometry Pipeline** component (one per layer):

```
Filter   = Curves                      → connect to Site / Wall / etc.
Layer    = ::site (or ::wall, ::door…)
Type     = Curve
```

Or right-click the geometry parameter and use *Set Multiple Curves* to pick
manually if you don't have a layer convention.

## What gets exported

| Type | Geometry expected | Schema produced |
|---|---|---|
| `site` | closed polygon (3+ pts) | polygon points; `meta.hasWalls=true` |
| `wall` | 2-point line | thick rectangle (4 corners) + `meta.thickness` + `meta.centerline` |
| `column` | closed rect | 4 corners + `meta.width` + `meta.depth` |
| `door` | 2-point line | thick rect (100mm fixed) + `meta.centerline` |
| `window` | 2-point line | 2 endpoints (no thickness) |
| `green` | closed polygon | polygon points (softscape, restorative model wires automatically) |
| `special` | closed polygon | polygon points (off-site context, no LOS / movement effect) |
| zone | closed rect | bounds `{x, y, width, height}` + default env (24°C / 55% / 300lx / 55dB / 0.1m/s / ceiling 2800mm) |
| agent | point | `{x, y}` |

> Per-zone environment fields (temperature, lux, dB, …) are **always exported with
> defaults** — tweak each zone in SentiArch's *Zone Environment* editor after
> import. This keeps the GH script focused on geometry, which is what Rhino
> models well.

## Coordinate conventions

- **Units**: SentiArch stores everything in **millimetres**.
  - Rhino doc in mm → `Scale = 1.0`
  - Rhino doc in metres → `Scale = 1000`
- **Y-axis**: SentiArch's canvas matches Rhino's plan view (`+Y` away from
  viewer). Leave `YFlip = false` unless your model is mirrored.
- **Z**: ignored. Geometry is projected to the XY plane.

## Loading into SentiArch

1. Open the spatial canvas in SentiArch (`/legacy`).
2. Click **`↑ Import Layout`** in the bottom toolbar (next to *Export Layout*).
3. Pick the JSON file.
4. Confirm the overwrite prompt — the **current canvas** is replaced.
5. Tweak zone env values + agent positions if needed.

## Round-trip

The JSON shape is identical to what *Export Layout* produces, so:

```
Rhino → GH script → JSON → Import → tweak in SentiArch → Export Layout → JSON
                                                                  ↓
                                                           identical schema
```

You can re-export from SentiArch and version-control the JSON file (e.g. as a
new entry in `client/src/lib/presets/`).

## Troubleshooting

- **"My polygon imported with too few points"** — the curve was a NURBS spline,
  not a polyline. Run *Convert ▸ To Polyline* in Rhino first, or rebuild the
  curve as a polyline.
- **"Agent positions look mirrored"** — try `YFlip = true`.
- **"Coordinates are 1000× too small"** — your doc is in metres; set
  `Scale = 1000`.
- **"Walls are paper-thin / huge"** — check `WallThickness` matches your wall
  count or rely on the 100mm default.
