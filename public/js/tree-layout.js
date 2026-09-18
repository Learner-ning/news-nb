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
import { textWidth, orderTags } from "./helpers.js";

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
  // —— 树冠模式（Stage 3.2.1 首页新闻源树）——
  // 旧扇形模式把一级节点钉在 rCat=170 的小圆上、把叶片簇推到 2000~2800 的远端环上，
  // 于是视觉上变成「中心小点 + 16 根长直线 + 远端卡片墙」。树冠模式改为：
  // 少量粗主枝（弯曲）→ 来源节点分布在各自主枝上 → 叶片簇紧贴来源节点两侧。
  mode: "fan",
  // —— 首页分阶段披露（Stage 3.3）：先只显示新闻源骨架，点进来源才出新闻 ——
  // 注意：这不是「渲染时隐藏叶片」——叶片簇的 AABB 会把包围盒撑到远端，
  // 那样 fit 会把骨架缩成一小团并留下大片空白。skipLeaves 直接不生成叶片几何，
  // 来源节点按主枝均匀铺开，包围盒只包住主枝与节点本身。
  skipLeaves: false,
  crownLimbs: 6,       // 主枝条数（少量、粗、有曲线）
  crownPerLimb: 3,     // 每条主枝最多承载几个来源（决定主枝条数）
  crownSpreadDeg: 180, // 主枝张角
  // Stage 3.4：首页树必须成为绝对主视觉。原来的 1200 让树冠过高，
  // fit 被高度卡住 → 整体缩放只有 0.37，节点小到看不清。
  // 压短主枝后包围盒宽高比更贴近 16:9 视口，缩放与可读性同步上升。
  crownLimbLen: 1200,  // 主枝长度（crown 模式；crown-bare 用 crownBareLimbLen）
  crownRowCap: 660,    // 来源簇每行最大宽度（≈2 片叶）
  crownT0: 0.4,        // 第一个来源在主枝上的位置（0=apex，1=枝端）
  crownT1: 0.96,       // 最后一个来源的位置
  crownNodeGap: 42,    // 叶片簇内侧与来源节点的距离（新闻要贴着来源）
  // 无叶片模式的节点铺开范围（0.32 起步避免贴着树干顶端重叠）
  crownBareT0: 0.42,
  crownBareT1: 0.9,
  crownBareNodeGapX: 26,   // 同枝上相邻来源节点的最小水平间距
  crownBareNodeGapY: 54,   // 相邻来源节点的最小垂直间距
  // 分类之间的额外横向间隙：Stage 3.4 §2 要求「不同新闻分类对应不同主枝」，
  // 同分类的来源必须占据连续的列区间，分类之间再留出视觉呼吸空间。
  crownBareGroupGap: 72,
  crownBareMaxLimbLen: 1100, // 单根主枝长度上限（防止小角度主枝被拉成无限长）
  crownBareMaxReach: 980,    // 列的横向半跨度上限（控制主枝需要伸多远）
  crownTrunkRatio: 0.33,
  crownTrunkBaseW: 108,  // 树冠模式的树干底部宽度（树干是最高视觉权重）
  crownTrunkTopW: 30,
  crownTrunkMin: 260,
  crownTrunkMax: 560,
  // —— crown-bare（首页无叶片）专属树干/主枝尺度 ——
  // 与 crown 模式分开，避免调整首页时把已验收的 crown 几何一起改掉。
  crownBareLimbLen: 700,
  crownBareTrunkRatio: 0.29,
  crownBareTrunkBaseW: 150,
  crownBareTrunkTopW: 42,
  crownBareTrunkMin: 240,
  crownBareTrunkMax: 560,
  crownBareLimbHalfW: 14,   // 首页主枝更粗（CSS 最粗 28px）
  // 中央分类扇区的加宽系数（见 ② 的说明：让树冠更扁，fit 缩放更大）
  crownBareCenterBoost: 1.55,
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
  stretchMax: 2.4,     // 水平拉伸上限
  // —— 无叶片模式（homepage）度量 ——
  // Stage 3.4：节点是首页唯一可交互主体，必须看得清。
  // 采用「徽标在上、名称在下」的竖式节点：盒更窄 → 列更密 → 树冠更窄更扁，
  // 在 16:9 视口下的 fit 缩放更大，文字反而更清楚（横式节点会被宽度吃满）。
  bareNodeMaxW: 240,   // 来源节点盒最大宽度
  bareNodeMinW: 104,
  bareNodeH: 94,       // 节点盒高度（徽标 48 + 名称 + 条数）
  bareNameFont: 19,    // 名称字号（世界单位）；textWidth() 以 13.5px 为基准，需按比例换算
  bareNodePadX: 26,    // 盒内左右余量
  bareCountGap: 6,     // 名称下方「N 条」占用的额外空间
  bareApexPad: 56,     // apex 上方留白
  limbHalfW: 14        // 主枝半宽（CSS .limb 最粗 28 的一半）
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
function buildCluster(items, o, rowCap) {
  const cap = rowCap || o.clusterRowCap;
  const rows = [];
  let row = [], rowW = 0;
  for (const item of items) {
    const w = leafWidth(item, o);
    if (row.length && rowW + o.leafGap + w > cap) { rows.push(row); row = []; rowW = 0; }
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

// ============================================================
// 树冠模式（Stage 3.2.1）：少量粗主枝 + 来源节点分布在主枝上 + 叶片簇紧贴来源
//
// 与扇形模式（fan）的根本区别：
//   fan ：一级节点全部钉在 rCat 小圆上，叶片簇被 AABB 迭代外推到同一个远端环
//         → 视觉上是「中心小点 + 16 根长直线 + 远端卡片墙」
//   crown：来源节点分布在各自主枝的 40%~96% 处（到中心的距离天然分散），
//         叶片簇以「左右交替」的方式紧贴来源节点两侧；碰撞用局部 AABB 分离解决，
//         不再整体放大半径 —— 所以包围盒不会无脑增大。
// ============================================================
const qbez = (p0, p1, p2, t) => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
});
const qtan = (p0, p1, p2, t) => {
  const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const n = Math.hypot(dx, dy) || 1;
  return { x: dx / n, y: dy / n };
};

/** 在二次贝塞尔上求「x(t) ≈ targetX」的 t（二分，确定性）
 *
 * 主枝的 x(t) 在 [0,1] 上单调（p0.x=0、p1.x 与 p2.x 同号且 |p1.x| < |p2.x|），
 * 所以二分一定收敛。用于把「节点锁定的横向列 colX」映射回主枝上的落点，
 * 保证枝脊从节点的正后方长出来而不是横穿节点。
 *
 * 注意：这里**不做 T0/T1 裁剪**。若裁剪，节点会被留在它的列上而主枝落点被拽向
 * 树干/枝尖，枝脊就会横向斜穿节点（实测最多偏出 465px）。
 * 代价是极端情况下 t 会接近 1，此时节点紧贴枝端 —— 这是可接受的，
 * 因为主枝长度 crownLimbLen 已按树冠半径取值。
 */
function solveTForX(g, targetX, o) {
  const x0 = g.p0.x, x1 = g.p2.x;
  const span = Math.abs(x1 - x0);
  if (span < 1e-6) return 0.5;
  const sign = Math.sign(x1 - x0) || 1;
  const lo = Math.min(sign * x0, sign * x1);
  const hi = Math.max(sign * x0, sign * x1);
  const want = clamp(sign * targetX, lo, hi);
  let a = 0, b = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    if (sign * qbez(g.p0, g.p1, g.p2, mid).x < want) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

/** 局部 AABB 分离：只推开真正重叠的那一对（确定性） */
function relaxBoxes(boxes, gx, gy, iters = 160) {
  for (let k = 0; k < iters; k++) {
    let moved = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = (a.W + b.W) / 2 + gx - Math.abs(a.cx - b.cx);
        const oy = (a.H + b.H) / 2 + gy - Math.abs(a.cy - b.cy);
        if (ox > 0 && oy > 0) {
          moved++;
          if (ox < oy) {
            const s = Math.sign(b.cx - a.cx) || 1;
            a.cx -= (s * ox) / 2; b.cx += (s * ox) / 2;
          } else {
            const s = Math.sign(b.cy - a.cy) || 1;
            a.cy -= (s * oy) / 2; b.cy += (s * oy) / 2;
          }
        }
      }
    }
    if (!moved) break;
  }
}

/** 树冠骨架：返回主枝曲线、来源节点、叶片簇、叶片（apex 在原点，向上为 -y） */
function buildCrownSkeleton(entries, o) {
  const list = entries.map((c) => ({ cat: c, srcs: sourceItems(c) })).filter((x) => x.srcs.length);
  if (!list.length) return null;
  const units = [];
  for (const { cat, srcs } of list) {
    const items = srcs.flatMap((s) => s.items);
    if (!items.length) continue;
    units.push({ key: cat.key, name: cat.name, color: cat.color, count: items.length, items });
  }
  if (!units.length) return null;

  const n = units.length;
  const perLimb = Math.max(1, o.crownPerLimb);
  const limbCount = Math.max(1, Math.min(n, Math.max(1, Math.ceil(n / perLimb))));
  const spread = o.crownSpreadDeg * DEG;
  const angles = Array.from({ length: limbCount }, (_, i) =>
    limbCount === 1 ? 0 : -spread / 2 + (i / (limbCount - 1)) * spread);

  // 轮转发牌：每条主枝分到条目数相近的来源；条目少的靠内侧（内侧空间小）
  const buckets = angles.map(() => []);
  units.forEach((u, i) => buckets[i % limbCount].push(u));
  buckets.forEach((b) => b.sort((a, c) => a.count - c.count));

  const limbs = [];
  const nodes = [];
  const clusters = [];

  buckets.forEach((bucket, li) => {
    if (!bucket.length) return;
    const th = angles[li];
    const len = o.crownLimbLen;
    const p0 = { x: 0, y: 0 };
    const p2 = { x: Math.sin(th) * len, y: -Math.cos(th) * len };
    const p1 = { x: Math.sin(th * 0.34) * len * 0.6, y: -Math.cos(th * 0.34) * len * 0.6 };
    limbs.push({ p0, p1, p2, color: bucket[0].color, key: bucket[0].key });
    const k = bucket.length;
    bucket.forEach((u, j) => {
      const t = k === 1 ? 0.9 : o.crownT0 + (j / (k - 1)) * (o.crownT1 - o.crownT0);
      const p = qbez(p0, p1, p2, t);
      const tan = qtan(p0, p1, p2, t);
      const perp = { x: -tan.y, y: tan.x };
      const side = j % 2 === 0 ? 1 : -1;   // 左右交替：像叶子长在枝条两侧
      const cl = buildCluster(u.items, o, o.crownRowCap);
      const off = cl.W / 2 + o.crownNodeGap;
      const node = { x: p.x, y: p.y, key: u.key, name: u.name, color: u.color, count: u.count, li, t };
      nodes.push(node);
      clusters.push({ cx: p.x + perp.x * off * side, cy: p.y + perp.y * off * side, W: cl.W, H: cl.H, cl, node });
    });
  });

  relaxBoxes(clusters, o.clusterGapX, o.clusterGapY);
  return { limbs, nodes, clusters, units };
}

/** 无叶片骨架（homepage / skipLeaves）：只有主枝 + 来源节点
 *
 * 与 buildCrownSkeleton 的区别：不构建任何叶片簇，因此没有 AABB 外推，
 * 包围盒完全由主枝曲线与来源节点盒决定 —— 树冠可以铺满视口。
 *
 * 排布策略（关键，Stage 3.2.1 的可视性问题是「节点挤在中心 + 长线放射」）：
 *   ① 节点盒按自身宽度分到**互不重叠的横向列**，列在整个树冠宽度上铺开。
 *      这从结构上保证了水平方向永不重叠 —— 不依赖迭代 relax 收敛。
 *   ② 列的 x 决定节点在主枝上的参数 t：占的列越靠外，t 越大。
 *      于是节点沿着主枝铺开（离中心距离天然离散），而不是被钉在同一个圆上。
 *   ③ 垂直位置再按各主枝自身的曲线走一遍分离，避免相邻主枝在高度上撞车。
 * 这样「节点挂在主枝上」「节点不重叠」「半径有离散度」三个性质同时成立。
 */
function buildBareSkeleton(entries, o, boxOf) {
  const list = entries.map((c) => ({ cat: c, srcs: sourceItems(c) })).filter((x) => x.srcs.length);
  if (!list.length) return null;
  const units = [];
  for (const { cat, srcs } of list) {
    const items = srcs.flatMap((s) => s.items);
    if (!items.length) continue;
    units.push({ key: cat.key, name: cat.name, color: cat.color, count: items.length, tag: cat.tag || "综合" });
  }
  if (!units.length) return null;

  const n = units.length;
  const perLimb = Math.max(1, o.crownPerLimb);
  const len = o.crownBareLimbLen;
  const boxed = units.map((u) => ({ u, box: boxOf(u) }));
  const gapX = o.crownBareNodeGapX;

  // —— ① 按分类分组（Stage 3.4 §2「不同新闻分类对应不同主枝」）——
  // 同分类的来源占据**连续的列区间**，分类之间再留出额外的横向间隙。
  // 这是「一根主枝只挂一个分类」的前提：列区间连续 → 主枝按区间分配 →
  // 一根枝自然只落在一个分类里。顺带让分类色在树冠上成片出现，
  // 而不是被打散成彩虹噪点（同分类的来源共用同一个颜色）。
  const tagOf = (i) => String(units[i].tag || "综合");
  const groups = orderTags([...new Set(units.map((_, i) => tagOf(i)))])
    .map((tag) => ({ tag, idx: units.map((_, i) => i).filter((i) => tagOf(i) === tag) }))
    .filter((g) => g.idx.length);
  const groupOf = new Array(n);

  // 组内按宽度降序装箱（同数据同输出）→ 组内列互不重叠；组间再留 groupGap。
  // 「列互不重叠」这个全局保证在分组之后继续成立（只是换了一种排列顺序）。
  const pack = (gx, ggx) => {
    const gW = groups.map((g) =>
      g.idx.reduce((s, i) => s + boxed[i].box.W, 0) + gx * Math.max(0, g.idx.length - 1));
    const total = gW.reduce((s, v) => s + v, 0) + ggx * Math.max(0, groups.length - 1);
    const x = new Array(n);
    let cursor = -total / 2;
    groups.forEach((g, gi) => {
      const order = g.idx.slice().sort((a, b) => boxed[b].box.W - boxed[a].box.W || a - b);
      let cur = cursor;
      for (const i of order) { x[i] = cur + boxed[i].box.W / 2; cur += boxed[i].box.W + gx; }
      for (const i of g.idx) groupOf[i] = gi;
      cursor += gW[gi] + ggx;
    });
    return { x, gW, total };
  };

  // 横向跨度过大时按比例压缩**间隙**（列宽不变 → 仍互不重叠），
  // 组结构与顺序保持不变，因此「分类占连续区间」也保持不变。
  const maxReach = o.crownBareMaxReach;
  let packed = pack(gapX, o.crownBareGroupGap);
  if (packed.total > maxReach * 2) {
    const shrink = (maxReach * 2) / packed.total;
    packed = pack(Math.max(6, gapX * shrink), Math.max(14, o.crownBareGroupGap * shrink));
  }
  const colX = packed.x;
  const groupW = packed.gW;
  const totalW = packed.total;

  // 列跨度仍可能超出 crownBareMaxReach（列宽总和 + 最小间隙本身就超过 2×maxReach）。
  // 此时不能再压间隙，唯一出路是**放大可达半径口径**：把实际列半跨度作为基准，
  // 让最外侧枝按实际需要伸展，而不是被 crownBareMaxLimbLen 卡死。
  const actualHalfSpan = Math.max(...colX.map((v) => Math.abs(v))) + o.crownBareLimbHalfW;

  // —— ② 每个分类的主枝数与角度扇区 ——
  // 扇区宽度按该分类的**横向宽度**成比例分配。这样「x 区间包含 0 的分类」
  // 恰好就是「角度扇区跨越 θ=0 的分类」—— 两个坐标系的「中央」一致，
  // 中央领导干（θ=0）才能正好承接最内侧的列（否则它会够不到自己的列而斜穿）。
  const spread = o.crownSpreadDeg * DEG;
  const limbCountByGroup = groups.map((g) => Math.max(1, Math.ceil(g.idx.length / perLimb)));
  let centerG = 0;
  {
    // 注意必须把「分类之间的额外间隙」一起累计 —— 漏掉它会让中央分类判定整体右移一组，
    // 于是中央领导干被分到并不跨越 x=0 的分类上（实测导致节点横向偏离 321px）。
    let acc = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const next = acc + groupW[gi];
      if (next >= totalW / 2) { centerG = gi; break; }
      acc = next + o.crownBareGroupGap;
    }
  }
  // 中央领导干（θ=0）的节点靠「横向短枝」挂到两侧的列上，横向偏移 = 该列到中心的距离。
  // 若中央分类的列跨得比节点自身还宽，就必须给它配侧枝 —— 否则节点会被扔到远离主干的位置
  // （实测 dx 达 540px）。这里提前把主枝数抬到 3（竖直 + 左右各一）。
  if (limbCountByGroup[centerG] < 3) {
    const needSide = groups[centerG].idx.some((i) => Math.abs(colX[i]) > boxed[i].box.W * 2);
    if (needSide) limbCountByGroup[centerG] = 3;
  }
  // 中央组取奇数根 → 正中央那根恰好落在 θ=0，作为中央领导干（见 ③ 的竖直主枝）
  if (limbCountByGroup[centerG] % 2 === 0 && limbCountByGroup[centerG] > 1) limbCountByGroup[centerG] += 1;

  const anglesByGroup = [];
  const angles = [];
  {
    const kc = limbCountByGroup[centerG];
    // 中央分类的扇区要额外加宽。原因：它的主枝角度最接近竖直，
    // 而横向覆盖 = L·sinθ —— 角度越小，主枝必须「长得越高」才能碰到自己的列，
    // 树冠于是被拉得又高又窄（实测宽高比 1.23，而视口是 1.78），
    // fit 被高度卡住，整体缩放只有 0.28，节点小到看不清。
    // 加宽中央扇区 → |sinθ| 变大 → 主枝更短更平 → 树冠更扁、更接近 16:9。
    const centerShare = Math.min(0.62, (groupW[centerG] / totalW) * o.crownBareCenterBoost);
    // 步长下限 0.2rad：防止中央组的相邻主枝也近乎竖直（那会让枝长按 1/sinθ 爆炸）
    const stepC = Math.max((spread * centerShare) / kc, 0.2);
    const centerAngles = Array.from({ length: kc }, (_, i) => (i - (kc - 1) / 2) * stepC);
    anglesByGroup[centerG] = centerAngles;

    // 左侧：把 [-spread/2, 中央组左缘] 这段角度按各分类的横向宽度成比例分掉。
    // 两侧都铺满到 ±spread/2 → 树冠左右对称，不会因为分类宽度不同而整体歪向一边。
    const leftEdge = centerAngles[0] - stepC;
    const leftRoom = leftEdge - (-spread / 2);
    let LW = 0;
    for (let gi = 0; gi < centerG; gi++) LW += groupW[gi];
    let edge = -spread / 2;
    for (let gi = 0; gi < centerG; gi++) {
      const k = limbCountByGroup[gi];
      const span = LW > 0 ? leftRoom * (groupW[gi] / LW) : 0;
      const step = span / k;
      anglesByGroup[gi] = Array.from({ length: k }, (_, i) => edge + (i + 0.5) * step);
      edge += span;
    }

    // 右侧：对称处理
    const rightEdge = centerAngles[kc - 1] + stepC;
    const rightRoom = spread / 2 - rightEdge;
    let RW = 0;
    for (let gi = centerG + 1; gi < groups.length; gi++) RW += groupW[gi];
    edge = rightEdge;
    for (let gi = centerG + 1; gi < groups.length; gi++) {
      const k = limbCountByGroup[gi];
      const span = RW > 0 ? rightRoom * (groupW[gi] / RW) : 0;
      const step = span / k;
      anglesByGroup[gi] = Array.from({ length: k }, (_, i) => edge + (i + 0.5) * step);
      edge += span;
    }

    for (let gi = 0; gi < groups.length; gi++) angles.push(...anglesByGroup[gi]);
  }
  // 每个分类占据的连续主枝索引区间（角度已按分类顺序排列）
  const limbStart = [];
  {
    let acc = 0;
    groups.forEach((g, gi) => { limbStart[gi] = acc; acc += limbCountByGroup[gi]; });
  }
  const limbGroup = [];
  groups.forEach((g, gi) => anglesByGroup[gi].forEach(() => limbGroup.push(gi)));


  const colOrder = colX
    .map((v, i) => ({ i, x: v }))
    .sort((a, b) => a.x - b.x || a.i - b.i)
    .map((x) => x.i);

  // θ=0 的主枝 sinθ=0，靠加长永远够不到它分到的两侧列（实测 dx 达 228px）。
  // 真实树木的中央领导干也是这个形态：主干竖直向上，两侧直接挂枝/挂果。
  // 因此中央主枝只承接「最靠近中心」的列，两侧的列交给侧枝。
  // 取 |sinθ| 最小的那一根（而不是所有 < 0.09 的）：中央组的步长有下限，
  // 但仍可能在极端数据下出现两根都接近竖直 —— 那会破坏「一根枝只挂一个分类」。
  const verticalLimbs = new Set();
  {
    let best = -1, bestAbs = Infinity;
    angles.forEach((th, i) => {
      const a = Math.abs(Math.sin(th));
      if (a < bestAbs) { bestAbs = a; best = i; }
    });
    if (best >= 0 && bestAbs < 0.09) verticalLimbs.add(best);
  }

  const buckets = angles.map(() => []);
  {
    // 按分类分组分配：每个分类只在自己的列区间里分给自己的主枝。
    // 这样「一根主枝 = 一个分类」是结构保证，而不是碰巧。
    const colsByGroup = groups.map((g) =>
      g.idx.slice().sort((a, b) => Math.abs(colX[a]) - Math.abs(colX[b]) || a - b));

    groups.forEach((g, gi) => {
      const cols = colsByGroup[gi];
      if (!cols.length) return;
      const k = limbCountByGroup[gi];
      const gLimbs = Array.from({ length: k }, (_, t) => limbStart[gi] + t);
      const vi = gLimbs.filter((li) => verticalLimbs.has(li));
      const sideIdx = gLimbs.filter((li) => !verticalLimbs.has(li));

      // ① 竖直主枝（中央领导干）只承接本分类里「横向偏移不超过节点自身宽度两倍」的列。
      //    判据用宽度而不是数量：一列能不能挂在主干上，取决于它离中心多远，
      //    而不是它是第几列（用数量口径会让宽节点被扔到远离主干的位置）。
      let rest = cols;
      if (vi.length) {
        const inner = cols.filter((c) => Math.abs(colX[c]) <= boxed[c].box.W * 2);
        inner.forEach((c) => buckets[vi[0]].push(c));
        rest = cols.filter((c) => !inner.includes(c));
      }
      if (!sideIdx.length) {
        rest.forEach((c) => buckets[vi[0]].push(c));
        return;
      }

      // ② 关键几何关系：一条主枝能覆盖到多远，由「枝长 × |sinθ|」决定。
      //    |sinθ| 越大（越接近水平）→ 伸得越远 → 必须拿越外侧的列。
      //    因此两侧各自的列（按 |x| 升序 = 由内向外）必须与「|sinθ| 升序」的枝一一对应，
      //    且分界按各枝可达宽度按比例切分，而不是平均分列数。
      //    （历史错误：曾把最内侧列分给最陡的枝，导致外侧枝被迫斜穿，n=40 时 dx 达 2220px。）
      const neg = rest.filter((c) => colX[c] < 0);
      const pos = rest.filter((c) => colX[c] >= 0);

      const deal = (sideCols) => {
        if (!sideCols.length) return;
        const side = sideIdx
          .filter((li) => (sideCols === neg ? Math.sin(angles[li]) < 0 : Math.sin(angles[li]) >= 0))
          .sort((a, b) => Math.abs(Math.sin(angles[a])) - Math.abs(Math.sin(angles[b])) || a - b);
        if (!side.length) return;
        // 每条枝的可达半径：以「实际列半跨度」为基准（不再用固定上限，
        // 否则 n 大时最外侧枝够不到自己的列 → 枝脊斜穿）。
        const caps = side.map((li) =>
          Math.max(1, Math.max(actualHalfSpan, o.crownBareMaxLimbLen * Math.abs(Math.sin(angles[li])))));
        const totalCap = caps.reduce((s, v) => s + v, 0);
        // 由内向外按 caps 比例切分为连续区间
        let acc = 0;
        let prev = 0;
        side.forEach((li, t) => {
          acc += caps[t];
          const from = Math.round(prev * sideCols.length);
          const to = t === side.length - 1 ? sideCols.length : Math.round((acc / totalCap) * sideCols.length);
          for (let c = from; c < to && c < sideCols.length; c++) buckets[li].push(sideCols[c]);
          prev = acc / totalCap;
        });
        // 越界兜底：某枝分到的列超出其可达半径时，转交给本侧更外侧（更强）的枝。
        // 最外侧枝拥有最大 cap，是最终收容方，因此不会再出现「无人可达」的列。
        for (let t = 0; t < side.length - 1; t++) {
          const li = side[t];
          const reach = caps[t];
          const keep = [];
          for (const c of buckets[li]) {
            if (Math.abs(colX[c]) <= reach) keep.push(c);
            else buckets[side[t + 1]].push(c);
          }
          buckets[li] = keep.sort((a, b) => Math.abs(colX[a]) - Math.abs(colX[b]));
          buckets[side[t + 1]].sort((a, b) => Math.abs(colX[a]) - Math.abs(colX[b]));
        }
      };
      // 左半侧（colX < 0）与右半侧（colX >= 0）各自独立分配
      deal(neg);
      deal(pos);
    });
  }

  // —— ①b 每条主枝的长度：刚好覆盖它自己分到的最外侧列 ——
  // 竖直主枝（中央领导干）按节点层数给长度；侧枝按 |sinθ| 反推所需长度。
  // 上限口径 = max(crownBareMaxLimbLen, 实际列半跨度 / |sinθ|)，
  // 即「必须够得到自己那一段列」，否则枝脊会被迫斜穿（这是 3.2.1 的可视性缺陷）。
  const limbGeom2 = angles.map((th, i) => {
    const bucket = buckets[i];
    const sinAbs = Math.abs(Math.sin(th));
    let need = len;
    if (verticalLimbs.has(i)) {
      need = Math.max(len, o.crownBareNodeGapY * (Math.max(1, bucket.length) + 2) * 1.6);
    } else if (bucket.length) {
      const far = Math.max(...bucket.map((c) => Math.abs(colX[c]))) + o.crownBareLimbHalfW;
      need = sinAbs > 0.12 ? Math.max(len, far / sinAbs) : len;
    }
    // 硬约束优先：可达半径 ≥ 本枝最外侧列；软上限只用来避免小角度枝无限伸长
    const farSelf = bucket.length
      ? Math.max(...bucket.map((c) => Math.abs(colX[c]))) + o.crownBareLimbHalfW
      : 0;
    const hardNeed = sinAbs > 0.05 ? farSelf / sinAbs : 0;
    need = Math.max(Math.min(need, o.crownBareMaxLimbLen), hardNeed);
    const p0 = { x: 0, y: 0 };
    const p2 = { x: Math.sin(th) * need, y: -Math.cos(th) * need };
    const p1 = { x: Math.sin(th * 0.34) * need * 0.6, y: -Math.cos(th * 0.34) * need * 0.6 };
    return { p0, p1, p2 };
  });

  // —— ② 生成节点：列 → 主枝落点 ——
  // 节点 x 锁在保留列上（水平永不重叠的结构保证），主枝落点由 x 反推，
  // 因此枝脊从节点的正上/正下方近乎垂直地长出来。
  // 每条主枝带上它所属分类的 tag / color —— 渲染器据此把「分类」画成可辨识的枝。
  const limbs = limbGeom2.map((g, i) => {
    const gi = limbGroup[i];
    const rep = groups[gi] ? units[groups[gi].idx[0]] : null;
    return { ...g, li: i, tag: groups[gi] ? groups[gi].tag : null, group: gi, color: rep ? rep.color : null };
  });
  const nodes = [];
  const boxes = [];

  buckets.forEach((bucket, li) => {
    if (!bucket.length) return;
    const g = limbGeom2[li];
    const isVertical = verticalLimbs.has(li);
    // 同枝内按 colX 升序（外侧节点 t 大，沿枝走得更远）
    const sorted = [...bucket].sort((a, b) => colX[a] - colX[b]);
    const k = sorted.length;
    sorted.forEach((unitIdx, vi) => {
      const u = units[unitIdx];
      const box = boxed[unitIdx].box;
      const nx = colX[unitIdx];
      let t;
      if (isVertical) {
        // 中央主枝（树干延伸）：节点沿主干**按层分布**，每层再左右交替。
        // 每层的 t 由「该节点在本枝内的序号」给出 —— 于是竖向必然错开，
        // 枝脊是「先水平（挂到列）再竖直（层高）」的小段，最短且不错乱。
        t = k === 1
          ? clamp((o.crownBareT0 + o.crownBareT1) / 2, 0.1, 0.95)
          : clamp(o.crownBareT0 + (vi / (k - 1)) * (o.crownBareT1 - o.crownBareT0), 0.1, 0.95);
      } else {
        // 侧枝：t 由节点锁定的列反推，保证落点在节点的正后方
        t = solveTForX(g, nx, o);
      }
      const p = qbez(g.p0, g.p1, g.p2, t);
      const tan = qtan(g.p0, g.p1, g.p2, t);
      const perp = { x: -tan.y, y: tan.x };
      // 左右交替挂枝：节点落在主枝两侧（像果实，而不是串珠）
      const side = unitIdx % 2 === 0 ? 1 : -1;
      const off = box.H * 0.5 + o.crownBareNodeGapY * 0.42;
      // 法向偏移要存下来：垂直分离之后重算落点时，节点 y 需要重新加上它，
      // 否则枝脊会脱离主枝（节点贴着主枝的性质在重算后必须继续成立）。
      const perpY = isVertical ? 0 : perp.y * off * side;
      const node = {
        // 节点 x 锁在保留列上（水平永不重叠的结构保证）
        x: nx,
        // 侧枝：沿主枝法线挂出；中央主干：该层的 y 直接作为节点 y（枝脊水平）
        y: isVertical ? p.y : p.y + perpY,
        bx: p.x,
        by: p.y,
        perpY,
        key: u.key, name: u.name, color: u.color, count: u.count, tag: u.tag,
        li, t, side, colX: nx, vertical: isVertical
      };
      nodes.push(node);
      boxes.push({ cx: nx, cy: node.y, W: box.W, H: box.H, node, li, t, fixedX: nx });
    });
  });

  // —— ③ 垂直分离：只在同一横向列内做 ——
  // 列已经互不重叠（colX 之间至少隔了一个 crownBareNodeGapX），所以只调整 y
  // 绝不会破坏水平分离。这比全局 AABB relax 可靠：全局 relax 会把不同主枝的
  // 节点沿 x 相互推开，反而绕过了「一列一节点」的保证（实测 22 个来源时破功）。
  const byCol = new Map();
  for (const b of boxes) {
    const key = String(Math.round(b.fixedX));
    if (!byCol.has(key)) byCol.set(key, []);
    byCol.get(key).push(b);
  }
  for (const group of byCol.values()) {
    group.sort((a, b) => a.cy - b.cy || b.li - a.li);
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1], c = group[i];
      const need = (prev.H + c.H) / 2 + o.crownBareNodeGapY;
      const d = c.cy - prev.cy;
      if (d < need) {
        const push = (need - d) / 2;
        prev.cy -= push; c.cy += push;
      }
    }
  }
  // 回写节点位置：x 始终锁在保留列上（不因垂直分离而漂移）
  for (const b of boxes) {
    b.node.y = b.cy;
    b.node.x = b.fixedX;
    // 枝脊落点按「节点自己的 x」重新求一次（垂直分离把 y 推走后，
    // 若继续用分离前的落点，枝脊会斜穿节点）。
    // 竖直主枝例外：它的 t 是「层高」，不能被 solveTForX 覆盖，
    // 否则同一列上的节点会全部塌到同一个落点（实测 n=2 时 dy 达 198px）。
    const g = limbGeom2[b.li];
    if (!b.node.vertical) {
      b.node.t = solveTForX(g, b.fixedX, o);
      const p = qbez(g.p0, g.p1, g.p2, b.node.t);
      b.node.bx = p.x;
      b.node.by = p.y;
      // 侧枝的 y 也要跟着新落点走（否则枝脊会脱离主枝）
      b.node.y = p.y + (b.node.perpY || 0);
    } else {
      // 竖直主干：x 落点始终在主干上（≈0），y 保持层高
      const p = qbez(g.p0, g.p1, g.p2, b.node.t);
      b.node.bx = p.x;
      b.node.by = p.y;
    }
  }

  // —— ④ 分类标签：放在该分类所有节点的外侧，沿分类的角度中心方向 ——
  // 有了它，「这一片是科技、那一片是财经」一眼可读 —— 分类关系不再只靠颜色暗示。
  // 位置约束（重要）：标签**不能把包围盒撑大**。3.3 的做法是「碰撞就沿半径一直往外推」，
  // 实测把 bbox 高度从 ~2000 推到 2401，fit 缩放从 0.46 掉到 0.28，整棵树缩小近一半。
  // 改为：先在同一半径上小角度左右试探，实在找不到空位才有限度地外推。
  let maxCrownR = 0;
  for (const b of boxes) maxCrownR = Math.max(maxCrownR, Math.hypot(b.fixedX, b.cy));
  const groupLabels = [];
  groups.forEach((g, gi) => {
    const limbsOfG = anglesByGroup[gi].map((_, t) => limbStart[gi] + t);
    const th0 = anglesByGroup[gi].reduce((s, v) => s + v, 0) / anglesByGroup[gi].length;
    let far = 0;
    for (const b of boxes) {
      if (limbsOfG.includes(b.li)) far = Math.max(far, Math.hypot(b.fixedX, b.cy));
    }
    const r = Math.min(far + 58, maxCrownR + 34);
    const free = (ang) => {
      const px = Math.sin(ang) * r, py = -Math.cos(ang) * r;
      return !boxes.some((b) =>
        Math.abs(b.fixedX - px) < b.W / 2 + 26 && Math.abs(b.cy - py) < b.H / 2 + 22);
    };
    let best = th0;
    for (const d of [0, 0.07, -0.07, 0.14, -0.14, 0.21, -0.21, 0.28, -0.28]) {
      if (free(th0 + d)) { best = th0 + d; break; }
    }
    groupLabels.push({
      group: gi, tag: g.tag, color: units[g.idx[0]].color,
      count: g.idx.length, x: Math.sin(best) * r, y: -Math.cos(best) * r
    });
  });

  return { limbs, nodes, clusters: [], boxes, units, groupLabels };
}

/** 首页无叶片布局：主枝 + 来源节点，包围盒只包住这两者 */
function layoutTreeCrownBare(entries, o) {
  const empty = {
    mode: "crown-bare",
    categories: [], sources: [], leaves: [], limbs: [], trunk: null, groupLabels: [],
    bbox: { minX: -1, maxX: 1, minY: -1, maxY: 0 },
    crownR: 0, trunkH: 0, apex: { x: 0, y: 0 }, base: { x: 0, y: 0 },
    totalLeaves: 0, avgLeafW: 0, stretch: 1, params: o
  };
  if (!Array.isArray(entries) || !entries.length) return empty;

  // 节点盒尺寸：只用文字宽度，不依赖叶片（与渲染器同一套度量 → 不会算错包围盒）
  const boxOf = (u) => {
    // 名称按真实字号换算宽度：textWidth() 以 ~13.5px 为基准，字号变大必须按比例放大，
    // 否则包围盒会低估文字宽度，相邻节点看起来会「贴在一起」。
    const tw = textWidth(String(u.name || "")) * (o.bareNameFont / 13.5);
    const wl = Math.min(o.bareNodeMaxW, Math.max(o.bareNodeMinW, tw + o.bareNodePadX));
    return { W: wl, H: o.bareNodeH };
  };
  const sk = buildBareSkeleton(entries, o, boxOf);
  if (!sk) return empty;

  let maxR = 0;
  for (const nd of sk.nodes) maxR = Math.max(maxR, Math.hypot(nd.x, nd.y));
  for (const lb of sk.limbs) maxR = Math.max(maxR, Math.hypot(lb.p2.x, lb.p2.y));
  const trunkH = Math.round(clamp(o.crownBareTrunkRatio * maxR, o.crownBareTrunkMin, o.crownBareTrunkMax));

  for (const lb of sk.limbs) { lb.p0.y -= trunkH; lb.p1.y -= trunkH; lb.p2.y -= trunkH; }
  for (const nd of sk.nodes) { nd.y -= trunkH; nd.by -= trunkH; }
  for (const b of sk.boxes) b.cy -= trunkH;
  const groupLabels = (sk.groupLabels || []).map((gl) => ({ ...gl, y: gl.y - trunkH }));

  const apex = { x: 0, y: -trunkH };
  const categories = [];
  const sources = [];

  sk.nodes.forEach((nd) => {
    const catRec = {
      key: nd.key, name: nd.name, color: nd.color, count: nd.count, tag: nd.tag, limb: nd.li,
      node: { x: nd.x, y: nd.y }, x: nd.x, y: nd.y,
      a0: 0, a1: 0, mid: 0, u0: 0, u1: 0, frac: 0,
      w: boxOf(nd).W, h: boxOf(nd).H,
      limbPoint: { x: nd.bx, y: nd.by }, side: nd.side,
      sources: []
    };
    catRec.sources.push({
      name: nd.name, count: nd.count, ci: catRec.key, si: 0, limb: nd.li,
      node: { x: nd.x, y: nd.y }, x: nd.x, y: nd.y,
      clusterBase: { x: nd.bx, y: nd.by }, clusterW: 0, clusterH: 0,
      spine: { x1: nd.bx, y1: nd.by, x2: nd.x, y2: nd.y }
    });
    categories.push(catRec);
    sources.push(catRec.sources[0]);
  });

  // 包围盒：主枝曲线采样 + 节点盒（含名称下方的计数文字空间）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const track = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const lb of sk.limbs) {
    for (let i = 0; i <= 32; i++) {
      const p = qbez(lb.p0, lb.p1, lb.p2, i / 32);
      // 主枝本身有粗细（CSS stroke-width），左右各留出 limbHalfW
      track(p.x - o.limbHalfW, p.y);
      track(p.x + o.limbHalfW, p.y);
    }
  }
  for (const cat of categories) {
    const hw = cat.w / 2, hh = cat.h / 2;
    track(cat.x - hw, cat.y - hh);
    track(cat.x + hw, cat.y + hh);
    track(cat.x - hw, cat.y + hh + o.bareCountGap);   // 名称下方的「N 条」
    track(cat.x + hw, cat.y + hh + o.bareCountGap);
    // 枝脊：从主枝上的落点到节点盒边缘，不能超出包围盒
    track(cat.limbPoint.x, cat.limbPoint.y);
  }
  // 分类标签（带底色胶囊；字号 18px，textWidth 以 13.5px 为基准，需按比例换算）
  for (const gl of groupLabels) {
    const lw = textWidth(gl.tag) * (18 / 13.5) + 30;
    track(gl.x - lw / 2, gl.y - 17);
    track(gl.x + lw / 2, gl.y + 17);
  }
  if (!isFinite(minX)) { minX = -o.rCat; maxX = o.rCat; minY = -trunkH - o.rCat; maxY = 0; }
  minY = Math.min(minY, apex.y - o.bareApexPad);
  maxY = Math.max(maxY, 0);
  const pad = o.labelPad;
  const bbox = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };

  const trunk = {
    h: trunkH, baseW: o.crownBareTrunkBaseW, topW: o.crownBareTrunkTopW,
    base: { x: 0, y: 0 }, apex: { x: 0, y: -trunkH },
    bark: Array.from({ length: o.barkLines }, (_, i) => {
      const t = o.barkLines === 1 ? 0 : (i / (o.barkLines - 1)) * 2 - 1;
      return { offset: t * (o.trunkBaseW * 0.26), scale: 1 - Math.abs(t) * 0.25 };
    })
  };

  return {
    mode: "crown-bare",
    categories, sources, leaves: [], limbs: sk.limbs, trunk, bbox, groupLabels,
    crownR: maxR, trunkH, apex, base: { x: 0, y: 0 },
    totalLeaves: 0, avgLeafW: 0, stretch: 1, params: o
  };
}

/** 树冠模式的完整布局（对外结构与扇形模式保持一致，便于渲染器复用） */
function layoutTreeCrown(entries, o) {
  const empty = {
    mode: "crown",
    categories: [], sources: [], leaves: [], limbs: [], trunk: null,
    bbox: { minX: -1, maxX: 1, minY: -1, maxY: 0 },
    crownR: 0, trunkH: 0, apex: { x: 0, y: 0 }, base: { x: 0, y: 0 },
    totalLeaves: 0, avgLeafW: 0, stretch: 1, params: o
  };
  if (!Array.isArray(entries) || !entries.length) return empty;
  const sk = buildCrownSkeleton(entries, o);
  if (!sk) return empty;

  // 树干高度与树冠尺寸协调（树干是最高视觉权重，不能是几十像素的横杆）
  let maxR = 0;
  for (const nd of sk.nodes) maxR = Math.max(maxR, Math.hypot(nd.x, nd.y));
  for (const c of sk.clusters) {
    maxR = Math.max(maxR, Math.hypot(c.cx + c.W / 2, c.cy), Math.hypot(c.cx - c.W / 2, c.cy));
  }
  const trunkH = Math.round(clamp(o.crownTrunkRatio * maxR, o.crownTrunkMin, o.crownTrunkMax));

  // 平移到最终坐标：树根在 (0,0)，apex 在 (0,-trunkH)
  for (const lb of sk.limbs) { lb.p0.y -= trunkH; lb.p1.y -= trunkH; lb.p2.y -= trunkH; }
  for (const nd of sk.nodes) nd.y -= trunkH;
  for (const c of sk.clusters) c.cy -= trunkH;

  const apex = { x: 0, y: -trunkH };
  const categories = [];
  const sources = [];
  const leaves = [];

  sk.nodes.forEach((nd, i) => {
    const c = sk.clusters[i];
    // 来源节点 → 自己叶片簇的最近点：连线一定接在簇上（不会再悬空）
    const bx = clamp(nd.x, c.cx - c.W / 2, c.cx + c.W / 2);
    const by = clamp(nd.y, c.cy - c.H / 2, c.cy + c.H / 2);
    const step = o.pillH + o.leafGapV;
    for (let ri = 0; ri < c.cl.rows.length; ri++) {
      const y = c.cy - c.cl.H / 2 + (ri + 0.5) * step;
      let lx = c.cx - c.cl.widths[ri] / 2;
      for (const cell of c.cl.rows[ri]) {
        leaves.push({
          id: cell.item.id, item: cell.item, w: cell.w, h: o.pillH,
          x: lx + cell.w / 2, y, ci: i, si: 0, sourceName: nd.name
        });
        lx += cell.w + o.leafGap;
      }
    }
    const catRec = {
      key: nd.key, name: nd.name, color: nd.color, count: nd.count, limb: nd.li,
      node: { x: nd.x, y: nd.y }, x: nd.x, y: nd.y,
      a0: 0, a1: 0, mid: 0, u0: 0, u1: 0, frac: 0, sources: []
    };
    const srcRec = {
      name: nd.name, count: nd.count, ci: i, si: 0, limb: nd.li,
      node: { x: nd.x, y: nd.y }, x: nd.x, y: nd.y,
      clusterBase: { x: bx, y: by }, clusterW: c.W, clusterH: c.H,
      spine: { x1: nd.x, y1: nd.y, x2: bx, y2: by },
      catNode: { x: nd.x, y: nd.y }
    };
    catRec.sources.push(srcRec);
    categories.push(catRec);
    sources.push(srcRec);
  });

  // 包围盒
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of leaves) {
    if (l.x - l.w / 2 < minX) minX = l.x - l.w / 2;
    if (l.x + l.w / 2 > maxX) maxX = l.x + l.w / 2;
    if (l.y - l.h / 2 < minY) minY = l.y - l.h / 2;
    if (l.y + l.h / 2 > maxY) maxY = l.y + l.h / 2;
  }
  for (const nd of sk.nodes) {
    if (nd.x - 80 < minX) minX = nd.x - 80;
    if (nd.x + 80 > maxX) maxX = nd.x + 80;
    if (nd.y - 24 < minY) minY = nd.y - 24;
    if (nd.y + 40 > maxY) maxY = nd.y + 40;
  }
  if (!isFinite(minX)) { minX = -o.rCat; maxX = o.rCat; minY = -trunkH - o.rCat; maxY = 0; }
  minY = Math.min(minY, apex.y - 40);
  maxY = Math.max(maxY, 0);
  const pad = o.labelPad;
  const bbox = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };

  const trunk = {
    h: trunkH, baseW: o.crownTrunkBaseW, topW: o.crownTrunkTopW,
    base: { x: 0, y: 0 }, apex: { x: 0, y: -trunkH },
    bark: Array.from({ length: o.barkLines }, (_, i) => {
      const t = o.barkLines === 1 ? 0 : (i / (o.barkLines - 1)) * 2 - 1;
      return { offset: t * (o.trunkBaseW * 0.26), scale: 1 - Math.abs(t) * 0.25 };
    })
  };

  return {
    mode: "crown",
    categories, sources, leaves, limbs: sk.limbs, trunk, bbox,
    crownR: maxR, trunkH, apex, base: { x: 0, y: 0 },
    totalLeaves: leaves.length,
    avgLeafW: leaves.length ? leaves.reduce((s, l) => s + l.w, 0) / leaves.length : 0,
    stretch: 1, params: o
  };
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
    h: trunkH, baseW: o.crownTrunkBaseW, topW: o.crownTrunkTopW,
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
function layoutTreeFan(cats, opts = {}) {
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

/**
 * 布局入口（纯函数，确定性）
 * @param {Array} entries 树模型（一级 = 主枝，二级 = 分枝）
 * @param {Object} opts 覆盖 LAYOUT_DEFAULTS；opts.mode 决定几何模式：
 *   crown（默认）树冠模式 —— 首页新闻源树：少量粗主枝 + 来源节点分布在主枝上
 *   crown-bare   树冠模式·无叶片 —— 首页分阶段披露：只有主枝 + 来源节点，新闻点进来源才出现
 *   fan          扇形模式 —— 来源独立树：单个来源在扇面内展开多条分枝
 *
 * opts.skipLeaves 为 true 时，即使 mode=crown 也走 crown-bare（避免调用方漏改两处）。
 */
export function layoutTree(entries, opts = {}) {
  const o = { ...LAYOUT_DEFAULTS, ...(opts || {}) };
  const bare = o.skipLeaves ? true : o.mode === "crown-bare";
  if (bare) return layoutTreeCrownBare(entries, o);
  return o.mode === "crown" ? layoutTreeCrown(entries, o) : layoutTreeFan(entries, o);
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
