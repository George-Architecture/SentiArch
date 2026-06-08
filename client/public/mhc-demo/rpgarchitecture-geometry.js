/* Hard-fixed traced geometry for the mental-health centre.

   Produced by the demo's hidden author/tracer mode (open the demo
   with ?author=1, align the 18 zones on the floor plan, place
   doors/windows, mark green areas, then Export). Paste the exported
   JSON object as the value of window.MHC_GEOMETRY below.

   When this is null the engine falls back to the authored per-zone
   SpatialData in rpgarchitecture-site.js (approximate). When populated,
   dist_to_wall / window / exit / enclosure / GVI / visible_agents
   are GEOMETRICALLY COMPUTED from these shapes (exact).

   Schema:
   {
     "building": { "w_mm": 40000, "h_mm": 14000 },
     "zones":   [ { "id": "reception", "label": "...", "rect": [x%,y%,w%,h%] }, ... ],
     "doors":   [ { "line": [[x%,y%],[x%,y%]] }, ... ],
     "windows": [ { "line": [[x%,y%],[x%,y%]] }, ... ],
     "greens":  [ { "rect": [x%,y%,w%,h%] }, ... ]
   }
   Coordinates are % of the floor-plan image (registration-exact). */
window.MHC_GEOMETRY = null;
