import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAll, toListItem } from "./lib/news-core.mjs";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

// 本地开发服务的内存缓存（Cloudflare 侧由部署缓存层负责）
// 抓取与请求解耦：
//   - 进程启动即后台预热，请求不再同步等待 collectAll()
//   - 缓存为空且后台正在抓取 → 立即返回 202 + warming:true，前端显示加载状态
//   - 缓存有数据 → 立即返回缓存；即使已过期也只触发后台更新，不阻塞本次请求
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000;
const REFRESH_MIN_INTERVAL_MS = Number(process.env.REFRESH_MIN_INTERVAL_MS) || 60 * 1000;

let cache = { items: [], errors: [], updatedAt: 0, fetchedAt: 0, warming: false, stale: false };
let inflight = null;      // 进行中的抓取（single-flight，避免并发重复抓取）
let lastForcedAt = 0;     // 上一次强制刷新的时间，用于 refresh 节流

function startCollect() {
  if (inflight) return inflight;
  cache.warming = true;
  inflight = collectAll()
    .then(({ items, errors, updatedAt }) => {
      if (items.length) {
        cache = { items, errors, updatedAt, fetchedAt: Date.now(), warming: false, stale: false };
      } else {
        // 全部源失败：保留旧数据，只更新错误信息
        cache = { ...cache, errors, warming: false, stale: cache.items.length > 0 };
      }
      return cache;
    })
    .catch((e) => {
      cache = { ...cache, errors: [{ source: "collectAll", message: e.message || "抓取失败" }], warming: false, stale: cache.items.length > 0 };
      return cache;
    })
    .finally(() => { cache.warming = false; inflight = null; });
  return inflight;
}

/** 只读缓存：绝不等待抓取完成 */
function readCache({ force = false } = {}) {
  const now = Date.now();
  const hasItems = cache.items.length > 0;
  const fresh = now - cache.fetchedAt < CACHE_TTL_MS;
  let throttled = false;

  if (force) {
    if (now - lastForcedAt >= REFRESH_MIN_INTERVAL_MS) {
      lastForcedAt = now;
      startCollect();
    } else {
      throttled = true;   // 距上次强制刷新不足最小间隔，直接返回现有缓存
    }
  } else if (!fresh && !inflight) {
    startCollect();       // 过期或为空：后台更新，本次请求照常返回
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

app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  const data = readCache();
  res.json({
    ok: true,
    itemCount: data.items.length,
    updatedAt: data.updatedAt,
    warming: Boolean(data.warming),
    errors: data.errors || []
  });
});

app.get("/api/news", (req, res) => {
  const source = req.query.source || "all";
  const force = req.query.refresh === "1";
  const data = readCache({ force });

  // 缓存为空且后台正在抓取：立即返回 202，不让请求等待完整抓取
  if (!data.items.length && data.warming) {
    return res.status(202).json({
      items: [], warming: true, updatedAt: null, errors: data.errors || [], stale: false, throttled: data.throttled
    });
  }

  const items = source === "all" ? data.items : data.items.filter((x) => x.tag === source);
  res.json({
    updatedAt: data.updatedAt,
    stale: Boolean(data.stale),
    warming: Boolean(data.warming),
    throttled: Boolean(data.throttled),
    errors: data.errors || [],
    // 列表只返回渲染所需字段，正文 content 由 /api/news/:id 按需返回
    items: items.slice(0, 260).map(toListItem)
  });
});

app.get("/api/news/:id", (req, res) => {
  const { id } = req.params;
  const data = readCache();
  const found = data.items.find((x) => x.id === id);
  if (!found) {
    if (!data.items.length && data.warming) {
      return res.status(503).json({ error: "数据正在准备中，请稍后重试", warming: true });
    }
    return res.status(404).json({ error: "新闻不存在或已过期" });
  }
  res.json(found);
});

// Express 5 catch-all for SPA deep links like /detail/:id
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// 启动即后台预热，让首个用户请求尽量命中缓存（不阻塞 listen）
startCollect();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`NewsNow Bold running on http://localhost:${port}`);
});
