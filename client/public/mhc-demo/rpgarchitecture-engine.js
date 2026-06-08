/* ─────────────────────────────────────────────────────────────
   SentiArch perceptual engine — faithful plain-JS port

   Ported verbatim from the canonical TypeScript engine
   client/src/lib/store.ts
   (computeOutputs / computePerceptualLoad and all helpers they
   call). Pure numeric, zero React/Zustand. The maths is copied
   line-for-line so the demo's numbers match the main app.

   Scope: single dwelling perception (one zone placement). The
   route/waypoint bidirectional-EMA carry-over layer is NOT
   ported here — the demo places an agent once, it does not walk
   a trajectory.

   Exposes: window.SentiArchEngine
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── ASI-3 anxiety model (store.ts:28-105) ──────────────────
  function deriveAnxietyLevel(asiScore) {
    var s = Math.max(0, Math.min(72, Math.round(asiScore)));
    if (s <= 16) return "normal";
    if (s <= 23) return "mild";
    if (s <= 48) return "moderate";
    return "severe";
  }

  var ANXIETY_MODIFIERS_BY_LEVEL = {
    normal:   { noise_sensitivity: 1.0, thermal_comfort_range: 1.0, personal_space_radius: 1.0,  enclosure_sensitivity: 1.0, exit_proximity_need: 1.0 },
    mild:     { noise_sensitivity: 1.2, thermal_comfort_range: 1.3, personal_space_radius: 1.05, enclosure_sensitivity: 1.2, exit_proximity_need: 1.2 },
    moderate: { noise_sensitivity: 1.4, thermal_comfort_range: 1.6, personal_space_radius: 1.09, enclosure_sensitivity: 1.5, exit_proximity_need: 1.5 },
    severe:   { noise_sensitivity: 1.6, thermal_comfort_range: 1.9, personal_space_radius: 1.15, enclosure_sensitivity: 1.8, exit_proximity_need: 1.9 },
  };

  function buildAnxietyData(asiScore) {
    var clamped = Math.max(0, Math.min(72, Math.round(asiScore)));
    var level = deriveAnxietyLevel(clamped);
    var m = ANXIETY_MODIFIERS_BY_LEVEL[level];
    return {
      asi_score: clamped,
      asi_level: level,
      modifiers: { noise_sensitivity: m.noise_sensitivity, thermal_comfort_range: m.thermal_comfort_range, personal_space_radius: m.personal_space_radius, enclosure_sensitivity: m.enclosure_sensitivity, exit_proximity_need: m.exit_proximity_need },
    };
  }

  var defaultAnxiety = buildAnxietyData(0);
  var defaultTemporal = { total_dwell_min: 0, fatigue_accumulated: 0 };

  // ── ISO 7730 / ASHRAE 55 PMV (store.ts:2688-2750) ──────────
  function calculatePMV(tdb, tr, vr, rh, met, clo) {
    var M = met * 58.15;
    var W = 0;
    var Icl = clo * 0.155;
    var pa = (rh / 100) * 610.5 * Math.exp((17.269 * tdb) / (237.3 + tdb));
    var fcl = clo <= 0.078 ? 1.0 + 1.29 * Icl : 1.05 + 0.645 * Icl;

    var tcl = 35.7 - 0.028 * (M - W) - Icl * (
      3.96e-8 * fcl * (Math.pow(35.7 - 0.028 * (M - W) + 273, 4) - Math.pow(tr + 273, 4))
    );

    for (var i = 0; i < 150; i++) {
      var hcn0 = 2.38 * Math.pow(Math.abs(tcl - tdb), 0.25);
      var hcf0 = 12.1 * Math.sqrt(vr);
      var hc0 = Math.max(hcn0, hcf0);
      var tclNew = 35.7 - 0.028 * (M - W) - Icl * (
        3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4)) +
        fcl * hc0 * (tcl - tdb)
      );
      if (Math.abs(tclNew - tcl) < 0.00015) { tcl = tclNew; break; }
      tcl = 0.5 * tcl + 0.5 * tclNew;
    }

    var hcn = 2.38 * Math.pow(Math.abs(tcl - tdb), 0.25);
    var hcf = 12.1 * Math.sqrt(vr);
    var hc = Math.max(hcn, hcf);

    var L_skin_diffusion = 3.05e-3 * (5733 - 6.99 * (M - W) - pa);
    var L_sweat = 0.42 * ((M - W) - 58.15);
    var L_resp_latent = 1.7e-5 * M * (5867 - pa);
    var L_resp_sensible = 0.0014 * M * (34 - tdb);
    var L_radiation = 3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4));
    var L_convection = fcl * hc * (tcl - tdb);

    var pmv = (0.303 * Math.exp(-0.036 * M) + 0.028) * (
      (M - W) - L_skin_diffusion - L_sweat - L_resp_latent - L_resp_sensible - L_radiation - L_convection
    );

    var ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    return {
      pmv: isNaN(pmv) ? 0 : r2(pmv),
      ppd: isNaN(ppd) ? 5 : Math.round(ppd * 10) / 10,
      heatLoss: {
        convection: r2(L_convection),
        radiation: r2(L_radiation),
        evaporation: r2(L_skin_diffusion + L_sweat),
        respiration: r2(L_resp_latent + L_resp_sensible),
        metabolic_input: r2(M - W),
      },
    };
  }

  function getPMVWarnings(tdb, rh, vr, met, clo, pmv) {
    var w = [];
    if (vr > 0.2) w.push("Elevated air speed: PMV may be unreliable; consider SET.");
    if (rh < 20 || rh > 80) w.push("Extreme humidity may reduce PMV reliability.");
    if (tdb < 10 || tdb > 35) w.push("Air temperature outside typical PMV bounds (10–35 °C).");
    if (met < 0.8 || met > 2.0) w.push("Met outside typical PMV range (0.8–2.0).");
    if (clo > 2) w.push("High clothing insulation (>2 clo).");
    if (Math.abs(pmv) > 3) w.push("PMV value outside comfort scale range (−3 to +3).");
    return w;
  }

  // ── Greenery / view-out curves (store.ts:2922-3010) ────────
  function viewOutFactor(distToWindow) {
    if (distToWindow < 0) return 0;
    if (distToWindow <= 2) return 1.0;
    if (distToWindow >= 10) return 0.1;
    return 1.0 - (distToWindow - 2) / 8 * 0.9;
  }

  function stressRecoveryFromGVI(gvi) {
    var g = Math.max(0, Math.min(1, gvi));
    if (g <= 0.25) return g * 3.4;
    if (g <= 0.75) return 0.85;
    return Math.max(0, 0.85 - (g - 0.75) * 0.3);
  }

  function anxietyGreenAmplifier(level) {
    switch (level) {
      case "normal": return 1.0;
      case "mild": return 1.2;
      case "moderate": return 1.5;
      case "severe": return 1.7;
      default: return 1.0;
    }
  }

  function effectiveAnxietyModifiers(persona, gvi) {
    var anxiety = persona.agent.anxiety || defaultAnxiety;
    var mods = anxiety.modifiers;
    if (anxiety.asi_level === "normal" || gvi <= 0) return mods;
    var recovery = stressRecoveryFromGVI(gvi);
    var amp = anxietyGreenAmplifier(anxiety.asi_level);
    return {
      noise_sensitivity:     mods.noise_sensitivity     * Math.max(0.05, 1 - recovery * 0.20 * amp),
      thermal_comfort_range: mods.thermal_comfort_range,
      personal_space_radius: mods.personal_space_radius,
      enclosure_sensitivity: mods.enclosure_sensitivity,
      exit_proximity_need:   mods.exit_proximity_need   * Math.max(0.05, 1 - recovery * 0.15 * amp),
    };
  }

  function perceivedAirTemp(airTemp, gvi) {
    var baseCooling = Math.min(gvi * 5.0, 5.0);
    var heatRamp =
      airTemp <= 24 ? 0 :
      airTemp >= 30 ? 1.3 :
      airTemp >= 27 ? 1.0 :
      (airTemp - 24) / 3;
    return airTemp - baseCooling * heatRamp;
  }

  // ── Zone helpers (store.ts:1844-1952, 2056-2069) ───────────
  function zoneEnvToEnvironment(ze) {
    var out = {
      lux: Math.round(ze.light),
      dB: Math.round(ze.noise * 10) / 10,
      air_temp: Math.round(ze.temperature * 10) / 10,
      humidity: Math.round(ze.humidity * 10) / 10,
      air_velocity: Math.round(ze.air_velocity * 100) / 100,
      open_space: ze.open_space === true,
    };
    if (ze.mrt !== undefined) out.mrt = Math.round(ze.mrt * 10) / 10;
    if (ze.outdoor_air_temp !== undefined) out.outdoor_air_temp = Math.round(ze.outdoor_air_temp * 10) / 10;
    return out;
  }

  function isPointInZone(px, py, b) {
    if (b.points && b.points.length >= 3) {
      var inside = false;
      for (var i = 0, j = b.points.length - 1; i < b.points.length; j = i++) {
        var xi = b.points[i][0], yi = b.points[i][1];
        var xj = b.points[j][0], yj = b.points[j][1];
        var intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
  }

  var BLEND_MARGIN = 1500; // mm — proximity fallback only (store.ts); never fires when agent is at a zone centre.

  function getZoneAtPosition(px, py, zones) {
    var containing = zones.filter(function (z) { return isPointInZone(px, py, z.bounds); });
    if (containing.length > 0) return containing[containing.length - 1];
    var closest = null, closestDist = Infinity;
    for (var k = 0; k < zones.length; k++) {
      var b = zones[k].bounds;
      var cx = Math.max(b.x, Math.min(px, b.x + b.width));
      var cy = Math.max(b.y, Math.min(py, b.y + b.height));
      var d = Math.sqrt(Math.pow(px - cx, 2) + Math.pow(py - cy, 2));
      if (d < closestDist) { closestDist = d; closest = zones[k]; }
    }
    return (closest && closestDist <= BLEND_MARGIN) ? closest : null;
  }

  function polygonAreaM2(points) {
    if (points.length < 3) return 0;
    var s = 0;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    }
    return Math.abs(s / 2) / 1000000;
  }

  function zoneAreaM2(zone) {
    var b = zone.bounds;
    if (b.points && b.points.length >= 3) return polygonAreaM2(b.points);
    return (b.width * b.height) / 1000000;
  }

  function densityPenaltyMultiplier(m2PerPerson) {
    if (!isFinite(m2PerPerson) || m2PerPerson < 0) return 1.0;
    if (m2PerPerson >= 8) return 1.0;
    if (m2PerPerson >= 4) return 1.0 + (8 - m2PerPerson) / 4 * 0.20;
    if (m2PerPerson >= 2) return 1.20 + (4 - m2PerPerson) / 2 * 0.40;
    return Math.min(2.50, 1.60 + (2 - m2PerPerson) / 2 * 0.90);
  }

  // ── computeOutputs (store.ts:3012-3065) ────────────────────
  function computeOutputs(persona) {
    var gvi = persona.spatial.green_visibility == null ? 0 : persona.spatial.green_visibility;
    var airTempRaw = persona.environment.air_temp;
    var perceivedTemp = perceivedAirTemp(airTempRaw, gvi);
    var recovery = stressRecoveryFromGVI(gvi);

    var baseMrt = persona.environment.mrt == null ? airTempRaw : persona.environment.mrt;
    var mrtDelta = baseMrt - airTempRaw;
    var effectiveMrt = perceivedTemp + mrtDelta;

    var pmvRes = calculatePMV(
      perceivedTemp, effectiveMrt,
      persona.environment.air_velocity, persona.environment.humidity,
      persona.agent.metabolic_rate, persona.agent.clothing_insulation
    );
    var warnings = getPMVWarnings(
      perceivedTemp, persona.environment.humidity,
      persona.environment.air_velocity, persona.agent.metabolic_rate,
      persona.agent.clothing_insulation, pmvRes.pmv
    );
    var visionFactor = persona.agent.vision === "normal" ? 1 : persona.agent.vision === "mild_impairment" ? 0.75 : 0.5;
    var hearingFactor = persona.agent.hearing === "normal" ? 1 : persona.agent.hearing === "impaired" ? 1.1 : 0.7;
    var perceivedDb = Math.round(persona.environment.dB * hearingFactor);
    var effMods = effectiveAnxietyModifiers(persona, gvi);
    var anxietyPerceivedDb = Math.round(perceivedDb * effMods.noise_sensitivity * 10) / 10;
    var anxietyPmvRange = Math.round((1 / effMods.thermal_comfort_range) * 100) / 100;
    var distExit = persona.spatial.dist_to_exit;
    var anxietyPersonalSpace = distExit < 0 ? -1 : Math.round(distExit * effMods.exit_proximity_need * 10) / 10;
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    return {
      PMV: pmvRes.pmv, PPD: pmvRes.ppd,
      effective_lux: Math.round(persona.environment.lux * visionFactor),
      perceived_dB: perceivedDb,
      pmv_warnings: warnings,
      anxiety_perceived_dB: anxietyPerceivedDb,
      anxiety_pmv_range: anxietyPmvRange,
      anxiety_personal_space: anxietyPersonalSpace,
      perceived_air_temp: r1(perceivedTemp),
      effective_mrt: r1(effectiveMrt),
      mrt_delta: r1(effectiveMrt - perceivedTemp),
      green_recovery: Math.round(recovery * 100) / 100,
      heat_loss: pmvRes.heatLoss,
    };
  }

  // ── computePerceptualLoad (store.ts:3082-3309) ─────────────
  function computePerceptualLoad(persona, computed, zones) {
    var anxiety = persona.agent.anxiety || defaultAnxiety;
    var mods = anxiety.modifiers;

    var pmvDivisor = Math.max(0.1, 3 * computed.anxiety_pmv_range);
    var thermalDiscomfort = Math.min(1, Math.abs(computed.PMV) / pmvDivisor);

    var isOutdoor = persona.environment.open_space === true;
    var optimalLux = 300;
    var luxDev = isOutdoor ? 0 : Math.abs(persona.environment.lux - optimalLux) / optimalLux;
    var visionPenalty = persona.agent.vision === "normal" ? 0 : persona.agent.vision === "mild_impairment" ? 0.15 : 0.3;
    var hasWindowInLOS = persona.spatial.dist_to_window >= 0;
    var windowlessVisualPenalty = (hasWindowInLOS || isOutdoor) ? 0 : 0.15;
    var visualStrain = Math.min(1, luxDev * 0.6 + visionPenalty + windowlessVisualPenalty);

    var noiseInput = computed.anxiety_perceived_dB;
    var noiseBase = noiseInput > 70 ? 0.8 : noiseInput > 55 ? 0.4 : noiseInput > 40 ? 0.2 : 0.05;
    var hearingPenalty = persona.agent.hearing === "impaired" ? 0.15 : persona.agent.hearing === "deaf" ? -0.1 : 0;
    var noiseStress = Math.min(1, Math.max(0, noiseBase + hearingPenalty));

    var isIntrovert = persona.agent.mbti.charAt(0) === "I";
    var socialBase = persona.spatial.visible_agents > 5 ? 0.6 : persona.spatial.visible_agents > 2 ? 0.3 : 0.1;
    var socialCore = (socialBase + (isIntrovert ? 0.2 : -0.1)) * mods.personal_space_radius;
    var enclosureMismatch = Math.abs(persona.spatial.enclosure_ratio - 0.5) * 2;
    var enclosureTerm = enclosureMismatch * (mods.enclosure_sensitivity - 1) * 0.4;
    var socialOverload = Math.min(1, Math.max(0, socialCore + enclosureTerm));

    var densityM2PerPerson = -1;
    var densityFactor = 1.0;
    if (zones && zones.length > 0) {
      var px = persona.position.cell[0] * 1000;
      var py = persona.position.cell[1] * 1000;
      var zone = getZoneAtPosition(px, py, zones);
      if (zone) {
        var area = zoneAreaM2(zone);
        if (area > 0) {
          var occupants = persona.spatial.visible_agents + 1;
          densityM2PerPerson = area / occupants;
          densityFactor = densityPenaltyMultiplier(densityM2PerPerson);
        }
      }
    }
    var densityExcess = Math.max(0, densityFactor - 1.0);
    if (densityExcess > 0) {
      socialOverload = Math.min(1, socialOverload + densityExcess * 0.30);
    }

    var durationFactor = Math.min(1, persona.position.duration_in_cell / 120);
    var ageFactor = persona.agent.age > 65 ? 0.2 : persona.agent.age > 45 ? 0.1 : 0;
    var windowlessFatiguePenalty = (hasWindowInLOS || isOutdoor)
      ? 0
      : persona.position.duration_in_cell < 30 ? 0.05
      : persona.position.duration_in_cell < 60 ? 0.15
      : persona.position.duration_in_cell < 90 ? 0.25
      : 0.30;
    var densityFatigueBoost = densityExcess * 0.20 * durationFactor;
    var fatigue = Math.min(1, durationFactor * 0.5 + ageFactor + thermalDiscomfort * 0.2 + windowlessFatiguePenalty + densityFatigueBoost);

    var effectiveExit = computed.anxiety_personal_space < 0 ? -1 : computed.anxiety_personal_space;
    var baseExitFactor = effectiveExit < 0
      ? 0.7
      : effectiveExit > 10 ? 0.5 : effectiveExit > 5 ? 0.3 : 0.1;
    var panicAmp = anxietyGreenAmplifier(anxiety.asi_level);
    var exitFactor = effectiveExit < 0 ? Math.min(1, baseExitFactor * panicAmp) : baseExitFactor;
    var mobilityPenalty = persona.agent.mobility !== "normal" ? 0.2 : 0;
    var wayfindingAnxiety = Math.min(1, exitFactor + mobilityPenalty);

    var noExit = persona.spatial.dist_to_exit < 0;
    var noWindow = !isOutdoor && persona.spatial.dist_to_window < 0;
    var sealed = persona.spatial.enclosure_ratio > 0.85;
    var crowded = persona.spatial.visible_agents >= 3;
    var trappedCount = (noExit ? 1 : 0) + (noWindow ? 1 : 0) + (sealed ? 1 : 0) + (crowded ? 1 : 0);
    var trappedIntensity = trappedCount >= 3
      ? (trappedCount / 4) * Math.min(1, persona.position.duration_in_cell / 60)
      : 0;
    if (trappedIntensity > 0) {
      wayfindingAnxiety = Math.min(1, wayfindingAnxiety + trappedIntensity * 0.20 * panicAmp);
    }

    if (trappedIntensity > 0) {
      fatigue = Math.min(1, fatigue + trappedIntensity * 0.25 * panicAmp);
      socialOverload = Math.min(1, socialOverload + trappedIntensity * 0.10 * panicAmp);
    }

    var recovery = computed.green_recovery;
    var fatigueOut = fatigue * (1 - recovery * 0.20);
    var socialOut = socialOverload * (1 - recovery * 0.15);
    var visualOut = visualStrain * (1 - recovery * 0.10);

    var viewOut = isOutdoor ? 1 : viewOutFactor(persona.spatial.dist_to_window);
    fatigueOut *= (1 - viewOut * 0.10);
    socialOut  *= (1 - viewOut * 0.08);
    visualOut  *= (1 - viewOut * 0.05);

    return {
      thermal_discomfort: Math.round(thermalDiscomfort * 100) / 100,
      visual_strain: Math.round(visualOut * 100) / 100,
      noise_stress: Math.round(noiseStress * 100) / 100,
      social_overload: Math.round(socialOut * 100) / 100,
      fatigue: Math.round(fatigueOut * 100) / 100,
      wayfinding_anxiety: Math.round(wayfindingAnxiety * 100) / 100,
    };
  }

  // ── Scores + drivers (store.ts:2100-2394) ──────────────────
  function computeStressScore(acc) {
    var w = { thermal_discomfort: 0.20, visual_strain: 0.15, noise_stress: 0.20, social_overload: 0.15, fatigue: 0.15, wayfinding_anxiety: 0.15 };
    var score = (
      acc.thermal_discomfort * w.thermal_discomfort +
      acc.visual_strain * w.visual_strain +
      acc.noise_stress * w.noise_stress +
      acc.social_overload * w.social_overload +
      acc.fatigue * w.fatigue +
      acc.wayfinding_anxiety * w.wayfinding_anxiety
    ) * 10;
    return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
  }

  function computeComfortScore(load) {
    var stress = computeStressScore(load);
    return Math.max(1, Math.min(10, Math.round(10 - stress)));
  }

  function round01(n) { return Math.round(n * 100) / 100; }

  var COMFORT_DRIVER_THRESHOLD = 0.30;

  function deriveComfortDrivers(accState, computed, env, spatial) {
    var out = [];
    if (accState.thermal_discomfort >= COMFORT_DRIVER_THRESHOLD) {
      var pmv = computed.PMV;
      var t = computed.perceived_air_temp;
      var direction = pmv <= -0.5 ? "cold" : pmv >= 0.5 ? "warm" : "borderline neutral";
      out.push({ factor: "thermal_discomfort", level: round01(accState.thermal_discomfort),
        cause: "PMV " + pmv.toFixed(2) + " (" + direction + "); perceived " + t.toFixed(1) + "°C, " + env.humidity + "% RH, air " + env.air_velocity + " m/s" });
    }
    if (accState.visual_strain >= COMFORT_DRIVER_THRESHOLD) {
      var lux = env.lux;
      var lit = lux < 100 ? "very dim — eyes straining"
        : lux < 200 ? "dim — below comfortable reading lux"
        : lux < 500 ? "low ambient — borderline"
        : lux > 3000 ? "very bright — possible glare"
        : lux + " lux — within neutral range, strain likely from contrast or duration";
      out.push({ factor: "visual_strain", level: round01(accState.visual_strain), cause: "lux " + Math.round(lux) + " — " + lit });
    }
    if (accState.noise_stress >= COMFORT_DRIVER_THRESHOLD) {
      var dB = env.dB;
      var anx = computed.anxiety_perceived_dB;
      var amp = anx > dB + 0.1 ? " (anxiety amplifies to ~" + anx.toFixed(1) + ")" : "";
      out.push({ factor: "noise_stress", level: round01(accState.noise_stress), cause: dB + " dB" + amp });
    }
    if (accState.social_overload >= COMFORT_DRIVER_THRESHOLD) {
      var va = spatial.visible_agents;
      var space = computed.anxiety_personal_space;
      var spaceNote = space > 0 ? "; personal-space need ~" + space.toFixed(1) + "m" : "";
      out.push({ factor: "social_overload", level: round01(accState.social_overload),
        cause: va + " other agent" + (va === 1 ? "" : "s") + " in line of sight" + spaceNote });
    }
    if (accState.fatigue >= COMFORT_DRIVER_THRESHOLD) {
      out.push({ factor: "fatigue", level: round01(accState.fatigue), cause: "accumulated across prior legs of this visit" });
    }
    if (accState.wayfinding_anxiety >= COMFORT_DRIVER_THRESHOLD) {
      var exit = spatial.dist_to_exit;
      var cause = exit < 0
        ? "no exit visible from current position"
        : "nearest exit " + exit + "m away" + (spatial.enclosure_ratio >= 0.7 ? "; enclosure " + spatial.enclosure_ratio.toFixed(2) + " (mostly enclosed)" : "");
      out.push({ factor: "wayfinding_anxiety", level: round01(accState.wayfinding_anxiety), cause: cause });
    }
    return out.sort(function (a, b) { return b.level - a.level; });
  }

  // ── Convenience: assemble PersonaData + run the full pipeline
  // agent  : real AgentData (asi/modifiers/mbti/metabolic_rate/...)
  // zone   : { id,label,bounds,env(ZoneEnv),spatial(SpatialData) }
  // opts   : { duration_in_cell?, timestamp? }
  function runPerception(agent, zone, opts) {
    opts = opts || {};
    var bx = zone.bounds, cellX = Math.round((bx.x + bx.width / 2) / 1000), cellY = Math.round((bx.y + bx.height / 2) / 1000);
    var persona = {
      agent: agent,
      position: {
        cell: [cellX, cellY],
        timestamp: opts.timestamp || "10:25",
        duration_in_cell: opts.duration_in_cell != null ? opts.duration_in_cell : 30,
      },
      environment: zoneEnvToEnvironment(zone.env),
      spatial: {
        dist_to_wall: zone.spatial.dist_to_wall,
        dist_to_window: zone.spatial.dist_to_window,
        dist_to_exit: zone.spatial.dist_to_exit,
        ceiling_h: zone.spatial.ceiling_h,
        enclosure_ratio: zone.spatial.enclosure_ratio,
        visible_agents: zone.spatial.visible_agents,
        green_visibility: zone.spatial.green_visibility,
      },
      temporal: { total_dwell_min: defaultTemporal.total_dwell_min, fatigue_accumulated: defaultTemporal.fatigue_accumulated },
    };
    var computed = computeOutputs(persona);
    var accState = computePerceptualLoad(persona, computed, [zoneToEngineZone(zone)]);
    var stress = computeStressScore(accState);
    var comfort = computeComfortScore(accState);
    var drivers = deriveComfortDrivers(accState, computed, persona.environment, persona.spatial);
    return { persona: persona, computed: computed, accState: accState, stress_score: stress, comfort_score: comfort, drivers: drivers };
  }

  // Zone object the density branch expects (bounds + env). The site
  // dataset's zone already carries bounds in mm.
  function zoneToEngineZone(z) {
    return { id: z.id, label: z.label, bounds: z.bounds, env: z.env };
  }

  // ════════════════════════════════════════════════════════════
  //  GEOMETRY / LINE-OF-SIGHT ENGINE
  //  Faithful port of store.ts shape-geometry so dist_to_wall /
  //  window / exit / enclosure / green_visibility / visible_agents
  //  are GEOMETRICALLY COMPUTED from traced shapes — not authored.
  //  Shape = { type:"site|wall|column|door|window|green", points:[[x,y]], meta?:{centerline,hasWalls} }  (mm)
  // ════════════════════════════════════════════════════════════
  var OPENING_EDGE_TOLERANCE_MM = 50;

  function blocksLineOfSight(s) {
    if (s.type === "wall" || s.type === "column") return true;
    if (s.type === "site" && s.meta && s.meta.hasWalls) return true;
    return false;
  }
  function blocksMovement(s) { return s.type === "wall" || s.type === "column" || s.type === "window"; }

  function buildThickRect(ax, ay, bx, by, thickness, side) {
    var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      var t0 = thickness / 2;
      return [[ax - t0, ay - t0], [ax + t0, ay - t0], [ax + t0, ay + t0], [ax - t0, ay + t0]];
    }
    var sign = side === "right" ? -1 : 1;
    var nx = -dy / len * sign, ny = dx / len * sign, t = thickness;
    return [
      [Math.round(ax), Math.round(ay)],
      [Math.round(bx), Math.round(by)],
      [Math.round(bx + nx * t), Math.round(by + ny * t)],
      [Math.round(ax + nx * t), Math.round(ay + ny * t)],
    ];
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));
    var t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(Math.pow(px - (x1 + t * dx), 2) + Math.pow(py - (y1 + t * dy), 2));
  }
  function lineIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var dxAB = bx - ax, dyAB = by - ay, dxCD = dx - cx, dyCD = dy - cy;
    var denom = dxAB * dyCD - dyAB * dxCD;
    if (Math.abs(denom) < 1e-10) return false;
    var t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
    var u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function shapeCentroid(pts) {
    var sx = 0, sy = 0;
    for (var i = 0; i < pts.length; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    return [sx / pts.length, sy / pts.length];
  }
  function rayCastInPolygon(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  var isPointInBoundary = rayCastInPolygon;
  function isPointInBoundaryOrOnEdge(px, py, pts, epsilon) {
    if (epsilon == null) epsilon = 5;
    if (isPointInBoundary(px, py, pts)) return true;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      var t = ((px - pts[j][0]) * dx + (py - pts[j][1]) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      var cx = pts[j][0] + t * dx, cy = pts[j][1] + t * dy;
      if (Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) <= epsilon) return true;
    }
    return false;
  }

  function hasLineOfSight(ax, ay, bx, by, shapes) {
    var blockers = shapes.filter(blocksLineOfSight);
    if (blockers.length === 0) return true;
    var losOpenings = shapes.filter(function (s) { return s.type === "window" && s.points.length >= 3; });
    var EPS = 1e-4;
    for (var b = 0; b < blockers.length; b++) {
      var pts = blockers[b].points;
      if (pts.length < 2) continue;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        if (pts.length === 2 && i === 1) break;
        var dxAB = bx - ax, dyAB = by - ay;
        var dxCD = pts[j][0] - pts[i][0], dyCD = pts[j][1] - pts[i][1];
        var denom = dxAB * dyCD - dyAB * dxCD;
        if (Math.abs(denom) < 1e-10) continue;
        var t = ((pts[i][0] - ax) * dyCD - (pts[i][1] - ay) * dxCD) / denom;
        var u = ((pts[i][0] - ax) * dyAB - (pts[i][1] - ay) * dxAB) / denom;
        if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
          var ix = ax + t * dxAB, iy = ay + t * dyAB;
          var insideOpening = losOpenings.some(function (op) { return isPointInBoundaryOrOnEdge(ix, iy, op.points, OPENING_EDGE_TOLERANCE_MM); });
          if (insideOpening) continue;
          return false;
        }
      }
    }
    return true;
  }

  function rayCrossesWall(ax, ay, bx, by, shapes) {
    var blockers = shapes.filter(blocksLineOfSight);
    if (blockers.length === 0) return false;
    var dxAB = bx - ax, dyAB = by - ay, EPS = 1e-4;
    for (var b = 0; b < blockers.length; b++) {
      var pts = blockers[b].points;
      if (pts.length < 2) continue;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        if (pts.length === 2 && i === 1) break;
        var cx = pts[i][0], cy = pts[i][1];
        var dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
        var denom = dxAB * dyCD - dyAB * dxCD;
        if (Math.abs(denom) < 1e-10) continue;
        var t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
        var u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
        if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) return true;
      }
    }
    return false;
  }

  function isDoorInAgentRoom(ax, ay, door, shapes) {
    var cl = door.meta && door.meta.centerline;
    if (cl) {
      var a = cl[0], b = cl[1];
      var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        var nx = -dy / len, ny = dx / len, offset = 300;
        if (!rayCrossesWall(ax, ay, cx + nx * offset, cy + ny * offset, shapes)) return true;
        if (!rayCrossesWall(ax, ay, cx - nx * offset, cy - ny * offset, shapes)) return true;
        return false;
      }
    }
    for (var p = 0; p < door.points.length; p++) {
      if (!rayCrossesWall(ax, ay, door.points[p][0], door.points[p][1], shapes)) return true;
    }
    return false;
  }

  function distToShapeType(ax, ay, shapes, type) {
    var minDist = Infinity;
    var types = Array.isArray(type) ? type : [type];
    var filtered = shapes.filter(function (s) { return types.indexOf(s.type) !== -1; });
    if (filtered.length === 0) return -1;
    var needLOS = types.every(function (t) { return t === "window"; });
    for (var f = 0; f < filtered.length; f++) {
      var shape = filtered[f];
      if (needLOS) {
        var ce = shapeCentroid(shape.points);
        if (!hasLineOfSight(ax, ay, ce[0], ce[1], shapes)) continue;
      }
      if (shape.type === "door" && !isDoorInAgentRoom(ax, ay, shape, shapes)) continue;
      var pts = shape.points;
      if (pts.length < 2) continue;
      var isClosed = shape.type !== "window" && pts.length >= 3;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        if (!isClosed && j === 0 && pts.length > 1) continue;
        var d = distToSegment(ax, ay, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
        if (d < minDist) minDist = d;
      }
    }
    return minDist === Infinity ? -1 : Math.round(minDist / 100) / 10;
  }

  function computeEnclosure(ax, ay, shapes) {
    var blockers = shapes.filter(blocksLineOfSight);
    if (blockers.length === 0) return 0;
    var rays = 16, hits = 0, reach = 10000;
    for (var i = 0; i < rays; i++) {
      var angle = (i / rays) * Math.PI * 2;
      var ex = ax + Math.cos(angle) * reach, ey = ay + Math.sin(angle) * reach, rayHit = false;
      for (var b = 0; b < blockers.length && !rayHit; b++) {
        var pts = blockers[b].points;
        for (var j = 0; j < pts.length; j++) {
          var k = (j + 1) % pts.length;
          if (pts.length === 2 && j === 1) break;
          if (lineIntersect(ax, ay, ex, ey, pts[j][0], pts[j][1], pts[k][0], pts[k][1])) { rayHit = true; break; }
        }
      }
      if (rayHit) hits++;
    }
    return Math.round((hits / rays) * 100) / 100;
  }

  function nearestBlockerTWithOpenings(ax, ay, bx, by, shapes) {
    var blockers = shapes.filter(blocksLineOfSight);
    if (blockers.length === 0) return Infinity;
    var losOpenings = shapes.filter(function (s) { return s.type === "window" && s.points.length >= 3; });
    var dxAB = bx - ax, dyAB = by - ay, EPS = 1e-4, best = Infinity;
    for (var b = 0; b < blockers.length; b++) {
      var pts = blockers[b].points;
      if (pts.length < 2) continue;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        if (pts.length === 2 && i === 1) break;
        var cx = pts[i][0], cy = pts[i][1];
        var dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
        var denom = dxAB * dyCD - dyAB * dxCD;
        if (Math.abs(denom) < 1e-10) continue;
        var t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
        var u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
        if (t > EPS && t < 1 && u >= 0 && u <= 1) {
          var ix = ax + t * dxAB, iy = ay + t * dyAB;
          var insideOpening = losOpenings.some(function (op) { return isPointInBoundaryOrOnEdge(ix, iy, op.points, OPENING_EDGE_TOLERANCE_MM); });
          if (insideOpening) continue;
          if (t < best) best = t;
        }
      }
    }
    return best;
  }
  function nearestRayPolygonT(ax, ay, bx, by, pts) {
    var dxAB = bx - ax, dyAB = by - ay, best = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      var cx = pts[i][0], cy = pts[i][1];
      var dxCD = pts[j][0] - cx, dyCD = pts[j][1] - cy;
      var denom = dxAB * dyCD - dyAB * dxCD;
      if (Math.abs(denom) < 1e-10) continue;
      var t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
      var u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
      if (t > 1e-4 && t < 1 && u >= 0 && u <= 1) { if (t < best) best = t; }
    }
    return best === Infinity ? null : best;
  }
  function computeGreenVisibility(pos, shapes) {
    var greens = shapes.filter(function (s) { return s.type === "green" && s.points.length >= 3; });
    if (greens.length === 0) return 0;
    for (var g0 = 0; g0 < greens.length; g0++) {
      if (isPointInBoundary(pos.x, pos.y, greens[g0].points)) return 1.0;
    }
    var RAYS = 36, MAX_DIST = 30000, hits = 0;
    for (var i = 0; i < RAYS; i++) {
      var angle = (i / RAYS) * 2 * Math.PI;
      var ex = pos.x + Math.cos(angle) * MAX_DIST, ey = pos.y + Math.sin(angle) * MAX_DIST;
      var greenT = Infinity;
      for (var g = 0; g < greens.length; g++) {
        var tg = nearestRayPolygonT(pos.x, pos.y, ex, ey, greens[g].points);
        if (tg !== null && tg < greenT) greenT = tg;
      }
      if (greenT === Infinity) continue;
      var blockerT = nearestBlockerTWithOpenings(pos.x, pos.y, ex, ey, shapes);
      if (greenT < blockerT) hits++;
    }
    return Math.round((hits / RAYS) * 100) / 100;
  }

  function computeSpatialFromAgent(pos, shapes, currentSpatial, zones) {
    var distWall = distToShapeType(pos.x, pos.y, shapes, ["wall", "column"]);
    if (distWall < 0) distWall = distToShapeType(pos.x, pos.y, shapes, "site");
    var distWin = distToShapeType(pos.x, pos.y, shapes, "window");
    var distDoor = distToShapeType(pos.x, pos.y, shapes, "door");
    var enclosure = computeEnclosure(pos.x, pos.y, shapes);
    var ceiling = -1;
    if (zones && zones.length > 0) {
      var zn = getZoneAtPosition(pos.x, pos.y, zones);
      if (zn) ceiling = Math.round((zn.env.ceiling_height / 1000) * 100) / 100;
    }
    return {
      dist_to_wall: distWall,
      dist_to_window: distWin,
      dist_to_exit: distDoor,
      ceiling_h: ceiling,
      enclosure_ratio: enclosure,
      visible_agents: currentSpatial ? currentSpatial.visible_agents : 0,
      green_visibility: computeGreenVisibility(pos, shapes),
    };
  }

  function computeVisibleAgents(agentIdx, allPositions, shapes) {
    var myPos = allPositions[agentIdx];
    if (!myPos) return 0;
    var sites = shapes.filter(function (s) { return s.type === "site" && s.points.length >= 3; });
    var mySites = sites.filter(function (r) { return isPointInBoundary(myPos.x, myPos.y, r.points); });
    var count = 0, i, other;
    if (mySites.length === 0) {
      for (i = 0; i < allPositions.length; i++) {
        if (i === agentIdx || !allPositions[i]) continue;
        other = allPositions[i];
        var otherInSite = sites.some(function (r) { return isPointInBoundary(other.x, other.y, r.points); });
        if (!otherInSite && hasLineOfSight(myPos.x, myPos.y, other.x, other.y, shapes)) count++;
      }
      return count;
    }
    for (i = 0; i < allPositions.length; i++) {
      if (i === agentIdx || !allPositions[i]) continue;
      other = allPositions[i];
      var sameSite = mySites.some(function (r) { return isPointInBoundary(other.x, other.y, r.points); });
      if (sameSite && hasLineOfSight(myPos.x, myPos.y, other.x, other.y, shapes)) count++;
    }
    return count;
  }

  // Build engine Shape[] from the tracer's %-of-image geometry.
  //  geom = { building:{w_mm,h_mm}, zones:[{id,rect:[x%,y%,w%,h%]}],
  //           doors|windows:[{line:[[x%,y%],[x%,y%]]}], greens:[{rect:[x%,y%,w%,h%]}] }
  // Walls are auto-derived from each zone rectangle's 4 edges. One site
  // polygon = whole building (hasWalls:false) so co-site grouping = the
  // building and inter-room walls drive LOS / visible_agents.
  function buildShapesFromGeometry(geom) {
    var B = geom.building || { w_mm: 40000, h_mm: 14000 };
    var X = function (p) { return p / 100 * B.w_mm; };
    var Y = function (p) { return p / 100 * B.h_mm; };
    var shapes = [];
    shapes.push({ type: "site", points: [[0, 0], [B.w_mm, 0], [B.w_mm, B.h_mm], [0, B.h_mm]], meta: { hasWalls: false } });

    // % rect [x,y,w,h] → { corners(mm), centerline(mm, along longer axis) }
    function rectMM(r) {
      var x0 = X(r[0]), y0 = Y(r[1]), x1 = X(r[0] + r[2]), y1 = Y(r[1] + r[3]);
      var corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      var cl = (x1 - x0) >= (y1 - y0)
        ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
        : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]];
      return { corners: corners, centerline: cl };
    }
    // % point list → mm point list (polygon)
    function polyMM(pts) { return pts.map(function (p) { return [X(p[0]), Y(p[1])]; }); }
    function pushEdgeWalls(ptsMM, zoneId) {
      for (var i = 0; i < ptsMM.length; i++) {
        var a = ptsMM[i], b = ptsMM[(i + 1) % ptsMM.length];
        shapes.push({ type: "wall", points: buildThickRect(a[0], a[1], b[0], b[1], 100, "left"),
          meta: { centerline: [[a[0], a[1]], [b[0], b[1]]], zoneId: zoneId } });
      }
    }

    (geom.zones || []).forEach(function (z) {
      if (z.poly && z.poly.length >= 3) {
        pushEdgeWalls(polyMM(z.poly), z.id);
      } else if (z.rect) {
        var rm = rectMM(z.rect);
        pushEdgeWalls(rm.corners, z.id);
      }
    });
    (geom.doors || []).forEach(function (d) {
      if (d.rect) {
        var rm = rectMM(d.rect);
        shapes.push({ type: "door", points: rm.corners, meta: { centerline: rm.centerline } });
      } else if (d.line) { // legacy
        var a = [X(d.line[0][0]), Y(d.line[0][1])], b = [X(d.line[1][0]), Y(d.line[1][1])];
        shapes.push({ type: "door", points: buildThickRect(a[0], a[1], b[0], b[1], 100, "left"), meta: { centerline: [a, b] } });
      }
    });
    (geom.windows || []).forEach(function (w) {
      if (w.rect) {
        var rm = rectMM(w.rect);
        shapes.push({ type: "window", points: rm.corners, meta: { centerline: rm.centerline } });
      } else if (w.line) { // legacy
        var a = [X(w.line[0][0]), Y(w.line[0][1])], b = [X(w.line[1][0]), Y(w.line[1][1])];
        shapes.push({ type: "window", points: buildThickRect(a[0], a[1], b[0], b[1], 300, "left"), meta: { centerline: [a, b] } });
      }
    });
    (geom.greens || []).forEach(function (gr) {
      if (gr.poly && gr.poly.length >= 3) { shapes.push({ type: "green", points: polyMM(gr.poly) }); }
      else if (gr.rect) { shapes.push({ type: "green", points: rectMM(gr.rect).corners }); }
    });
    return shapes;
  }

  // Geometric perception: spatial comes from real shapes at the agent's
  // mm position; everything else identical to runPerception.
  //  agent, zoneEnvObj{env,bounds}, opts{ agentXY:{x,y}mm, shapes, zonesMM, others:[{x,y}mm], duration_in_cell, timestamp }
  function runPerceptionGeo(agent, zoneObj, opts) {
    opts = opts || {};
    var shapes = opts.shapes || [];
    var ax = opts.agentXY.x, ay = opts.agentXY.y;
    var spatialGeo = computeSpatialFromAgent({ x: ax, y: ay }, shapes, { visible_agents: 0 }, opts.zonesMM || null);
    // visible_agents from other placed agents (insert self at idx 0)
    var positions = [{ x: ax, y: ay }].concat((opts.others || []).map(function (o) { return { x: o.x, y: o.y }; }));
    spatialGeo.visible_agents = computeVisibleAgents(0, positions, shapes);
    if (spatialGeo.ceiling_h < 0) spatialGeo.ceiling_h = Math.round((zoneObj.env.ceiling_height / 1000) * 100) / 100;
    var persona = {
      agent: agent,
      position: {
        cell: [Math.round(ax / 1000), Math.round(ay / 1000)],
        timestamp: opts.timestamp || "10:25",
        duration_in_cell: opts.duration_in_cell != null ? opts.duration_in_cell : 30,
      },
      environment: zoneEnvToEnvironment(zoneObj.env),
      spatial: spatialGeo,
      temporal: { total_dwell_min: 0, fatigue_accumulated: 0 },
    };
    var computed = computeOutputs(persona);
    var accState = computePerceptualLoad(persona, computed, [zoneToEngineZone(zoneObj)]);
    return {
      persona: persona, computed: computed, accState: accState,
      stress_score: computeStressScore(accState),
      comfort_score: computeComfortScore(accState),
      drivers: deriveComfortDrivers(accState, computed, persona.environment, persona.spatial),
      geometric: true,
    };
  }

  window.SentiArchEngine = {
    deriveAnxietyLevel: deriveAnxietyLevel,
    buildAnxietyData: buildAnxietyData,
    ANXIETY_MODIFIERS_BY_LEVEL: ANXIETY_MODIFIERS_BY_LEVEL,
    defaultAnxiety: defaultAnxiety,
    calculatePMV: calculatePMV,
    getPMVWarnings: getPMVWarnings,
    viewOutFactor: viewOutFactor,
    stressRecoveryFromGVI: stressRecoveryFromGVI,
    anxietyGreenAmplifier: anxietyGreenAmplifier,
    perceivedAirTemp: perceivedAirTemp,
    zoneEnvToEnvironment: zoneEnvToEnvironment,
    zoneAreaM2: zoneAreaM2,
    densityPenaltyMultiplier: densityPenaltyMultiplier,
    getZoneAtPosition: getZoneAtPosition,
    computeOutputs: computeOutputs,
    computePerceptualLoad: computePerceptualLoad,
    computeStressScore: computeStressScore,
    computeComfortScore: computeComfortScore,
    deriveComfortDrivers: deriveComfortDrivers,
    COMFORT_DRIVER_THRESHOLD: COMFORT_DRIVER_THRESHOLD,
    runPerception: runPerception,
    // geometry / LOS
    buildShapesFromGeometry: buildShapesFromGeometry,
    computeSpatialFromAgent: computeSpatialFromAgent,
    computeVisibleAgents: computeVisibleAgents,
    computeEnclosure: computeEnclosure,
    computeGreenVisibility: computeGreenVisibility,
    distToShapeType: distToShapeType,
    hasLineOfSight: hasLineOfSight,
    runPerceptionGeo: runPerceptionGeo,
  };
})();
