/* ─────────────────────────────────────────────────────────────
   Hard-fixed SITE dataset — Hong Kong Mental-Health Centre

   The canonical repo (SentiArch) has NO machine-readable
   site for this centre (only a presentation image). This file
   IS the authored, locked quantitative venue: 18 zones, each
   with a full engine ZoneEnv + SpatialData + mm bounds. The
   demo never loads scenarios or an editor — this is the only
   site, by design ("全部數據場地都係 fix 死 for mental-health centre").

   Calibration (thesis-defensible, qualitative → numeric):
   · Source of qualitative descriptors: the demo's zones.jsx
     (lux/noise/density/biophilia/exit/scale) + architect notes.
   · Air temp 25.5 °C / 60 % RH / 0.10 m·s⁻¹: HK clinic AC
     setpoint — the same figure the engine's perceivedAirTemp
     doc cites ("Health-Centre-style 25.5 °C setpoint"). Indoor
     zones are modelled radiant-symmetric (mrt = air_temp) per
     the engine's ZoneEnv default.
   · Courtyard is the only open_space (outdoor): 28 °C / 70 %,
     wind 0.4 m·s⁻¹, mrt 31 °C (sun-warmed stone + benches),
     outdoor_air_temp 28 °C.
   · lux ladder: dim≈120, lamplight≈220–300, daylight≈450–600,
     fluorescent≈500, task≈350, store(off)≈50, outdoor≈12000.
   · dB ladder: very-low 35, low 42, low-hum 45, low-med 50,
     circular-voice 55, social-hum 58, tiled-echo 60, street 62.
   · dist_to_exit = −1 (no exit in LOS) for Reception and Group
     Therapy — that IS the case's design problem (anxious
     clients seated where the way out is not visible). Other
     zones: nearest visible door in metres.
   · bounds (mm): the floor-plan proportions (% of plan image)
     projected onto a 40 m × 14 m building envelope (≈ small HK
     centre footprint) so zone m² → density penalty is realistic.

   Exposes: window.MHC_SITE   (zoneId → { label, bounds, env, spatial })
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var BUILDING_W = 40000; // mm — assumed plan envelope width
  var BUILDING_H = 14000; // mm — assumed plan envelope depth

  // pct = [x%, y%, w%, h%] of the floor-plan image (matches zones.jsx
  // so engine area aligns with the UI hit-test geometry).
  function bounds(pct) {
    return {
      x: Math.round(pct[0] / 100 * BUILDING_W),
      y: Math.round(pct[1] / 100 * BUILDING_H),
      width: Math.round(pct[2] / 100 * BUILDING_W),
      height: Math.round(pct[3] / 100 * BUILDING_H),
    };
  }

  // env: ZoneEnv  ·  spatial: SpatialData (distances in metres;
  // dist_to_window / dist_to_exit sentinel −1 = none in line of sight)
  var Z = [
    { id: "quiet_refuge_1", label: "Quiet Refuge (QR-1)", pct: [1.5, 2.7, 11.5, 20.5],
      env: { temperature: 25.5, humidity: 60, light: 120, noise: 35, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 0.9, dist_to_window: 1.5, dist_to_exit: 2.2, ceiling_h: 2.7, enclosure_ratio: 0.90, visible_agents: 0, green_visibility: 0.35 } },

    { id: "quiet_refuge_2", label: "Quiet Refuge (QR-2)", pct: [1.5, 25.5, 11.5, 13.5],
      env: { temperature: 25.5, humidity: 60, light: 120, noise: 35, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 0.8, dist_to_window: 2.0, dist_to_exit: 2.0, ceiling_h: 2.7, enclosure_ratio: 0.92, visible_agents: 0, green_visibility: 0.20 } },

    { id: "therapy_1", label: "Therapy Room 1", pct: [15.0, 3.8, 11.8, 21.5],
      env: { temperature: 25.5, humidity: 60, light: 220, noise: 42, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 1.0, dist_to_window: 1.5, dist_to_exit: 2.5, ceiling_h: 2.7, enclosure_ratio: 0.82, visible_agents: 1, green_visibility: 0.20 } },

    { id: "therapy_2", label: "Therapy Room 2", pct: [27.8, 3.8, 13.1, 21.5],
      env: { temperature: 25.5, humidity: 60, light: 300, noise: 42, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 1.0, dist_to_window: 2.0, dist_to_exit: 2.5, ceiling_h: 2.7, enclosure_ratio: 0.82, visible_agents: 1, green_visibility: 0.12 } },

    { id: "therapy_3", label: "Therapy Room 3", pct: [41.3, 3.8, 14.2, 21.5],
      env: { temperature: 25.5, humidity: 60, light: 240, noise: 42, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 1.0, dist_to_window: 1.5, dist_to_exit: 2.5, ceiling_h: 2.7, enclosure_ratio: 0.82, visible_agents: 1, green_visibility: 0.20 } },

    { id: "art_therapy", label: "Art Therapy Room 4", pct: [55.9, 3.8, 15.6, 21.7],
      env: { temperature: 25.5, humidity: 60, light: 600, noise: 50, air_velocity: 0.1, ceiling_height: 2900, open_space: false },
      spatial: { dist_to_wall: 1.6, dist_to_window: 2.0, dist_to_exit: 2.5, ceiling_h: 2.9, enclosure_ratio: 0.62, visible_agents: 3, green_visibility: 0.40 } },

    { id: "group_therapy", label: "Group Therapy Room", pct: [72.0, 4.2, 21.5, 26.4],
      env: { temperature: 25.5, humidity: 60, light: 450, noise: 55, air_velocity: 0.1, ceiling_height: 3000, open_space: false },
      spatial: { dist_to_wall: 2.2, dist_to_window: 3.0, dist_to_exit: -1, ceiling_h: 3.0, enclosure_ratio: 0.55, visible_agents: 7, green_visibility: 0.40 } },

    { id: "reception", label: "Reception & Waiting", pct: [1.5, 39.6, 26.8, 37.3],
      env: { temperature: 25.5, humidity: 60, light: 130, noise: 45, air_velocity: 0.1, ceiling_height: 3200, open_space: false },
      spatial: { dist_to_wall: 2.5, dist_to_window: 3.0, dist_to_exit: -1, ceiling_h: 3.2, enclosure_ratio: 0.45, visible_agents: 5, green_visibility: 0.25 } },

    { id: "courtyard", label: "Courtyard", pct: [30.4, 32.9, 28.3, 32.0],
      env: { temperature: 28, humidity: 70, light: 12000, noise: 50, air_velocity: 0.4, ceiling_height: 0, open_space: true, mrt: 31, outdoor_air_temp: 28 },
      spatial: { dist_to_wall: 3.5, dist_to_window: -1, dist_to_exit: 1.5, ceiling_h: -1, enclosure_ratio: 0.10, visible_agents: 1, green_visibility: 0.70 } },

    { id: "tea_pause", label: "Tea / Pause Area", pct: [29.8, 65.5, 20.9, 19.3],
      env: { temperature: 25.5, humidity: 60, light: 280, noise: 58, air_velocity: 0.12, ceiling_height: 2800, open_space: false },
      spatial: { dist_to_wall: 1.5, dist_to_window: 2.0, dist_to_exit: 3.0, ceiling_h: 2.8, enclosure_ratio: 0.55, visible_agents: 3, green_visibility: 0.30 } },

    { id: "staff_lounge", label: "Staff Lounge & Offices", pct: [51.7, 58.0, 29.4, 29.4],
      env: { temperature: 25.5, humidity: 60, light: 150, noise: 45, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 1.8, dist_to_window: -1, dist_to_exit: 3.0, ceiling_h: 2.7, enclosure_ratio: 0.70, visible_agents: 2, green_visibility: 0.12 } },

    { id: "records", label: "Records (staff only)", pct: [81.0, 54.0, 12.2, 17.0],
      env: { temperature: 25.5, humidity: 60, light: 350, noise: 35, air_velocity: 0.1, ceiling_height: 2700, open_space: false },
      spatial: { dist_to_wall: 1.0, dist_to_window: 2.0, dist_to_exit: 2.0, ceiling_h: 2.7, enclosure_ratio: 0.82, visible_agents: 1, green_visibility: 0.12 } },

    { id: "f_washroom", label: "Female Washroom", pct: [82.6, 32.1, 11.0, 9.5],
      env: { temperature: 25.5, humidity: 60, light: 500, noise: 60, air_velocity: 0.1, ceiling_height: 2600, open_space: false },
      spatial: { dist_to_wall: 0.8, dist_to_window: -1, dist_to_exit: 1.5, ceiling_h: 2.6, enclosure_ratio: 0.86, visible_agents: 0, green_visibility: 0 } },

    { id: "m_washroom", label: "Male Washroom", pct: [82.6, 42.5, 11.0, 9.5],
      env: { temperature: 25.5, humidity: 60, light: 500, noise: 60, air_velocity: 0.1, ceiling_height: 2600, open_space: false },
      spatial: { dist_to_wall: 0.8, dist_to_window: -1, dist_to_exit: 1.5, ceiling_h: 2.6, enclosure_ratio: 0.86, visible_agents: 0, green_visibility: 0 } },

    { id: "storage", label: "Storage", pct: [82.0, 71.5, 11.6, 13.5],
      env: { temperature: 25.5, humidity: 60, light: 50, noise: 30, air_velocity: 0.1, ceiling_height: 2500, open_space: false },
      spatial: { dist_to_wall: 0.8, dist_to_window: -1, dist_to_exit: 1.5, ceiling_h: 2.5, enclosure_ratio: 0.90, visible_agents: 0, green_visibility: 0 } },

    { id: "staff_f_wash", label: "Staff Female Washroom", pct: [51.7, 85.4, 11.7, 7.4],
      env: { temperature: 25.5, humidity: 60, light: 500, noise: 58, air_velocity: 0.1, ceiling_height: 2600, open_space: false },
      spatial: { dist_to_wall: 0.7, dist_to_window: -1, dist_to_exit: 1.2, ceiling_h: 2.6, enclosure_ratio: 0.88, visible_agents: 0, green_visibility: 0 } },

    { id: "staff_m_wash", label: "Staff Male Washroom", pct: [63.7, 85.4, 11.4, 7.4],
      env: { temperature: 25.5, humidity: 60, light: 500, noise: 58, air_velocity: 0.1, ceiling_height: 2600, open_space: false },
      spatial: { dist_to_wall: 0.7, dist_to_window: -1, dist_to_exit: 1.2, ceiling_h: 2.6, enclosure_ratio: 0.88, visible_agents: 0, green_visibility: 0 } },

    { id: "entrance", label: "Main Entrance", pct: [15.1, 91.2, 21.5, 8.2],
      env: { temperature: 27, humidity: 65, light: 800, noise: 62, air_velocity: 0.15, ceiling_height: 3000, open_space: false },
      spatial: { dist_to_wall: 1.5, dist_to_window: 1.0, dist_to_exit: 0.5, ceiling_h: 3.0, enclosure_ratio: 0.25, visible_agents: 1, green_visibility: 0.15 } },
  ];

  var MHC_SITE = {};
  Z.forEach(function (z) {
    MHC_SITE[z.id] = { id: z.id, label: z.label, bounds: bounds(z.pct), env: z.env, spatial: z.spatial };
  });

  window.MHC_SITE = MHC_SITE;
})();
