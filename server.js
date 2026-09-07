import express from "express";
import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const app = express();
const REQUEST_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS) || 15000;
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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 选用当前可稳定访问的 RSS
const rssFeeds = [
  { name: "Solidot", url: "https://www.solidot.org/index.rss", tag: "综合" },
  { name: "IT之家", url: "https://www.ithome.com/rss/", tag: "科技" },
  { name: "少数派", url: "https://sspai.com/feed", tag: "数码" }
];

// 主流平台热搜（标题类聚合；原文通过平台搜索/话题页打开）
const HOT_SOURCES = [
  {
    kind: "tencent", name: "腾讯新闻", tag: "腾讯",
    url: "https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=30&tab_id=rank_hot",
    ref: "https://news.qq.com/", limit: 15
  },
  {
    kind: "toutiao", name: "头条", tag: "头条",
    url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
    ref: "https://www.toutiao.com/", limit: 15
  },
  {
    kind: "douyin", name: "抖音", tag: "抖音",
    url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/?limit=30",
    ref: "https://www.douyin.com/", limit: 15
  },
  {
    kind: "bilibili", name: "哔哩哔哩", tag: "B站",
    url: "https://s.search.bilibili.com/main/hotword",
    ref: "https://www.bilibili.com/", limit: 15
  },
  {
    kind: "weibo", name: "微博", tag: "微博",
    url: "https://weibo.com/ajax/side/hotSearch",
    ref: "https://weibo.com/", limit: 15
  }
];

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000;
let cache = { items: [], updatedAt: 0, errors: [] };

function makeId(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  return crypto.createHash("sha1").update(k).digest("hex").slice(0, 12);
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

function sanitizeXml(xml) {
  return String(xml).replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

function looksLikeRss(text) {
  const head = String(text).slice(0, 400).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:rdf");
}

async function fetchText(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        ...extraHeaders
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), res };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------- RSS ----------
function mapRssItem(item, feed) {
  const link = item.link || item.guid || "";
  const id = makeId("rss|" + link);
  if (!id) return null;
  const rawContent =
    item["content:encoded"] || item.content || item.description || item.contentSnippet || item.summary || "";
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

async function parseRss(feed) {
  const { text } = await fetchText(feed.url, { Accept: "application/rss+xml, application/xml, text/xml, */*" });
  if (!looksLikeRss(text)) throw new Error("返回内容不是 RSS（可能被反爬拦截）");
  const data = await parser.parseString(sanitizeXml(text));
  return (data.items || [])
    .slice(0, 15)
    .map((item) => mapRssItem(item, feed))
    .filter(Boolean);
}

// ---------- 平台热搜 ----------
function hotItem(src, rank, title, url, extra = {}) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !String(title || "").trim()) return null;
  const now = Date.now();
  return {
    id: makeId(`hot|${src.name}|${title}`),
    title: String(title).trim(),
    url: cleanUrl,
    source: src.name,
    tag: src.tag,
    time: new Date(now - (rank + 1) * 60 * 1000).toISOString(),
    summary: `「${src.name}热搜」第 ${rank + 1} 位：${title}`,
    content:
      `本条为 ${src.name} 热搜第 ${rank + 1} 位。\n\n「${title}」\n\n点击下方「阅读原文」前往 ${src.name} 查看完整内容。`,
    rank: rank + 1,
    ...extra
  };
}

async function parseHotTencent(src) {
  const { text } = await fetchText(src.url, { Referer: src.ref });
  const j = parseJsonSafe(text);
  if (!j || !Array.isArray(j.idlist)) throw new Error("腾讯热榜结构异常");
  const out = [];
  const seen = new Set();
  for (const g of j.idlist) {
    for (const it of (g?.newslist || [])) {
      const title = String(it.title || "").trim();
      const url = String(it.url || "").trim();
      if (!title || !/^https?:\/\//.test(url) || /每10分钟更新一次/.test(title) || seen.has(title)) continue;
      seen.add(title);
      out.push(hotItem(src, out.length, title, url));
      if (out.length >= src.limit) break;
    }
    if (out.length >= src.limit) break;
  }
  return out;
}

async function parseHotToutiao(src) {
  const { text } = await fetchText(src.url, { Referer: src.ref });
  const j = parseJsonSafe(text);
  const arr = j?.data;
  if (!Array.isArray(arr)) throw new Error("头条热榜结构异常");
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    const title = String(it.Title || "").trim();
    const url = String(it.Url || "").trim() || (it.ClusterIdStr ? `https://www.toutiao.com/trending/${it.ClusterIdStr}/` : "");
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(hotItem(src, out.length, title, url));
    if (out.length >= src.limit) break;
  }
  return out;
}

async function parseHotDouyin(src) {
  const { text } = await fetchText(src.url, { Referer: src.ref });
  const j = parseJsonSafe(text);
  const arr = j?.word_list;
  if (!Array.isArray(arr)) throw new Error("抖音热榜结构异常");
  const out = [];
  for (const it of arr) {
    const title = String(it.word || it.word_name || "").trim();
    if (!title) continue;
    out.push(hotItem(src, out.length, title, `https://www.douyin.com/search/${encodeURIComponent(title)}`));
    if (out.length >= src.limit) break;
  }
  return out;
}

async function parseHotBilibili(src) {
  const { text } = await fetchText(src.url, { Referer: src.ref });
  const j = parseJsonSafe(text);
  const arr = Array.isArray(j?.list) ? j.list : Array.isArray(j?.data) ? j.data : null;
  if (!arr) throw new Error("B站热榜结构异常");
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    const title = String(it.keyword || it.show_name || it.word || "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(hotItem(src, out.length, title, `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}`));
    if (out.length >= src.limit) break;
  }
  return out;
}

async function parseHotWeibo(src) {
  // 微博需要先在主站“暖场”再拉热搜接口
  try { await fetchText("https://weibo.com/", { "Accept-Language": "zh-CN,zh;q=0.9" }); } catch {}
  const { text } = await fetchText(src.url, { Referer: src.ref, "X-Requested-With": "XMLHttpRequest" });
  const j = parseJsonSafe(text);
  if (!j || j.ok !== 1 || !j.data?.realtime) throw new Error("微博热搜获取失败");
  const out = [];
  const seen = new Set();
  for (const it of j.data.realtime) {
    const title = String(it.note || it.word || "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const extra = {};
    if (it.label_name || it.small_icon_desc) extra.label = it.label_name || it.small_icon_desc || "";
    out.push(hotItem(src, out.length, title, `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`, extra));
    if (out.length >= src.limit) break;
  }
  return out;
}

const hotParsers = {
  tencent: parseHotTencent,
  toutiao: parseHotToutiao,
  douyin: parseHotDouyin,
  bilibili: parseHotBilibili,
  weibo: parseHotWeibo
};

async function fetchAll() {
  const errors = [];
  const rssResults = await Promise.all(
    rssFeeds.map(async (feed) => {
      try {
        return { items: await parseRss(feed) };
      } catch (e) {
        errors.push({ source: feed.name, message: e.message });
        return { items: [] };
      }
    })
  );

  const hotResults = await Promise.all(
    HOT_SOURCES.map(async (src) => {
      try {
        return { items: await fetchHot(src) };
      } catch (e) {
        errors.push({ source: src.name, message: e.message });
        return { items: [] };
      }
    })
  );

  const seen = new Set();
  const items = [];
  // RSS 在前（按时间排序），热搜按平台顺序排列（组内按榜单名次）
  const rssAll = rssResults.flatMap((r) => r.items).sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  for (const it of rssAll) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  for (const { items: list } of hotResults) {
    for (const it of list) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
  }
  return { items, errors };
}

function fetchHot(src) {
  const fn = hotParsers[src.kind];
  return fn ? fn(src) : Promise.resolve([]);
}

async function getNews(force = false) {
  const fresh = Date.now() - cache.updatedAt < CACHE_TTL_MS;
  if (!force && fresh && cache.items.length) return cache;

  const { items, errors } = await fetchAll();
  if (!items.length && cache.items.length) {
    return { ...cache, stale: true, errors };
  }
  cache = { items, updatedAt: Date.now(), errors };
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
    const items = source === "all" ? data.items : data.items.filter((x) => x.tag === source);

    res.json({
      updatedAt: new Date(data.updatedAt || Date.now()).toISOString(),
      stale: Boolean(data.stale),
      errors: data.errors || [],
      items: items.slice(0, 200)
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
