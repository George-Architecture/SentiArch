/* global React, ReactDOM, ZONES */
// ─────────────────────────────────────────────────────────────
//  SentiArch — hidden AUTHOR / TRACER mode  (?author=1)
//  Trace zones (rectangle OR straight-line polygon), doors,
//  windows, green areas on the real floor plan. Every object is
//  selectable → move / resize / edit / delete. Export the
//  geometry JSON → it is baked into rpgarchitecture-geometry.js so the
//  engine computes dist_to_wall/window/exit/enclosure/GVI/
//  visible_agents geometrically. Coords are % of the plan image.
// ─────────────────────────────────────────────────────────────
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("author") !== "1") return;

  const { useState, useRef, useCallback, useEffect } = React;
  const FLOOR = "assets/floorplan.jpg";
  const r2 = (n) => Math.round(n * 100) / 100;
  let _k = 0;
  const uid = () => "k" + (++_k) + Date.now().toString(36);
  const bbox = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };

  function seed() {
    const g = window.MHC_GEOMETRY;
    const rectFromLine = (L) => { const b = bbox(L); return { x: r2(b.x - 0.6), y: r2(b.y - 0.6), w: r2(Math.max(1, b.w) + 1.2), h: r2(Math.max(1, b.h) + 1.2) }; };
    if (g && Array.isArray(g.zones)) {
      return {
        zones: g.zones.map((z) => z.poly
          ? { key: uid(), id: z.id, label: z.label || z.id, poly: z.poly.map((p) => [p[0], p[1]]) }
          : { key: uid(), id: z.id, label: z.label || z.id, rect: { x: z.rect[0], y: z.rect[1], w: z.rect[2], h: z.rect[3] } }),
        doors: (g.doors || []).map((d) => ({ key: uid(), ...(d.rect ? { x: d.rect[0], y: d.rect[1], w: d.rect[2], h: d.rect[3] } : rectFromLine(d.line)) })),
        windows: (g.windows || []).map((w) => ({ key: uid(), ...(w.rect ? { x: w.rect[0], y: w.rect[1], w: w.rect[2], h: w.rect[3] } : rectFromLine(w.line)) })),
        greens: (g.greens || []).map((gr) => ({ key: uid(), x: gr.rect[0], y: gr.rect[1], w: gr.rect[2], h: gr.rect[3] })),
        bW: ((g.building && g.building.w_mm) || 40000) / 1000,
        bH: ((g.building && g.building.h_mm) || 14000) / 1000,
      };
    }
    return {
      zones: (window.ZONES || []).map((z) => ({ key: uid(), id: z.id, label: z.label, rect: { x: z.bounds[0], y: z.bounds[1], w: z.bounds[2], h: z.bounds[3] } })),
      doors: [], windows: [], greens: [], bW: 40, bH: 14,
    };
  }

  function Author() {
    const s0 = seed();
    const [zones, setZones] = useState(s0.zones);
    const [doors, setDoors] = useState(s0.doors);
    const [windows, setWindows] = useState(s0.windows);
    const [greens, setGreens] = useState(s0.greens);
    const [bW, setBW] = useState(s0.bW);
    const [bH, setBH] = useState(s0.bH);
    const [mode, setMode] = useState("select"); // select|zone|zonepoly|door|window|green
    const [sel, setSel] = useState(null);        // { kind, key }
    const [draftRect, setDraftRect] = useState(null);
    const [polyDraft, setPolyDraft] = useState(null); // [[x,y],...]
    const wrapRef = useRef(null);
    const drag = useRef(null);

    const LIST = { zone: [zones, setZones], door: [doors, setDoors], window: [windows, setWindows], green: [greens, setGreens] };
    const toPct = useCallback((e) => {
      const r = wrapRef.current.getBoundingClientRect();
      return { x: r2(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))),
               y: r2(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))) };
    }, []);
    const selObj = sel ? (LIST[sel.kind][0].find((o) => o.key === sel.key) || null) : null;
    const patch = (kind, key, fn) => LIST[kind][1]((arr) => arr.map((o) => o.key === key ? fn(o) : o));
    const remove = (kind, key) => { LIST[kind][1]((arr) => arr.filter((o) => o.key !== key)); setSel(null); };

    const CANON = (window.ZONES || []).map((z) => ({ id: z.id, label: z.label }));
    const usedIds = zones.map((z) => z.id);

    // keyboard: Del removes selected, arrows nudge, Esc cancels
    useEffect(() => {
      const onKey = (e) => {
        const tg = e.target;
        if (tg && /^(input|textarea|select)$/i.test(tg.tagName)) return;
        if (e.key === "Escape") { setPolyDraft(null); setSel(null); return; }
        if (!sel) return;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(sel.kind, sel.key); return; }
        const step = e.shiftKey ? 1 : 0.1;
        let dx = 0, dy = 0;
        if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step; else return;
        e.preventDefault();
        patch(sel.kind, sel.key, (o) => o.poly
          ? { ...o, poly: o.poly.map((p) => [r2(p[0] + dx), r2(p[1] + dy)]) }
          : o.rect ? { ...o, rect: { ...o.rect, x: r2(o.rect.x + dx), y: r2(o.rect.y + dy) } }
          : { ...o, x: r2(o.x + dx), y: r2(o.y + dy) });
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [sel, zones, doors, windows, greens]);

    // ── drag helpers ──
    const startMove = (e, kind, key) => {
      e.stopPropagation(); e.preventDefault();
      setSel({ kind, key }); setMode("select");
      const o0 = LIST[kind][0].find((o) => o.key === key);
      const st = toPct(e);
      drag.current = { st, o0: JSON.parse(JSON.stringify(o0)) };
      const move = (ev) => {
        const p = toPct(ev), d = drag.current; if (!d) return;
        const dx = p.x - d.st.x, dy = p.y - d.st.y;
        patch(kind, key, () => {
          const b = d.o0;
          if (b.poly) return { ...b, poly: b.poly.map((q) => [r2(q[0] + dx), r2(q[1] + dy)]) };
          if (b.rect) return { ...b, rect: { ...b.rect, x: r2(b.rect.x + dx), y: r2(b.rect.y + dy) } };
          return { ...b, x: r2(b.x + dx), y: r2(b.y + dy) };
        });
      };
      const up = () => { drag.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
    const startResize = (e, kind, key) => {
      e.stopPropagation(); e.preventDefault();
      setSel({ kind, key });
      const o0 = LIST[kind][0].find((o) => o.key === key);
      const base = o0.rect ? o0.rect : o0;
      const st = toPct(e), ow = base.w, oh = base.h;
      drag.current = { st, ow, oh };
      const move = (ev) => {
        const p = toPct(ev), d = drag.current; if (!d) return;
        patch(kind, key, (o) => {
          const nb = { w: r2(Math.max(0.5, d.ow + (p.x - d.st.x))), h: r2(Math.max(0.5, d.oh + (p.y - d.st.y))) };
          return o.rect ? { ...o, rect: { ...o.rect, ...nb } } : { ...o, ...nb };
        });
      };
      const up = () => { drag.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
    const startVertex = (e, key, vi) => {
      e.stopPropagation(); e.preventDefault();
      setSel({ kind: "zone", key });
      const move = (ev) => { const p = toPct(ev); patch("zone", key, (o) => ({ ...o, poly: o.poly.map((q, i) => i === vi ? [p.x, p.y] : q) })); };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };

    // ── canvas pointer (create) ──
    const onCanvasDown = (e) => {
      const p = toPct(e);
      if (mode === "select") { setSel(null); return; }
      if (mode === "zonepoly") {
        if (polyDraft && polyDraft.length >= 3 && Math.hypot(p.x - polyDraft[0][0], p.y - polyDraft[0][1]) < 1.6) {
          const nid = "zone_" + Date.now().toString(36), nk = uid();
          const poly = polyDraft.map((q) => [r2(q[0]), r2(q[1])]);
          setZones((zs) => [...zs, { key: nk, id: nid, label: "(unnamed)", poly }]);
          setPolyDraft(null); setSel({ kind: "zone", key: nk }); setMode("select");
          return;
        }
        // rectilinear: each new edge snaps to horizontal OR vertical
        // relative to the previous vertex (whichever axis moved more).
        setPolyDraft((d) => {
          const arr = d || [];
          if (arr.length === 0) return [[p.x, p.y]];
          const pr = arr[arr.length - 1];
          const np = Math.abs(p.x - pr[0]) >= Math.abs(p.y - pr[1]) ? [p.x, pr[1]] : [pr[0], p.y];
          return [...arr, np];
        });
        return;
      }
      // rect-drag tools: zone | door | window | green
      drag.current = { sx: p.x, sy: p.y };
      const move = (ev) => { const q = toPct(ev), d = drag.current; if (!d) return;
        setDraftRect([Math.min(d.sx, q.x), Math.min(d.sy, q.y), Math.abs(q.x - d.sx), Math.abs(q.y - d.sy)]); };
      const up = (ev) => {
        const q = toPct(ev), d = drag.current; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        drag.current = null; setDraftRect(null);
        const R = { x: r2(Math.min(d.sx, q.x)), y: r2(Math.min(d.sy, q.y)), w: r2(Math.abs(q.x - d.sx)), h: r2(Math.abs(q.y - d.sy)) };
        if (R.w <= 0.5 || R.h <= 0.5) return;
        const key = uid();
        if (mode === "zone") { setZones((z) => [...z, { key, id: "zone_" + Date.now().toString(36), label: "(unnamed)", rect: R }]); setSel({ kind: "zone", key }); }
        else if (mode === "door") { setDoors((a) => [...a, { key, ...R }]); setSel({ kind: "door", key }); }
        else if (mode === "window") { setWindows((a) => [...a, { key, ...R }]); setSel({ kind: "window", key }); }
        else if (mode === "green") { setGreens((a) => [...a, { key, ...R }]); setSel({ kind: "green", key }); }
        setMode("select");
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };

    // selected-zone id/label
    const setSelId = (nid) => {
      if (!nid || (usedIds.indexOf(nid) !== -1 && nid !== (selObj && selObj.id))) return;
      const c = CANON.find((x) => x.id === nid);
      patch("zone", sel.key, (o) => ({ ...o, id: nid, label: c ? c.label : o.label }));
    };

    const buildGeom = () => ({
      building: { w_mm: Math.round(bW * 1000), h_mm: Math.round(bH * 1000) },
      zones: zones.map((z) => z.poly
        ? { id: z.id, label: z.label, poly: z.poly.map((p) => [r2(p[0]), r2(p[1])]) }
        : { id: z.id, label: z.label, rect: [r2(z.rect.x), r2(z.rect.y), r2(z.rect.w), r2(z.rect.h)] }),
      doors: doors.map((d) => ({ rect: [r2(d.x), r2(d.y), r2(d.w), r2(d.h)] })),
      windows: windows.map((w) => ({ rect: [r2(w.x), r2(w.y), r2(w.w), r2(w.h)] })),
      greens: greens.map((g) => ({ rect: [r2(g.x), r2(g.y), r2(g.w), r2(g.h)] })),
    });
    const exportGeom = () => {
      const json = JSON.stringify(buildGeom(), null, 1);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = "rpgarchitecture_geometry.json"; a.click();
      try { navigator.clipboard.writeText(json); } catch (e) {}
      console.log("=== rpgarchitecture_geometry.json (also copied to clipboard) ===\n" + json);
    };

    const isSel = (kind, key) => sel && sel.kind === kind && sel.key === key;
    const rectEl = (kind, o, fill, stroke) => {
      const on = isSel(kind, o.key);
      return (
        <g key={o.key}>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={on ? fill.on : fill.off}
            stroke={on ? "#caa46a" : stroke} strokeWidth={on ? "0.7" : "0.4"} vectorEffect="non-scaling-stroke"
            style={{ cursor: "move", pointerEvents: mode === "select" ? "auto" : "none" }} onPointerDown={(e) => startMove(e, kind, o.key)} />
          {mode === "select" && on && (
            <g onPointerDown={(e) => startResize(e, kind, o.key)} style={{ cursor: "nwse-resize" }}>
              <rect x={o.x + o.w - 4} y={o.y + o.h - 4} width="8" height="8" fill="transparent" />
              <rect x={o.x + o.w - 2.6} y={o.y + o.h - 2.6} width="2.6" height="2.6" fill="#fff" stroke="#1c1915" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </g>
      );
    };

    const TOOL = { select: "select", zone: "+ zone box", zonepoly: "+ zone poly", door: "+ door", window: "+ window", green: "+ green" };
    const unnamed = zones.filter((z) => !CANON.some((c) => c.id === z.id)).length;

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#15130f", display: "flex", flexDirection: "column", font: "13px 'JetBrains Mono',ui-monospace,monospace", color: "#f3ede2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "#211d17", flexWrap: "wrap" }}>
          <b style={{ color: "#caa46a" }}>SENTIARCH · AUTHOR</b>
          {Object.keys(TOOL).map((m) => (
            <button key={m} onClick={() => { setMode(m); setPolyDraft(null); }}
              style={{ padding: "5px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid #4a4334",
                background: mode === m ? "#caa46a" : "transparent", color: mode === m ? "#1c1915" : "#f3ede2" }}>{TOOL[m]}</button>
          ))}
          <span style={{ marginLeft: 8, opacity: .8 }}>building&nbsp;
            <input type="number" value={bW} onChange={(e) => setBW(+e.target.value)} style={{ width: 50, background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4 }} /> ×
            <input type="number" value={bH} onChange={(e) => setBH(+e.target.value)} style={{ width: 50, background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4, marginLeft: 4 }} /> m
          </span>
          <span style={{ opacity: .6, fontSize: 11 }}>z {zones.length} · d {doors.length} · w {windows.length} · g {greens.length}{unnamed ? " · ⚠" + unnamed : ""}</span>
          <button onClick={exportGeom} style={{ marginLeft: "auto", padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", background: "#5fae74", color: "#10210f", fontWeight: 600 }}>⤓ Export JSON</button>
          <button onClick={() => { location.search = ""; }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #4a4334", background: "transparent", color: "#f3ede2", cursor: "pointer" }}>exit</button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, overflow: "auto" }}>
            <div ref={wrapRef} onPointerDown={onCanvasDown}
              onDoubleClick={() => { if (mode === "zonepoly" && polyDraft && polyDraft.length >= 3) {
                const nid = "zone_" + Date.now().toString(36), nk = uid();
                setZones((zs) => [...zs, { key: nk, id: nid, label: "(unnamed)", poly: polyDraft.map((q) => [r2(q[0]), r2(q[1])]) }]);
                setPolyDraft(null); setSel({ kind: "zone", key: nk }); setMode("select"); } }}
              style={{ position: "relative", width: "min(100%, 1320px)", aspectRatio: "1586 / 992", boxShadow: "0 0 0 1px #4a4334", cursor: mode === "select" ? "default" : "crosshair" }}>
              <img src={FLOOR} alt="plan" draggable={false} style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                {greens.map((g) => rectEl("green", g, { off: "rgba(95,174,116,.35)", on: "rgba(95,174,116,.55)" }, "#5fae74"))}
                {draftRect && <rect x={draftRect[0]} y={draftRect[1]} width={draftRect[2]} height={draftRect[3]} fill="rgba(202,164,106,.20)" stroke="#caa46a" strokeDasharray="1" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />}
                {zones.map((z) => {
                  const on = isSel("zone", z.key);
                  if (z.poly) {
                    const c = bbox(z.poly);
                    return (
                      <g key={z.key}>
                        <polygon points={z.poly.map((p) => p.join(",")).join(" ")}
                          fill={on ? "rgba(202,164,106,.20)" : "rgba(0,0,0,.04)"} stroke={on ? "#caa46a" : "#d2683f"}
                          strokeWidth={on ? "0.7" : "0.4"} vectorEffect="non-scaling-stroke"
                          style={{ cursor: "move", pointerEvents: mode === "select" ? "auto" : "none" }} onPointerDown={(e) => startMove(e, "zone", z.key)} />
                        <text x={c.x + 0.6} y={c.y + 2.6} fill={on ? "#caa46a" : "#d2683f"} style={{ font: "2px 'JetBrains Mono'", pointerEvents: "none" }}>{z.id}</text>
                        {mode === "select" && on && z.poly.map((p, vi) => (
                          <circle key={vi} cx={p[0]} cy={p[1]} r="1.1" fill="#fff" stroke="#1c1915" strokeWidth="1" vectorEffect="non-scaling-stroke"
                            style={{ cursor: "grab" }} onPointerDown={(e) => startVertex(e, z.key, vi)} />
                        ))}
                      </g>
                    );
                  }
                  return (
                    <g key={z.key}>
                      <rect x={z.rect.x} y={z.rect.y} width={z.rect.w} height={z.rect.h}
                        fill={on ? "rgba(202,164,106,.20)" : "rgba(0,0,0,.04)"} stroke={on ? "#caa46a" : "#d2683f"}
                        strokeWidth={on ? "0.7" : "0.4"} vectorEffect="non-scaling-stroke"
                        style={{ cursor: "move", pointerEvents: mode === "select" ? "auto" : "none" }} onPointerDown={(e) => startMove(e, "zone", z.key)} />
                      <text x={z.rect.x + 0.6} y={z.rect.y + 2.6} fill={on ? "#caa46a" : "#d2683f"} style={{ font: "2px 'JetBrains Mono'", pointerEvents: "none" }}>{z.id}</text>
                      {mode === "select" && on && (
                        <g onPointerDown={(e) => startResize(e, "zone", z.key)} style={{ cursor: "nwse-resize" }}>
                          <rect x={z.rect.x + z.rect.w - 4} y={z.rect.y + z.rect.h - 4} width="8" height="8" fill="transparent" />
                          <rect x={z.rect.x + z.rect.w - 2.6} y={z.rect.y + z.rect.h - 2.6} width="2.6" height="2.6" fill="#fff" stroke="#1c1915" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                        </g>
                      )}
                    </g>
                  );
                })}
                {doors.map((d) => rectEl("door", d, { off: "rgba(108,169,216,.40)", on: "rgba(108,169,216,.65)" }, "#6ca9d8"))}
                {windows.map((w) => rectEl("window", w, { off: "rgba(155,209,224,.45)", on: "rgba(155,209,224,.70)" }, "#9bd1e0"))}
                {polyDraft && polyDraft.length > 0 && (
                  <g>
                    <polyline points={polyDraft.map((p) => p.join(",")).join(" ")} fill="rgba(202,164,106,.12)" stroke="#ffd479" strokeWidth="0.5" strokeDasharray="1" vectorEffect="non-scaling-stroke" />
                    {polyDraft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? "1.4" : "0.9"} fill={i === 0 ? "#ffd479" : "#fff"} stroke="#1c1915" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                  </g>
                )}
              </svg>
            </div>
          </div>

          <div style={{ width: 234, background: "#211d17", padding: "10px 12px", overflow: "auto" }}>
            {selObj && (
              <div style={{ background: "#15130f", border: "1px solid #4a4334", borderRadius: 6, padding: "8px 9px", marginBottom: 10 }}>
                <div style={{ color: "#caa46a", marginBottom: 6, fontSize: 11 }}>SELECTED · {sel.kind}{selObj.poly ? " (polygon)" : ""}</div>
                {sel.kind === "zone" && (
                  <>
                    <select value={CANON.some((c) => c.id === selObj.id) ? selObj.id : ""} onChange={(e) => setSelId(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4, padding: "3px", marginBottom: 6 }}>
                      <option value="">{CANON.some((c) => c.id === selObj.id) ? "—" : "(pick centre zone id)"}</option>
                      {CANON.map((c) => { const taken = usedIds.indexOf(c.id) !== -1 && c.id !== selObj.id;
                        return <option key={c.id} value={c.id} disabled={taken}>{c.id}{taken ? " (used)" : ""}</option>; })}
                    </select>
                    <input value={selObj.label} onChange={(e) => patch("zone", sel.key, (o) => ({ ...o, label: e.target.value }))} placeholder="label"
                      style={{ width: "100%", boxSizing: "border-box", background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4, padding: "3px", marginBottom: 6 }} />
                  </>
                )}
                {selObj.poly ? (
                  <div style={{ fontSize: 11, opacity: .7, marginBottom: 6 }}>polygon · {selObj.poly.length} pts — drag the white dots to align</div>
                ) : (
                  <>
                    <div style={{ fontSize: 10.5, opacity: .7, marginBottom: 3 }}>position / size (% of plan)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 7 }}>
                      {["x", "y", "w", "h"].map((k) => {
                        const val = selObj.rect ? selObj.rect[k] : selObj[k];
                        return (
                          <label key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, opacity: .85 }}>
                            <span style={{ width: 14, color: "#9a8f7d" }}>{k}</span>
                            <input type="number" step="0.1" value={val}
                              onChange={(e) => { const n = parseFloat(e.target.value); if (isNaN(n)) return;
                                const mn = (k === "w" || k === "h") ? 0.5 : 0; const nv = r2(Math.max(mn, n));
                                patch(sel.kind, sel.key, (o) => o.rect ? { ...o, rect: { ...o.rect, [k]: nv } } : { ...o, [k]: nv }); }}
                              style={{ width: "100%", boxSizing: "border-box", background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4, padding: "2px 3px" }} />
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
                <button onClick={() => remove(sel.kind, sel.key)}
                  style={{ width: "100%", padding: "5px", borderRadius: 4, border: "1px solid #6b3326", background: "transparent", color: "#e0866a", cursor: "pointer" }}>delete (Del)</button>
              </div>
            )}
            <div style={{ color: "#caa46a", marginBottom: 6 }}>ZONES · {zones.length}</div>
            {zones.map((z) => { const bad = !CANON.some((c) => c.id === z.id);
              return (
                <div key={z.key} onClick={() => { setMode("select"); setSel({ kind: "zone", key: z.key }); }}
                  style={{ padding: "4px 6px", borderRadius: 4, cursor: "pointer", marginBottom: 2,
                    background: isSel("zone", z.key) ? "#caa46a" : "transparent", color: isSel("zone", z.key) ? "#1c1915" : (bad ? "#e0a87a" : "#cfc6b4") }}>
                  {bad ? "⚠ " : ""}{z.id}{z.poly ? " ⬠" : ""}
                </div>
              );
            })}
            <div style={{ marginTop: 12, fontSize: 11, opacity: .7, lineHeight: 1.65 }}>
              · <b>select</b>: click any object → drag = move, white corner = resize, panel = exact %, Del = remove, arrows = nudge<br />
              · <b>+ zone box</b>: drag a rectangle<br />
              · <b>+ zone poly</b>: click corners (edges snap to horizontal/vertical only); click the yellow start dot (or double-click) to close; Esc cancels — drag white dots to fine-tune<br />
              · <b>+ door / + window / + green</b>: drag a box (doors & windows are boxes now)<br />
              · ⚠ = zone id not one of the 18 (no engine climate) · ⬠ = polygon<br />
              · Export → send me rpgarchitecture_geometry.json
            </div>
          </div>
        </div>
      </div>
    );
  }

  const mount = document.createElement("div");
  document.body.appendChild(mount);
  ReactDOM.createRoot(mount).render(<Author />);
})();
