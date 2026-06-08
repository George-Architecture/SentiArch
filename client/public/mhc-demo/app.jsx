/* global React, ReactDOM, AGENTS, ZONES, spriteStyle */
const { useState, useRef, useEffect, useCallback, useMemo } = React;
const r2 = (n) => Math.round(n * 100) / 100;

// Live-animation registry — agentId → { anim, sprite } DOM nodes + wander
// state. Module-level so <PlacedAgent> (rendered inside PlanCanvas) and the
// rAF loop (in App) can share it without prop-drilling through PlanCanvas.
const animMap = new Map();
function registerAnim(agentId, nodes) {
  if (!nodes) { animMap.delete(agentId); return; }
  const prev = animMap.get(agentId) || { ph: Math.random() * 100, wx: 0, wy: 0, tx: 0, ty: 0, retargetAt: 0 };
  animMap.set(agentId, { ...prev, ...nodes });
}

// ─────────────────────────────────────────────────────────────
//  SentiArch — App shell
// ─────────────────────────────────────────────────────────────

function App() {
  // placedAgents: Map<agentId, { zoneId, x: %, y: % }>
  const [placed, setPlaced] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [chats, setChats] = useState({}); // agentId → [{role,content,thinking?}]
  const [hoverZone, setHoverZone] = useState(null);
  const [dragging, setDragging] = useState(null); // { agentId, mouseX, mouseY } during drag
  const [engineByAgent, setEngineByAgent] = useState({}); // agentId → SentiArch engine result

  const planRef = useRef(null);
  // Mirror of `placed` so handlers read current positions synchronously
  // (React 18 does NOT guarantee a setState updater runs before the next
  // line, so capturing `positions` inside setPlaced was flaky → engine
  // got positions=undefined → blank panel in layout mode).
  const placedRef = useRef({});
  useEffect(() => { placedRef.current = placed; }, [placed]);

  // ── Live sprite animation ───────────────────────────────────
  //  One rAF loop drives idle-breathing + a slow cosmetic wander for
  //  every placed agent. PURE PRESENTATION: the engine anchor
  //  placed[id] never moves, so perceptual readings are unaffected.
  //  Calm vs anxious motion is driven by comfort_score / stress_score.
  const engineRef = useRef({});
  const selRef = useRef(null);
  useEffect(() => { engineRef.current = engineByAgent; }, [engineByAgent]);
  useEffect(() => { selRef.current = selectedId; }, [selectedId]);

  useEffect(() => {
    if (!Object.keys(placed).length) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = Math.min(50, now - last); last = now;
      animMap.forEach((s, id) => {
        if (!s.anim || !s.sprite) return;
        const eng = engineRef.current[id];
        const llm = eng && eng.llm && eng.llm.status === "ok" ? eng.llm : null;
        // ── Wait for the LLM assessment before showing any score, aura, or
        //  animation. The agent sits still on the plan during the pending
        //  window; everything pops in together when the reading returns
        //  (or falls back to engine baseline on failure). ──
        const awaiting = !eng || !eng.llm || eng.llm.status === "pending";
        if (awaiting) {
          if (s.anim) s.anim.style.transform = "translate(0px,0px)";
          if (s.sprite) { s.sprite.style.transform = "rotate(0deg) scale(1,1)"; s.sprite.style.filter = "none"; }
          if (s.aura) s.aura.style.opacity = 0;
          if (s.fx) { for (let i = 0; i < s.fx.children.length; i++) s.fx.children[i].style.opacity = 0; }
          if (s.hp && s.hp.parentElement) s.hp.parentElement.style.opacity = 0;
          return;
        }
        if (s.hp && s.hp.parentElement) s.hp.parentElement.style.opacity = "";
        const comfort = llm ? llm.comfort : eng.comfort_score;
        const stress = llm ? llm.stress : eng.stress_score;
        // 0 = at ease … 1 = anxious / uncomfortable
        const unease = Math.max(0, Math.min(1, (stress / 10) * 0.6 + (1 - comfort / 10) * 0.55));
        const sel = selRef.current === id;

        // idle breathing — squash/stretch anchored at the feet
        s.ph += dt * 0.001 * (1.0 + unease * 1.8);
        const breath = Math.sin(s.ph) * (0.045 + unease * 0.03);

        // wander — drift to a fresh nearby target after each pause
        const radius = (7 + (1 - unease) * 13) * (sel ? 0.35 : 1);
        if (now > s.retargetAt) {
          const ang = Math.random() * Math.PI * 2;
          const reach = radius * (0.4 + Math.random() * 0.6);
          s.tx = Math.cos(ang) * reach;
          s.ty = Math.sin(ang) * reach * 0.5;        // flatter Y — reads as floor
          s.retargetAt = now + (unease > 0.55 ? 450 + Math.random() * 950 : 1800 + Math.random() * 2800);
        }
        const k = Math.min(1, (0.0011 + unease * 0.0027) * dt);
        s.wx += (s.tx - s.wx) * k;
        s.wy += (s.ty - s.wy) * k;
        const moving = Math.hypot(s.tx - s.wx, s.ty - s.wy) > 0.7;

        // anxious fidget + walk bob + lean toward travel
        const jx = unease > 0.5 ? (Math.random() - 0.5) * (unease - 0.5) * 3.2 : 0;
        const jy = unease > 0.5 ? (Math.random() - 0.5) * (unease - 0.5) * 2.0 : 0;
        const bob = moving ? Math.abs(Math.sin(s.ph * 2.4)) * (1.4 + unease) : 0;
        const lean = moving ? Math.max(-1, Math.min(1, (s.tx - s.wx) * 0.4)) * (3 + unease * 4) : 0;

        s.anim.style.transform = `translate(${(s.wx + jx).toFixed(2)}px, ${(s.wy - bob + jy).toFixed(2)}px)`;
        s.sprite.style.transform = `rotate(${lean.toFixed(2)}deg) scale(${(1 - breath).toFixed(3)},${(1 + breath).toFixed(3)})`;

        // ── comfort aura: red distress flame ↔ green healing glow ──
        const at = Math.max(-1, Math.min(1, (comfort - 7) / 2.5));  // engine range ~5-9 → 7 neutral
        const amag = Math.abs(at);
        const distress = at < 0;
        if (s.aura) {
          if (amag < 0.16) {
            s.aura.style.opacity = 0;
            s.sprite.style.filter = "none";
          } else {
            const col = distress
              ? `255,${Math.round(58 + (1 - amag) * 82)},34`
              : `${Math.round(72 + (1 - amag) * 44)},206,${Math.round(126 + (1 - amag) * 34)}`;
            const flick = distress ? 0.6 + Math.random() * 0.4 : 0.84 + Math.sin(s.ph * 1.4) * 0.16;
            s.aura.style.opacity = Math.min(1, 0.46 + amag * flick * 0.74).toFixed(3);
            s.aura.style.background =
              `radial-gradient(ellipse 58% 68% at 50% 64%, rgba(${col},1) 0%, rgba(${col},0.55) 44%, rgba(${col},0) 82%)`;
            const ax = distress ? 1.04 + Math.random() * 0.14 : 1 + Math.sin(s.ph * 1.4) * 0.06;
            const ay = distress ? 1.16 + Math.random() * 0.42 : 1.02 + Math.sin(s.ph * 1.4 + 1) * 0.08;
            s.aura.style.transform = `translateX(-50%) scale(${ax.toFixed(2)},${ay.toFixed(2)})`;
            const ga = (0.62 + amag * 0.38).toFixed(2);
            s.sprite.style.filter =
              `drop-shadow(0 0 ${(3 + amag * 6).toFixed(1)}px rgba(${col},${ga})) ` +
              `drop-shadow(0 0 ${(8 + amag * 15).toFixed(1)}px rgba(${col},${(amag * 0.6).toFixed(2)}))`;
          }
        }
        // ── aura particles: rising embers (red) / drifting motes (green) ──
        if (s.fx) {
          const on = amag >= 0.16;
          const kids = s.fx.children;
          if (on && !s.parts) s.parts = Array.from(kids, () => ({ p: Math.random(), x: Math.random() - 0.5 }));
          for (let i = 0; i < kids.length; i++) {
            const el = kids[i], pt = s.parts && s.parts[i];
            if (!on || !pt) { el.style.opacity = 0; continue; }
            pt.p += dt * 0.001 * (distress ? 0.5 + (i % 3) * 0.14 : 0.24);
            if (pt.p >= 1) { pt.p -= 1; pt.x = Math.random() - 0.5; }
            const life = pt.p, fade = Math.sin(life * Math.PI);
            const rise = 6 + life * (distress ? 44 : 34);
            const sway = Math.sin(life * 6 + i * 1.7) * (distress ? 3.5 : 7);
            const sz = (distress ? 3 + life * 3.4 : 5 - life * 2.2).toFixed(1);
            el.style.opacity = (fade * amag * 0.95).toFixed(2);
            el.style.width = el.style.height = sz + "px";
            el.style.transform = `translate(${(pt.x * 15 + sway).toFixed(1)}px, ${(-rise).toFixed(1)}px)`;
            el.style.background = distress
              ? `rgba(255,${132 + Math.round(life * 88)},50,1)`
              : `rgba(${168 + Math.round(life * 68)},255,206,1)`;
            el.style.boxShadow = distress
              ? "0 0 7px rgba(255,120,40,0.95)" : "0 0 7px rgba(150,255,190,0.9)";
          }
        }
        // ── floating RPG bars: HP = comfort, MP = stress ──
        if (s.hp) {
          s.hp.style.width = (Math.max(0, Math.min(10, comfort)) * 10).toFixed(1) + "%";
          s.hp.style.background = comfort >= 7.5 ? "linear-gradient(#86dd92,#4fae62)"
            : comfort >= 5.5 ? "linear-gradient(#e8c46b,#c69a3f)"
            : "linear-gradient(#e58457,#c0432a)";
        }
        if (s.mp) {
          s.mp.style.width = (Math.max(0, Math.min(10, stress)) * 10).toFixed(1) + "%";
          s.mp.style.background = stress >= 4 ? "linear-gradient(#c98ae8,#8a4fc8)"
            : "linear-gradient(#8aa6ee,#4f6fc8)";
        }
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [placed]);

  // ── Re-sync EVERY placed agent's engine result ──────────────
  //  Each agent's perception depends on the others (visible_agents,
  //  density), so whenever placements change we recompute them all —
  //  not just the one that moved — otherwise earlier-placed agents
  //  keep a stale reading that never "sees" the people added later.
  const recomputeAllEngines = useCallback((positions) => {
    const prev = engineRef.current || {};
    const next = {};
    for (const [aid, info] of Object.entries(positions || {})) {
      const zone = getMHCLayout()
        ? layoutZoneById(info.zoneId)
        : ZONES.find((z) => z.id === info.zoneId);
      if (!zone) continue;
      const eng = computeEngineResult(aid, zone, positions);
      if (eng) {
        // keep the agent's existing Layer-2 (LLM) assessment across a
        // re-sync; only the agent that actually moved gets re-read.
        if (prev[aid] && prev[aid].llm) eng.llm = prev[aid].llm;
        next[aid] = eng;
      }
    }
    setEngineByAgent(next);
    return next;
  }, []);

  // ── Drop logic ──
  const handleDrop = useCallback((agentId, clientX, clientY) => {
    const plan = planRef.current;
    if (!plan) return;
    const rect = plan.getBoundingClientRect();
    const hit = resolveDropAt(rect, clientX, clientY);
    if (!hit) return;
    const { xPct, yPct, wx, wy, zone } = hit;

    const newInfo = { zoneId: zone.id, x: xPct, y: yPct, wx, wy };
    const positions = { ...placedRef.current, [agentId]: newInfo };
    placedRef.current = positions;
    setPlaced(prev => ({ ...prev, [agentId]: newInfo }));
    setSelectedId(agentId);
    // Re-sync the whole room, then narrate just the new arrival.
    const engMap = recomputeAllEngines(positions);
    triggerSpatialReading(agentId, zone, engMap[agentId], positions);
  }, []);

  // ── Layer 2: the LLM becomes the agent, scores the 6 felt
  //  dimensions itself, and narrates. `eng` is the Layer-1 input. ──
  const triggerSpatialReading = useCallback(async (agentId, zone, eng, positions) => {
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) return;
    const social = resolveSocialContext(agentId, positions || placedRef.current);
    setChats(prev => ({
      ...prev,
      [agentId]: [
        ...(prev[agentId] || []),
        { role: "system_event", content: `Placed in ${zone.label}`, zoneId: zone.id, ts: Date.now() },
        { role: "assistant", content: "", thinking: true, ts: Date.now() },
      ],
    }));
    // mark the Layer-2 assessment pending — the panel shows the
    // Layer-1 baseline meanwhile, then swaps to the LLM's reading.
    setEngineByAgent(prev => {
      const e = prev[agentId];
      if (!e) return prev;
      return { ...prev, [agentId]: { ...e, llm: { status: "pending" } } };
    });

    const putNarration = (text) => setChats(prev => {
      const list = [...(prev[agentId] || [])];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].thinking) { list[i] = { role: "assistant", content: text, ts: Date.now() }; break; }
      }
      return { ...prev, [agentId]: list };
    });

    if (!eng) {
      // no engine result — plain narration, no scoring
      try {
        const reply = await window.claude.complete({
          messages: [{ role: "user", content: CHAT_TASK }],
          system: buildSystemPrompt(agent, zone, eng, social),
        });
        putNarration(reply);
      } catch (e) { putNarration(`(reading unavailable: ${String(e).slice(0,100)})`); }
      return;
    }

    try {
      const raw = await window.claude.complete({
        messages: [{ role: "user", content: SCORING_TASK }],
        system: buildSystemPrompt(agent, zone, eng, social),
        format: "json",
        num_predict: 800,
        temperature: 0.6,
      });
      const parsed = parseAssessment(raw);
      if (!parsed) throw new Error("could not parse assessment");
      const { stress, comfort } = feltComfort(parsed.dims);
      setEngineByAgent(prev => {
        const e = prev[agentId];
        if (!e) return prev;
        return { ...prev, [agentId]: { ...e, llm: {
          status: "ok", dims: parsed.dims, reasons: parsed.reasons,
          comfort, stress, ts: Date.now(),
        } } };
      });
      putNarration(parsed.narration || "(…)");
    } catch (e) {
      setEngineByAgent(prev => {
        const e2 = prev[agentId];
        if (!e2) return prev;
        return { ...prev, [agentId]: { ...e2, llm: { status: "failed" } } };
      });
      putNarration(`(reading unavailable: ${String(e).slice(0,100)})`);
    }
  }, []);

  // ── Free-text chat with an agent (defaults to selectedId) ──
  const sendMessage = useCallback(async (text, agentIdOverride) => {
    const targetId = agentIdOverride || selectedId;
    if (!targetId || !text.trim()) return;
    const agent = AGENTS.find(a => a.id === targetId);
    const place = placed[targetId];
    const zone = place ? (getMHCLayout() ? layoutZoneById(place.zoneId) : ZONES.find(z => z.id === place.zoneId)) : null;
    if (!agent || !zone) return;

    const history = chats[targetId] || [];
    const next = [...history, { role: "user", content: text, ts: Date.now() }, { role: "assistant", content: "", thinking: true, ts: Date.now() }];
    setChats(prev => ({ ...prev, [targetId]: next }));

    const eng = engineByAgent[targetId] || computeEngineResult(targetId, zone, placed);
    const social = resolveSocialContext(targetId, placed);
    const system = buildSystemPrompt(agent, zone, eng, social) + "\n\n" + CHAT_TASK;
    const messages = [];
    for (const m of history) {
      if (m.role === "user" || m.role === "assistant") {
        if (m.thinking) continue;
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: "user", content: text });

    try {
      const reply = await window.claude.complete({ messages, system });
      setChats(prev => {
        const list = [...(prev[targetId] || [])];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].thinking) { list[i] = { role: "assistant", content: reply, ts: Date.now() }; break; }
        }
        return { ...prev, [targetId]: list };
      });
    } catch (e) {
      setChats(prev => {
        const list = [...(prev[targetId] || [])];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].thinking) { list[i] = { role: "assistant", content: `(unable to reply: ${String(e).slice(0,100)})`, ts: Date.now() }; break; }
        }
        return { ...prev, [targetId]: list };
      });
    }
  }, [selectedId, placed, chats, engineByAgent]);

  const clearAgent = useCallback((agentId) => {
    const remaining = { ...placedRef.current };
    delete remaining[agentId];
    placedRef.current = remaining;
    setPlaced(remaining);
    setChats(prev => { const n = { ...prev }; delete n[agentId]; return n; });
    // re-sync the agents still on the plan (one fewer body → less density)
    recomputeAllEngines(remaining);
    if (selectedId === agentId) setSelectedId(null);
  }, [selectedId]);

  const resetAll = useCallback(() => {
    setPlaced({});
    setChats({});
    setSelectedId(null);
    setEngineByAgent({});
  }, []);

  // ── Determine which agents have been placed for the legend tray ──
  const placedIds = Object.keys(placed);
  const trayAgents = AGENTS; // always show all 25 in tray (placed ones get a marker)
  const selAgent = (selectedId && placed[selectedId]) ? AGENTS.find(a => a.id === selectedId) : null;
  const selZone = selAgent
    ? (getMHCLayout() ? layoutZoneById(placed[selectedId].zoneId) : ZONES.find(z => z.id === placed[selectedId].zoneId))
    : null;

  return (
    <div className="app">
      <Header placedCount={placedIds.length} onReset={resetAll} />
      <div className="stage">
        <ChatDock
          agent={selAgent}
          zone={selZone}
          messages={selAgent ? (chats[selectedId] || []) : []}
          onSend={(text) => { if (selectedId) sendMessage(text, selectedId); }}
          onClose={() => setSelectedId(null)}
        />
        <PlanCanvas
          planRef={planRef}
          placed={placed}
          dragging={dragging}
          hoverZone={hoverZone}
          setHoverZone={setHoverZone}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onDrop={handleDrop}
          onStartDrag={setDragging}
          onClearAgent={clearAgent}
          chats={chats}
          onSendMessage={sendMessage}
        />
        <SidePanel
          agents={trayAgents}
          placed={placed}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          chats={chats}
          engineByAgent={engineByAgent}
          onSendMessage={sendMessage}
          onClearAgent={clearAgent}
          onStartDrag={setDragging}
          dragging={dragging}
          onDrop={handleDrop}
        />
      </div>
      {dragging && <DragGhost agentId={dragging.agentId} x={dragging.mouseX} y={dragging.mouseY} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  SentiArch engine bridge — quantitative perceptual load for
//  (agent, zone) via the ported engine + hard-fixed centre site.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  Layer split — thesis methodology v2
//  Layer 1 (engine) = objective physics / geometry only.
//  Layer 2 (the LLM) = BECOMES the character, then scores the 6
//  felt dimensions itself. The engine's own 6-dim accState is kept
//  only as a Layer-1 baseline / fallback when the LLM is absent.
// ─────────────────────────────────────────────────────────────
const FELT_DIMS = ["thermal", "visual", "noise", "social", "temporal", "wayfinding"];
// felt dim → engine accState key (for the Layer-1 baseline)
const ENGINE_DIM_KEY = {
  thermal: "thermal_discomfort", visual: "visual_strain", noise: "noise_stress",
  social: "social_overload", temporal: "fatigue", wayfinding: "wayfinding_anxiety",
};
// stress weighting — identical to the engine's computeStressScore, so
// only WHO produced the 6 inputs changes, not how they roll up.
const DIM_WEIGHT = {
  thermal: 0.20, visual: 0.15, noise: 0.20, social: 0.15, temporal: 0.15, wayfinding: 0.15,
};

// comfort / stress derived from the 6 felt-dimension scores (0-100 each)
function feltComfort(dims) {
  let stress = 0;
  for (const d of FELT_DIMS) {
    stress += (Math.max(0, Math.min(100, dims[d] || 0)) / 100) * DIM_WEIGHT[d];
  }
  stress = Math.round(Math.min(10, Math.max(0, stress * 10)) * 10) / 10;
  return { stress, comfort: Math.max(1, Math.min(10, Math.round(10 - stress))) };
}

// parse the LLM's JSON assessment defensively
function parseAssessment(raw) {
  let obj = null;
  try { obj = JSON.parse(raw); }
  catch (e) {
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!obj || typeof obj !== "object") return null;
  const dims = {}, reasons = {};
  for (const d of FELT_DIMS) {
    const v = obj[d];
    let score = 0, reason = "";
    if (v && typeof v === "object") { score = Number(v.score); reason = String(v.reason || ""); }
    else if (typeof v === "number") { score = v; }
    dims[d] = isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
    reasons[d] = reason;
  }
  const narration = typeof obj.narration === "string" ? obj.narration.trim() : "";
  return { dims, reasons, narration };
}

// Layer-2 task — become the character, score the 6 felt dimensions.
const SCORING_TASK = [
  `BECOME this person now and read the room. For each of the 6 pressures, decide — as YOU, through your disposition and anxiety register — how strongly it weighs on you right now: 0 = not felt at all, 100 = overwhelming. The same physical fact lands differently on different people; a measured 66 dB is background to a steady person and a wall of pressure to an anxious one. Score what YOU feel, justified by the Layer-1 physical readout above and by who you are.`,
  ``,
  `The 6 pressures:`,
  `· thermal — the air / temperature on your body`,
  `· visual — the light: dim, glaring, or windowless strain`,
  `· noise — the sound as it presses on you`,
  `· social — the people here: WHO they are to you matters as much as how many; a room holding your own therapist, or your spouse, is not a room of strangers`,
  `· temporal — how the time you have spent here is wearing on you`,
  `· wayfinding — orientation: knowing the way out, free vs trapped`,
  ``,
  `Reply with JSON ONLY, exactly this shape. Every "reason" must be TERSE — 14 words maximum, clipped, no full paragraphs; spend your effort on the narration instead:`,
  `{`,
  `  "thermal":    {"score": 0-100, "reason": "<=14 words, tying the score to the physical fact AND to who you are"},`,
  `  "visual":     {"score": 0-100, "reason": "..."},`,
  `  "noise":      {"score": 0-100, "reason": "..."},`,
  `  "social":     {"score": 0-100, "reason": "..."},`,
  `  "temporal":   {"score": 0-100, "reason": "..."},`,
  `  "wayfinding": {"score": 0-100, "reason": "..."},`,
  `  "narration":  "2-4 sentences, first person, present tense, in YOUR voice — how being here actually feels, grounded in body and senses at the intensity your register warrants. Ordinary lived language: no numbers, no units, no instrument words."`,
  `}`,
].join("\n");

// Layer-2 task — free conversation, in character.
const CHAT_TASK = `Reply AS this person — first person, present tense, your own voice, grounded in body and senses at the intensity your anxiety register warrants. 2-4 sentences. Use only the spatial facts given; invent nothing. Ordinary lived language — no numbers, units or instrument words. Never break character.`;

// relationship type (from the persona graph) → a phrase, holder's POV
const RELATION_PHRASE = {
  is_clinician:            "is your clinician — the person who treats you here",
  is_client_of:            "is your client — you are the one treating them",
  checks_in_with:          "is the receptionist you check in with",
  is_spouse_of:            "is your spouse",
  is_clinician_of_spouse:  "is your spouse's clinician",
  is_colleague_of:         "is a colleague you work alongside here",
  is_facilitator:          "facilitates your support group",
  is_circle_member:        "is a fellow member of your support circle",
  is_locum_client:         "is a client you are covering as a locum",
  is_locum_clinician:      "is the locum standing in for your usual clinician",
  is_locum_for_my_clients: "is the locum covering your own clients",
};

// Who is in the SAME zone as `agentId`, resolved against this agent's
// relationship graph — so the LLM can reason socially, not just count.
function resolveSocialContext(agentId, positions) {
  const P = window.MHC_PERSONAS || {};
  const self = P[agentId];
  const here = positions && positions[agentId];
  if (!self || !here) return [];
  const relByEngineId = {};
  const rels = (self.agent && self.agent.relationships) || [];
  for (const r of rels) { if (r && r.with) relByEngineId[r.with] = r.type; }
  const out = [];
  for (const did of Object.keys(positions)) {
    if (did === agentId) continue;
    if (positions[did].zoneId !== here.zoneId) continue;
    const a = P[did] && P[did].agent;
    if (!a) continue;
    out.push({ name: a.name, role: a.role, relation: relByEngineId[a.id] || null });
  }
  return out;
}

// Memoised build of traced geometry → engine Shape[] + per-zone mm
// bounds + zonesMM (for ceiling/density). Rebuilds if MHC_GEOMETRY
// reference changes. Returns null when no geometry traced yet.
let _geomSrc = undefined, _geomBuilt = null;
function getMHCGeometry() {
  const g = window.MHC_GEOMETRY;
  if (!g) return null;
  if (g === _geomSrc) return _geomBuilt;
  const E = window.SentiArchEngine, S = window.MHC_SITE || {};
  const B = g.building || { w_mm: 40000, h_mm: 14000 };
  const shapes = E.buildShapesFromGeometry(g);
  const zoneBoundsById = {};
  const zonesMM = (g.zones || []).map((z) => {
    let b;
    if (z.poly && z.poly.length >= 3) {
      const pts = z.poly.map((p) => [p[0] / 100 * B.w_mm, p[1] / 100 * B.h_mm]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      b = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, points: pts };
    } else if (z.rect) {
      b = { x: z.rect[0] / 100 * B.w_mm, y: z.rect[1] / 100 * B.h_mm,
            width: z.rect[2] / 100 * B.w_mm, height: z.rect[3] / 100 * B.h_mm };
    } else { return null; }
    zoneBoundsById[z.id] = b;
    return { id: z.id, label: z.label || z.id, bounds: b, env: (S[z.id] && S[z.id].env) || { ceiling_height: 2700 } };
  }).filter(Boolean);
  _geomSrc = g;
  _geomBuilt = { shapes, zonesMM, zoneBoundsById, building: B };
  return _geomBuilt;
}

// Real geometry imported from SentiArch "⬇ Export Layout" — already
// shaped {shapes,zones(mm,env),bbox}. Highest-fidelity source.
function getMHCLayout() {
  const L = window.MHC_LAYOUT;
  if (!L || !L.shapes || !L.shapes.length || !L.zones || !L.bbox) return null;
  return L;
}

// positions: { agentId → { x:%, y:%, zoneId } } — drop points on the
// plan image. Engine source priority:
//   MHC_LAYOUT (real SentiArch export)  ▶  MHC_GEOMETRY (in-demo trace)  ▶  authored rpgarchitecture-site.js
function computeEngineResult(agentId, zone, positions) {
  try {
    const E = window.SentiArchEngine, P = window.MHC_PERSONAS, S = window.MHC_SITE || {};
    if (!E || !P || !zone) return null;
    const persona = P[agentId];
    if (!persona) return null;
    const site = S[zone.id];
    const sc = persona.scenario || {};
    const opts = {
      duration_in_cell: sc.duration_in_cell != null ? sc.duration_in_cell : 30,
      timestamp: sc.home_timestamp || "10:25",
    };
    const self = positions && positions[agentId];
    let res;

    // ── Tier 1: real SentiArch layout (true walls/doors/windows + real env) ──
    const L = getMHCLayout();
    if (L && self && self.wx != null) {
      // Exact world coords captured at drop via the SpatialMap fit
      // transform — same geometry that is rendered, zero remap error.
      const a = { x: self.wx, y: self.wy };
      // Never leave the agent zone-less: getZoneAtPosition first (inside
      // or within BLEND_MARGIN), else snap to the NEAREST layout zone —
      // a drop in an un-zoned corridor/gap still gets real env, so the
      // engine panel is never blank.
      const mz = E.getZoneAtPosition(a.x, a.y, L.zones) || nearestLayoutZone(a.x, a.y, L.zones);
      if (mz) {
        const others = Object.keys(positions)
          .filter((id) => id !== agentId && positions[id] && positions[id].wx != null)
          .map((id) => ({ x: positions[id].wx, y: positions[id].wy }));
        res = E.runPerceptionGeo(persona.agent,
          { id: mz.id, label: mz.label, env: mz.env, bounds: mz.bounds },
          { agentXY: a, shapes: L.shapes, zonesMM: L.zones, others,
            duration_in_cell: opts.duration_in_cell, timestamp: opts.timestamp });
        res.realAgent = persona.agent; res.scenario = persona.scenario || null;
        res.site = { id: mz.id, label: mz.label, env: mz.env, spatial: res.persona.spatial };
        return res;
      }
    }

    // ── Tier 2: in-demo traced geometry ──
    const geom = getMHCGeometry();
    if (geom && site && geom.zoneBoundsById[zone.id] && self) {
      const B = geom.building;
      const agentXY = { x: self.x / 100 * B.w_mm, y: self.y / 100 * B.h_mm };
      const others = Object.keys(positions)
        .filter((id) => id !== agentId && positions[id] && positions[id].x != null)
        .map((id) => ({ x: positions[id].x / 100 * B.w_mm, y: positions[id].y / 100 * B.h_mm }));
      res = E.runPerceptionGeo(persona.agent,
        { id: zone.id, label: site.label, env: site.env, bounds: geom.zoneBoundsById[zone.id] },
        { agentXY, shapes: geom.shapes, zonesMM: geom.zonesMM, others,
          duration_in_cell: opts.duration_in_cell, timestamp: opts.timestamp });
    } else if (site) {
      // ── Tier 3: authored per-zone SpatialData ──
      res = E.runPerception(persona.agent, site, opts);
    } else {
      return null;
    }
    res.realAgent = persona.agent;
    res.scenario = persona.scenario || null;
    res.site = site;
    return res;
  } catch (e) {
    console.warn("[SentiArch] engine compute failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  System prompt — thesis methodology: the ENGINE computes the
//  body state; the LLM only NARRATES it (no self-scoring).
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(agent, zone, eng, social) {
  if (!eng) {
    const qualities = Object.entries(zone.qualities || {}).map(([k,v]) => `  · ${k}: ${v}`).join("\n");
    return [
      `You are ${agent.name}, a ${agent.age}-year-old ${agent.role} at a small mental-health centre in Hong Kong.`,
      `MBTI: ${agent.mbti}. Anxiety Sensitivity Index (ASI-3): ${agent.asi} → ${agent.asiLevel}.`,
      ``,
      `You are in the centre's "${zone.label}". Spatial qualities:`,
      qualities,
      `Architect's note: ${zone.description}`,
    ].join("\n");
  }

  const a = eng.realAgent;
  const c = eng.computed;
  const sp = eng.persona.spatial;
  const env = (eng.site && eng.site.env) || {};
  const pct = (n) => Math.round((n || 0) * 100);
  const pmvWord = c.PMV <= -0.5 ? "cool" : c.PMV >= 0.5 ? "warm" : "neutral";
  const exitTxt = sp.dist_to_exit < 0
    ? "no exit visible from where you are"
    : `nearest exit ≈ ${sp.dist_to_exit} m`;
  const windowTxt = sp.dist_to_window < 0 ? "no window in sight" : `a window ≈ ${sp.dist_to_window} m away`;
  const dur = (eng.persona.position && eng.persona.position.duration_in_cell) || 0;
  const seen = sp.visible_agents;

  // Role class from the persona id prefix (staff_/anx_/cli_/comp_).
  const idClass = String(a.id || "").split("_")[0];
  const dispositionLine =
    idClass === "staff"
      ? `You are STAFF here — this is your daily workplace. Your purpose is to work, and that purpose OWNS your time here: long stretches in these rooms are professional routine, not an ordeal to endure. You read the space operationally — how it serves or fails the people you work with — from a steady baseline. You do NOT narrate yourself like a distressed patient; composure is your default.`
    : idClass === "comp"
      ? `You are here ACCOMPANYING someone (a relative/partner), not as a client yourself. Your purpose is THEM — your attention sits on the person you came with and how this space treats them. Your own time here is on-hold and peripheral; your state is comparatively settled.`
      : `You are a CLIENT here today. Your purpose is the reason you came — to be seen, to wait for it, to get through it — and that makes time here something you ENDURE: minutes in this space are felt, not owned, because you are here out of need, not choice. The environment acts on you through your condition and that purpose — a legitimate, personal lens.`;

  const lvl = a.anxiety.asi_level;
  const registerLine = ({
    normal:   `ANXIETY SENSITIVITY — NORMAL (ASI-3 ${a.anxiety.asi_score}/72). You are composed and low-reactive. Notice the space matter-of-factly; you have mild preferences and passing observations, NOT distress. Do NOT write a racing heart, dread, a "knot of anxiety", or shoulders heavy with the unknown unless the environment is objectively extreme. Default to understated, neutral, even slightly detached.`,
    mild:     `ANXIETY SENSITIVITY — MILD (ASI-3 ${a.anxiety.asi_score}/72). Largely steady; at most a faint edge on the single strongest pressure. Not visceral, not spiralling.`,
    moderate: `ANXIETY SENSITIVITY — MODERATE (ASI-3 ${a.anxiety.asi_score}/72). The loaded dimensions register as genuine, nameable unease, but you can still self-regulate. Honest discomfort, not panic.`,
    severe:   `ANXIETY SENSITIVITY — SEVERE (ASI-3 ${a.anxiety.asi_score}/72). The top driver(s) reach your body — breath, pulse, the pull toward the way out. This is lived clinical anxiety; let it show on the dimensions that are actually loaded (only those).`,
  })[lvl] || `ANXIETY SENSITIVITY — ${lvl} (ASI-3 ${a.anxiety.asi_score}/72).`;

  const socList = Array.isArray(social) ? social : [];
  const socialBlock = socList.length
    ? "WHO IS IN THIS ROOM WITH YOU:\n" + socList.map((s) =>
        `  · ${s.name} (${s.role}) — ${s.relation ? (RELATION_PHRASE[s.relation] || ("relationship: " + s.relation)) : "no particular connection to you — a stranger sharing the space"}`
      ).join("\n")
    : "You are alone in this room right now.";

  return [
    `You are ${a.name}, ${a.age}, ${a.role} at a small mental-health centre in Hong Kong.`,
    a.purpose_at_centre ? `YOUR OBJECTIVE TODAY: ${a.purpose_at_centre}` : ``,
    `MBTI ${a.mbti}. Vision ${a.vision}; hearing ${a.hearing}; mobility ${a.mobility}.`,
    ``,
    `WHO YOU ARE — this governs how the space lands on you:`,
    `· ${dispositionLine}`,
    `· ${registerLine}`,
    ``,
    `You are standing in: "${zone.label}". ${zone.description || ""}`,
    socialBlock,
    `Work out — from your objective, this room's purpose, and who is here with you — what you are actually DOING right now (in session, waiting, working, supporting someone). Read the space THROUGH that activity and those relationships: the same room is not the same to someone alone, someone with their own therapist, or someone among strangers.`,
    ``,
    `═══ LAYER 1 — PHYSICAL READOUT (objective; instrument-measured) ═══`,
    `Geometry and physics only — identical for every body, whoever feels it. These are NOT feelings and NOT a verdict on how you are doing. They are the raw facts you must INTERPRET into felt experience.`,
    `  · air — PMV ${c.PMV} (${pmvWord})${env.temperature != null ? `, ${env.temperature}°C` : ``}${env.humidity != null ? `, ${env.humidity}% RH` : ``}`,
    `  · light — ${env.light != null ? env.light : c.effective_lux} lux`,
    `  · sound — ${env.noise != null ? env.noise + " dB(A)" : "level n/a"}`,
    `  · ${exitTxt}; ${windowTxt}; enclosure ${sp.enclosure_ratio}; green-in-view ${pct(sp.green_visibility)}%`,
    `  · ${seen} other ${seen === 1 ? "person" : "people"} within sight`,
    `  · you have been in this spot about ${dur} min`,
    `═══ END LAYER 1 ═══`,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────
//  Header
// ─────────────────────────────────────────────────────────────
function Header({ placedCount, onReset }) {
  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="hdr-logo">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="2" width="18" height="18" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            <circle cx="11" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            <line x1="11" y1="2" x2="11" y2="7.5" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="11" y1="14.5" x2="11" y2="20" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </div>
        <div>
          <div className="hdr-title">SENTIARCH<span className="hdr-version">v0.7 · demo</span></div>
          <div className="hdr-sub">Embodied agents × architectural plan · Tuesday morning, 10:25</div>
        </div>
      </div>
      <div className="hdr-right">
        <div className="hdr-stat"><span className="hdr-stat-num">{placedCount}</span><span className="hdr-stat-lbl">placed</span></div>
        <div className="hdr-stat"><span className="hdr-stat-num">25</span><span className="hdr-stat-lbl">agents</span></div>
        <div className="hdr-stat"><span className="hdr-stat-num">{ZONES.length}</span><span className="hdr-stat-lbl">zones</span></div>
        <button className="hdr-btn" onClick={onReset}>reset</button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
//  PlanCanvas — the floor plan with zones and placed agents
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  Faithful port of SentiArch SpatialMap's fit + render. When a
//  real layout is imported, the plan IS drawn from the geometry
//  (no jpg) so visual == engine == drop, aligned by construction.
// ─────────────────────────────────────────────────────────────
const SHAPE_STYLE = {
  site:   { fill: "rgba(184,176,160,0.20)", stroke: "#1D6B5E", lw: 1.5, dash: [10, 5] },
  wall:   { fill: "#3C3228", stroke: "#3C3228", lw: 0, dash: [] },
  column: { fill: "#3C3228", stroke: "#3C3228", lw: 0, dash: [] },
  door:   { fill: "rgba(245,220,190,0.95)", stroke: "#B47846", lw: 2, dash: [] },
  window: { fill: "rgba(59,130,246,0.30)", stroke: "#3B82F6", lw: 1.5, dash: [] },
  green:  { fill: "rgba(125,176,96,0.32)", stroke: "#5C8E4A", lw: 1, dash: [] },
  special:{ fill: "rgba(168,85,247,0.15)", stroke: "#A855F7", lw: 1.5, dash: [6, 4] },
};
const SHAPE_ORDER = { site: 0, green: 1, door: 2, wall: 3, column: 4, window: 5 };

// SentiArch fitToContent (store-faithful): world mm ↔ screen px.
function computeFit(layout, W, H) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  layout.shapes.forEach((s) => (s.points || []).forEach((p) => eat(p[0], p[1])));
  layout.zones.forEach((z) => {
    const b = z.bounds;
    if (b.points && b.points.length >= 3) b.points.forEach((p) => eat(p[0], p[1]));
    else { eat(b.x, b.y); eat(b.x + b.width, b.y + b.height); }
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 20000; maxY = 20000; }
  const padX = (maxX - minX) * 0.02 || 2000, padY = (maxY - minY) * 0.02 || 2000;
  minX -= padX; minY -= padY; maxX += padX; maxY += padY;
  const rangeX = (maxX - minX) || 20000, rangeY = (maxY - minY) || 20000;
  let zoom = Math.min(W / rangeX, H / rangeY);
  zoom = Math.max(0.005, Math.min(2, zoom));
  zoom *= getFillK(); // scale geometry in sync with the jpg to fill the card
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const offX = cx - W / (2 * zoom), offY = cy + H / (2 * zoom);
  return { zoom, offX, offY, W, H };
}
const w2s = (wx, wy, f) => [(wx - f.offX) * f.zoom, (f.offY - wy) * f.zoom];
const s2w = (sx, sy, f) => [sx / f.zoom + f.offX, f.offY - sy / f.zoom];

// memoised fit for the current frame size + layout
let _fitKey = "", _fit = null;
function layoutFitFor(W, H) {
  const L = getMHCLayout(); if (!L) return null;
  const k = W + "x" + H + ":" + L.shapes.length + ":" + L.zones.length + ":" + JSON.stringify(window.MHC_CALIB);
  if (k !== _fitKey) { _fit = computeFit(L, W, H); _fitKey = k; }
  return _fit;
}
function layoutZoneById(id) {
  const L = getMHCLayout(); if (!L) return null;
  const z = L.zones.find((zz) => zz.id === id);
  return z ? { id: z.id, label: z.label || z.id, description: z.program || "", _layout: true } : null;
}
// Nearest layout zone to a world point (clamped distance to each zone's
// bounds rect). Guarantees a zone so an agent dropped in an un-zoned
// corridor/gap still gets real env — engine result is never null.
function nearestLayoutZone(x, y, zones) {
  let best = null, bestD = Infinity;
  for (const z of zones) {
    const b = z.bounds; if (!b) continue;
    const cx = Math.max(b.x, Math.min(x, b.x + b.width));
    const cy = Math.max(b.y, Math.min(y, b.y + b.height));
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}
// Manual floor-plan-image calibration (visual only — engine uses geometry).
function getCalib() {
  const c = window.MHC_CALIB;
  return (c && typeof c.x === "number") ? { x: c.x, y: c.y, sx: c.sx ?? 1, sy: c.sy ?? 1 } : { x: 0, y: 0, sx: 1, sy: 1 };
}
// Shared "fill the card" zoom: scales BOTH the (invisible) geometry fit
// AND the jpg by the same factor about the same centre, so the plan
// covers the white frame with the jpg↔geometry alignment unchanged.
function getFillK() {
  const c = getCalib();
  return 1 / Math.max(0.05, Math.min(c.sx, c.sy));
}
// Resolve a pointer (relative to the plan-frame rect) → { xPct,yPct, wx,wy, zone }.
// Layout mode: exact world via the fit transform + getZoneAtPosition.
// Else: legacy floorplan.jpg % hit-test against zones.jsx.
function resolveDropAt(rect, clientX, clientY) {
  const xPct = ((clientX - rect.left) / rect.width) * 100;
  const yPct = ((clientY - rect.top) / rect.height) * 100;
  if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return null;
  const E = window.SentiArchEngine, L = getMHCLayout();
  if (E && L) {
    const fit = layoutFitFor(rect.width, rect.height);
    const w = s2w(clientX - rect.left, clientY - rect.top, fit);
    const mz = E.getZoneAtPosition(w[0], w[1], L.zones);
    if (!mz) return null;
    return { xPct, yPct, wx: w[0], wy: w[1],
      zone: { id: mz.id, label: mz.label || mz.id, description: mz.program || "", _layout: true } };
  }
  const z = (window.ZONES || []).find((zz) => { const [zx, zy, zw, zh] = zz.bounds; return xPct >= zx && xPct <= zx + zw && yPct >= zy && yPct <= zy + zh; });
  return z ? { xPct, yPct, wx: null, wy: null, zone: z } : null;
}

function GeoBase({ layout, fit, dpr, transparent }) {
  const cv = React.useRef(null);
  React.useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d");
    c.width = fit.W * dpr; c.height = fit.H * dpr;
    c.style.width = fit.W + "px"; c.style.height = fit.H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, fit.W, fit.H);
    if (!transparent) { ctx.fillStyle = "#FAFAF6"; ctx.fillRect(0, 0, fit.W, fit.H); }

    // zones (under shapes)
    layout.zones.forEach((z) => {
      const b = z.bounds;
      let pts;
      if (b.points && b.points.length >= 3) pts = b.points.map((p) => w2s(p[0], p[1], fit));
      else { const a = w2s(b.x, b.y + b.height, fit), d = w2s(b.x + b.width, b.y, fit); pts = [[a[0], a[1]], [d[0], a[1]], [d[0], d[1]], [a[0], d[1]]]; }
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath();
      ctx.fillStyle = "rgba(29,107,94,0.04)"; ctx.fill();
      ctx.strokeStyle = "rgba(29,107,94,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // Labels only when GeoBase is the BASE (legacy). In transparent
      // calibrate-guide mode the jpg already shows the rooms — drawing
      // canvas labels on top causes the duplicate-label overlap.
      if (!transparent) {
        ctx.font = "bold 14px 'Inter',sans-serif"; ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillText(z.label || z.id, cx, cy);
        if (z.env) { ctx.font = "11px 'JetBrains Mono',monospace"; ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(`${z.env.temperature}°C  ${z.env.light}lx  ${z.env.noise}dB`, cx, cy + 18); }
      }
    });

    // fused walls/columns first (no seams)
    ctx.fillStyle = "#3C3228";
    layout.shapes.forEach((s) => {
      if (s.type !== "wall" && s.type !== "column") return;
      if (!s.points || s.points.length < 3) return;
      ctx.beginPath(); const q = s.points.map((p) => w2s(p[0], p[1], fit));
      ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill();
    });
    // other shapes in order
    const ordered = layout.shapes.filter((s) => s.type !== "wall" && s.type !== "column")
      .slice().sort((a, b) => (SHAPE_ORDER[a.type] ?? 6) - (SHAPE_ORDER[b.type] ?? 6));
    ordered.forEach((s) => {
      const st = SHAPE_STYLE[s.type] || SHAPE_STYLE.special;
      if (!s.points || s.points.length < 2) return;
      const q = s.points.map((p) => w2s(p[0], p[1], fit));
      ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      if (q.length >= 3) ctx.closePath();
      ctx.fillStyle = st.fill; if (q.length >= 3) ctx.fill();
      if (st.lw > 0) { ctx.strokeStyle = st.stroke; ctx.lineWidth = st.lw; ctx.setLineDash(st.dash); ctx.stroke(); ctx.setLineDash([]); }
      if (s.type === "door" && s.meta && s.meta.centerline) {
        const a = w2s(s.meta.centerline[0][0], s.meta.centerline[0][1], fit), bb = w2s(s.meta.centerline[1][0], s.meta.centerline[1][1], fit);
        const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]), ang = Math.atan2(bb[1] - a[1], bb[0] - a[0]);
        ctx.beginPath(); ctx.arc(a[0], a[1], len, ang - Math.PI / 2, ang); ctx.strokeStyle = "#B47846"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
    });
  }, [layout, fit, dpr, transparent]);
  return <canvas ref={cv} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

function PlanCanvas({ planRef, placed, dragging, hoverZone, setHoverZone, selectedId, setSelectedId, onDrop, onStartDrag, onClearAgent, chats, onSendMessage }) {
  const LAYOUT = getMHCLayout();
  const [dims, setDims] = useState(null);
  useEffect(() => {
    const el = planRef.current; if (!el) return;
    const measure = () => setDims({ W: el.clientWidth, H: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = (LAYOUT && dims && dims.W > 0) ? layoutFitFor(dims.W, dims.H) : null;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

  // ── Floor-plan-image calibration (visual only) ──
  const [calib, setCalib] = useState(false);
  const [imgT, setImgT] = useState(getCalib);
  const calDrag = useRef(null);
  useEffect(() => {
    if (!calib) return;
    const onKey = (e) => {
      const t = e.target; if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
      const s = e.shiftKey ? 1 : 0.2;
      if (e.key === "ArrowLeft") setImgT(v => ({ ...v, x: r2(v.x - s) }));
      else if (e.key === "ArrowRight") setImgT(v => ({ ...v, x: r2(v.x + s) }));
      else if (e.key === "ArrowUp") setImgT(v => ({ ...v, y: r2(v.y - s) }));
      else if (e.key === "ArrowDown") setImgT(v => ({ ...v, y: r2(v.y + s) }));
      else if (e.key === "+" || e.key === "=") setImgT(v => ({ ...v, sx: r2(v.sx + 0.01), sy: r2(v.sy + 0.01) }));
      else if (e.key === "-") setImgT(v => ({ ...v, sx: r2(Math.max(0.05, v.sx - 0.01)), sy: r2(Math.max(0.05, v.sy - 0.01)) }));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calib]);
  const startImgDrag = (e) => {
    if (!calib) return;
    e.preventDefault(); e.stopPropagation();
    const rect = planRef.current.getBoundingClientRect();
    calDrag.current = { mx: e.clientX, my: e.clientY, ox: imgT.x, oy: imgT.y };
    const move = (ev) => { const d = calDrag.current; if (!d) return;
      setImgT(v => ({ ...v, x: r2(d.ox + ((ev.clientX - d.mx) / rect.width) * 100), y: r2(d.oy + ((ev.clientY - d.my) / rect.height) * 100) })); };
    const up = () => { calDrag.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const startImgScale = (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = planRef.current.getBoundingClientRect();
    calDrag.current = { mx: e.clientX, my: e.clientY, osx: imgT.sx, osy: imgT.sy };
    const move = (ev) => { const d = calDrag.current; if (!d) return;
      setImgT(v => ({ ...v, sx: r2(Math.max(0.05, d.osx + (ev.clientX - d.mx) / rect.width * 2)), sy: r2(Math.max(0.05, d.osy + (ev.clientY - d.my) / rect.height * 2)) })); };
    const up = () => { calDrag.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const exportCalib = () => {
    const json = JSON.stringify({ x: imgT.x, y: imgT.y, sx: imgT.sx, sy: imgT.sy });
    try { navigator.clipboard.writeText(json); } catch (e) {}
    console.log("=== rpgarchitecture-calib.js → window.MHC_CALIB = " + json + "; ===");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "rpgarchitecture-calib.json"; a.click();
  };
  const fillK = LAYOUT ? getFillK() : 1;
  const imgStyle = LAYOUT
    ? { transform: `translate(${imgT.x}%, ${imgT.y}%) scale(${r2(imgT.sx * fillK)}, ${r2(imgT.sy * fillK)})`,
        transformOrigin: "center", cursor: calib ? "move" : "default" }
    : undefined;

  // Screen-% of the plan-frame for a placed agent (exact in layout mode).
  const posPct = (info) => {
    if (LAYOUT && fit && info.wx != null) {
      const s = w2s(info.wx, info.wy, fit);
      return { x: (s[0] / dims.W) * 100, y: (s[1] / dims.H) * 100 };
    }
    return { x: info.x, y: info.y };
  };

  const handlePointerMove = (e) => {
    if (!dragging) { return; }
    const rect = planRef.current.getBoundingClientRect();
    const hit = resolveDropAt(rect, e.clientX, e.clientY);
    setHoverZone(hit ? hit.zone.id : null);
  };

  const handlePointerUp = () => {
    // The drop is performed exactly once by the tray's window-level
    // pointerup listener (AgentTray.startDrag). This bubbled handler
    // must only clear the hover highlight — calling onDrop here too
    // double-fired triggerSpatialReading (agent spoke twice).
    if (dragging) setHoverZone(null);
  };

  // Hovered-zone callout position (screen-% of frame).
  const hoverCallout = (() => {
    if (!dragging || !hoverZone) return null;
    if (LAYOUT && fit) {
      const z = LAYOUT.zones.find(zz => zz.id === hoverZone); if (!z) return null;
      const b = z.bounds;
      const cw = (b.points && b.points.length >= 3)
        ? [b.points.reduce((s, p) => s + p[0], 0) / b.points.length, b.points.reduce((s, p) => s + p[1], 0) / b.points.length]
        : [b.x + b.width / 2, b.y + b.height / 2];
      const s = w2s(cw[0], cw[1], fit);
      return { x: (s[0] / dims.W) * 100, y: (s[1] / dims.H) * 100, label: z.label || z.id };
    }
    const z = (window.ZONES || []).find(zz => zz.id === hoverZone); if (!z) return null;
    const [x, y, w, h] = z.bounds;
    return { x: x + w / 2, y: y + h / 2, label: z.label };
  })();

  return (
    <div
      className="plan-wrap"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="plan-frame" ref={planRef}
           style={LAYOUT ? { background: "#FAFAF6", overflow: "hidden" } : undefined}>
        {/* VISUAL: the floor-plan image. In layout mode it is calibrated
            (translate/scale) by hand to sit over the hidden geometry. */}
        <img src="assets/floorplan.jpg" alt="floorplan" className="plan-img" draggable={false}
             style={imgStyle} onPointerDown={startImgDrag}/>

        {/* BACKEND geometry — drawn only as a faint guide while calibrating */}
        {LAYOUT && fit && calib && (
          <div style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none" }}>
            <GeoBase layout={LAYOUT} fit={fit} dpr={dpr} transparent />
          </div>
        )}

        {/* Calibrate controls */}
        {LAYOUT && (
          <div style={{ position: "absolute", top: 8, right: 8, zIndex: 30, display: "flex", gap: 6, alignItems: "center",
                        font: "500 11px 'JetBrains Mono',monospace" }} onPointerDown={(e) => e.stopPropagation()}>
            {calib && (
              <span style={{ background: "rgba(28,25,21,.9)", color: "#f3ede2", padding: "4px 7px", borderRadius: 6, display: "flex", gap: 5, alignItems: "center" }}>
                {[["x", "x"], ["y", "y"], ["sx", "w"], ["sy", "h"]].map(([k, lb]) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    {lb}<input type="number" step={k[0] === "s" ? 0.01 : 0.2} value={imgT[k]}
                      onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setImgT(v => ({ ...v, [k]: n })); }}
                      style={{ width: 46, background: "#15130f", color: "#f3ede2", border: "1px solid #4a4334", borderRadius: 4, padding: "1px 3px" }} />
                  </label>
                ))}
              </span>
            )}
            {calib && <button onClick={() => setImgT({ x: 0, y: 0, sx: 1, sy: 1 })} style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid #4a4334", cursor: "pointer", background: "rgba(28,25,21,.85)", color: "#e0a87a" }}>reset</button>}
            {calib && <button onClick={exportCalib} style={{ padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer", background: "#5fae74", color: "#10210f", fontWeight: 600 }}>⤓ calib</button>}
            <button onClick={() => setCalib(c => !c)}
              style={{ padding: "5px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid #4a4334",
                       background: calib ? "#caa46a" : "rgba(28,25,21,.85)", color: calib ? "#1c1915" : "#f3ede2" }}>
              {calib ? "done" : "calibrate"}
            </button>
          </div>
        )}
        {/* image scale handle (calibrate only) */}
        {LAYOUT && calib && (
          <div onPointerDown={startImgScale}
               style={{ position: "absolute", right: 4, bottom: 4, width: 22, height: 22, zIndex: 30,
                        background: "#caa46a", border: "2px solid #1c1915", borderRadius: 4, cursor: "nwse-resize" }}
               title="drag to scale the image"/>
        )}

        {/* Zone overlays — legacy floorplan.jpg only */}
        {!LAYOUT && (
          <svg className="plan-zones" viewBox="0 0 100 100" preserveAspectRatio="none">
            {ZONES.map(z => {
              const [x, y, w, h] = z.bounds;
              const isHover = hoverZone === z.id && dragging;
              return (
                <rect key={z.id} x={x} y={y} width={w} height={h}
                  className={`zone-rect ${isHover ? "zone-active" : ""}`} vectorEffect="non-scaling-stroke" />
              );
            })}
          </svg>
        )}

        {/* Zone label callout when hovering during drag */}
        {hoverCallout && (
          <div className="zone-callout" style={{ left: `${hoverCallout.x}%`, top: `${hoverCallout.y}%` }}>
            <div className="zone-callout-label">{hoverCallout.label}</div>
            <div className="zone-callout-tag">DROP TO PLACE</div>
          </div>
        )}

        {/* Placed agents */}
        {Object.entries(placed).map(([agentId, info]) => {
          const agent = AGENTS.find(a => a.id === agentId);
          if (!agent) return null;
          const idx = AGENTS.findIndex(a => a.id === agentId);
          return (
            <PlacedAgent
              key={agentId}
              agent={agent}
              idx={idx}
              pp={posPct(info)}
              isSel={selectedId === agentId}
              isDragging={!!dragging && dragging.agentId === agentId}
              onSelect={() => setSelectedId(agentId)}
              onClear={() => onClearAgent(agentId)}
              onStartDrag={onStartDrag}
              onDrop={onDrop}
            />
          );
        })}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PlacedAgent — a sprite on the plan. Idle-breathes & wanders via
//  the shared rAF loop (registers its DOM nodes through `register`).
// ─────────────────────────────────────────────────────────────
function PlacedAgent({ agent, idx, pp, isSel, isDragging, onSelect, onClear, onStartDrag, onDrop }) {
  const animRef = useRef(null);
  const spriteRef = useRef(null);
  const auraRef = useRef(null);
  const fxRef = useRef(null);
  const hpRef = useRef(null);
  const mpRef = useRef(null);
  useEffect(() => {
    registerAnim(agent.id, {
      anim: animRef.current, sprite: spriteRef.current,
      aura: auraRef.current, fx: fxRef.current,
      hp: hpRef.current, mp: mpRef.current,
    });
    return () => registerAnim(agent.id, null);
  }, [agent.id]);

  // A placed agent can be re-dragged straight to another room — no need
  // to clear it first. A press without movement selects; a press + drag
  // past a small threshold re-places (handleDrop overwrites the position
  // and re-syncs every agent). A drop outside any zone is a no-op, so the
  // agent simply snaps back to where it was.
  const beginDrag = (e) => {
    if (e.button != null && e.button !== 0) return; // primary button only
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
      moved = true;
      onStartDrag({ agentId: agent.id, mouseX: ev.clientX, mouseY: ev.clientY });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) { onDrop(agent.id, ev.clientX, ev.clientY); onStartDrag(null); }
      else { onSelect(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`placed-agent ${isSel ? "placed-sel" : ""} ${isDragging ? "placed-dragging" : ""}`}
         style={{ left: `${pp.x}%`, top: `${pp.y}%` }}
         onPointerDown={beginDrag} title={agent.name}>
      <div className="placed-anim" ref={animRef}>
        <div className="placed-aura" ref={auraRef}></div>
        <div className="placed-fx" ref={fxRef}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="fx-particle"></div>)}
        </div>
        <div className="placed-sprite" ref={spriteRef} style={spriteStyle(idx, 64)}></div>
        <div className="placed-name">{agent.name.split(" ")[0]}</div>
        {isSel && (
          <button className="placed-x"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onClear(); }}>×</button>
        )}
        <div className="placed-hud">
          <div className="hud-bar hud-hp"><div className="hud-fill" ref={hpRef}></div></div>
          <div className="hud-bar hud-mp"><div className="hud-fill" ref={mpRef}></div></div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  DragGhost — visual sprite that follows the pointer during drag
// ─────────────────────────────────────────────────────────────
function DragGhost({ agentId, x, y }) {
  const idx = AGENTS.findIndex(a => a.id === agentId);
  if (idx < 0) return null;
  return (
    <div className="drag-ghost" style={{left: x, top: y}}>
      <div style={spriteStyle(idx, 72)}></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ChatDock — single docked conversation panel; switches agent on select
// ─────────────────────────────────────────────────────────────
function ChatDock({ agent, zone, messages, onSend, onClose }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.thinking, agent && agent.id]);

  if (!agent) {
    return (
      <aside className="chat-dock chat-dock-empty">
        <div className="chat-dock-empty-inner">
          <div className="chat-dock-empty-mark">⌖</div>
          <div>Tap an agent on the plan to open the conversation.</div>
        </div>
      </aside>
    );
  }
  const idx = AGENTS.findIndex(a => a.id === agent.id);
  const sendNow = () => { if (!input.trim()) return; const t = input; setInput(""); onSend(t); };
  return (
    <aside className="chat-dock">
      <div className="fchat-hdr">
        <div className="fchat-hdr-sprite" style={spriteStyle(idx, 28)}></div>
        <div className="fchat-hdr-info">
          <div className="fchat-hdr-name">{agent.name.split(" ")[0]}</div>
          <div className="fchat-hdr-zone">{zone ? zone.label : ""}</div>
        </div>
        <button className="fchat-btn" onClick={onClose} title="close">×</button>
      </div>
      <div className="fchat-scroll" ref={scrollRef}>
        {messages.length === 0 && <div className="fchat-empty">Reading the space…</div>}
        {messages.map((m, i) => {
          if (m.role === "system_event") return <div key={i} className="fmsg-sys">— {m.content} —</div>;
          return (
            <div key={i} className={`fmsg fmsg-${m.role}`}>
              {m.thinking ? <span className="thinking"><span/><span/><span/></span> : m.content}
            </div>
          );
        })}
      </div>
      <div className="fchat-input">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendNow(); }} placeholder="ask…" />
        <button onClick={sendNow}>⏎</button>
      </div>
      <div className="fchat-suggest">
        {["light?", "exit?", "body?", "stay/move?"].map(s => {
          const full = ({
            "light?": "How does the light feel here?",
            "exit?": "Can you see an exit from where you are?",
            "body?": "What's happening in your body right now?",
            "stay/move?": "Would you stay here or move?",
          })[s];
          return <button key={s} className="fsuggest-pill" onClick={() => onSend(full)}>{s}</button>;
        })}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
//  Side panel — tray + agent insights
// ─────────────────────────────────────────────────────────────
function SidePanel({ agents, placed, selectedId, setSelectedId, chats, engineByAgent, onSendMessage, onClearAgent, onStartDrag, dragging, onDrop }) {
  const selectedAgent = selectedId ? agents.find(a => a.id === selectedId) : null;
  const selectedPlace = selectedId ? placed[selectedId] : null;
  const selectedZone = selectedPlace
    ? (getMHCLayout() ? layoutZoneById(selectedPlace.zoneId) : ZONES.find(z => z.id === selectedPlace.zoneId))
    : null;
  const selectedEng = selectedId ? (engineByAgent || {})[selectedId] : null;

  return (
    <aside className="side">
      <AgentInsights
        agent={selectedAgent}
        zone={selectedZone}
        eng={selectedEng}
        onClear={() => selectedId && onClearAgent(selectedId)}
      />
      <AgentTray
        agents={agents}
        placed={placed}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        onStartDrag={onStartDrag}
        dragging={dragging}
        onDrop={onDrop}
      />
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
//  Engine readout — 6-dim load bars + comfort + drivers + sensors
// ─────────────────────────────────────────────────────────────
function LoadBar({ label, v, baseline }) {
  const p = Math.max(0, Math.min(100, Math.round(v || 0)));
  const col = p >= 60 ? "#d2683f" : p >= 30 ? "#caa46a" : "#5fae74";
  const bl = baseline == null ? null : Math.max(0, Math.min(100, Math.round(baseline)));
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,margin:"4px 0",font:"500 11px 'JetBrains Mono',monospace"}}>
      <span style={{width:78,color:"#7a715f",textTransform:"uppercase",letterSpacing:".04em"}}>{label}</span>
      <span style={{flex:1,height:8,background:"rgba(0,0,0,.08)",borderRadius:4,overflow:"hidden",position:"relative"}}>
        <span style={{display:"block",height:"100%",width:p+"%",background:col,transition:"width .3s"}}/>
        {bl != null && <span title="Layer 1 baseline" style={{position:"absolute",top:-2,bottom:-2,left:"calc("+bl+"% - 1px)",width:2,background:"#2b2620",opacity:.5}}/>}
      </span>
      <span style={{width:26,textAlign:"right",color:"#3a352d"}}>{p}</span>
    </div>
  );
}

// comfort / stress stat bar for the side panel — labelled + numeric.
// `kind` (hp|mp) is an internal colour discriminator only — not shown.
function StatBar({ label, value, max, kind }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const col = kind === "hp"
    ? (value >= 7.5 ? "linear-gradient(90deg,#86dd92,#4fae62)"
      : value >= 5.5 ? "linear-gradient(90deg,#e8c46b,#c69a3f)"
      : "linear-gradient(90deg,#e58457,#c0432a)")
    : (value >= 4 ? "linear-gradient(90deg,#c98ae8,#8a4fc8)"
      : "linear-gradient(90deg,#8aa6ee,#4f6fc8)");
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,margin:"6px 0"}}>
      <span style={{width:58,font:"700 11px 'JetBrains Mono',monospace",color:"#3a352d",letterSpacing:".06em",textTransform:"uppercase"}}>{label}</span>
      <span style={{flex:1,height:12,background:"#2b2620",border:"1px solid #14100b",padding:"1.5px",display:"block"}}>
        <span style={{display:"block",height:"100%",width:pct+"%",background:col,transition:"width .5s ease"}}/>
      </span>
      <span style={{width:44,textAlign:"right",font:"600 13px 'JetBrains Mono',monospace",color:"#3a352d"}}>
        {value}<span style={{color:"#9a8f7d",fontSize:10}}>/{max}</span>
      </span>
    </div>
  );
}

function EnginePanel({ eng }) {
  const acc = eng.accState, c = eng.computed;
  const llm = eng.llm && eng.llm.status === "ok" ? eng.llm : null;
  // "pending" covers both the explicit pending status AND the brief window
  // before triggerSpatialReading first sets it (eng exists but no .llm yet).
  const pending = !eng.llm || eng.llm.status === "pending";
  const failed = !!(eng.llm && eng.llm.status === "failed");
  const name = (eng.realAgent && eng.realAgent.name ? eng.realAgent.name.split(" ")[0] : "agent");

  // ── Waiting for the LLM: no bars, no scores, no sensor line — just the
  //  "reading the space" notice. The plan-side aura/HUD/animation are
  //  also gated off in the rAF loop, so the agent stays fully still until
  //  the assessment returns. ──
  if (pending) {
    return (
      <div className="chat-zone">
        <div className="chat-zone-tag">{name.toUpperCase()} IS READING THE SPACE</div>
        <div style={{padding:"14px 4px 6px",font:"500 12px 'JetBrains Mono',monospace",color:"#7a715f",lineHeight:1.55}}>
          {name} is becoming the character and reading the room. Scores, aura and animation will appear together when the assessment returns.
        </div>
      </div>
    );
  }

  const comfort = llm ? llm.comfort : eng.comfort_score;
  const stress = llm ? llm.stress : eng.stress_score;
  const baseScore = (d) => Math.round((acc[ENGINE_DIM_KEY[d]] || 0) * 100);
  const tag = llm ? `LAYER 2 · ${name.toUpperCase()}'S READING`
    : `LAYER 1 BASELINE · LLM UNAVAILABLE`;
  return (
    <div className="chat-zone">
      <div className="chat-zone-tag">{tag}</div>
      <div style={{margin:"6px 0 11px"}}>
        <StatBar label="comfort" value={comfort} max={10} kind="hp" />
        <StatBar label="stress" value={stress} max={10} kind="mp" />
      </div>
      {FELT_DIMS.map(d => (
        <LoadBar key={d} label={d}
          v={llm ? llm.dims[d] : baseScore(d)}
          baseline={llm ? baseScore(d) : null} />
      ))}
      <div style={{margin:"9px 0 2px",font:"500 10.5px 'JetBrains Mono',monospace",color:"#8a8070",lineHeight:1.55}}>
        Layer 1 · PMV {c.PMV} · {c.perceived_air_temp}°C · {c.effective_lux} lx · {c.anxiety_perceived_dB} dB · PPD {c.PPD}%
      </div>
      {llm && (
        <div style={{marginTop:7}}>
          <div className="chat-zone-tag">{name.toUpperCase()}'S REASONING</div>
          {FELT_DIMS.filter(d => llm.dims[d] >= 30)
            .sort((x,y) => llm.dims[y] - llm.dims[x]).slice(0,4)
            .map(d => (
            <div key={d} style={{font:"500 10.5px 'JetBrains Mono',monospace",color:"#6b6256",margin:"4px 0",lineHeight:1.5}}>
              <b style={{color:"#3a352d",textTransform:"uppercase"}}>{d}</b> — {llm.reasons[d] || "—"}
            </div>
          ))}
        </div>
      )}
      {failed && (
        <div style={{marginTop:7,font:"500 10.5px 'JetBrains Mono',monospace",color:"#b06a4a",lineHeight:1.5}}>
          LLM unreachable — showing the Layer-1 physical baseline only.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Agent insights — profile + LIVE engine readout (no chat)
//  Conversation happens in the floating window on the plan.
// ─────────────────────────────────────────────────────────────
function AgentInsights({ agent, zone, eng, onClear }) {
  if (!agent) {
    return (
      <section className="chat empty">
        <div className="chat-empty-inner">
          <div className="chat-empty-mark">⌖</div>
          <div className="chat-empty-title">Drop an agent onto a space</div>
          <div className="chat-empty-body">
            Drag any of the 25 figures from below onto the floor plan. The agent will read the room — what it does to their body, their breath, their attention — and a chat window opens on the plan so you can ask them about it.
          </div>
        </div>
      </section>
    );
  }

  const idx = AGENTS.findIndex(a => a.id === agent.id);
  return (
    <section className="chat">
      <div className="chat-hdr">
        <div className="chat-hdr-sprite" style={spriteStyle(idx, 56)}></div>
        <div className="chat-hdr-info">
          <div className="chat-hdr-name">{agent.name}</div>
          <div className="chat-hdr-role">{agent.role}</div>
          <div className="chat-hdr-meta">
            <span className={`pill pill-${agent.asiLevel}`}>ASI {agent.asi} · {agent.asiLevel}</span>
            <span className="pill pill-mbti">{agent.mbti}</span>
            <span className="pill pill-age">{agent.age}y</span>
          </div>
        </div>
        <button className="chat-hdr-x" onClick={onClear} title="remove from plan">✕</button>
      </div>

      {zone && (
        <div className="chat-zone" style={{flex:"0 0 auto",padding:"11px 16px 9px"}}>
          <div className="chat-zone-tag">CURRENTLY IN</div>
          <div className="chat-zone-name">{zone.label}</div>
          <div className="chat-zone-desc">{zone.description}</div>
        </div>
      )}

      {zone && eng && <EnginePanel eng={eng} />}

      {zone && !eng && (
        <div className="chat-zone">
          <div className="chat-zone-tag">SPATIAL QUALITIES</div>
          <div className="chat-zone-q">
            {Object.entries(zone.qualities || {}).map(([k, v]) => (
              <div key={k} className="zone-q-row"><span>{k}</span><span>{v}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="chat-hint">
        <span className="chat-hint-dot"></span>
        Chat opens beside {agent.name.split(" ")[0]} on the plan.
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Agent tray — 5×5 grid of draggable sprites
// ─────────────────────────────────────────────────────────────
function AgentTray({ agents, placed, selectedId, setSelectedId, onStartDrag, dragging, onDrop }) {
  const [filter, setFilter] = useState("all"); // all|client|staff|companion

  const filtered = useMemo(() => {
    if (filter === "all") return agents.map((a, i) => ({ a, i }));
    return agents.map((a, i) => ({ a, i })).filter(({ a }) => {
      if (filter === "staff") return a.tags.includes("staff");
      if (filter === "client") return a.tags.includes("client");
      if (filter === "companion") return a.tags.includes("companion");
      return true;
    });
  }, [agents, filter]);

  // pointer-based drag
  const startDrag = (agentId, e) => {
    e.preventDefault();
    onStartDrag({ agentId, mouseX: e.clientX, mouseY: e.clientY });

    const move = (ev) => {
      onStartDrag({ agentId, mouseX: ev.clientX, mouseY: ev.clientY });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onDrop(agentId, ev.clientX, ev.clientY);
      onStartDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section className="tray">
      <div className="tray-hdr">
        <div className="tray-title">AGENTS · {agents.length}</div>
        <div className="tray-filters">
          {["all","client","staff","companion"].map(f => (
            <button key={f} className={`tf ${filter === f ? "tf-on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="tray-grid">
        {filtered.map(({ a, i }) => {
          const isPlaced = !!placed[a.id];
          const isSel = selectedId === a.id;
          const isDragging = dragging && dragging.agentId === a.id;
          return (
            <button
              key={a.id}
              className={`tray-cell ${isPlaced ? "tray-placed" : ""} ${isSel ? "tray-sel" : ""} ${isDragging ? "tray-dragging" : ""}`}
              onPointerDown={(e) => startDrag(a.id, e)}
              onClick={() => isPlaced && setSelectedId(a.id)}
              title={`${a.name} — ${a.role}`}
            >
              <div className="tray-sprite" style={spriteStyle(i, 52)}></div>
              <div className="tray-name">{a.name.split(" ")[0]}</div>
              {isPlaced && <div className="tray-dot"></div>}
            </button>
          );
        })}
      </div>
      <div className="tray-foot">
        <div>Drag any figure onto the floor plan.</div>
        <div>Tap a placed agent to chat — or drag it to a new room.</div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
