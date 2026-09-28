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
    // 列表只返回渲染所需字段，正文 content 由 /api/news/:id 按需返回。
    // 2026-09-28：上限 260 → 400，与 server.js 保持一致（源增至 20 个，总量已超 260）
    return json({
      updatedAt: data.updatedAt,
      stale: Boolean(data.stale),
      warming: Boolean(data.warming),
      throttled: Boolean(data.throttled),
      errors: data.errors || [],
      items: items.slice(0, 400).map(toListItem)
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

/**
 * SPA 深链回落：取 index.html 的壳返回。
 *
 * ★ 2026-09-28 修复：此前直接 `env.ASSETS.fetch("/index.html")` 必然 404。
 * 原因：Static Assets 的 html_handling 会把 `/index.html` **307 归一化到 `/`**
 * （实测：GET /index.html → 307, Location: /），而 Workers 里**入站 Request 的
 * redirect 默认是 "manual"**，`new Request(url, request)` 会继承它 ⇒ ASSETS 返回的是
 * 3xx 而不是 200 ⇒ `idx.ok` 为 false ⇒ 落到末尾 `return new Response("Not Found", 404)`。
 * 表现就是「站内跳转正常（pushState 不请求服务器），但分享/刷新/直接访问深链即 404」。
 *
 * 现在：优先取 `/`（本来就不会重定向），并在遇到 3xx 时手动跟随一次 Location；
 * `/` 不行再退回 `/index.html`。ASSETS.fetch 直连资源层，不经过本 Worker，无递归风险。
 */
async function spaShell(request, env, url) {
  if (!env || !env.ASSETS) return null;
  const candidates = ["/", "/index.html"];
  for (const p of candidates) {
    try {
      let res = await env.ASSETS.fetch(new Request(new URL(p, url.origin), {
        method: "GET",
        headers: request.headers,
        redirect: "manual"
      }));
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("Location");
        if (!loc) continue;
        res = await env.ASSETS.fetch(new Request(new URL(loc, url.origin), {
          method: "GET",
          headers: request.headers,
          redirect: "manual"
        }));
      }
      if (res.ok) return res;
    } catch { /* 换下一个候选 */ }
  }
  return null;
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

    // SPA 深链回落（/detail/:id、/source/:key 等非静态路径）
    const shell = await spaShell(request, env, url);
    if (shell) {
      return new Response(shell.body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
