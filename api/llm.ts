import type { VercelRequest, VercelResponse } from "@vercel/node";

// POST /api/llm
// Server-side proxy for OpenAI-compatible LLM providers (DeepSeek, OpenAI).
// The browser POSTs an OpenAI chat-completions body; we attach the
// Authorization header and forward the request. The proxy exists to sidestep
// browser-side CORS surprises — it does NOT supply a key of its own.
//
// BYOK (bring your own key): the visitor enters their own provider key in the
// app's Settings page. It is stored only in their browser (localStorage) and
// sent here as the `x-llm-key` header; the proxy forwards it upstream. The
// hosted demo sets NO env key, so every visitor pays for their own usage and
// the host is never billed.
//
// Local dev: you may instead set DEEPSEEK_API_KEY / OPENAI_API_KEY in
// `.env.local`; the env var is used only as a fallback when no `x-llm-key`
// header is present.
//
// Provider is selected via the `x-llm-provider` header (default: deepseek).
// Ollama is NOT proxied here — local Ollama is called directly from the
// browser at http://localhost:11434/api/chat and doesn't need a key.

const PROVIDERS = {
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    keyEnv: "DEEPSEEK_API_KEY",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
  },
} as const;

type ProviderName = keyof typeof PROVIDERS;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const rawProvider = (req.headers["x-llm-provider"] ?? "deepseek") as string;
  if (!(rawProvider in PROVIDERS)) {
    return res.status(400).json({
      error: `Unknown provider "${rawProvider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`,
    });
  }
  const provider = rawProvider as ProviderName;
  const cfg = PROVIDERS[provider];
  // BYOK: prefer the visitor's own key (sent from the browser); fall back to a
  // server env var for local dev only. The hosted demo sets no env key.
  const clientKey = (req.headers["x-llm-key"] as string | undefined)?.trim();
  const apiKey = clientKey || process.env[cfg.keyEnv];
  if (!apiKey) {
    return res.status(401).json({
      error: `No ${provider} API key. Enter your own key in the app's Settings page — it stays in your browser and is sent only with your own requests.`,
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Missing or invalid JSON body" });
  }

  try {
    const upstream = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    return res.send(text);
  } catch (err) {
    return res.status(502).json({
      error: `Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
