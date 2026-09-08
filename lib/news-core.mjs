// ============================================================
// 统一新闻核心引擎 v4（本地 Express 与 Cloudflare Worker 共用）
// 职责：源适配器注册表 / 抓取 / 轻量XML·JSON解析 / 去重 / 热度评分
// 统一分类：科技 / 体育 / 国内 / 影视 / 财经（可配置扩展）
// 统一数据结构：kind 区分 news | hot；含 rank、fetchedAt 等
// 不依赖第三方运行时包，不写死任何密钥。
// ============================================================

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15000;
const RSS_PER_FEED = 15;
const HOT_PER_SOURCE = 15;
export const BOARD_TOP_PER_PLATFORM = 10;

// 统一分类（顺序即展示顺序；新增分类只需在此追加并在源配置里使用）
export const CATEGORIES = ["科技", "体育", "国内", "影视", "财经"];

// ---------------- 源适配器注册表 ----------------
// enabled:false = 预留关闭；weight 参与热度。kind: rss=普通新闻 hot=平台热榜
export const RSS_FEEDS = [
  { id: "solidot", name: "Solidot", category: "科技", url: "https://www.solidot.org/index.rss", kind: "rss", enabled: true, weight: 1.15 },
  { id: "ithome", name: "IT之家", category: "科技", url: "https://www.ithome.com/rss/", kind: "rss", enabled: true, weight: 1.1 },
  { id: "sspai", name: "少数派", category: "科技", url: "https://sspai.com/feed", kind: "rss", enabled: true, weight: 1.0 },
  { id: "qbitai", name: "量子位", category: "科技", url: "https://www.qbitai.com/feed", kind: "rss", enabled: true, weight: 1.05 },
  { id: "ifanr", name: "爱范儿", category: "科技", url: "https://www.ifanr.com/feed", kind: "rss", enabled: true, weight: 1.0 },
  { id: "github", name: "GitHub热榜", category: "科技", url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", kind: "rss", enabled: true, weight: 0.95 },
  { id: "chuapp", name: "触乐", category: "影视", url: "https://www.chuapp.com/feed", kind: "rss", enabled: true, weight: 1.0, note: "游戏/文娱内容归入影视分类" },
  { id: "wallstreetcn", name: "华尔街见闻", category: "财经", url: "https://dedicated.wallstreetcn.com/rss.xml", kind: "rss", enabled: true, weight: 1.05 },
  { id: "xueqiu", name: "雪球话题", category: "财经", url: "https://xueqiu.com/hots/topic/rss", kind: "rss", enabled: true, weight: 1.0 }
];

export const HOT_SOURCES = [
  { kind: "weibo", id: "weibo", name: "微博", category: "国内", url: "https://weibo.com/ajax/side/hotSearch", ref: "https://weibo.com/", enabled: true, weight: 0.9, warmup: "https://weibo.com/" },
  { kind: "tencent", id: "tencent", name: "腾讯新闻", category: "国内", url: "https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=30&tab_id=rank_hot", ref: "https://news.qq.com/", enabled: true, weight: 0.95 },
  { kind: "toutiao", id: "toutiao", name: "今日头条", category: "国内", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", ref: "https://www.toutiao.com/", enabled: true, weight: 0.95 },
  { kind: "douyin", id: "douyin", name: "抖音", category: "国内", url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/?limit=30", ref: "https://www.douyin.com/", enabled: true, weight: 0.9 },
  { kind: "bilibili", id: "bilibili", name: "哔哩哔哩", category: "国内", url: "https://s.search.bilibili.com/main/hotword", ref: "https://www.bilibili.com/", enabled: true, weight: 0.9 },
  { kind: "tieba", id: "tieba", name: "百度贴吧", category: "国内", url: "https://tieba.baidu.com/hottopic/browse/topicList?page_size=30", ref: "https://tieba.baidu.com/", enabled: true, weight: 0.9 },
  { kind: "thepaper", id: "thepaper", name: "澎湃", category: "国内", url: "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar", ref: "https://www.thepaper.cn/", enabled: true, weight: 0.9 }
];

// 预留但暂不可达的源（官方风控/无公开接口；保持注册便于后续接入，不参与抓取）
export const PLANNED_SOURCES = [
  { name: "知乎热榜", category: "国内", why: "API 需登录态(401)，等待可用通道" },
  { name: "虎扑热榜", category: "体育", why: "接口 404/风控，需授权通道" },
  { name: "懂球帝", category: "体育", why: "403 风控" },
  { name: "豆瓣热门", category: "影视", why: "无公开稳定接口(反爬)" },
  { name: "36氪", category: "科技", why: "feed 被反爬为 HTML" },
  { name: "稀土掘金", category: "科技", why: "API 需签名/登录" },
  { name: "酷安 / 远景 / 凤凰网", category: "科技", why: "无稳定公开 RSS/API" }
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

// ---------------- 轻量 RSS/Atom 解析 ----------------
function tag(text, name) {
  const re = new RegExp(
    `<[a-zA-Z0-9-]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[a-zA-Z0-9-]*:?${name}>`,
    "i"
  );
  const m = text.match(re);
  return m ? m[1] : "";
}

export function parseFeedXml(xml) {
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

function dateToIso(pub) {
  try {
    const d = new Date(pub);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function fakeTimeAgo(now, rank) {
  return new Date(now - (rank + 1) * 60 * 1000).toISOString();
}

// ---------------- 普通新闻（rss）条目 ----------------
function buildRssItems(feed, entries) {
  const now = Date.now();
  return entries.slice(0, RSS_PER_FEED).map((e, i) => {
    const url = (e.url || "").trim();
    const publishedAt = e.isoDate || fakeTimeAgo(now, i);
    const content = (e.content || e.summary || "").slice(0, 2000);
    return {
      id: simpleHash(`rss|${feed.id}|${e.guid || url || e.title}`),
      kind: "news",
      type: "news",
      title: e.title,
      url,
      source: feed.name,
      platform: feed.name,
      category: feed.category,
      tag: feed.category,
      summary: (e.summary || content).slice(0, 220),
      content,
      image: null,
      publishedAt,
      fetchedAt: new Date(now).toISOString(),
      feedId: feed.id,
      feedWeight: feed.weight,
      hotRank: null,
      rank: null
    };
  });
}

// ---------------- 平台热榜条目 ----------------
function hotEntry(src, rank, title, url, extra = {}) {
  const now = Date.now();
  const content =
    `本条为「${src.name}」第 ${rank + 1} 位热门话题（抓取于 ${new Date(now).toLocaleString("zh-CN")}）。\n\n「${title}」\n\n点击下方「阅读原文」前往 ${src.name} 查看完整内容。`;
  return {
    id: simpleHash(`hot|${src.id}|${title}`),
    kind: "hot",
    type: "hot",
    title,
    url: decodeEntities(url),
    source: src.name,
    platform: src.name,
    category: src.category,
    tag: src.category,
    summary: `「${src.name}」第 ${rank + 1} 位：${title}`,
    content,
    image: null,
    publishedAt: fakeTimeAgo(now, rank),
    fetchedAt: new Date(now).toISOString(),
    feedId: src.id,
    feedWeight: src.weight,
    isHotBoard: true,
    hotRank: rank + 1,
    rank: rank + 1,
    ...extra
  };
}

async function parseHot(src) {
  if (src.warmup) {
    try { await fetchText(src.warmup, { "Accept-Language": "zh-CN,zh;q=0.9" }); } catch {}
  }
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
  const done = () => out.length >= HOT_PER_SOURCE;

  if (src.kind === "tencent") {
    if (!Array.isArray(j?.idlist)) throw new Error("结构异常");
    for (const g of j.idlist) {
      for (const it of g?.newslist || []) {
        const t = String(it.title || "").trim();
        const u = String(it.url || "").trim();
        if (!t || !/^https?:\/\//.test(u) || /每10分钟更新一次/.test(t)) continue;
        pick(t, u);
        if (done()) break;
      }
      if (done()) break;
    }
  } else if (src.kind === "toutiao") {
    const arr = j?.data;
    if (!Array.isArray(arr)) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.Title || "").trim();
      const u = String(it.Url || "").trim() || (it.ClusterIdStr ? `https://www.toutiao.com/trending/${it.ClusterIdStr}/` : "");
      pick(t, u);
      if (done()) break;
    }
  } else if (src.kind === "douyin") {
    const arr = j?.word_list;
    if (!Array.isArray(arr)) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.word || it.word_name || "").trim();
      if (!t) continue;
      pick(t, `https://www.douyin.com/search/${encodeURIComponent(t)}`);
      if (done()) break;
    }
  } else if (src.kind === "bilibili") {
    const arr = Array.isArray(j?.list) ? j.list : Array.isArray(j?.data) ? j.data : null;
    if (!arr) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.keyword || it.show_name || it.word || "").trim();
      pick(t, `https://search.bilibili.com/all?keyword=${encodeURIComponent(t)}`);
      if (done()) break;
    }
  } else if (src.kind === "weibo") {
    if (!j || j.ok !== 1 || !j.data?.realtime) throw new Error("微博热搜获取失败");
    for (const it of j.data.realtime) {
      const t = String(it.note || it.word || "").trim();
      const extra = it.label_name || it.small_icon_desc ? { hotTag: it.label_name || it.small_icon_desc || "" } : {};
      pick(t, `https://s.weibo.com/weibo?q=${encodeURIComponent(t)}`, extra);
      if (done()) break;
    }
  } else if (src.kind === "tieba") {
    const d = j?.data;
    const lists = [];
    for (const key of ["bang_topic", "manual_topic"]) {
      const arr = d?.[key]?.topic_list;
      if (Array.isArray(arr)) lists.push(...arr);
    }
    if (!lists.length) throw new Error("结构异常");
    for (const it of lists) {
      const t = String(it.topic_name || "").trim();
      const u = String(it.topic_url || "").trim();
      pick(t, u ? u : `https://tieba.baidu.com/f?kw=${encodeURIComponent(t)}&ie=utf-8`, { discuss: it.discuss_num ? Number(it.discuss_num) : null });
      if (done()) break;
    }
  } else if (src.kind === "thepaper") {
    const arr = j?.data?.hotNews;
    if (!Array.isArray(arr)) throw new Error("结构异常");
    for (const it of arr) {
      const t = String(it.name || "").trim();
      const cid = String(it.contId || "").trim();
      if (!t || !cid) continue;
      pick(t, `https://www.thepaper.cn/newsDetail_forward_${cid}`, { praise: Number(it.praiseTimes) || null });
      if (done()) break;
    }
  } else {
    throw new Error("未知平台类型: " + src.kind);
  }
  return out;
}

// ---------------- 去重：识别同一事件 ----------------
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
  const index = new Map();
  for (const it of rawItems) {
    const norm = normTitle(it.title);
    if (!norm) continue;
    const existing = index.get(norm);
    if (existing) {
      existing.dupCount = (existing.dupCount || 1) + 1;
      existing.dupSources = [...new Set([...(existing.dupSources || [existing.source]), it.source])];
      continue;
    }
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
const HEAT_KEYS = [
  "AI", "OpenAI", "GPT", "大模型", "小米", "华为", "苹果", "英伟达", "央行", "美联储",
  "涨停", "夺冠", "国足", "iPhone", "上市", "发布", "收购", "芯片", "机器人", "火箭"
];

export function calculateHeatScore(item, ctx) {
  ctx = ctx || { now: Date.now(), catCount: new Map(), all: 1 };
  const now = ctx.now || Date.now();

  let ageH = 24;
  try {
    const t = new Date(item.publishedAt || item.time);
    if (!isNaN(t.getTime())) ageH = Math.max(0, (now - t.getTime()) / 36e5);
  } catch {}
  const fresh = Math.exp(-ageH / 12);

  const w = item.feedWeight || 1;
  const quality = Math.min(1, 0.55 + w * 0.42);

  const rankBonus = item.isHotBoard ? Math.max(0, 0.16 * (1 - (item.rank || 1) / 17)) : 0;
  const dup = Math.min(0.3, ((item.dupCount || 1) - 1) * 0.15);

  const catN = ctx.catCount.get(item.tag) || 1;
  const catFreq = Math.min(0.06, Math.sqrt(catN / Math.max(1, ctx.all)) * 0.06);

  let kw = 0;
  for (const k of HEAT_KEYS) {
    if (String(item.title || "").includes(k)) {
      kw += 0.035;
      if (kw >= 0.12) break;
    }
  }
  kw = Math.min(0.12, kw);

  const raw = 0.3 * fresh + 0.28 * quality + 0.14 * rankBonus + 0.18 * dup + 0.08 * catFreq + kw;
  return Math.min(1, Math.max(0.05, raw));
}

// ---------------- 总抓取 ----------------
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

  const catCount = new Map();
  for (const it of deduped) catCount.set(it.tag, (catCount.get(it.tag) || 0) + 1);
  const ctx = { now, catCount, all: deduped.length };

  const items = deduped.map((it) => {
    const heatScore = calculateHeatScore(it, ctx);
    return {
      id: it.id,
      kind: it.kind || (it.isHotBoard ? "hot" : "news"),
      type: it.kind || (it.isHotBoard ? "hot" : "news"),
      category: it.category || it.tag,
      tag: it.tag,
      platform: it.platform || it.source,
      title: it.title,
      url: it.url,
      source: it.source,
      summary: it.summary,
      content: it.content,
      image: it.image || null,
      publishedAt: it.publishedAt || it.time || null,
      time: it.publishedAt || it.time || null,
      fetchedAt: it.fetchedAt || new Date(now).toISOString(),
      hotRank: it.hotRank || null,
      rank: it.rank || null,
      hotTag: it.hotTag || null,
      praise: it.praise || null,
      discuss: it.discuss || null,
      dupCount: it.dupCount || 1,
      dupSources: it.dupSources || [it.source],
      heatScore: Number(heatScore.toFixed(3)),
      heatPct: Math.round(heatScore * 100)
    };
  });

  return { items, errors, updatedAt: new Date(now).toISOString() };
}
