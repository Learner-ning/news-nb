// 数据层：负责从现有 /api/news 拉取真实新闻，缓存，
// 并把扁平的 items 转换成“新闻 → 分类 → 来源 → 叶片”的树模型。
// 不改变现有后端、不引入 Mock 数据。
import { colorFor, orderTags } from "./helpers.js";

const state = {
  items: [],        // 服务端最新一批（或 localStorage 里的上一批）
  updatedAt: 0,
  stale: false,
  warming: false,   // 服务端缓存为空、后台正在抓取
  throttled: false, // 刷新被节流（距上次强制刷新不足最小间隔）
  fromCache: false, // 当前 items 来自 localStorage
  errors: [],
  loading: false
};

// ---------------- localStorage 持久化 ----------------
// 只保存列表字段（列表接口本身已不含 content），控制体积在 200 KB 以内。
const LS_KEY = "nt.news.v1";
const LS_MAX_ITEMS = 260;

function saveCache() {
  try {
    const items = state.items.slice(0, LS_MAX_ITEMS);
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, updatedAt: state.updatedAt, items }));
    return true;
  } catch {
    return false;   // 写入失败（配额/隐私模式）不影响页面
  }
}

/** 读取上一次成功的数据；成功则置 items 并标记 fromCache */
export function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.items) || !d.items.length) return false;
    state.items = d.items;
    state.updatedAt = Number(d.updatedAt) || 0;
    state.fromCache = true;
    return true;
  } catch {
    return false;
  }
}

/** 清掉本地缓存（仅用于调试/排障） */
export function clearCache() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

export async function loadNews({ force = false, source = "all" } = {}) {
  if (state.loading) return state;
  state.loading = true;
  try {
    const qs = new URLSearchParams({ source });
    if (force) qs.set("refresh", "1");
    const r = await fetch(`/api/news?${qs.toString()}`, { cache: "no-store" });

    // 202：服务端缓存为空、后台正在抓取。保留现有数据，交给上层轮询。
    if (r.status === 202) {
      const d = await r.json().catch(() => ({}));
      state.warming = d.warming !== false;
      state.errors = Array.isArray(d.errors) ? d.errors : [];
      return state;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);

    const d = await r.json();
    const items = Array.isArray(d.items) ? d.items : [];
    // 先更新元信息，再写缓存 —— 否则缓存里会存到旧的 updatedAt
    if (d.updatedAt) state.updatedAt = new Date(d.updatedAt).getTime();
    state.stale = Boolean(d.stale);
    state.warming = Boolean(d.warming);
    state.throttled = Boolean(d.throttled);
    state.errors = Array.isArray(d.errors) ? d.errors : [];
    if (items.length) {
      state.items = items;
      state.fromCache = false;
      saveCache();
    } else if (!state.items.length) {
      state.items = [];
    }
  } catch (e) {
    state.errors = [{ source: "client", message: e.message || "请求失败" }];
  } finally {
    state.loading = false;
  }
  return state;
}

export function getState() {
  return state;
}

export function findItem(id) {
  return state.items.find((x) => x.id === id) || null;
}

/** 当前数据里真实存在的分类（tag）列表，稳定排序 */
export function getTags() {
  const tags = [...new Set(state.items.map((x) => x.tag).filter(Boolean))];
  return orderTags(tags);
}

export function getUpdatedLabel() {
  if (!state.updatedAt) return "—";
  return new Date(state.updatedAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit"
  });
}

// ============================================================
// Stage 3.2 信息架构：新闻源成为一级节点
//
// 首页树：  树干 → 主枝(新闻源) → 叶片(新闻)
// 来源树：  树干 → 主枝(该来源) → 分枝(分组) → 叶片(新闻)
//
// 分类不再参与树的层级，只保留为：顶部筛选 / 来源分类属性 / 颜色语义。
// 复用 tree-layout.js 现有的两级布局：一级 = 主枝，二级 = 分枝；
// 首页把「每个来源」包装成一级节点（下面挂一个同名分组，渲染时省略中间层）。
//
// 注：Stage 3.2 之前使用的「分类 → 来源 → 新闻」树模型（buildTreeModel）
// 已随本次信息架构调整移除，避免留下无人使用的死代码。
// ============================================================

/** 某个来源的主导分类（条目最多的那个，平局按分类优先级） */
function dominantTag(counter) {
  // 平局时按「底部分类导航」的稳定顺序决定，避免同权重时顺序抖动（破坏确定性）
  const rank = new Map(orderTags([...counter.keys()]).map((t, i) => [t, i]));
  return [...counter.entries()].sort(
    (a, b) => b[1] - a[1] || (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99)
  )[0][0];
}

/**
 * 首页树模型：新闻源为一级节点
 * @returns [{ key, name, color, count, tag, tags, sources:[{name, items}] }]
 */
export function buildSourceModel(items) {
  const bySrc = new Map();
  for (const item of items || state.items) {
    const name = item.source || "未知来源";
    if (!bySrc.has(name)) bySrc.set(name, { name, counter: new Map(), items: [] });
    const s = bySrc.get(name);
    s.items.push(item);
    const t = item.tag || "综合";
    s.counter.set(t, (s.counter.get(t) || 0) + 1);
  }
  return [...bySrc.values()]
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, "zh"))
    .map((s) => {
      const tag = dominantTag(s.counter);
      return {
        key: s.name,          // 路由 key = 来源名本身，不引入第二套命名
        name: s.name,
        color: colorFor(tag),
        count: s.items.length,
        tag,
        tags: [...s.counter.keys()],
        sources: [{ name: s.name, items: s.items }]
      };
    });
}

/** 该来源的全部条目（保持与服务端一致的顺序） */
export function itemsOfSource(name, items) {
  return (items || state.items).filter((x) => (x.source || "未知来源") === name);
}

/**
 * 来源页树模型：来源为根，其新闻按块分成多条分枝
 * —— 每个来源只属于一个分类，按分类分组只会得到 1 组，因此按顺序分块，
 *    这样来源页仍然是一棵有分枝的树，而不是一列叶片。
 * @returns [{ key, name, color, count, tag, tags, sources:[{name, items}] }]
 */
export function buildSourceTreeModel(items, sourceName, chunkSize = 5) {
  const mine = itemsOfSource(sourceName, items);
  if (!mine.length) return [];
  const groups = [];
  for (let i = 0; i < mine.length; i += chunkSize) {
    groups.push({ name: "", items: mine.slice(i, i + chunkSize) });
  }
  const counter = new Map();
  for (const it of mine) {
    const t = it.tag || "综合";
    counter.set(t, (counter.get(t) || 0) + 1);
  }
  const tag = dominantTag(counter);
  return [{
    key: sourceName,
    name: sourceName,
    color: colorFor(tag),
    count: mine.length,
    tag,
    tags: [...counter.keys()],
    sources: groups
  }];
}

/** 数据里真实存在的来源名（按条目数降序，稳定） */
export function getSourceNames(items) {
  return buildSourceModel(items).map((s) => s.key);
}

/** 路由 key → 来源名（key 就是来源名；做一次大小写无关的兜底匹配） */
export function resolveSource(key, items) {
  if (!key) return null;
  const names = getSourceNames(items);
  const raw = String(key);
  return names.find((n) => n === raw)
    || names.find((n) => n.toLowerCase() === raw.toLowerCase())
    || null;
}

/** 来源的元信息（分类 / 颜色 / 数量），列表分区标题用 */
export function sourceMeta(name, items) {
  const model = buildSourceModel(items);
  return model.find((s) => s.key === name) || null;
}

/**
 * 新闻列表分区：先按 source 分组，再在组内排序
 * —— 同一来源绝不拆散（分组先于排序，热度排序不会打散来源）
 * @returns [{ key, name, color, tag, count, items }]
 */
export function buildListSections(items, sort = "heat") {
  const byHeat = (arr) => [...arr].sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
  const byTime = (arr) => [...arr].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  const pick = sort === "time" ? byTime : byHeat;
  return buildSourceModel(items).map((s) => ({
    key: s.key,
    name: s.name,
    color: s.color,
    tag: s.tag,
    tags: s.tags,
    count: s.count,
    items: pick(s.sources[0].items)
  }));
}

// 每一片叶子的元信息（复用跳转详情逻辑所需的字段）
export function leafMeta(item) {
  return {
    id: item.id,
    title: item.title || "无标题",
    url: item.url,
    source: item.source,
    tag: item.tag,
    time: item.time,
    summary: item.summary
  };
}
