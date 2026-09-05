import express from "express";
import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const app = express();
const REQUEST_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS) || 20000;
const parser = new Parser({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; NewsNowBold/1.1; +https://github.com/Learner-ning/news-nb)",
    Accept: "application/rss+xml, application/xml, text/xml, */*"
  },
  customFields: {
    item: ["content:encoded", "description"]
  }
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

// 选用当前可稳定访问的 RSS：
// - Google News / 36氪 在国内常见超时或反爬拦截，故替换为 Solidot / IT之家
const feeds = [
  { name: "Solidot", url: "https://www.solidot.org/index.rss", tag: "综合" },
  { name: "IT之家", url: "https://www.ithome.com/rss/", tag: "科技" },
  { name: "少数派", url: "https://sspai.com/feed", tag: "数码" }
];

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000;
let cache = {
  items: [],
  updatedAt: 0,
  errors: []
};

function makeId(url) {
  const key = String(url || "").trim();
  if (!key) return null;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
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

/** 修复 RSS 中未转义的 &，避免 xml 解析失败 */
function sanitizeXml(xml) {
  return String(xml).replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

function looksLikeRss(text) {
  const head = String(text).slice(0, 400).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:rdf");
}

function mapItem(item, feed) {
  const link = item.link || item.guid || "";
  const id = makeId(link);
  if (!id) return null;

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
    id,
    title: item.title || "无标题",
    url: link,
    source: feed.name,
    tag: feed.tag,
    time: item.isoDate || item.pubDate || null,
    summary: snippet,
    content: fullText || snippet
  };
}

async function parseFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewsNowBold/1.1; +https://github.com/Learner-ning/news-nb)",
        Accept: "application/rss+xml, application/xml, text/xml, */*"
      },
      redirect: "follow"
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const raw = await res.text();
    if (!looksLikeRss(raw)) {
      throw new Error("返回内容不是 RSS（可能被反爬拦截）");
    }
    const data = await parser.parseString(sanitizeXml(raw));
    return (data.items || [])
      .slice(0, 15)
      .map((item) => mapItem(item, feed))
      .filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeeds() {
  const errors = [];
  const batches = await Promise.all(
    feeds.map(async (feed) => {
      try {
        return await parseFeed(feed);
      } catch (e) {
        const message = e?.name === "AbortError" ? `请求超时（${REQUEST_TIMEOUT_MS}ms）` : e?.message || String(e);
        console.error("Feed error:", feed.name, message);
        errors.push({ source: feed.name, message });
        return [];
      }
    })
  );

  const seen = new Set();
  const items = batches
    .flat()
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  return { items, errors };
}

async function getNews(force = false) {
  const fresh = Date.now() - cache.updatedAt < CACHE_TTL_MS;
  if (!force && fresh && cache.items.length) {
    return cache;
  }

  const { items, errors } = await fetchFeeds();
  if (!items.length && cache.items.length) {
    return { ...cache, stale: true, errors };
  }

  cache = {
    items,
    updatedAt: Date.now(),
    errors
  };
  return cache;
}

app.use(express.static(publicDir));

app.get("/api/health", async (_req, res) => {
  const data = await getNews();
  res.json({
    ok: true,
    itemCount: data.items.length,
    updatedAt: new Date(data.updatedAt || Date.now()).toISOString(),
    errors: data.errors || []
  });
});

app.get("/api/news", async (req, res) => {
  try {
    const source = req.query.source || "all";
    const force = req.query.refresh === "1";
    const data = await getNews(force);
    const items =
      source === "all" ? data.items : data.items.filter((x) => x.tag === source);

    res.json({
      updatedAt: new Date(data.updatedAt || Date.now()).toISOString(),
      stale: Boolean(data.stale),
      errors: data.errors || [],
      items: items.slice(0, 48)
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
    if (!found) {
      return res.status(404).json({ error: "新闻不存在或已过期" });
    }
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
