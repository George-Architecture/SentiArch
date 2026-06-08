/* ─────────────────────────────────────────────────────────────
   SentiArch — window.claude → local Ollama bridge

   The demo was authored as a claude.ai artifact and calls
   window.claude.complete({ messages, system }). That API only
   exists inside claude.ai. This shim re-implements the same
   contract against a local Ollama server so the demo runs
   fully offline for the thesis presentation.

   Config (highest priority first):
     model :  ?model=<name>   ·  localStorage 'rpgarchitecture.ollama.model'  ·  window.OLLAMA_MODEL  ·  default 'llama3.1'
     url   :  ?ollama=<url>   ·  localStorage 'rpgarchitecture.ollama.url'    ·  window.OLLAMA_URL    ·  default 'http://localhost:11434'

   Returns: a plain string (assistant text), matching the
   original window.claude.complete contract.
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var DEFAULT_URL = "http://localhost:11434";
  var DEFAULT_MODEL = "llama3.1:8b";

  function qp(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (e) { return null; }
  }
  function ls(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) {}
  }

  var state = {
    url: (qp("ollama") || ls("rpgarchitecture.ollama.url") || window.OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, ""),
    model: qp("model") || ls("rpgarchitecture.ollama.model") || window.OLLAMA_MODEL || DEFAULT_MODEL,
    installed: [],
    online: false,
    checked: false,
  };

  // ── Status pill (so the presenter can see Ollama health at a glance) ──
  var pill, pillDot, pillText, pillSelect;
  function buildPill() {
    pill = document.createElement("div");
    pill.id = "ollama-pill";
    pill.style.cssText = [
      "position:fixed", "left:360px", "bottom:14px", "z-index:9999",
      "display:flex", "align-items:center", "gap:8px",
      "padding:7px 11px", "border-radius:999px",
      "background:rgba(28,25,21,.92)", "color:#f3ede2",
      "font:500 11px/1 'JetBrains Mono',ui-monospace,monospace",
      "letter-spacing:.02em", "box-shadow:0 4px 18px rgba(0,0,0,.28)",
      "backdrop-filter:blur(6px)", "user-select:none",
    ].join(";");
    pillDot = document.createElement("span");
    pillDot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#caa46a;flex:none;box-shadow:0 0 0 0 rgba(0,0,0,0)";
    pillText = document.createElement("span");
    pillText.textContent = "Ollama · checking…";
    pillSelect = document.createElement("select");
    pillSelect.title = "Switch Ollama model (persists)";
    pillSelect.style.cssText = [
      "display:none", "background:transparent", "color:#f3ede2",
      "border:1px solid rgba(243,237,226,.28)", "border-radius:6px",
      "font:500 11px 'JetBrains Mono',monospace", "padding:2px 4px", "cursor:pointer",
    ].join(";");
    pillSelect.addEventListener("change", function () {
      state.model = pillSelect.value;
      lsSet("rpgarchitecture.ollama.model", state.model);
      render();
    });
    pill.appendChild(pillDot);
    pill.appendChild(pillText);
    pill.appendChild(pillSelect);
    (document.body || document.documentElement).appendChild(pill);
  }
  function render() {
    if (!pill) return;
    if (!state.checked) {
      pillDot.style.background = "#caa46a";
      pillText.textContent = "Ollama · checking…";
      pillSelect.style.display = "none";
      return;
    }
    if (state.online) {
      pillDot.style.background = "#5fae74";
      pillDot.style.boxShadow = "0 0 0 4px rgba(95,174,116,.16)";
      pillText.textContent = "Ollama";
      if (state.installed.length) {
        pillSelect.innerHTML = "";
        state.installed.forEach(function (m) {
          var o = document.createElement("option");
          o.value = m; o.textContent = m;
          o.style.color = "#1c1915";
          if (m === state.model) o.selected = true;
          pillSelect.appendChild(o);
        });
        if (state.installed.indexOf(state.model) === -1) {
          var o2 = document.createElement("option");
          o2.value = state.model; o2.textContent = state.model + " (not pulled)";
          o2.style.color = "#1c1915"; o2.selected = true;
          pillSelect.appendChild(o2);
        }
        pillSelect.style.display = "";
      } else {
        pillSelect.style.display = "none";
        pillText.textContent = "Ollama · no models — run: ollama pull " + DEFAULT_MODEL;
      }
    } else {
      pillDot.style.background = "#d2683f";
      pillDot.style.boxShadow = "0 0 0 4px rgba(210,104,63,.16)";
      pillText.textContent = "Ollama offline — see console (F12)";
      pillSelect.style.display = "none";
    }
  }

  function helpText() {
    return [
      "",
      "┌─ SentiArch · Ollama not reachable ─────────────────────",
      "│ The demo needs a local Ollama server at " + state.url,
      "│",
      "│ 1. Install Ollama:  https://ollama.com/download",
      "│ 2. Pull a model:    ollama pull " + DEFAULT_MODEL,
      "│ 3. Ollama runs automatically; confirm:  ollama list",
      "│",
      "│ If Ollama IS running but still offline here, it is a CORS",
      "│ block. Set this env var, then restart Ollama:",
      "│     setx OLLAMA_ORIGINS \"*\"   (Windows, new terminal after)",
      "│",
      "│ Switch model live:  pick from the pill, or add ?model=NAME",
      "│ Point elsewhere:    ?ollama=http://host:port",
      "└──────────────────────────────────────────────────────────────",
      "",
    ].join("\n");
  }

  // ── Health check / model resolution ──
  function refresh() {
    return fetch(state.url + "/api/tags", { method: "GET" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(function (data) {
        state.online = true;
        state.installed = (data && data.models ? data.models : []).map(function (m) { return m.name; });
        // If the configured model isn't installed, fall back to the first one available.
        if (state.installed.length && state.installed.indexOf(state.model) === -1) {
          var base = state.model.split(":")[0];
          var match = state.installed.filter(function (m) { return m.split(":")[0] === base; })[0];
          var picked = match || state.installed[0];
          console.warn("[SentiArch] model '" + state.model + "' not pulled — using '" + picked + "'. Installed: " + state.installed.join(", "));
          state.model = picked;
        }
        state.checked = true;
        render();
        return true;
      })
      .catch(function (e) {
        state.online = false;
        state.checked = true;
        render();
        console.warn("[SentiArch] Ollama health check failed:", e && e.message ? e.message : e);
        console.info(helpText());
        return false;
      });
  }

  // ── The contract the demo expects ──
  function complete(opts) {
    opts = opts || {};
    var messages = Array.isArray(opts.messages) ? opts.messages.slice() : [];
    var system = typeof opts.system === "string" ? opts.system : "";
    var model = opts.model || state.model;

    var run = function () {
      var chat = [];
      if (system) chat.push({ role: "system", content: system });
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
          chat.push({ role: m.role, content: m.content });
        }
      }
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 240000);

      var body = {
        model: model,
        messages: chat,
        stream: false,
        keep_alive: opts.keep_alive != null ? opts.keep_alive : "30m",
        options: {
          temperature: opts.temperature != null ? opts.temperature : 0.8,
          num_predict: opts.num_predict != null ? opts.num_predict : 420,
        },
      };
      if (opts.format) body.format = opts.format;

      return fetch(state.url + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
        .then(function (r) {
          clearTimeout(timer);
          return r.text().then(function (txt) {
            var data;
            try { data = JSON.parse(txt); } catch (e) { data = null; }
            if (!r.ok) {
              var em = (data && data.error) ? data.error : ("HTTP " + r.status);
              if (/not found|try pulling|no such model/i.test(em)) {
                throw new Error("Ollama: model '" + model + "' not pulled. Run:  ollama pull " + model);
              }
              throw new Error("Ollama error: " + String(em).slice(0, 140));
            }
            if (data && data.error) throw new Error("Ollama error: " + String(data.error).slice(0, 140));
            var out = data && data.message && typeof data.message.content === "string" ? data.message.content : "";
            return out.trim();
          });
        })
        .catch(function (e) {
          clearTimeout(timer);
          if (e && e.name === "AbortError") {
            throw new Error("Ollama timed out (240s). The model may still be loading — try again.");
          }
          if (e instanceof TypeError) {
            throw new Error("Ollama not reachable at " + state.url + " — start Ollama / check OLLAMA_ORIGINS (see console).");
          }
          throw e;
        });
    };

    // Make the very first interaction robust even if the health
    // check hasn't resolved yet (user drags an agent immediately).
    if (!state.checked) return refresh().then(run);
    return run();
  }

  window.claude = {
    complete: complete,
    setModel: function (name) { state.model = name; lsSet("rpgarchitecture.ollama.model", name); render(); },
    getStatus: function () { return Object.assign({}, state); },
    refresh: refresh,
  };

  function boot() {
    buildPill();
    render();
    refresh();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
