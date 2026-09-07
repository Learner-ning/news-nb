import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAll } from "./lib/news-core.mjs";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

// 本地开发服务的内存缓存（Cloudflare 侧由部署缓存层负责）
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000;
let cache = { items: [], errors: [], updatedAt: 0, fetchedAt: 0 };

async function getNews(force = false) {
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!force && fresh && cache.items.length) return cache;
  const { items, errors, updatedAt } = await collectAll();
  if (!items.length && cache.items.length) {
    return { ...cache, stale: true, errors };
  }
  cache = { items, errors, updatedAt, fetchedAt: Date.now() };
  return cache;
}

app.use(express.static(publicDir));

app.get("/api/health", async (_req, res) => {
  try {
    const data = await getNews();
    res.json({
      ok: true,
      itemCount: data.items.length,
      updatedAt: data.updatedAt,
      errors: data.errors || []
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const source = req.query.source || "all";
    const force = req.query.refresh === "1";
    const data = await getNews(force);
    const items = source === "all" ? data.items : data.items.filter((x) => x.tag === source);
    res.json({
      updatedAt: data.updatedAt,
      stale: Boolean(data.stale),
      errors: data.errors || [],
      items: items.slice(0, 260)
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "加载失败" });
  }
});

app.get("/api/news/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getNews();
    const found = data.items.find((x) => x.id === id);
    if (!found) return res.status(404).json({ error: "新闻不存在或已过期" });
    res.json(found);
  } catch (e) {
    res.status(500).json({ error: e.message || "加载失败" });
  }
});

// Express 5 catch-all for SPA deep links like /detail/:id
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`NewsNow Bold running on http://localhost:${port}`);
});
