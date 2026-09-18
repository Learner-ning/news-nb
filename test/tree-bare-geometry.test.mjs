// 首页「无叶片」树冠几何自检（Stage 3.3）
//
// 目的：首页只显示新闻源骨架，因此几何必须满足：
//   ① 不生成任何叶片（leaves === 0）
//   ② 来源节点不重叠（这是 3.2.1 的可视性问题，必须在几何层保证，而不是靠截图肉眼判断）
//   ③ 节点分布是「挂在主枝上」而不是「钉在同一个圆上」——节点到中心的距离必须有明显离散度
//   ④ 包围盒由骨架决定，不能残留叶片簇 AABB 外推（否则 fit 会把树缩成一小团）
//   ⑤ 确定性：同输入同输出
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutTree, LAYOUT_DEFAULTS } from "../public/js/tree-layout.js";
import { buildSourceModel } from "../public/js/news-store.js";

const OPTS = { ...LAYOUT_DEFAULTS, mode: "crown-bare", skipLeaves: true };

/** 构造 n 个来源、每个 m 条新闻的树模型（确定性，无随机） */
function model(n, m = 14) {
  const items = [];
  const tags = ["科技", "财经", "社会", "体育", "娱乐", "国际"];
  for (let i = 0; i < n; i++) {
    const name = `来源${String(i).padStart(2, "0")}`;
    for (let j = 0; j < m; j++) {
      items.push({
        id: `${name}-${j}`,
        title: `第${j}条新闻标题用于宽度估算`,
        source: name,
        tag: tags[i % tags.length],
        heatScore: 0.3 + ((i * 7 + j * 3) % 70) / 100,
        time: 1700000000000 + i * 1000 + j
      });
    }
  }
  return buildSourceModel(items);
}

/** 节点盒（与 layoutTreeCrownBare 内部 boxOf 保持一致的口径） */
function nodeBox(cat) {
  return { x: cat.x, y: cat.y, w: cat.w, h: cat.h };
}

function overlaps(a, b, gx = 0, gy = 0) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gx
    && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gy;
}

test("无叶片模式：不生成任何叶片几何", () => {
  for (const n of [1, 2, 6, 12, 16, 25]) {
    const g = layoutTree(model(n), OPTS);
    assert.equal(g.leaves.length, 0, `${n} 个来源时不应生成叶片`);
    assert.equal(g.totalLeaves, 0);
    assert.equal(g.mode, "crown-bare");
  }
});

test("无叶片模式：来源节点数量与输入一致", () => {
  for (const n of [1, 3, 7, 16]) {
    const g = layoutTree(model(n), OPTS);
    assert.equal(g.categories.length, n, `${n} 个来源应产出 ${n} 个节点`);
    const keys = g.categories.map((c) => c.key);
    assert.equal(new Set(keys).size, n, "节点 key 不应重复");
  }
});

test("无叶片模式：来源节点互不重叠（矩形盒不相交）", () => {
  for (const n of [2, 5, 9, 12, 16, 22]) {
    const g = layoutTree(model(n), OPTS);
    const boxes = g.categories.map(nodeBox);
    const bad = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        // 留 2px 容差：relax 是迭代收敛，可能停在 1px 内的临界状态
        if (overlaps(boxes[i], boxes[j], -2, -2)) {
          bad.push(`${g.categories[i].name} ↔ ${g.categories[j].name}`);
        }
      }
    }
    assert.equal(bad.length, 0, `${n} 个来源存在重叠：${bad.join(", ")}`);
  }
});

test("无叶片模式：节点沿主枝分散（到中心距离有离散度，不是同一个圆）", () => {
  // Stage 3.2.1 §24：不能把「新闻源是一级节点」做成「从中心拉出 16 根线」
  for (const n of [6, 12, 16]) {
    const g = layoutTree(model(n), OPTS);
    const radii = g.categories.map((c) => Math.hypot(c.x, c.y - g.trunkH));
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    const spreadRatio = max / Math.max(1, min);
    assert.ok(
      spreadRatio > 1.25,
      `${n} 个来源时半径分布过于集中（max/min=${spreadRatio.toFixed(3)}），
       说明节点被钉在同一个圆上而不是分布在主枝上`
    );
  }
});

test("无叶片模式：枝脊短且方向明确（不斜穿、不悬空）", () => {
  // 口径说明：节点盒的 x 被锁在「保留列」上（这是水平永不重叠的保证），
  // 因此不能要求节点盒中心正好落在主枝曲线上 —— 那和「一列一节点」互斥。
  //
  // 统一判据（对侧枝与中央主干都成立）：**至少一个分量极小**，
  // 即枝脊总有一个明确方向（侧枝→近竖直，中央干→近水平），不会斜穿节点。
  // 同时枝脊长度必须小于「节点宽 + 该列到中心的距离」，
  // 因为中央主干的节点天然要横向伸出一段才能挂到两侧的列上。
  for (const n of [2, 4, 6, 12, 16, 22]) {
    const g = layoutTree(model(n), OPTS);
    for (const c of g.categories) {
      const dx = Math.abs(c.limbPoint.x - c.x);
      const dy = Math.abs(c.limbPoint.y - c.y);
      const spine = Math.hypot(dx, dy);
      // ① 方向明确：有一个分量接近 0
      const minComp = Math.min(dx, dy);
      assert.ok(
        minComp < 3,
        `${n} 个来源：节点「${c.name}」枝脊斜穿（dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}），应有 dx≈0 或 dy≈0`
      );
      // ② 长度受限：竖直枝脊（中央干）的横向跨度不应超过节点自身宽度的两倍
      //    —— 超过就说明节点被扔到了远离主干的列上
      if (dx > 3) {
        assert.ok(
          dx < c.w * 2,
          `${n} 个来源：节点「${c.name}」横向偏离主干 ${dx.toFixed(1)}px，超过 ${(c.w * 2).toFixed(1)}px`
        );
      }
      if (dy > 3) {
        assert.ok(
          dy < c.w * 2,
          `${n} 个来源：节点「${c.name}」纵向偏离主枝 ${dy.toFixed(1)}px，超过 ${(c.w * 2).toFixed(1)}px`
        );
      }
      assert.ok(spine < c.w * 3, `${n} 个来源：节点「${c.name}」枝脊 ${spine.toFixed(1)}px 过长`);
    }
  }
});

test("无叶片模式：枝脊落点确实落在自己那根主枝的曲线上", () => {
  for (const n of [2, 6, 16, 22]) {
    const g = layoutTree(model(n), OPTS);
    for (const c of g.categories) {
      const lb = g.limbs[c.limb];
      assert.ok(lb, `节点「${c.name}」引用了不存在的主枝 ${c.limb}`);
      // 在曲线上采样，落点应与其重合（容差 3px：曲线采样是离散的）
      let best = Infinity;
      for (let i = 0; i <= 400; i++) {
        const t = i / 400;
        const p = {
          x: (1 - t) * (1 - t) * lb.p0.x + 2 * (1 - t) * t * lb.p1.x + t * t * lb.p2.x,
          y: (1 - t) * (1 - t) * lb.p0.y + 2 * (1 - t) * t * lb.p1.y + t * t * lb.p2.y
        };
        best = Math.min(best, Math.hypot(p.x - c.limbPoint.x, p.y - c.limbPoint.y));
      }
      assert.ok(best < 3, `节点「${c.name}」的枝脊落点偏离主枝 ${best.toFixed(2)}px`);
    }
  }
});

test("无叶片模式：节点×主枝的归属是「连续区间」（同枝节点横向相邻）", () => {
  // 这保证视觉上「一根枝上依次挂着几个来源」，而不是把来源打散到随机位置
  const g = layoutTree(model(16), OPTS);
  const spans = [];
  for (const lb of g.limbs) {
    const xs = g.categories.filter((c) => c.limb === lb.li).map((c) => c.x).sort((a, b) => a - b);
    if (xs.length) spans.push({ li: lb.li, min: xs[0], max: xs[xs.length - 1], n: xs.length });
  }
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i], b = spans[j];
      const disjoint = a.max < b.min || b.max < a.min;
      assert.ok(disjoint, `主枝 ${a.li} 与 ${b.li} 的节点横向区间重叠（分组被打散）`);
    }
  }
});

test("无叶片模式：包围盒不含叶片簇外推（宽高比与面积都在合理范围）", () => {
  const g = layoutTree(model(16), OPTS);
  const w = g.bbox.maxX - g.bbox.minX;
  const h = g.bbox.maxY - g.bbox.minY;
  assert.ok(w > 0 && h > 0);
  // 有叶片时 16 个来源簇会把包围盒撑到 4000px 以上；无叶片骨架应远小于此
  assert.ok(w < 4200 && h < 3200, `包围盒过大：${w.toFixed(0)}×${h.toFixed(0)}，疑似残留叶片簇外推`);
  // 每个节点都必须在包围盒内（含标签溢出空间）
  for (const c of g.categories) {
    assert.ok(c.x - c.w / 2 >= g.bbox.minX - 1, `${c.name} 左侧超出包围盒`);
    assert.ok(c.x + c.w / 2 <= g.bbox.maxX + 1, `${c.name} 右侧超出包围盒`);
    assert.ok(c.y - c.h / 2 >= g.bbox.minY - 1, `${c.name} 上方超出包围盒`);
    assert.ok(c.y + c.h / 2 <= g.bbox.maxY + 1, `${c.name} 下方超出包围盒`);
  }
});

test("无叶片模式：主干在底部、apex 在顶部（树是站着的）", () => {
  const g = layoutTree(model(16), OPTS);
  assert.equal(g.base.y, 0);
  assert.ok(g.trunkH > 0, "树干高度应为正");
  assert.equal(g.apex.y, -g.trunkH);
  // 所有主枝末端都应在 apex 上方（-y 方向）
  for (const lb of g.limbs) {
    assert.ok(lb.p2.y < 0, "主枝末端应在树根上方");
  }
  // 节点整体重心应在树干顶端之上（长在树冠里）
  const cy = g.categories.reduce((s, c) => s + c.y, 0) / g.categories.length;
  assert.ok(cy < -g.trunkH * 0.5, `节点重心 y=${cy.toFixed(1)} 过低，树冠没有抬起来`);
});

test("无叶片模式：确定性（同数据同参数 → 逐字段一致）", () => {
  const m = model(16);
  const a = layoutTree(m, OPTS);
  const b = layoutTree(m, OPTS);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("无叶片模式：skipLeaves 与 mode=crown-bare 等价（调用方漏改一处也能生效）", () => {
  const m = model(12);
  const a = layoutTree(m, { ...LAYOUT_DEFAULTS, mode: "crown-bare" });
  const b = layoutTree(m, { ...LAYOUT_DEFAULTS, mode: "crown", skipLeaves: true });
  assert.equal(a.leaves.length, 0);
  assert.equal(b.leaves.length, 0);
  assert.deepEqual(
    a.categories.map((c) => [c.key, c.x, c.y]),
    b.categories.map((c) => [c.key, c.x, c.y])
  );
});

test("无叶片模式：单来源退化为「一根主枝 + 一个节点」，不报错", () => {
  const g = layoutTree(model(1), OPTS);
  assert.equal(g.categories.length, 1);
  assert.equal(g.limbs.length, 1);
  assert.ok(Number.isFinite(g.categories[0].x));
  assert.ok(Number.isFinite(g.categories[0].y));
  assert.ok(Number.isFinite(g.trunkH));
});

test("无叶片模式：空输入返回空骨架，不抛异常", () => {
  for (const bad of [[], null, undefined]) {
    const g = layoutTree(bad, OPTS);
    assert.equal(g.categories.length, 0);
    assert.equal(g.leaves.length, 0);
    assert.ok(g.bbox);
  }
});

test("无叶片模式：来源页仍照常生成叶片（不能误伤 fan 模式）", () => {
  const g = layoutTree(model(1), { ...LAYOUT_DEFAULTS, mode: "fan" });
  assert.ok(g.leaves.length > 0, "来源页（fan）必须仍然有叶片");
});

test("无叶片模式：有叶片模式不受影响（回归）", () => {
  const g = layoutTree(model(16), { ...LAYOUT_DEFAULTS, mode: "crown" });
  assert.ok(g.leaves.length > 0, "crown（有叶片）必须仍然有叶片");
  assert.equal(g.mode, "crown");
});

// ============ Stage 3.4 §2：不同新闻分类对应不同主枝 ============

test("分类分组：一根主枝只挂一个分类（不混分类）", () => {
  for (const n of [2, 4, 6, 12, 16, 22, 30]) {
    const g = layoutTree(model(n), OPTS);
    const byLimb = new Map();
    for (const c of g.categories) {
      if (!byLimb.has(c.limb)) byLimb.set(c.limb, new Set());
      byLimb.get(c.limb).add(c.tag);
    }
    const mixed = [...byLimb.entries()].filter(([, s]) => s.size > 1);
    assert.equal(
      mixed.length, 0,
      `${n} 个来源时主枝混分类：${mixed.map(([li, s]) => `枝#${li}=[${[...s].join("/")}]`).join(", ")}`
    );
    // 每条主枝都必须带上它所属分类（渲染器据此画分类标签）
    for (const lb of g.limbs) {
      assert.ok(lb.tag, `主枝 ${lb.li} 缺少 tag`);
      assert.ok(lb.color, `主枝 ${lb.li} 缺少 color`);
    }
  }
});

test("分类分组：同一分类的来源占据连续的横向区间（不与其他分类交错）", () => {
  for (const n of [6, 12, 16, 22]) {
    const g = layoutTree(model(n), OPTS);
    const spans = new Map();
    for (const c of g.categories) {
      const s = spans.get(c.tag) || { min: Infinity, max: -Infinity };
      s.min = Math.min(s.min, c.x - c.w / 2);
      s.max = Math.max(s.max, c.x + c.w / 2);
      spans.set(c.tag, s);
    }
    const list = [...spans.entries()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [ta, a] = list[i], [tb, b] = list[j];
        const disjoint = a.max <= b.min + 1 || b.max <= a.min + 1;
        assert.ok(
          disjoint,
          `${n} 个来源时分类「${ta}」与「${tb}」的横向区间交错（分类没有占据连续区间）`
        );
      }
    }
  }
});

test("分类分组：节点标签 tag 与输入一致", () => {
  const m = model(12);
  const g = layoutTree(m, OPTS);
  const want = new Map(m.map((x) => [x.key, x.tag]));
  for (const c of g.categories) {
    assert.equal(c.tag, want.get(c.key), `节点「${c.name}」的 tag 与输入不一致`);
  }
});
