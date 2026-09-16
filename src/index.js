// newstree Worker（Workers Static Assets 形态）
// - 静态资源（public/）由 Cloudflare Assets 自动托管
// - /api/* 由本 Worker 处理（复用统一抓取/去重/热度引擎）
// - 其余路径（SPA 深链 /detail/:id 等）回落 index.html
// - 抓取与请求解耦：请求只读 isolate 内存缓存，不等待 collectAll()
//   （真正的边缘缓存架构留到 Stage 4）
import { collectAll, toListItem } from "../lib/news-core.mjs";

const TTL = 120000;                          // 缓存有效期 2 分钟
const REFRESH_MIN_INTERVAL_MS = 60000;       // ?refresh=1 的最小间隔

let cache = { items: [], errors: [], updatedAt: 0, fetchedAt: 0, warming: false, stale: false };
let inflight = null;
let lastForcedAt = 0;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// 后台抓取：single-flight。Worker 中返回响应后仍需继续执行，故用 ctx.waitUntil 保活。
function startCollect(ctx) {
  if (inflight) return inflight;
  cache.warming = true;
  inflight = collectAll()
    .then(({ items, errors, updatedAt }) => {
      if (items.length) {
        cache = { items, errors, updatedAt, fetchedAt: Date.now(), warming: false, stale: false };
      } else {
        cache = { ...cache, errors, warming: false, stale: cache.items.length > 0 };
      }
      return cache;
    })
    .catch((e) => {
      cache = { ...cache, errors: [{ source: "collectAll", message: e.message || "抓取失败" }], warming: false, stale: cache.items.length > 0 };
      return cache;
    })
    .finally(() => { cache.warming = false; inflight = null; });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(inflight);
  return inflight;
}

/** 只读缓存：绝不等待抓取完成 */
function readCache(force, ctx) {
  const now = Date.now();
  const hasItems = cache.items.length > 0;
  const fresh = now - cache.fetchedAt < TTL;
  let throttled = false;

  if (force) {
    if (now - lastForcedAt >= REFRESH_MIN_INTERVAL_MS) {
      lastForcedAt = now;
      startCollect(ctx);
    } else {
      throttled = true;
    }
  } else if (!fresh && !inflight) {
    startCollect(ctx);
  }

  if (!hasItems) {
    return { warming: true, items: [], errors: cache.errors || [], updatedAt: null, stale: false, throttled };
  }
  return {
    warming: Boolean(cache.warming),
    items: cache.items,
    errors: cache.errors || [],
    updatedAt: cache.updatedAt,
    stale: Boolean(cache.stale) || !fresh,
    throttled
  };
}

function handleApi(url, ctx) {
  const force = url.searchParams.get("refresh") === "1";
  const data = readCache(force, ctx);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({
      ok: true,
      itemCount: data.items.length,
      updatedAt: data.updatedAt,
      warming: Boolean(data.warming),
      errors: data.errors || []
    });
  }
  if (path === "/api/news") {
    // 缓存为空且后台正在抓取：立即返回 202，不让请求等待完整抓取
    if (!data.items.length && data.warming) {
      return json({ items: [], warming: true, updatedAt: null, errors: data.errors || [], stale: false, throttled: data.throttled }, 202);
    }
    const source = url.searchParams.get("source") || "all";
    const items = source === "all" ? data.items : data.items.filter((x) => x.tag === source);
    // 列表只返回渲染所需字段，正文 content 由 /api/news/:id 按需返回
    return json({
      updatedAt: data.updatedAt,
      stale: Boolean(data.stale),
      warming: Boolean(data.warming),
      throttled: Boolean(data.throttled),
      errors: data.errors || [],
      items: items.slice(0, 260).map(toListItem)
    });
  }
  const m = path.match(/^\/api\/news\/([0-9a-f]+)$/i);
  if (m) {
    const found = data.items.find((x) => x.id === m[1]);
    if (!found) {
      if (!data.items.length && data.warming) return json({ error: "数据正在准备中，请稍后重试", warming: true }, 503);
      return json({ error: "新闻不存在或已过期" }, 404);
    }
    return json(found);
  }
  return json({ error: "Not Found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // /api/* -> API 逻辑
    if (url.pathname.startsWith("/api/")) {
      try {
        return handleApi(url, ctx);
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
