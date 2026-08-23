import express from "express";
import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  CATEGORIES,
  ALL_SOURCES,
  getCategory,
  getSource,
  sourcesByCategory
} from "./src/sources.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NewsTree/2.0",
    Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
  },
  customFields: {
    item: ["content:encoded", "description"]
  }
});

// 每个厂家（枝叶）最多取多少条
const PER_SOURCE_LIMIT = 15;
// 一次 /api/news 最多返回多少条
const MAX_TOTAL = 240;
// 列表缓存时间（毫秒），避免每次请求都去打 RSS
const CACHE_TTL_MS = 5 * 60 * 1000;

// sourceId -> { ok, items, updatedAt, fetchedAt, stale?, lastError? }
const cache = new Map();
// 防止同一时刻对同一源发起重复请求
const inflight = new Map();

function makeId(url) {
  return crypto
    .createHash("sha1")
    .update(url || Math.random().toString())
    .digest("hex")
    .slice(0, 12);
}

function cleanHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 只允许 http/https 外链，避免 javascript: 等危险协议
function safeUrl(url) {
  if (!url) return "#";
  try {
    const u = new URL(String(url));
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* 忽略非法链接 */
  }
  return "#";
}

function normalizeItem(item, source) {
  const link = item.link || item.guid || "";
  const rawContent =
    item["content:encoded"] ||
    item.content ||
    item.description ||
    item.contentSnippet ||
    item.summary ||
    "";
  const snippet = (item.contentSnippet || cleanHtml(rawContent) || "").slice(0, 220);
  const fullText = cleanHtml(rawContent).slice(0, 2000);

  return {
    id: makeId(link || source.id + ":" + (item.title || Math.random())),
    title: (item.title || "无标题").trim(),
    url: safeUrl(link),
    sourceId: source.id,
    source: source.name,
    category: source.category,
    categoryName: source.categoryName,
    color: source.color,
    time: item.isoDate || item.pubDate || null,
    summary: snippet,
    content: fullText || snippet
  };
}

async function doFetch(source) {
  const cached = cache.get(source.id);
  try {
    const data = await parser.parseURL(source.feed);
    const items = (data.items || [])
      .slice(0, PER_SOURCE_LIMIT)
      .map((item) => normalizeItem(item, source));
    const entry = {
      ok: true,
      items,
      updatedAt: new Date().toISOString(),
      fetchedAt: Date.now(),
      source
    };
    cache.set(source.id, entry);
    return entry;
  } catch (e) {
    console.error("[feed:" + source.name + "]", e.message);
    if (cached) {
      // 抓取失败时回退到旧缓存，保证页面不空
      return {
        ...cached,
        stale: true,
        lastError: e.message,
        lastAttemptAt: Date.now()
      };
    }
    const entry = {
      ok: false,
      items: [],
      error: e.message,
      fetchedAt: Date.now(),
      source
    };
    cache.set(source.id, entry);
    return entry;
  }
}

function fetchSource(source) {
  const cached = cache.get(source.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }
  if (inflight.has(source.id)) return inflight.get(source.id);
  const p = doFetch(source).finally(() => inflight.delete(source.id));
  inflight.set(source.id, p);
  return p;
}

function feedStatus(entry) {
  return {
    ok: entry.ok,
    stale: !!entry.stale,
    error: entry.lastError || entry.error || null,
    count: entry.items.length,
    updatedAt: entry.updatedAt || null
  };
}

app.use(
  express.static(path.join(__dirname, "public"), {
    index: "index.html",
    maxAge: "1h"
  })
);

// Three.js 引擎（沉浸式粒子新闻树 /immersive 使用）
app.use(
  "/vendor/three",
  express.static(path.join(__dirname, "node_modules", "three", "build"), {
    maxAge: "1d"
  })
);

// 知识树：枝干（分类）+ 枝叶（厂家模块）及其实时状态
app.get("/api/sources", async (req, res) => {
  try {
    await Promise.all(ALL_SOURCES.map(fetchSource));
    const tree = CATEGORIES.map((cat) => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      description: cat.description,
      sources: sourcesByCategory(cat.id).map((s) => {
        const entry = cache.get(s.id) || { ok: false, items: [] };
        return {
          id: s.id,
          name: s.name,
          feed: s.feed,
          note: s.note || "",
          categoryName: s.categoryName,
          icon: s.icon,
          color: s.color,
          ...feedStatus(entry)
        };
      })
    }));
    res.json({ updatedAt: new Date().toISOString(), tree });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新闻列表：?source=厂家id 只看一片枝叶；?category=分类id 只看一个枝干；都不传=整棵树
app.get("/api/news", async (req, res) => {
  try {
    const { source, category } = req.query;
    let selected = ALL_SOURCES;
    if (source && source !== "all") {
      const s = getSource(source);
      if (!s) return res.status(400).json({ error: "未知新闻源: " + source });
      selected = [s];
    } else if (category && category !== "all") {
      const c = getCategory(category);
      if (!c) return res.status(400).json({ error: "未知分类: " + category });
      selected = sourcesByCategory(category);
    }

    const entries = await Promise.all(selected.map(fetchSource));
    const items = entries
      .flatMap((e) => e.items)
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    const failed = entries.filter((e) => !e.ok).map((e) => e.source.name);

    res.set("Cache-Control", "no-store");
    res.json({
      updatedAt: new Date().toISOString(),
      source: source || "all",
      category: category || null,
      failed,
      items: items.slice(0, MAX_TOTAL)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 详情页：按 id 在整棵树上查找（走缓存，不会重复打源）
app.get("/api/news/:id", async (req, res) => {
  try {
    const entries = await Promise.all(ALL_SOURCES.map(fetchSource));
    const found = entries
      .flatMap((e) => e.items)
      .find((x) => x.id === req.params.id);
    if (!found) {
      return res.status(404).json({ error: "新闻不存在或已过期" });
    }
    res.json(found);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, categories: CATEGORIES.length, sources: ALL_SOURCES.length });
});

// Express 5 中 app.get("*") 已失效，统一用 use 兜底 SPA 路由
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("🌳 新闻知识树已启动: http://localhost:" + port);
  console.log("   " + ALL_SOURCES.length + " 个厂家枝叶 / " + CATEGORIES.length + " 个分类枝干");
});
