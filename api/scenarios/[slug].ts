import type { VercelRequest, VercelResponse } from "@vercel/node";
import { list } from "@vercel/blob";

// GET /api/scenarios/<slug>
// Looks up the blob saved at scenarios/<slug>.json and returns its
// JSON contents. 404 when no blob with that slug exists.

const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const slug = req.query.slug;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res.status(400).json({
      error: "Invalid slug — must be 3–64 chars of letters, digits, dash, underscore",
    });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: "BLOB_READ_WRITE_TOKEN not configured. Add a Blob store to this Vercel project (Storage → Create → Blob) and the token is injected automatically.",
    });
  }

  try {
    const target = `scenarios/${slug}.json`;
    const { blobs } = await list({ prefix: target, limit: 1 });
    const match = blobs.find((b) => b.pathname === target);
    if (!match) {
      return res.status(404).json({ error: `No scenario named "${slug}" found` });
    }
    const upstream = await fetch(match.url, { cache: "no-store" });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Failed to fetch blob: ${upstream.status}` });
    }
    const data = await upstream.json();
    return res.status(200).json({
      ok: true,
      slug,
      payload: data,
      uploaded_at: match.uploadedAt ?? null,
      size: match.size ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
