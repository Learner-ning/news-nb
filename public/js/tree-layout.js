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
  leafGapV: 8,         // 同一来源簇内相邻两行的垂直间隙（新闻之间要有明显间隔）
  clusterRowCap: 340,  // 单个来源簇内一行的最大宽度（≈一片叶宽 → 每行一片）
  clusterGapX: 30,     // 相邻来源簇的水平最小间距
  clusterGapY: 22,     // 相邻来源簇的垂直最小间距
  srcLead: 96,         // 来源节点到第一条新闻的距离
  catExtraGap: 90,     // 分类之间额外让出的横向空隙（视觉呼吸空间）
  maxCatShare: 0.6,    // 单分类横向份额上限（不允许一个分类吃掉绝大部分画布）
  leafGap: 10,         // 同一行内相邻叶片水平间隙
  rCat: 170,           // 主枝节点半径（距 apex）
  rSrc: 300,           // 分枝节点半径
  rLeaf0: 460,         // 来源簇的起始半径（枝条主体长度）
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
/** 把一个来源的叶片排成「自己的竖列」：每行宽度不超过 clusterRowCap
 *  —— 来源拥有独立排列区域，不与其它来源共享水平货架（那是 Stage 3 的卡片墙来源）
 */
function buildCluster(items, o) {
  const rows = [];
  let row = [], rowW = 0;
  for (const item of items) {
    const w = leafWidth(item, o);
    if (row.length && rowW + o.leafGap + w > o.clusterRowCap) { rows.push(row); row = []; rowW = 0; }
    row.push({ item, w });
    rowW += w + (row.length > 1 ? o.leafGap : 0);
  }
  if (row.length) rows.push(row);
  const widths = rows.map((r) => r.reduce((s, x) => s + x.w, 0) + Math.max(0, r.length - 1) * o.leafGap);
  const step = o.pillH + o.leafGapV;
  return { rows, widths, W: Math.max(o.leafMinW, ...widths), H: rows.length * step, step };
}

const aabbHit = (a, b, gx, gy) =>
  Math.abs(a.cx - b.cx) < (a.W + b.W) / 2 + gx && Math.abs(a.cy - b.cy) < (a.H + b.H) / 2 + gy;

/** 每个来源一个独立叶片簇，沿扇面散开；半径迭代放大直到所有簇互不重叠（确定性） */
function placeClusters(catData, o, k, halfSin) {
  // ① 先建簇（簇宽 = 叶片宽度决定），再按「实际宽度」分配横向份额。
  //    若按条目数分配，窄簇会白占宽度、宽簇挤在一起，半径被白白撑大数倍。
  const cats = catData.map((c, ci) => ({
    ci, cat: c.cat, count: c.count,
    srcs: c.srcs.map((s, si) => ({ ci, si, name: s.name, cl: buildCluster(s.items, o) }))
  }));
  const catW = cats.map((c) => c.srcs.reduce((s2, x) => s2 + x.cl.W + o.clusterGapX, 0) + o.catExtraGap);
  // 单个分类的横向份额上限（Stage 3 要求：不允许一个分类吃掉绝大部分画布）
  const totalRaw = catW.reduce((x, y) => x + y, 0) || 1;
  const capW = totalRaw * o.maxCatShare;
  let over = 0;
  const wAdj = catW.map((w) => (w > capW ? capW : w));
  for (let i = 0; i < wAdj.length; i++) if (catW[i] > capW) over += catW[i] - capW;
  const underSum = wAdj.reduce((x, y) => x + y, 0) - wAdj.filter((_, i) => catW[i] > capW).reduce((x, y) => x + y, 0);
  for (let i = 0; i < wAdj.length; i++) {
    if (catW[i] <= capW && underSum > 0) wAdj[i] += (over * wAdj[i]) / underSum;
  }
  const totalW = wAdj.reduce((x, y) => x + y, 0);

  // ② 分类的 u 区间（按宽度比例）
  const uRange = [];
  let acc = 0;
  for (let i = 0; i < cats.length; i++) {
    const w = totalW > 0 ? wAdj[i] / totalW : 1 / cats.length;
    uRange.push([2 * acc - 1, 2 * (acc + w) - 1]);
    acc += w;
  }

  // ③ 每个来源的 u 中心（在其分类区间内按簇宽分配）
  const jobs = [];
  for (let ci = 0; ci < cats.length; ci++) {
    const srcs = cats[ci].srcs;
    const wsum = srcs.reduce((x, y) => x + y.cl.W + o.clusterGapX, 0) || 1;
    const u0 = uRange[ci][0], u1 = uRange[ci][1];
    let a2 = u0;
    for (const s2 of srcs) {
      const share = ((u1 - u0) * (s2.cl.W + o.clusterGapX)) / wsum;
      const uc = a2 + share / 2;
      a2 += share;
      jobs.push({ ci, si: s2.si, name: s2.name, uc, angle: Math.asin(clamp(uc * halfSin, -1, 1)), cl: s2.cl });
    }
  }

  // ④ 半径迭代：任一簇与其它簇的 AABB 相交就整体外推（确定性）
  let rIn = o.rLeaf0;
  let boxes = [];
  for (let iter = 0; iter < 120; iter++) {
    boxes = jobs.map((j) => {
      const bx = k * rIn * Math.sin(j.angle);
      const by = -rIn * Math.cos(j.angle);
      return { cx: bx, cy: by - j.cl.H / 2, W: j.cl.W, H: j.cl.H, bx, by, j };
    });
    let hit = false;
    for (let x = 0; x < boxes.length && !hit; x++) {
      for (let y = x + 1; y < boxes.length && !hit; y++) {
        if (aabbHit(boxes[x], boxes[y], o.clusterGapX, o.clusterGapY)) hit = true;
      }
    }
    if (!hit) break;
    rIn *= 1.05;
  }

  // ⑤ 生成叶片
  const leaves = [];
  for (const box of boxes) {
    const j = box.j;
    for (let ri = 0; ri < j.cl.rows.length; ri++) {
      const y = box.by - j.cl.H + (ri + 0.5) * j.cl.step;
      let lx = box.bx - j.cl.widths[ri] / 2;
      for (const cell of j.cl.rows[ri]) {
        leaves.push({
          id: cell.item.id, item: cell.item, w: cell.w, h: o.pillH,
          x: lx + cell.w / 2, y, ci: j.ci, si: j.si, sourceName: j.name, uc: j.uc, rIn
        });
        lx += cell.w + o.leafGap;
      }
    }
  }
  return { leaves, jobs, boxes, rIn };
}

function buildCrown(list, counts, o, k) {
  const spread = o.spreadDeg * DEG;
  const halfSin = Math.sin(spread / 2);
  const catData = list.map((x, ci) => ({ cat: x.cat, count: counts[ci], srcs: x.srcs }));
  const placed = placeClusters(catData, o, k, halfSin);

  // 分类区间由 placeClusters 的 u 分配结果反推（保持一致）
  const uOf = new Map();
  for (const j of placed.jobs) {
    const cur = uOf.get(j.ci) || { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    cur.min = Math.min(cur.min, j.uc); cur.max = Math.max(cur.max, j.uc);
    cur.sum += j.uc; cur.n++;
    uOf.set(j.ci, cur);
  }

  const categories = [];
  const sources = [];
  let maxR = 0;
  for (let ci = 0; ci < catData.length; ci++) {
    const u = uOf.get(ci);
    const midU = u ? u.sum / u.n : 0;
    const a0 = Math.asin(clamp((u ? u.min : midU) * halfSin, -1, 1));
    const a1 = Math.asin(clamp((u ? u.max : midU) * halfSin, -1, 1));
    const mid = Math.asin(clamp(midU * halfSin, -1, 1));
    const catNode = polar(o.rCat, mid, k);
    const catRec = {
      key: catData[ci].cat.key, name: catData[ci].cat.name, color: catData[ci].cat.color,
      count: counts[ci], a0, a1, mid, u0: u ? u.min : midU, u1: u ? u.max : midU,
      node: catNode, x: catNode.x, y: catNode.y, sources: []
    };
    for (const j of placed.jobs.filter((x) => x.ci === ci)) {
      const nr = Math.max(o.rCat + 40, placed.rIn - o.srcLead);
      const node = polar(nr, j.angle, k);
      const box = placed.boxes.find((bb) => bb.j === j);
      const rec = {
        name: j.name, count: j.cl.rows.reduce((s2, r) => s2 + r.length, 0), ci, si: j.si,
        meanU: j.uc, meanAngle: j.angle, outerH: placed.rIn + j.cl.H,
        node, x: node.x, y: node.y,
        clusterBase: { x: box.bx, y: box.by }, clusterW: j.cl.W, clusterH: j.cl.H,
        catNode
      };
      sources.push(rec);
      catRec.sources.push(rec);
      maxR = Math.max(maxR, placed.rIn + j.cl.H + o.labelPad);
    }
    categories.push(catRec);
  }
  return { categories, sources, leaves: placed.leaves, maxR, done: true, left: 0 };
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
  // 枝脊：从来源节点连到它自己那个叶片簇的基点（新闻挂在分枝末端）
  for (const s of sources) s.spine = { x1: s.x, y1: s.y, x2: s.clusterBase.x, y2: s.clusterBase.y };

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

/** 视口 → fit 变换
 *
 * 策略（Stage 3.1 调整）：默认「整树入镜」。
 * 以前为了保证叶片标题可读会把整树放大到超出视口（readable-focus），
 * 但那样第一眼只能看到局部。现在的做法是：整树入镜 + 由 LOD 决定是否显示标题
 * —— 远看是干净的树形结构（叶片只剩色条），放大后才出现标题。
 * 只有在整树入镜会缩到极小（< minScale）时才退回聚焦，避免出现一颗芝麻。
 */
export function computeFit(bbox, viewW, viewH, o = LAYOUT_DEFAULTS, minScale = 0.16) {
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const natural = Math.min(viewW / bw, viewH / bh);
  const s = Math.min(natural, 1.4);
  if (s >= minScale) {
    return { s, tx: viewW / 2 - ((bbox.minX + bbox.maxX) / 2) * s, ty: viewH - bbox.maxY * s, mode: "fit-all" };
  }
  const s2 = minScale;
  const cy = bbox.minY + bh * 0.55;
  return { s: s2, tx: viewW / 2, ty: viewH * 0.62 - cy * s2, mode: "readable-focus" };
}

/** LOD 级别：0 = 完整（叶片标题），1 = 仅叶片形状，2 = 来源聚合 */
export function lodLevel(scale, o = { textAt: 0.5, sourceAt: 0.15 }) {
  if (scale >= o.textAt) return 0;
  if (scale >= o.sourceAt) return 1;
  return 2;
}
