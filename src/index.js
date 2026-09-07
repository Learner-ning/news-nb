// newstree Worker（Workers Static Assets 形态）
// - 静态资源（public/）由 Cloudflare Assets 自动托管
// - /api/* 由本 Worker 处理（复用统一抓取/去重/热度引擎）
// - 其余路径（SPA 深链 /detail/:id 等）回落 index.html
import { collectAll } from "../lib/news-core.mjs";

let cache = null;
let cacheAt = 0;
const TTL = 120000; // 2 分钟缓存

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function loadAll(force) {
  if (!cache || force || Date.now() - cacheAt > TTL) {
    cache = await collectAll();
    cacheAt = Date.now();
  }
  return cache;
}

async function handleApi(url) {
  const force = url.searchParams.get("refresh") === "1";
  const data = await loadAll(force);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({ ok: true, itemCount: data.items.length, updatedAt: data.updatedAt, errors: data.errors || [] });
  }
  if (path === "/api/news") {
    const source = url.searchParams.get("source") || "all";
    const items = source === "all" ? data.items : data.items.filter((x) => x.tag === source);
    return json({ updatedAt: data.updatedAt, stale: false, errors: data.errors || [], items: items.slice(0, 260) });
  }
  const m = path.match(/^\/api\/news\/([0-9a-f]+)$/i);
  if (m) {
    const found = data.items.find((x) => x.id === m[1]);
    if (!found) return json({ error: "新闻不存在或已过期" }, 404);
    return json(found);
  }
  return json({ error: "Not Found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/* -> API 逻辑
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url);
      } catch (e) {
        return json({ error: e.message || "加载失败" }, 500);
      }
    }

    // SPA 深链回落（/detail/:id 等非静态路径）
    try {
      if (env.ASSETS) {
        const idx = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
        if (idx.ok) {
          return new Response(idx.body, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }
          });
        }
      }
    } catch {}
    return new Response("Not Found", { status: 404 });
  }
};
