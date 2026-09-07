// Cloudflare Pages Function：GET /api/health
import { collectAll } from "../../lib/news-core.mjs";
import { json } from "./news.js";

export async function onRequestGet() {
  try {
    const data = await collectAll();
    return json({ ok: true, itemCount: data.items.length, updatedAt: data.updatedAt, errors: data.errors || [] });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
