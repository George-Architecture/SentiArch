import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";

// POST /api/scenarios/save
// Body: { slug: string, payload: object }
// Stores the JSON payload in Vercel Blob at scenarios/<slug>.json with a
// deterministic public URL so callers can fetch it back by slug alone.
//
// "Slug-as-credential": there's no auth — possession of the slug is the
// permission to read or overwrite. Use a long, hard-to-guess slug for any
// scenario you don't want strangers to find (e.g. `clinic-thesis-9k3jx2`).

const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const body = req.body as { slug?: unknown; payload?: unknown } | null;
  const slug = body?.slug;
  const payload = body?.payload;

  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res.status(400).json({
      error: "Invalid slug — must be 3–64 chars of letters, digits, dash, underscore",
    });
  }
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Missing or invalid payload" });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: "BLOB_READ_WRITE_TOKEN not configured. Add a Blob store to this Vercel project (Storage → Create → Blob) and the token is injected automatically.",
    });
  }

  try {
    const result = await put(`scenarios/${slug}.json`, JSON.stringify(payload), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      allowOverwrite: true,
    });
    return res.status(200).json({
      ok: true,
      slug,
      url: result.url,
      size: result.size ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
