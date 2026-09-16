// ============================================================
// 新闻树布局引擎（Stage 3）
//
// 纯函数模块：不碰 DOM、不读全局、不使用 Math.random()。
// 同一批数据、同一组参数 → 输出逐字段完全一致（可单元测试）。
//
// 结构（四层，全部来自真实数据）：
//   树干        树根(base) → 树干 → 顶端分叉点(apex)
//   主枝        分类 category，占据一个确定的角度扇区
//   分枝        来源 source，扇区内按剩余条目数逐环分配的连续角带
//   叶片        新闻 item，在所属来源的角带内按同心环排布
//
// 排布方式：以 apex 为圆心的极坐标扇区；叶片是「轴对齐」的横向药丸，
// 因此每个同心环内按 x 轴顺序排布（而不是按弧长），保证不会水平重叠。
// ============================================================
import { textWidth } from "./helpers.js";

export const LAYOUT_DEFAULTS = {
  spreadDeg: 190,      // 树冠张角（180 = 半圆，>180 树冠会略低于 apex）
  minFrac: 0.06,       // 单分类最小横向份额
  maxFrac: 0.55,       // 单分类最大横向份额（防止一个分类吃掉大部分空间）
  pillH: 26,           // 叶片高度
  leafGapV: 4,         // 相邻货架（行）的垂直间隙
  leafGap: 10,         // 同一行内相邻叶片水平间隙
  rCat: 170,           // 主枝节点半径（距 apex）
  rSrc: 300,           // 分枝节点半径
  rLeaf0: 320,         // 第一行叶片距 apex 的高度
  trunkRatio: 0.16,    // 树干高度 / 树冠半径
  trunkMin: 150,       // 树干高度下限
  trunkMax: 460,       // 树干高度上限
  trunkBaseW: 62,      // 树干底部宽度
  trunkTopW: 16,       // 树干顶部宽度
  barkLines: 4,        // 树皮纹线条数
  labelPad: 30,        // 树冠外留给标签的余量
  leafPad: 24,         // 叶片左右内边距
  leafMinW: 108,       // 叶片最小宽度
  leafMaxW: 320,       // 叶片最大宽度（标题再长也不无限扩张）
  leafHeatLo: 0.95,    // 热度视觉权重下限
  leafHeatHi: 1.12,    // 热度视觉权重上限
  targetAspect: 1.72,  // 目标包围盒宽高比（<=1.8，同时尽量贴合视口比例以放大字号）
  stretchMax: 2.4      // 水平拉伸上限
};

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 叶片文字：剥掉残留 HTML 标签并归一化空白（保证截断不产生半截标签） */
export function leafText(s) {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** 语义边界：优先在这些标点处收尾 */
const BOUNDARY_RE = /[，。！？；：、,.!?;:）)】」》”"'/|·—…%]/;

/** 按真实文字宽度截断标题（CJK 约 13.5px / 拉丁数字约 7.6px，13px 字号） */
export function truncateByWidth(s, w, pad = LAYOUT_DEFAULTS.leafPad) {
  const avail = w - pad;
  const text = leafText(s);
  if (avail <= 4) return "…";
  if (textWidth(text) <= avail) return text;
  let out = "";
  let lastBoundary = 0;
  for (const ch of text) {
    if (textWidth(out + ch) > avail) break;
    out += ch;
    if (BOUNDARY_RE.test(ch)) lastBoundary = out.length;
  }
  if (lastBoundary >= out.length * 0.8) return out.slice(0, lastBoundary) + "…";
  return (out || "…") + "…";
}

/** 叶片宽度：按真实文字宽度估算完整标题所需宽度，再按热度做视觉权重微调 */
export function leafWidth(item, o = LAYOUT_DEFAULTS) {
  const need = Math.min(textWidth(leafText(item.title)) + o.leafPad, o.leafMaxW);
  const heat = clamp(Number(item.heatScore) || 0, 0, 1);
  const w = need * (o.leafHeatLo + heat * (o.leafHeatHi - o.leafHeatLo));
  return Math.round(clamp(w, o.leafMinW, o.leafMaxW));
}

/**
 * 分类横向份额分配（sqrt 权重抑制极端偏斜 + 上下限裁剪 + 归一化）
 *
 * 注意：这里分配的是「归一化 x 份额」而不是「角度」。
 * 若按角度平均分配，位于扇面边缘的分类其横向可用宽度会急剧缩小
 * （x 跨度 ∝ |sin a1 - sin a0|，边缘处趋近 0），被迫把半径撑大数倍。
 * 按 x 份额分配后再用 asin 反推角度，可保证每个分类的横向宽度与其权重成正比。
 */
export function allocateFractions(counts, minF, maxF) {
  const n = counts.length;
  if (!n) return [];
  const w = counts.map((c) => Math.sqrt(Math.max(0, c)));
  const sumW = w.reduce((a, b) => a + b, 0) || n;
  let f = w.map((x) => x / sumW);
  for (let pass = 0; pass < 4; pass++) {
    let used = 0;
    let freeW = 0;
    let freeN = 0;
    for (let i = 0; i < n; i++) {
      if (f[i] >= maxF) { f[i] = maxF; used += maxF; }
      else if (f[i] <= minF) { f[i] = minF; used += minF; }
      else { freeW += w[i]; freeN++; }
    }
    const rest = 1 - used;
    if (freeN === 0 || rest <= 0) break;
    for (let i = 0; i < n; i++) {
      if (f[i] > minF && f[i] < maxF) f[i] = freeW > 0 ? (rest * w[i]) / freeW : rest / freeN;
    }
  }
  // 修正总和到 1：必须在不突破上下限的前提下补差，
  // 否则「归一化」会把已裁剪的份额重新放大（极端不均衡时最大分类会超出上限）。
  for (let pass = 0; pass < 8; pass++) {
    const s0 = f.reduce((a, b) => a + b, 0);
    const diff = 1 - s0;
    if (Math.abs(diff) < 1e-9) break;
    const adjustable = f
      .map((v, i) => ({ i, v }))
      .filter(({ v }) => (diff > 0 ? v < maxF - 1e-9 : v > minF + 1e-9));
    if (!adjustable.length) break;
    const per = diff / adjustable.length;
    for (const { i } of adjustable) f[i] = clamp(f[i] + per, minF, maxF);
  }
  return f;
}

const polar = (r, a, k = 1) => ({ x: k * r * Math.sin(a), y: -r * Math.cos(a) });

function sourceItems(cat) {
  return (cat.sources || []).map((s) => ({ name: s.name, items: (s.items || []).filter(Boolean) })).filter((s) => s.items.length);
}

/** 构建树冠（apex 在原点，向上为 -y）。k = 水平拉伸系数
 *
 * 叶片排布采用「水平货架（shelf）」而不是同心环：
 * 每个货架独占一个 y 带，行内按 x 顺序排布，因此**永不重叠**。
 * 同心环在扇面边缘会出现纵向重叠（相邻环的水平间距远小于叶片宽度），
 * 且边缘扇区的横向跨度趋近 0，会把半径撑大数倍。
 *
 * 货架 j 的高度 h_j，该高度上树冠的半宽 halfW(h) = k·halfSin·√(R²-h²)；
 * 每个分类在此宽度上占固定比例（allocateFractions 的 u 区间），
 * 因此分类区域仍是一个真正的角度扇区。
 */
function placeShelves(catData, uCum, R, k, halfSin, o) {
  const leaves = [];
  const remaining = catData.map((c) => c.srcs.map((s) => ({ name: s.name, rem: s.items.slice() })));
  const unit = o.avgUnit || 260;
  const shelfStep = o.pillH + o.leafGapV;
  let h = o.rLeaf0;
  let guard = 0;
  while (h <= R + 1 && guard++ < 4000) {
    const halfW = k * halfSin * Math.sqrt(Math.max(0, R * R - h * h));
    if (halfW < o.leafMinW * 0.5) break;
    const y = -h;
    const shelfIdx = Math.round((h - o.rLeaf0) / shelfStep);
    for (let ci = 0; ci < catData.length; ci++) {
      const srcs = remaining[ci];
      const remTotal = srcs.reduce((s, x) => s + x.rem.length, 0);
      if (!remTotal) continue;
      const lo = uCum[ci][0] * halfW;
      const hi = uCum[ci][1] * halfW;
      const avail = hi - lo;
      const capN = Math.max(1, Math.floor(avail / unit));
      let cursor = lo;
      // 轮转起点：避免每行都是第一个来源先占满（确定性：由行号决定）
      const start = shelfIdx % srcs.length;
      for (let t = 0; t < srcs.length; t++) {
        const si = (start + t) % srcs.length;
        const s = srcs[si];
        if (!s.rem.length) continue;
        const quota = Math.max(1, Math.ceil((capN * s.rem.length) / remTotal) + 1);
        let n = 0;
        while (s.rem.length && n < quota) {
          const item = s.rem[0];
          const w = leafWidth(item, o);
          const need = cursor > lo ? w + o.leafGap : w;
          if (cursor + need > hi + 0.5) break;
          s.rem.shift();
          const cx = cursor + w / 2;
          cursor += need;
          n++;
          leaves.push({
            id: item.id, item, w, h: o.pillH, x: cx, y, hgt: h, ci, si,
            sourceName: s.name, u: halfW > 0 ? cx / halfW : 0
          });
        }
      }
    }
    h += shelfStep;
  }
  const left = remaining.reduce((s, c) => s + c.reduce((t, x) => t + x.rem.length, 0), 0);
  return { leaves, remaining, done: left === 0, left };
}

function buildCrown(list, counts, o, k) {
  const spread = o.spreadDeg * DEG;
  const halfSin = Math.sin(spread / 2);
  const fracs = allocateFractions(counts, o.minFrac, o.maxFrac);
  const uCum = [];
  let acc = 0;
  for (const f of fracs) { uCum.push([2 * acc - 1, 2 * (acc + f) - 1]); acc += f; }

  const total = counts.reduce((a, b) => a + b, 0);
  const all = [];
  for (const x of list) for (const s of x.srcs) for (const it of s.items) all.push(it);
  const avgUnit = all.reduce((s, it) => s + leafWidth(it, o) + o.leafGap, 0) / Math.max(1, all.length);
  const oo = { ...o, avgUnit };

  const catData = list.map((x, ci) => ({ cat: x.cat, count: counts[ci], srcs: x.srcs }));

  // 树冠半径：按扇形面积与行容量估算，再迭代放大直到所有叶片排下
  const shelfStep = o.pillH + o.leafGapV;
  let R = Math.sqrt(Math.max(1, (total * shelfStep * avgUnit) / ((Math.PI / 2) * k * halfSin)));
  let placed = placeShelves(catData, uCum, R, k, halfSin, oo);
  for (let iter = 0; iter < 16 && !placed.done; iter++) {
    R *= 1.06;
    placed = placeShelves(catData, uCum, R, k, halfSin, oo);
  }

  // 分类 / 来源节点
  const categories = [];
  const sources = [];
  for (let ci = 0; ci < catData.length; ci++) {
    const midU = (uCum[ci][0] + uCum[ci][1]) / 2;
    const a0 = Math.asin(clamp(uCum[ci][0] * halfSin, -1, 1));
    const a1 = Math.asin(clamp(uCum[ci][1] * halfSin, -1, 1));
    const mid = Math.asin(clamp(midU * halfSin, -1, 1));
    const catNode = polar(o.rCat, mid, k);
    const catRec = {
      key: catData[ci].cat.key, name: catData[ci].cat.name, color: catData[ci].cat.color,
      count: counts[ci], a0, a1, mid, frac: fracs[ci], u0: uCum[ci][0], u1: uCum[ci][1],
      node: catNode, x: catNode.x, y: catNode.y, sources: []
    };
    const nSrc = catData[ci].srcs.length;
    for (let si = 0; si < nSrc; si++) {
      const mine = placed.leaves.filter((l) => l.ci === ci && l.si === si);
      const meanU = mine.length ? mine.reduce((s, l) => s + l.u, 0) / mine.length : midU;
      const angle = Math.asin(clamp(meanU * halfSin, -1, 1));
      const node = polar(o.rSrc, angle, k);
      const rec = {
        name: catData[ci].srcs[si].name, count: catData[ci].srcs[si].items.length,
        ci, si, meanU, meanAngle: angle,
        band: mine.length ? [Math.min(...mine.map((l) => l.u)), Math.max(...mine.map((l) => l.u))] : [meanU, meanU],
        outerH: mine.length ? Math.max(...mine.map((l) => l.hgt)) : o.rSrc,
        node, x: node.x, y: node.y, catNode
      };
      sources.push(rec);
      catRec.sources.push(rec);
    }
    categories.push(catRec);
  }

  const maxH = placed.leaves.reduce((m, l) => Math.max(m, l.hgt), 0);
  return { categories, sources, leaves: placed.leaves, maxR: Math.max(maxH, o.rLeaf0), done: placed.done, left: placed.left };
}
/** 单遍布局（给定拉伸系数），返回几何 + 包围盒 */
function layoutOnce(cats, o, k) {
  const list = cats.map((c) => ({ cat: c, srcs: sourceItems(c) })).filter((x) => x.srcs.length);
  if (!list.length) return null;
  const counts = list.map((x) => x.srcs.reduce((s, y) => s + y.items.length, 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;

  const { categories, sources, leaves, maxR } = buildCrown(list, counts, o, k);
  const trunkH = Math.round(clamp(o.trunkRatio * maxR, o.trunkMin, o.trunkMax));

  // 平移到最终坐标：树根在 (0,0)，apex 在 (0,-trunkH)
  for (const c of categories) { c.node.y -= trunkH; c.x = c.node.x; c.y = c.node.y; }
  for (const s of sources) { s.node.y -= trunkH; s.x = s.node.x; s.y = s.node.y; }
  for (const l of leaves) l.y -= trunkH;
  // 枝脊：从来源节点竖直连到第一行叶片底部，让叶片看起来挂在分枝上
  for (const s of sources) s.spine = { x: s.x, y1: s.y, y2: -o.rLeaf0 - trunkH + o.pillH / 2 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of leaves) {
    if (l.x - l.w / 2 < minX) minX = l.x - l.w / 2;
    if (l.x + l.w / 2 > maxX) maxX = l.x + l.w / 2;
    if (l.y - l.h / 2 < minY) minY = l.y - l.h / 2;
    if (l.y + l.h / 2 > maxY) maxY = l.y + l.h / 2;
  }
  for (const s of sources) { if (s.x - 46 < minX) minX = s.x - 46; if (s.x + 46 > maxX) maxX = s.x + 46; }
  if (!isFinite(minX)) { minX = -o.rCat; maxX = o.rCat; }
  if (!isFinite(minY)) minY = -trunkH - o.rCat;
  minY = Math.min(minY, -trunkH - maxR);
  maxY = Math.max(maxY, 0);
  const pad = o.labelPad;
  const bbox = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };

  const trunk = {
    h: trunkH, baseW: o.trunkBaseW, topW: o.trunkTopW,
    base: { x: 0, y: 0 }, apex: { x: 0, y: -trunkH },
    bark: Array.from({ length: o.barkLines }, (_, i) => {
      const t = o.barkLines === 1 ? 0 : (i / (o.barkLines - 1)) * 2 - 1;
      return { offset: t * (o.trunkBaseW * 0.26), scale: 1 - Math.abs(t) * 0.25 };
    })
  };

  return {
    categories, sources, leaves, trunk, bbox, crownR: maxR, trunkH,
    apex: { x: 0, y: -trunkH }, base: { x: 0, y: 0 },
    totalLeaves: leaves.length,
    avgLeafW: leaves.length ? leaves.reduce((s, l) => s + l.w, 0) / leaves.length : 0,
    stretch: k, params: o
  };
}

/**
 * 主布局函数（纯函数，确定性）
 *
 * 两遍固定点：先用圆形树冠（k=1）量出尺寸，再按 targetAspect 计算水平拉伸系数重排。
 * 这样无论分类数量多少，包围盒宽高比都稳定落在目标附近 —— 而 fit 缩放与
 * 包围盒形状直接相关：形状越贴合视口，同样面积下字号越大。
 *
 * @param {Array} cats [{ key, name, color, count, sources: [{ name, items: [] }] }]
 * @param {Object} opts 覆盖 LAYOUT_DEFAULTS
 */
export function layoutTree(cats, opts = {}) {
  const o = { ...LAYOUT_DEFAULTS, ...(opts || {}) };
  const empty = {
    categories: [], sources: [], leaves: [], trunk: null,
    bbox: { minX: -1, maxX: 1, minY: -1, maxY: 0 },
    crownR: 0, trunkH: 0, apex: { x: 0, y: 0 }, base: { x: 0, y: 0 },
    totalLeaves: 0, avgLeafW: 0, stretch: 1, params: o
  };
  if (!Array.isArray(cats) || !cats.length) return empty;

  // 迭代收敛拉伸系数：包围盒形状越贴合视口比例，同样面积下 fit 字号越大。
  // 用阻尼更新（指数 0.75）避免过冲：k 变化会同时改变树冠半径，映射非线性。
  let k = 1;
  let best = layoutOnce(cats, o, k);
  if (!best) return empty;
  for (let i = 0; i < 10; i++) {
    const w = Math.max(1, best.bbox.maxX - best.bbox.minX);
    const h = Math.max(1, best.bbox.maxY - best.bbox.minY);
    const cur = w / h;
    if (Math.abs(cur - o.targetAspect) < 0.02) break;
    const nextK = clamp(k * Math.pow(o.targetAspect / cur, 0.75), 1, o.stretchMax);
    if (Math.abs(nextK - k) < 0.005) break;
    k = nextK;
    const next = layoutOnce(cats, o, k);
    if (!next) break;
    best = next;
  }
  return best;
}

/** 视口 → fit 变换（可读性优先：不允许把树缩到文字不可读） */
export function computeFit(bbox, viewW, viewH, o = LAYOUT_DEFAULTS, minScale = 0.465) {
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const natural = Math.min(viewW / bw, viewH / bh);
  const s = Math.min(natural, 1.6);
  if (s >= minScale) {
    return { s, tx: viewW / 2 - ((bbox.minX + bbox.maxX) / 2) * s, ty: viewH - bbox.maxY * s, mode: "fit-all" };
  }
  // 整树入镜必然不可读 → 保持可读缩放，聚焦树冠中心（树干 + 主枝 + 主要分枝）
  const s2 = minScale;
  const cx = 0;
  const cy = bbox.minY + bh * 0.55;
  return { s: s2, tx: viewW / 2 - cx * s2, ty: viewH * 0.62 - cy * s2, mode: "readable-focus" };
}

/** LOD 级别：0 = 完整（叶片标题），1 = 仅叶片形状，2 = 来源聚合 */
export function lodLevel(scale, o = { textAt: 0.42, sourceAt: 0.24 }) {
  if (scale >= o.textAt) return 0;
  if (scale >= o.sourceAt) return 1;
  return 2;
}
