// Cloudflare Pages Function：GET /api/news/:id
import { collectAll } from "../../../lib/news-core.mjs";
import { json } from "../news.js";

export async function onRequestGet(context) {
  const { id } = context.params;
  try {
    const data = await collectAll();
    const found = data.items.find((x) => x.id === id);
    if (!found) return json({ error: "新闻不存在或已过期" }, 404);
    return json(found);
  } catch (e) {
    return json({ error: e.message || "加载失败" }, 500);
  }
}
