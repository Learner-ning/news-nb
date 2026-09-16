// 数据层：负责从现有 /api/news 拉取真实新闻，缓存，
// 并把扁平的 items 转换成“新闻 → 分类 → 来源 → 叶片”的树模型。
// 不改变现有后端、不引入 Mock 数据。
import { colorFor, orderTags } from "./helpers.js";

const state = {
  items: [],        // 服务端最新一批
  updatedAt: 0,
  stale: false,
  warming: false,   // 服务端缓存为空、后台正在抓取
  throttled: false, // 刷新被节流（距上次强制刷新不足最小间隔）
  errors: [],
  loading: false
};

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
    if (items.length) state.items = items;
    else if (!state.items.length) state.items = [];
    if (d.updatedAt) state.updatedAt = new Date(d.updatedAt).getTime();
    state.stale = Boolean(d.stale);
    state.warming = Boolean(d.warming);
    state.throttled = Boolean(d.throttled);
    state.errors = Array.isArray(d.errors) ? d.errors : [];
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
// 树模型：categories[] = 主枝；每个分类下的 source 分组 = 分枝；
// 每条新闻 = 挂在枝头的叶片（保留全部真实字段用于跳转/详情）。
// ============================================================

export function buildTreeModel(items) {
  const cats = [];
  const byTag = new Map();

  for (const item of items || state.items) {
    const tag = item.tag || "综合";
    if (!byTag.has(tag)) {
      byTag.set(tag, { tag, name: tag, color: colorFor(tag), sources: new Map(), total: 0 });
      cats.push(byTag.get(tag));
    }
    const cat = byTag.get(tag);
    cat.total++;
    const src = item.source || "未知来源";
    if (!cat.sources.has(src)) cat.sources.set(src, { name: src, items: [] });
    cat.sources.get(src).items.push(item);
  }

  // 分类顺序稳定（真实存在的才出现）
  cats.sort((a, b) => {
    const ia = TAG_PRIORITY.indexOf(a.tag);
    const ib = TAG_PRIORITY.indexOf(b.tag);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return cats.map((cat) => ({
    key: cat.tag,
    name: cat.tag,
    color: cat.color,
    count: cat.total,
    sources: [...cat.sources.values()]
      .sort((a, b) => b.items.length - a.items.length)
      .map((s) => ({ name: s.name, items: s.items }))
  }));
}

const TAG_PRIORITY = ["综合", "科技", "数码", "AI", "财经", "国际", "国内", "体育", "娱乐"];

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
