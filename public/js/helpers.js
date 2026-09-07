// 公共工具：转义 / 时间 / 颜色 / 文本宽度估算 / slug
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function timeAgo(t) {
  if (!t) return "";
  const d = Date.now() - new Date(t).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 1440)} 天前`;
}

export function fmtClock(t) {
  if (!t) return "";
  try {
    return new Date(t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function fmtFull(t) {
  if (!t) return "";
  try {
    return new Date(t).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return "";
  }
}

// —— 分类颜色：已知分类固定色，未知分类取调色板（稳定、可读）——
const KNOWN = {
  "综合": "#2dd4bf",
  "科技": "#a78bfa",
  "数码": "#4ade80",
  "AI": "#f472b6",
  "游戏": "#fb923c",
  "财经": "#fbbf24",
  "国际": "#60a5fa",
  "国内": "#fb7185",
  "体育": "#a3e635",
  "娱乐": "#e879f9",
  "互联网": "#94a3f8",
  "汽车": "#38bdf8",
  "科学": "#5eead4",
  "开发者": "#67e8f9",
  "腾讯": "#22d3ee",
  "头条": "#fb7185",
  "抖音": "#4ade80",
  "B站": "#c084fc",
  "微博": "#facc15"
};
const PALETTE = ["#2dd4bf", "#a78bfa", "#4ade80", "#f472b6", "#fbbf24", "#60a5fa", "#fb7185", "#fb923c", "#e879f9", "#34d399", "#a3e635", "#38bdf8"];

const seenTag = new Map();
export function colorFor(tag) {
  if (KNOWN[tag]) return KNOWN[tag];
  if (!seenTag.has(tag)) seenTag.set(tag, PALETTE[seenTag.size % PALETTE.length]);
  return seenTag.get(tag);
}

// 底部分类导航的稳定顺序：已知分类置前，其余按首次出现追加
const TAG_ORDER = ["综合", "科技", "数码", "AI", "游戏", "财经", "国际", "国内", "体育", "娱乐", "互联网", "汽车", "科学", "开发者"];
export function orderTags(tags) {
  const known = TAG_ORDER.filter((t) => tags.includes(t));
  const rest = tags.filter((t) => !TAG_ORDER.includes(t));
  return [...known, ...rest];
}

/** 估算标题在 SVG（约 13px 字号）下的像素宽度：CJK≈13.5，拉丁/数字≈7.5 */
export function textWidth(s) {
  let w = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0);
    w += c > 0x2e7f || c === 0x3000 ? 13.5 : c > 0xff ? 13.5 : 7.6;
  }
  return w;
}

export function slugify(s) {
  return String(s || "x").replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}
