import { useState, useEffect } from "react";
import { useLocation } from "wouter";

type LLMProvider = "ollama" | "anthropic" | "deepseek" | "openai" | "custom";

interface LLMConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  provider?: LLMProvider;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, { apiUrl: string; model: string; apiKey: string }> = {
  ollama:    { apiUrl: "http://localhost:11434/api/chat", model: "llama3.1:8b",    apiKey: "ollama" },
  anthropic: { apiUrl: "https://api.anthropic.com/v1/messages",          model: "claude-sonnet-4-5", apiKey: "" },
  deepseek:  { apiUrl: "https://api.deepseek.com/chat/completions",      model: "deepseek-chat",     apiKey: "" },
  openai:    { apiUrl: "https://api.openai.com/v1/chat/completions",     model: "gpt-4o-mini",       apiKey: "" },
  custom:    { apiUrl: "",                                               model: "",                  apiKey: "" },
};

export default function Settings() {
  const [, navigate] = useLocation();
  const [config, setConfig] = useState<LLMConfig>({
    provider: "ollama",
    apiKey: PROVIDER_DEFAULTS.ollama.apiKey,
    apiUrl: PROVIDER_DEFAULTS.ollama.apiUrl,
    model:  PROVIDER_DEFAULTS.ollama.model,
  });

  useEffect(() => {
    const saved = localStorage.getItem("llm_config");
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const onProviderChange = (provider: LLMProvider) => {
    const d = PROVIDER_DEFAULTS[provider];
    setConfig({ provider, apiKey: d.apiKey, apiUrl: d.apiUrl, model: d.model });
  };

  const handleSave = () => {
    localStorage.setItem("llm_config", JSON.stringify(config));
    navigate("/");
  };

  const provider = config.provider ?? "ollama";

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <div className="container py-8 max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button className="sa-btn" onClick={() => navigate("/")}>
            Back
          </button>
          <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
            LLM Settings
          </h1>
        </div>

        <div className="sa-card space-y-5">
          {/* Methodology v2 notice — Layer-2 LLM scoring supports Ollama
              (local, direct), DeepSeek and OpenAI (via Vercel /api/llm
              proxy). Anthropic and Custom fall back to engine baseline. */}
          <div style={{
            padding: "10px 12px",
            background: "rgba(202, 164, 106, 0.12)",
            border: "1px solid #caa46a",
            borderLeft: "3px solid #caa46a",
            color: "var(--foreground)",
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            <b>Bring your own key</b> — Layer-2 LLM scoring (6 felt-dimension
            assessment + narration) works with <b>Ollama</b>, <b>DeepSeek</b>,
            and <b>OpenAI</b>. <b>Ollama</b> runs locally and free (no key).
            For <b>DeepSeek</b> / <b>OpenAI</b>, paste your own API key below —
            it is stored only in this browser and sent only with your own
            requests via the <code>/api/llm</code> proxy; the hosted demo
            provides no key, so you are never charged for anyone else's usage.
            The floor-plan, stress heatmap, and comfort scores are computed
            without any LLM and need no key. Anthropic and Custom have no
            Layer-2 transport and fall back to the engine baseline.
          </div>

          <div>
            <label className="text-xs font-semibold block mb-2" style={{ color: "var(--muted-foreground)" }}>
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as LLMProvider)}
              className="w-full text-sm p-3 rounded-lg"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04)",
              }}
            >
              <option value="ollama">Ollama (recommended)</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-2" style={{ color: "var(--muted-foreground)" }}>
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              className="w-full text-sm p-3 rounded-lg transition-all"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04)",
              }}
              placeholder={
                provider === "ollama"
                  ? "ollama (any non-empty value)"
                  : provider === "deepseek" || provider === "openai"
                  ? "sk-... (your own key — stored only in this browser)"
                  : "sk-..."
              }
            />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-2" style={{ color: "var(--muted-foreground)" }}>
              API URL
            </label>
            <input
              type="text"
              value={config.apiUrl}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
              className="w-full text-sm p-3 rounded-lg"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04)",
              }}
            />
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.4 }}>
              Ollama default: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>http://localhost:11434/api/chat</code>.
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-2" style={{ color: "var(--muted-foreground)" }}>
              Model
            </label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full text-sm p-3 rounded-lg"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04)",
              }}
            />
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.4 }}>
              Ollama default: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>llama3.1:8b</code> (fits the demo machine's RTX 3080 / 10 GB VRAM).
            </div>
          </div>

          <button
            className="sa-btn sa-btn-primary w-full mt-4 py-3"
            onClick={handleSave}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
