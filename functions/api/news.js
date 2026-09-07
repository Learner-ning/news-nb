// Cloudflare Pages Function：GET /api/news
import { collectAll } from "../../lib/news-core.mjs";

let cache = null;
let cacheAt = 0;
const TTL = 120000; // 2 分钟缓存，避免每次请求都抓全部源

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const source = url.searchParams.get("source") || "all";
  const force = url.searchParams.get("refresh") === "1";

  try {
    if (!cache || force || Date.now() - cacheAt > TTL) {
      cache = await collectAll();
      cacheAt = Date.now();
    }
    const items = source === "all" ? cache.items : cache.items.filter((x) => x.tag === source);
    return json({
      updatedAt: cache.updatedAt,
      stale: false,
      errors: cache.errors || [],
      items: items.slice(0, 260)
    });
  } catch (e) {
    return json({ error: e.message || "加载失败" }, 500);
  }
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
