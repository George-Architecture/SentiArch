// ============================================================
// SentiArch — Landing Page
// The multi-step workflow has been retired; this is now a thin
// entry point into the Legacy Prototype multi-agent simulator.
// ============================================================

import { useLocation } from "wouter";

export default function Home() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-xl w-full">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4"
          style={{ background: "#6366F115", color: "#6366F1", border: "1px solid #6366F130" }}
        >
          HKU MArch Thesis · JCTIC Case Study
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-3">
          SentiArch
        </h1>

        <p className="text-base text-muted-foreground leading-relaxed mb-6">
          A multi-agent environmental experience simulator that makes the
          <em> heterogeneous user experience </em> of a building visible —
          combining MBTI personality, ASI-3 anxiety sensitivity, and
          PMV/PPD thermal comfort with an LLM first-person narrative.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => navigate("/legacy")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "#6366F1", boxShadow: "0 2px 12px #6366F140" }}
          >
            Open Prototype →
          </button>
          <a
            href="/mhc-demo/index.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 active:scale-95"
            style={{
              background: "#caa46a",
              color: "#1c1915",
              boxShadow: "0 2px 12px rgba(202,164,106,0.30)",
              textDecoration: "none",
            }}
            title="Mental Health Centre demo — drag 25 agents onto the floor plan for live engine-grounded readings. Bundled with the app; opens in a new tab. Live readings need a local Ollama (mistral-nemo:12b)."
          >
            <span aria-hidden="true">⌖</span>
            Mental Health Centre Demo
          </a>
          <button
            onClick={() => navigate("/settings")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            LLM Settings
          </button>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Data persists via <code className="px-1 py-0.5 rounded bg-muted font-mono">localStorage</code>. Configure an API key in Settings to enable LLM narrative generation.
        </p>
      </div>
    </div>
  );
}
