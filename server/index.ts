import express from "express";
import { createServer } from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ============================================================
// SentiArch — local server
// Runs the whole app on your own machine, no cloud required:
//   pnpm install && pnpm build && pnpm start  →  http://localhost:3000
// Serves the built client and backs the two API routes the app calls:
//   • POST /api/llm        — proxy to DeepSeek / OpenAI (bring your own key)
//   • /api/scenarios/*     — save / load scenarios as local JSON files
// Ollama is called directly from the browser and never touches this server.
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LLM_PROVIDERS = {
  deepseek: { url: "https://api.deepseek.com/chat/completions", keyEnv: "DEEPSEEK_API_KEY" },
  openai: { url: "https://api.openai.com/v1/chat/completions", keyEnv: "OPENAI_API_KEY" },
} as const;
type ProviderName = keyof typeof LLM_PROVIDERS;

const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "5mb" }));

  // POST /api/llm — BYOK proxy. Prefer the caller's own key (x-llm-key
  // header, set from the Settings page); fall back to a DEEPSEEK_API_KEY /
  // OPENAI_API_KEY env var (handy if you'd rather not paste it in the UI).
  app.post("/api/llm", async (req, res) => {
    const rawProvider = (req.headers["x-llm-provider"] as string) || "deepseek";
    if (!(rawProvider in LLM_PROVIDERS)) {
      return res.status(400).json({
        error: `Unknown provider "${rawProvider}". Supported: ${Object.keys(LLM_PROVIDERS).join(", ")}`,
      });
    }
    const cfg = LLM_PROVIDERS[rawProvider as ProviderName];
    const clientKey = (req.headers["x-llm-key"] as string | undefined)?.trim();
    const apiKey = clientKey || process.env[cfg.keyEnv];
    if (!apiKey) {
      return res.status(401).json({
        error: `No ${rawProvider} API key. Enter your own key on the Settings page, or set ${cfg.keyEnv} in your environment.`,
      });
    }
    try {
      const upstream = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(req.body),
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      return res.send(text);
    } catch (err) {
      return res.status(502).json({
        error: `Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Local scenario store — plain JSON files under data/scenarios/<slug>.json.
  // Replaces the cloud blob store; the files live on your own disk.
  const scenariosDir = path.resolve(__dirname, "..", "data", "scenarios");

  app.post("/api/scenarios/save", async (req, res) => {
    const { slug, payload } = (req.body ?? {}) as { slug?: unknown; payload?: unknown };
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: "Invalid slug — 3–64 chars of letters, digits, dash, underscore",
      });
    }
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Missing or invalid payload" });
    }
    try {
      await fs.mkdir(scenariosDir, { recursive: true });
      await fs.writeFile(path.join(scenariosDir, `${slug}.json`), JSON.stringify(payload), "utf8");
      return res.status(200).json({ ok: true, slug, url: `/api/scenarios/${slug}` });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/scenarios/:slug", async (req, res) => {
    const { slug } = req.params;
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    try {
      const raw = await fs.readFile(path.join(scenariosDir, `${slug}.json`), "utf8").catch(() => null);
      if (raw === null) {
        return res.status(404).json({ error: `No scenario named "${slug}" found` });
      }
      return res.status(200).json({ ok: true, slug, payload: JSON.parse(raw) });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Static client + SPA fallback (the build always lands in dist/public).
  const staticPath = path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`SentiArch running locally → http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
