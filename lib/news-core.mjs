// ============================================================
// 统一新闻核心引擎（本地 Express 与 Cloudflare Pages Functions 共用）
// 职责：源适配器注册 / 抓取 / 轻量XML解析 / 去重合并 / 热度评分
// 不依赖任何第三方运行时包（仅全局 fetch / crypto），不写死 API Key。
// ============================================================

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15000;
const RSS_PER_FEED = 15;
const HOT_PER_SOURCE = 15;

// ---------------- 源适配器：启用/关闭/分类/权重 ----------------
// enabled:false 即可关闭某个源；weight 参与热度来源权重
export const RSS_FEEDS = [
  { id: "solidot", name: "Solidot", tag: "综合", url: "https://www.solidot.org/index.rss", enabled: true, weight: 1.15 },
  { id: "ithome", name: "IT之家", tag: "科技", url: "https://www.ithome.com/rss/", enabled: true, weight: 1.1 },
  { id: "sspai", name: "少数派", tag: "数码", url: "https://sspai.com/feed", enabled: true, weight: 1.0 },
  { id: "qbitai", name: "量子位", tag: "AI", url: "https://www.qbitai.com/feed", enabled: true, weight: 1.05 },
  { id: "ifanr", name: "爱范儿", tag: "科技", url: "https://www.ifanr.com/feed", enabled: true, weight: 1.0 },
  { id: "chuapp", name: "触乐", tag: "游戏", url: "https://www.chuapp.com/feed", enabled: true, weight: 1.0 }
];

export const HOT_SOURCES = [
  { kind: "tencent", id: "tencent", name: "腾讯新闻", tag: "腾讯", url: "https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=30&tab_id=rank_hot", ref: "https://news.qq.com/", enabled: true, weight: 0.95 },
  { kind: "toutiao", id: "toutiao", name: "头条", tag: "头条", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", ref: "https://www.toutiao.com/", enabled: true, weight: 0.95 },
  { kind: "douyin", id: "douyin", name: "抖音", tag: "抖音", url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/?limit=30", ref: "https://www.douyin.com/", enabled: true, weight: 0.9 },
  { kind: "bilibili", id: "bilibili", name: "哔哩哔哩", tag: "B站", url: "https://s.search.bilibili.com/main/hotword", ref: "https://www.bilibili.com/", enabled: true, weight: 0.9 },
  { kind: "weibo", id: "weibo", name: "微博", tag: "微博", url: "https://weibo.com/ajax/side/hotSearch", ref: "https://weibo.com/", enabled: true, weight: 0.9 }
];

// ---------------- 基础工具 ----------------
export function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripHtml(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeXml(xml) {
  return String(xml).replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

function simpleHash(str) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).slice(0, 12);
}

async function fetchText(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "*/*", "Accept-Language": "zh-CN,zh;q=0.9", ...extraHeaders }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- 轻量 RSS/Atom 解析（兼容 CDATA / 命名空间） ----------------
function xmlTag(text, name) {
  const m = text.match(new RegExp(`<(?:[a-zA-Z0-9-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9-]*:)?${name}>`, "i"));
  return m ? m[1] : "";
}

export function parseFeedXml(xml) {
  // 先展开 CDATA，避免后续正则/标签剥离把内容误删
  let text = sanitizeXml(xml).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const isAtom = /<feed\b/i.test(text);
  const out = [];
  if (isAtom) {
    const entries = [...text.matchAll(/<(?:[a-zA-Z0-9-]*:)?entry\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9-]*:)?entry>/gi)];
    for (const [, body] of entries) {
      const title = stripHtml(tag(body, "title"));
      const linkM = body.match(/<link\b([^>]*?)(?:\/?)>/i);
      let url = "";
      if (linkM) {
        const href = linkM[1].match(/href\s*=\s*["']([^"']+)["']/i);
        url = href ? href[1] : "";
      }
      const guid = stripHtml(tag(body, "id")) || url;
      const content = stripHtml(tag(body, "content") || tag(body, "summary"));
      const updated = stripHtml(tag(body, "updated") || tag(body, "published"));
      if (title) out.push({ title, url, guid, content, isoDate: updated || null });
    }
  } else {
    const items = [...text.matchAll(/<(?:[a-zA-Z0-9-]*:)?item\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9-]*:)?item>/gi)];
    for (const [, body] of items) {
      const title = stripHtml(tag(body, "title"));
      const url = stripHtml(tag(body, "link"));
      const guid = stripHtml(tag(body, "guid"));
      const pub = stripHtml(tag(body, "pubDate")) || stripHtml(tag(body, "dc:date"));
      const contentRaw = tag(body, "content:encoded") || tag(body, "description") || "";
      const content = stripHtml(contentRaw);
      const summary = content.slice(0, 240);
      const isoDate = pub ? dateToIso(pub) : null;
      if (title) out.push({ title, url: url || guid || "", guid, summary, content, isoDate });
    }
  }
  return out;
}

function tag(text, name) {
  const re = new RegExp(
    `<[a-zA-Z0-9-]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[a-zA-Z0-9-]*:?${name}>`,
    "i"
  );
  const m = text.match(re);
  return m ? m[1] : "";
}

function dateToIso(pub) {
  try {
    const d = new Date(pub);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ---------------- 统一条目结构 ----------------
function baseItem(now, rank) {
  return {
    time: new Date(now - (rank + 1) * 60 * 1000).toISOString(),
    image: null,
    rank: rank + 1
  };
}

function buildRssItems(feed, entries) {
  const now = Date.now();
  return entries.slice(0, RSS_PER_FEED).map((e, i) => {
    const url = (e.url || "").trim();
    const key = `rss|${feed.id}|${e.guid || url || e.title}`;
    return {
      ...baseItem(now, i),
      id: simpleHash(key),
      title: e.title,
      url: url || `https://www.solidot.org/`,
      source: feed.name,
      tag: feed.tag,
      publishedAt: e.isoDate,
      summary: (e.summary || "").slice(0, 220),
      content: (e.content || e.summary || "").slice(0, 2000),
      feedId: feed.id,
      feedWeight: feed.weight
    };
  });
}

// ---------------- 平台热搜解析 ----------------
function hotEntry(src, rank, title, url, extra = {}) {
  const key = `hot|${src.id}|${title}`;
  return {
    id: simpleHash(key),
    title,
    url,
    source: src.name,
    tag: src.tag,
    publishedAt: null,
    summary: `「${src.name}热搜」第 ${rank + 1} 位：${title}`,
    content: `本条为 ${src.name} 热搜第 ${rank + 1} 位。\n\n「${title}」\n\n点击下方「阅读原文」前往 ${src.name} 查看完整内容。`,
    image: null,
    feedId: src.id,
    feedWeight: src.weight,
    isHotBoard: true,
    ...extra
  };
}

async function parseHot(src) {
  const body = await fetchText(src.url, { Referer: src.ref, ...(src.kind === "weibo" ? { "X-Requested-With": "XMLHttpRequest" } : {}) });
  let j;
  try { j = JSON.parse(body); } catch { throw new Error("JSON 解析失败"); }
  const out = [];
  const seen = new Set();
  const pick = (title, url, extra = {}) => {
    const t = String(title || "").trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    out.push(hotEntry(src, out.length, t, url, extra));
    return true;
  };
  if (src.kind === "tencent") {
    if (!Array.isArray(j?.idlist)) throw new Error("结构异常");
    for (const g of j.idlist) {
      for (const it of g?.newslist || []) {
        const t = String(it.title || "").trim();
        const u = String(it.url || "").trim();
        if (!t || !/^https?:\/\//.test(u) || /每10分钟更新一次/.test(t)) continue;
        if (pick(t, u)) {}
        if (out.length >= HOT_PER_SOURCE) break;
      }
      if (out.length >= HOT_PER_SOURCE) break;
    }
  } else if (src.kind === "toutiao") {
    const arr = j?.data;
    if (!Array.isArray(arr)) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.Title || "").trim();
      const u = String(it.Url || "").trim() || (it.ClusterIdStr ? `https://www.toutiao.com/trending/${it.ClusterIdStr}/` : "");
      pick(t, u);
      if (out.length >= HOT_PER_SOURCE) break;
    }
  } else if (src.kind === "douyin") {
    const arr = j?.word_list;
    if (!Array.isArray(arr)) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.word || it.word_name || "").trim();
      if (!t) continue;
      pick(t, `https://www.douyin.com/search/${encodeURIComponent(t)}`);
      if (out.length >= HOT_PER_SOURCE) break;
    }
  } else if (src.kind === "bilibili") {
    const arr = Array.isArray(j?.list) ? j.list : Array.isArray(j?.data) ? j.data : null;
    if (!arr) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.keyword || it.show_name || it.word || "").trim();
      pick(t, `https://search.bilibili.com/all?keyword=${encodeURIComponent(t)}`);
      if (out.length >= HOT_PER_SOURCE) break;
    }
  } else if (src.kind === "weibo") {
    if (!j || j.ok !== 1 || !j.data?.realtime) throw new Error("微博热搜获取失败");
    for (const it of j.data.realtime) {
      const t = String(it.note || it.word || "").trim();
      const extra = it.label_name || it.small_icon_desc ? { hotTag: it.label_name || it.small_icon_desc || "" } : {};
      pick(t, `https://s.weibo.com/weibo?q=${encodeURIComponent(t)}`, extra);
      if (out.length >= HOT_PER_SOURCE) break;
    }
  }
  return out;
}

// ---------------- 去重：识别同一事件 ------------
function normTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[《》「」“”"'’·、，。！？!?…—\-–：:｜|#\s]+/g, "")
    .replace(/(记者|报道|来源|原创)/g, "")
    .slice(0, 60);
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

export function titleSimilarity(a, b) {
  const A = bigrams(normTitle(a));
  const B = bigrams(normTitle(b));
  if (!A.length || !B.length) return 0;
  const set = new Set(B);
  let hit = 0;
  for (const g of A) if (set.has(g)) hit++;
  return (2 * hit) / (A.length + B.length);
}

function dedupe(rawItems) {
  const list = [];
  const index = new Map(); // norm -> item
  for (const it of rawItems) {
    const norm = normTitle(it.title);
    if (!norm) continue;
    const existing = index.get(norm);
    if (existing) {
      existing.dupCount = (existing.dupCount || 1) + 1;
      existing.dupSources = [...new Set([...(existing.dupSources || [existing.source]), it.source])];
      continue;
    }
    // 高相似但不同标题：与已收条目比较
    let merged = false;
    if (norm.length >= 10) {
      for (const ex of list) {
        if (titleSimilarity(ex.title, it.title) >= 0.94) {
          ex.dupCount = (ex.dupCount || 1) + 1;
          ex.dupSources = [...new Set([...(ex.dupSources || [ex.source]), it.source])];
          merged = true;
          break;
        }
      }
    }
    if (!merged) {
      it.dupCount = it.dupCount || 1;
      it.dupSources = it.dupSources || [it.source];
      index.set(norm, it);
      list.push(it);
    }
  }
  return list;
}

// ---------------- 热度评分 ----------------
// 由：时间衰减、来源权重、榜单名次、重复报道、分类热度、关键词热度 合成
const HEAT_KEYS = [
  "AI", "OpenAI", "GPT", "大模型", "小米", "华为", "苹果", "英伟达", "央行", "美联储",
  "涨停", "夺冠", "国足", "iPhone", "上市", "发布", "收购", "芯片", "机器人", "火箭"
];

export function calculateHeatScore(item, ctx) {
  ctx = ctx || { now: Date.now(), catCount: new Map(), all: 1 };
  const now = ctx.now || Date.now();

  // 1) 时间新鲜度（小时衰减，半衰期≈12h）
  let ageH = 24;
  try {
    const t = new Date(item.publishedAt || item.time);
    if (!isNaN(t.getTime())) ageH = Math.max(0, (now - t.getTime()) / 36e5);
  } catch {}
  const fresh = Math.exp(-ageH / 12);

  // 2) 来源权重（映射到 0.55~1.0）
  const w = item.feedWeight || 1;
  const quality = Math.min(1, 0.55 + w * 0.42);

  // 3) 榜单名次加成（热搜类越靠前越热）
  const rankBonus = item.isHotBoard ? Math.max(0, 0.14 * (1 - (item.rank || 1) / 16)) : 0;

  // 4) 重复报道加成（同一事件被多个来源报道更热）
  const dup = Math.min(0.3, ((item.dupCount || 1) - 1) * 0.15);

  // 5) 分类热度（该分类相对占比越高，群体热度越高）
  const catN = ctx.catCount.get(item.tag) || 1;
  const catFreq = Math.min(0.06, Math.sqrt(catN / Math.max(1, ctx.all)) * 0.06);

  // 6) 关键词热度
  let kw = 0;
  for (const k of HEAT_KEYS) {
    if (String(item.title || "").includes(k)) {
      kw += 0.035;
      if (kw >= 0.12) break;
    }
  }
  kw = Math.min(0.12, kw);

  const raw = 0.3 * fresh + 0.28 * quality + 0.12 * rankBonus + 0.18 * dup + 0.08 * catFreq + kw;
  return Math.min(1, Math.max(0.05, raw));
}

// ---------------- 总抓取：聚合 -> 去重 -> 热度 ----------------
export async function collectAll() {
  const errors = [];
  const now = Date.now();

  const enabledRss = RSS_FEEDS.filter((f) => f.enabled !== false);
  const enabledHot = HOT_SOURCES.filter((s) => s.enabled !== false);

  const rssResults = await Promise.all(
    enabledRss.map(async (feed) => {
      try {
        const xml = await fetchText(feed.url, { Accept: "application/rss+xml, application/xml, text/xml, */*" });
        return { items: buildRssItems(feed, parseFeedXml(xml)) };
      } catch (e) {
        errors.push({ source: feed.name, message: e.message });
        return { items: [] };
      }
    })
  );

  const hotResults = await Promise.all(
    enabledHot.map(async (src) => {
      try {
        return { items: await parseHot(src) };
      } catch (e) {
        errors.push({ source: src.name, message: e.message });
        return { items: [] };
      }
    })
  );

  let raw = [];
  for (const { items } of rssResults) raw = raw.concat(items);
  for (const { items } of hotResults) raw = raw.concat(items);

  const deduped = dedupe(raw);

  // 分类热度上下文
  const catCount = new Map();
  for (const it of deduped) catCount.set(it.tag, (catCount.get(it.tag) || 0) + 1);
  const ctx = { now, catCount, all: deduped.length };

  const items = deduped.map((it) => {
    const heatScore = calculateHeatScore(it, ctx);
    return {
      id: it.id,
      title: it.title,
      url: it.url,
      source: it.source,
      tag: it.tag,
      time: it.publishedAt || it.time,
      publishedAt: it.publishedAt || it.time,
      summary: it.summary,
      content: it.content,
      image: it.image || null,
      tags: [...new Set([it.tag, it.source, ...(it.dupSources || [])])].filter(Boolean).slice(0, 8),
      dupCount: it.dupCount || 1,
      heatScore: Number(heatScore.toFixed(3)),
      heatPct: Math.round(heatScore * 100),
      rank: it.rank || null,
      hotTag: it.hotTag || null
    };
  });

  return { items, errors, updatedAt: new Date(now).toISOString() };
}
