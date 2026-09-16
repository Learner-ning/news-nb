// tree-layout.js 单元测试（node:test，无第三方依赖）
// 运行：node --test test/tree-layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const L = await import(pathToFileURL("D:/wr new/新闻树/public/js/tree-layout.js").href);
const { layoutTree, computeFit, leafWidth, truncateByWidth, allocateFractions, lodLevel, LAYOUT_DEFAULTS } = L;

// ---- 造数据（确定性） ----
function mkItem(title, heat = 0.4) {
  return { id: "id-" + title, title, heatScore: heat, source: "S", tag: "T" };
}
function mkCat(key, counts, heat = 0.4) {
  // counts: [来源1条目数, 来源2条目数, ...]
  const sources = counts.map((n, si) => ({
    name: `${key}-源${si + 1}`,
    items: Array.from({ length: n }, (_, i) => mkItem(`${key}新闻标题第${i + 1}条：关于某件事的报道`, heat))
  }));
  return { key, name: key, color: "#888", count: counts.reduce((a, b) => a + b, 0), sources };
}
function stable(g) {
  // 只取数值几何，做逐字段确定性比较
  return JSON.stringify({
    bbox: g.bbox, trunkH: g.trunkH, crownR: g.crownR, stretch: g.stretch,
    cats: g.categories.map((c) => [c.key, c.x, c.y, c.a0, c.a1, c.u0, c.u1]),
    srcs: g.sources.map((s) => [s.name, s.x, s.y, s.meanU]),
    leaves: g.leaves.map((l) => [l.id, l.x, l.y, l.w, l.h])
  });
}
const finite = (g) =>
  [g.bbox.minX, g.bbox.maxX, g.bbox.minY, g.bbox.maxY, g.trunkH, g.crownR, g.stretch].every(Number.isFinite) &&
  g.leaves.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.w) && Number.isFinite(l.h)) &&
  g.categories.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)) &&
  g.sources.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y));

test("1. 同一数据运行两次：输出完全一致", () => {
  const cats = [mkCat("科技", [15, 15, 14]), mkCat("财经", [15, 15]), mkCat("国内", [15, 15, 15, 15])];
  const a = layoutTree(cats);
  const b = layoutTree(cats);
  assert.equal(stable(a), stable(b));
  assert.equal(a.leaves.length, b.leaves.length);
});

test("1b. 输入数组顺序相同但对象重建：仍完全一致", () => {
  const build = () => [mkCat("科技", [15, 14]), mkCat("国内", [15, 15, 15])];
  const a = layoutTree(build());
  const b = layoutTree(build());
  assert.equal(stable(a), stable(b));
});

test("2. 空数据：不崩溃", () => {
  for (const input of [[], null, undefined, [{ key: "空", name: "空", color: "#888", sources: [] }]]) {
    const g = layoutTree(input);
    assert.equal(g.leaves.length, 0);
    assert.ok(Number.isFinite(g.bbox.minX) && Number.isFinite(g.bbox.maxY));
    assert.equal(g.trunk, null);
  }
});

test("3. 单分类：正常出树，且字号 >= 9px", () => {
  const cats = [mkCat("科技", [15, 15, 15, 15, 15, 4])];
  const g = layoutTree(cats);
  assert.equal(g.leaves.length, 79);
  assert.ok(g.trunk && g.trunk.h > 0, "有树干");
  assert.equal(g.categories.length, 1);
  assert.equal(g.sources.length, 6);
  assert.ok(finite(g));
  const f = computeFit(g.bbox, 1440, 784, LAYOUT_DEFAULTS);
  assert.ok(13 * f.s >= 9, `单分类字号应 >= 9px，实际 ${(13 * f.s).toFixed(2)}px`);
});

test("4. 五分类：正常出树", () => {
  const cats = [mkCat("科技", [15, 15]), mkCat("体育", [15]), mkCat("国内", [15, 15, 15]), mkCat("影视", [15]), mkCat("财经", [15, 15])];
  const g = layoutTree(cats);
  assert.equal(g.categories.length, 5);
  assert.equal(g.leaves.length, 15 * 9);
  assert.ok(finite(g));
  const f = computeFit(g.bbox, 1440, 784, LAYOUT_DEFAULTS);
  assert.ok(13 * f.s >= 6, `桌面字号应 >= 6px，实际 ${(13 * f.s).toFixed(2)}px`);
});

test("5. 200+ 条：不出现 NaN / Infinity", () => {
  const cats = [mkCat("科技", [15, 15, 15, 15, 15, 14]), mkCat("财经", [15, 15]), mkCat("国内", [15, 15, 15, 15, 15, 15, 10]), mkCat("影视", [15])];
  const g = layoutTree(cats);
  assert.ok(g.leaves.length >= 200, `应有 200+ 条，实际 ${g.leaves.length}`);
  assert.ok(finite(g), "不得出现 NaN / Infinity");
  const s = JSON.stringify(g);
  assert.ok(!s.includes("null,"), "序列化中不应出现 null 几何");
});

test("6. 分类条目极不均衡：不允许一个分类吃掉整个画布", () => {
  const cats = [mkCat("巨头", [15, 15, 15, 15, 15, 15, 15, 15]), mkCat("小微", [3]), mkCat("极小", [1])];
  const g = layoutTree(cats);
  const total = g.leaves.length;
  const widest = Math.max(...g.categories.map((c) => (c.u1 - c.u0) / 2));
  assert.ok(widest <= 0.56, `单分类横向份额应 <= 0.56（上限 0.55），实际 ${widest.toFixed(3)}`);
  const shares = g.categories.map((c) => (c.u1 - c.u0) / 2);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-6, "份额之和应为 1");
  assert.ok(finite(g));
  // 最小分类也必须拿到可见份额
  assert.ok(Math.min(...shares) > 0.02, `最小分类份额应 > 0.02，实际 ${Math.min(...shares).toFixed(3)}`);
  assert.equal(total, 120 + 3 + 1);
});

test("7. 确定性：无 Math.random（源码静态检查）", () => {
  const raw = readFileSync("D:/wr new/新闻树/public/js/tree-layout.js", "utf8");
  // 去掉注释后再检查，避免注释里提到 Math.random 被误判
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^"\n]*$/gm, "");
  assert.ok(!/Math\.random/.test(code), "布局源码不得出现 Math.random");
  assert.ok(!/Date\.now|new Date\(/.test(code), "布局不应依赖当前时间");
});

test("8. 四层结构齐备（树干 / 主枝 / 分枝 / 叶片）", () => {
  const cats = [mkCat("科技", [15, 15]), mkCat("国内", [15, 15, 15])];
  const g = layoutTree(cats);
  assert.ok(g.trunk && g.trunk.h > 0, "树干");
  assert.equal(g.categories.length, 2, "主枝");
  assert.equal(g.sources.length, 5, "分枝");
  assert.equal(g.leaves.length, 75, "叶片");
  // 层级位置关系：树干顶端(apex) 在 主枝节点 与 叶片 之下
  assert.ok(g.apex.y >= g.categories[0].y, "apex 应在主枝节点下方");
  assert.ok(g.categories[0].y >= g.leaves[0].y, "主枝节点应在叶片下方");
  // 树干高度与树冠尺寸协调（不是几十像素的横杆）
  assert.ok(g.trunk.h >= 120, `树干高度应 >= 120，实际 ${g.trunk.h}`);
  assert.ok(g.trunk.h / g.crownR > 0.08, "树干高度与树冠半径应协调");
});

test("9. 叶片不重叠（同数据下逐对检测水平/垂直冲突）", () => {
  const cats = [mkCat("科技", [15, 15]), mkCat("国内", [15, 15, 15])];
  const g = layoutTree(cats);
  let overlaps = 0;
  const ls = g.leaves;
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < (a.w + b.w) / 2 - 0.5 && dy < (a.h + b.h) / 2 - 0.5) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `叶片重叠对数应为 0，实际 ${overlaps}`);
});

test("10. 叶片宽度与截断：沿用 textWidth，不出现旧算法", () => {
  const src = readFileSync("D:/wr new/新闻树/public/js/tree-layout.js", "utf8");
  assert.ok(!/len \* 2\.8/.test(src), "不得恢复字符数×2.8 旧算法");
  assert.ok(/textWidth/.test(src), "必须使用 textWidth");
  const item = { title: "苹果 iOS 27 正式版更新汇总：60 项升级，系统 / 功能 / 安全全面调整", heatScore: 0.5 };
  const w = leafWidth(item);
  assert.ok(w >= LAYOUT_DEFAULTS.leafMinW && w <= LAYOUT_DEFAULTS.leafMaxW, `宽度应在 [${LAYOUT_DEFAULTS.leafMinW}, ${LAYOUT_DEFAULTS.leafMaxW}]，实际 ${w}`);
  const t = truncateByWidth(item.title, w);
  assert.ok(!/<[^>]*$/.test(t), "不得出现半截 HTML 标签");
  assert.ok(!/[\u4e00-\u9fa5]$/.test(t.replace("…", "")) || t.length <= item.title.length, "截断不应超长");
  // 极端超宽标题也必须被夹到上限
  const long = { title: "超长标题".repeat(80), heatScore: 1 };
  assert.equal(leafWidth(long), LAYOUT_DEFAULTS.leafMaxW);
  // 含 HTML 的标题被清洗
  assert.ok(!/<p/.test(truncateByWidth("<p>正文标题</p>", 200)));
});

test("11. 份额分配：上下限生效且归一化", () => {
  const f = allocateFractions([1000, 1], 0.06, 0.55);
  assert.ok(Math.abs(f.reduce((a, b) => a + b, 0) - 1) < 1e-9, "份额之和应为 1");
  assert.ok(f[0] <= 0.55 + 1e-9, "最大份额应受上限约束");
  assert.ok(f[1] >= 0.06 - 1e-9, "最小份额应受下限约束");
  const f2 = allocateFractions([10, 10, 10, 10], 0.06, 0.55);
  f2.forEach((v) => assert.ok(Math.abs(v - 0.25) < 1e-9, "等量分类应均分"));
});

test("12. computeFit：可读性优先（整树入镜不可读时保持可读缩放）", () => {
  const tiny = { minX: -100, maxX: 100, minY: -100, maxY: 0 };
  const f1 = computeFit(tiny, 1440, 784, LAYOUT_DEFAULTS);
  assert.equal(f1.mode, "fit-all");
  const huge = { minX: -9000, maxX: 9000, minY: -6000, maxY: 0 };
  const f2 = computeFit(huge, 1440, 784, LAYOUT_DEFAULTS);
  assert.equal(f2.mode, "readable-focus");
  assert.ok(13 * f2.s >= 6, `聚焦模式字号也必须 >= 6px，实际 ${(13 * f2.s).toFixed(2)}px`);
});

test("13. LOD 分级：稳定、单调、确定", () => {
  assert.equal(lodLevel(1.0), 0);
  assert.equal(lodLevel(0.5), 0);
  assert.equal(lodLevel(0.41), 1);
  assert.equal(lodLevel(0.3), 1);
  assert.equal(lodLevel(0.2), 2);
  assert.equal(lodLevel(0.05), 2);
  // 同一输入多次调用结果一致
  assert.equal(lodLevel(0.42), lodLevel(0.42));
});

test("14. 性能：200+ 条 layout 耗时可接受", () => {
  const cats = [mkCat("科技", [15, 15, 15, 15, 15, 14]), mkCat("财经", [15, 15]), mkCat("国内", [15, 15, 15, 15, 15, 15, 10]), mkCat("影视", [15])];
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) layoutTree(cats);
  const avg = (performance.now() - t0) / 5;
  assert.ok(avg < 250, `单次 layout 平均应 < 250ms，实际 ${avg.toFixed(1)}ms`);
});
