// Stage 3.2.1 树几何测试：首页树冠模式（crown）与来源扇形模式（fan）
// 运行：node --test test/tree-geometry-stage3.2.1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = "D:/wr new/新闻树";
const L = await import(pathToFileURL(ROOT + "/public/js/tree-layout.js").href);
const S = await import(pathToFileURL(ROOT + "/public/js/news-store.js").href);
const R = await import(pathToFileURL(ROOT + "/public/js/routes.js").href);
const read = (p) => readFileSync(ROOT + p, "utf8");

// ---- 复刻真实规模：16 个来源 / 225 条（14 个 15 条 + 2 个 ~8 条）----
const NAMES = ["爱范儿", "百度贴吧", "触乐", "抖音", "华尔街见闻", "今日头条", "澎湃", "腾讯新闻",
  "微博", "雪球话题", "GitHub热榜", "IT之家", "Solidot", "哔哩哔哩", "量子位", "少数派"];
const TAGS = ["科技", "国内", "影视", "国内", "财经", "国内", "国内", "国内", "国内", "财经", "科技", "科技", "科技", "国内", "科技", "科技"];
function fixture() {
  const items = [];
  NAMES.forEach((name, si) => {
    const n = si < 13 ? 15 : (si === 13 ? 12 : 9);
    for (let i = 0; i < n; i++) {
      items.push({
        id: `${name}-${i}`, kind: si >= 8 && si <= 13 ? "hot" : "news", type: "news",
        source: name, platform: name, tag: TAGS[si], category: TAGS[si],
        title: `${name} 的第 ${i + 1} 条新闻标题，关于某件事的报道`,
        url: `https://example.com/${si}/${i}`, summary: "摘要",
        time: new Date(Date.UTC(2026, 8, 17, 10, i)).toISOString(),
        publishedAt: si >= 8 && si <= 13 ? null : new Date(Date.UTC(2026, 8, 17, 10, i)).toISOString(),
        hasRealTime: !(si >= 8 && si <= 13),
        heatScore: 0.9 - i * 0.02
      });
    }
  });
  return items;
}
const ITEMS = fixture();
const HOME = S.buildSourceModel(ITEMS);
const G = L.layoutTree(HOME, { ...L.LAYOUT_DEFAULTS, mode: "crown" });

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const bboxOf = (g) => ({ w: g.bbox.maxX - g.bbox.minX, h: g.bbox.maxY - g.bbox.minY });

// ============ 1. 16 个 source 节点存在 ============
test("1. 16 个新闻源节点全部存在，且各自带名称与条数", () => {
  assert.equal(G.categories.length, 16, "一级节点 = 16 个新闻源");
  assert.equal(G.sources.length, 16);
  const keys = G.categories.map((c) => c.key).sort();
  assert.deepEqual(keys, [...NAMES].sort(), "来源名必须与数据一致");
  assert.ok(G.categories.every((c) => c.count > 0 && c.name), "每个节点都有名称与条数");
  assert.ok(G.leaves.length === ITEMS.length, "叶片 = 全部新闻");
});

// ============ 2. source 节点没有重叠 ============
test("2. 新闻源节点之间没有重叠", () => {
  let hit = 0;
  for (let i = 0; i < G.categories.length; i++) {
    for (let j = i + 1; j < G.categories.length; j++) {
      const a = G.categories[i], b = G.categories[j];
      // 节点胶囊约 130×46（含条数文字）
      if (Math.abs(a.x - b.x) < 130 && Math.abs(a.y - b.y) < 46) hit++;
    }
  }
  assert.equal(hit, 0, `来源节点重叠对数应为 0，实际 ${hit}`);
});

// ============ 3. source 节点不集中在 root 附近 ============
test("3. 新闻源节点不集中在 root 附近（旧版全部挤在 r=170 的圆上）", () => {
  const d = G.categories.map((c) => dist(c, G.apex));
  const min = Math.min(...d);
  assert.ok(min > 350, `最近的来源节点也应在 ${350}px 之外，实际 ${min.toFixed(0)}`);
  // 不能全部落在同一个小圆上：半径跨度必须足够大
  assert.ok(Math.max(...d) - min > 500, `半径跨度应 > 500px，实际 ${(Math.max(...d) - min).toFixed(0)}`);
  // 也不能全部挤在同一个半径（同心环）
  const rounded = new Set(d.map((v) => Math.round(v / 100)));
  assert.ok(rounded.size >= 4, `半径应分散在至少 4 个区间，实际 ${rounded.size}`);
});

// ============ 4. source 节点与 root 距离处于合理范围 ============
test("4. 新闻源节点与 root 的距离处于合理范围（不贴边也不聚心）", () => {
  const b = bboxOf(G);
  const halfDiag = Math.hypot(b.w / 2, b.h / 2);
  for (const c of G.categories) {
    const d = dist(c, G.apex);
    assert.ok(d < halfDiag * 1.05, `${c.name} 距 root ${d.toFixed(0)} 不应超过包围盒半对角 ${halfDiag.toFixed(0)}`);
  }
  const d = G.categories.map((c) => dist(c, G.apex));
  const avg = d.reduce((a, b2) => a + b2, 0) / d.length;
  assert.ok(avg > 500 && avg < halfDiag, `平均距离 ${avg.toFixed(0)} 应在 (500, ${halfDiag.toFixed(0)})`);
});

// ============ 5. source branch 不是全部直线放射 ============
test("5. 主枝是少量弯曲粗枝，不是 16 根直线放射", () => {
  assert.ok(G.limbs && G.limbs.length >= 3, "必须有主枝结构");
  assert.ok(G.limbs.length <= 6, `主枝应「少量」，实际 ${G.limbs.length} 条`);
  // 每条主枝都是曲线（控制点不在起点—终点连线上）
  for (const lb of G.limbs) {
    const dx = lb.p2.x - lb.p0.x, dy = lb.p2.y - lb.p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const cross = Math.abs((lb.p1.x - lb.p0.x) * dy - (lb.p1.y - lb.p0.y) * dx) / len;
    assert.ok(cross > 40, `主枝必须明显弯曲（偏离直线 ${cross.toFixed(1)}px）`);
  }
  // 不允许出现「从 apex 附近射出的细长直线」：所有连接枝都必须短
  let longRay = 0;
  for (const s of G.sources) {
    const len = Math.hypot(s.spine.x2 - s.spine.x1, s.spine.y2 - s.spine.y1);
    if (dist({ x: s.spine.x1, y: s.spine.y1 }, G.apex) < 420 && len > 600) longRay++;
  }
  assert.equal(longRay, 0, `从中心射出的超长细线应为 0 条，实际 ${longRay}`);
});

// ============ 6. source 新闻聚集在对应 source 附近 ============
test("6. 每个来源的新闻聚集在它自己的来源节点附近", () => {
  const dOwn = G.leaves.map((l) => dist(l, G.categories[l.ci]));
  const avg = dOwn.reduce((a, b) => a + b, 0) / dOwn.length;
  assert.ok(avg < 700, `叶片到自己的来源节点平均距离应 < 700px，实际 ${avg.toFixed(0)}`);
  // 每个来源的叶片必须都在自己节点的合理半径内（不能跑到别的枝上）
  for (let ci = 0; ci < G.categories.length; ci++) {
    const mine = G.leaves.filter((l) => l.ci === ci);
    assert.ok(mine.length > 0, `来源 ${G.categories[ci].name} 必须有叶片`);
    const far = mine.filter((l) => dist(l, G.categories[ci]) > 1100).length;
    assert.equal(far, 0, `来源 ${G.categories[ci].name} 有 ${far} 片叶片离自己的节点过远`);
  }
});

// ============ 7. 新闻叶片没有大规模出现在包围盒边缘 ============
test("7. 新闻叶片不再大规模堆在包围盒边缘", () => {
  const b = bboxOf(G);
  const edge = G.leaves.filter((l) =>
    (l.x - l.w / 2 - G.bbox.minX) < b.w * 0.08 || (G.bbox.maxX - (l.x + l.w / 2)) < b.w * 0.08 ||
    (l.y - l.h / 2 - G.bbox.minY) < b.h * 0.08 || (G.bbox.maxY - (l.y + l.h / 2)) < b.h * 0.08
  ).length;
  const pct = edge / G.leaves.length;
  assert.ok(pct < 0.18, `边缘叶片占比应 < 18%，实际 ${(pct * 100).toFixed(0)}%`);
});

// ============ 8. 不产生超长孤立连接线 ============
test("8. 不产生超长孤立连接线（连线必须接在自己的叶片簇上）", () => {
  let maxSpine = 0;
  for (const s of G.sources) {
    maxSpine = Math.max(maxSpine, Math.hypot(s.spine.x2 - s.spine.x1, s.spine.y2 - s.spine.y1));
    // 连线末端必须落在该来源叶片簇的包围盒内（旧版悬空 477px，这里允许 12px 的簇内边距误差）
    const mine = G.leaves.filter((l) => l.ci === s.ci);
    const bx0 = Math.min(...mine.map((l) => l.x - l.w / 2));
    const bx1 = Math.max(...mine.map((l) => l.x + l.w / 2));
    const by0 = Math.min(...mine.map((l) => l.y - l.h / 2));
    const by1 = Math.max(...mine.map((l) => l.y + l.h / 2));
    const dx = Math.max(bx0 - s.spine.x2, 0, s.spine.x2 - bx1);
    const dy = Math.max(by0 - s.spine.y2, 0, s.spine.y2 - by1);
    assert.ok(Math.hypot(dx, dy) <= 12, `${s.name} 的连接线末端必须接在自己的叶片簇上（偏离 ${Math.hypot(dx, dy).toFixed(1)}px）`);
  }
  assert.ok(maxSpine < 700, `最长连接线应 < 700px，实际 ${maxSpine.toFixed(0)}`);
});

// ============ 9. 不产生新闻叶片重叠 ============
test("9. 新闻叶片之间没有重叠", () => {
  let hit = 0;
  for (let i = 0; i < G.leaves.length; i++) {
    for (let j = i + 1; j < G.leaves.length; j++) {
      const a = G.leaves[i], b = G.leaves[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.5) hit++;
    }
  }
  assert.equal(hit, 0, `叶片重叠对数应为 0，实际 ${hit}`);
});

// ============ 10. deterministic ============
test("10. 确定性：同数据两次布局完全一致，且无 Math.random", () => {
  const a = L.layoutTree(HOME, { ...L.LAYOUT_DEFAULTS, mode: "crown" });
  const b = L.layoutTree(HOME, { ...L.LAYOUT_DEFAULTS, mode: "crown" });
  const pick = (g) => JSON.stringify({
    bbox: g.bbox,
    nodes: g.categories.map((c) => [c.key, c.x, c.y]),
    leaves: g.leaves.map((l) => [l.id, l.x, l.y, l.w])
  });
  assert.equal(pick(a), pick(b));
  const src = read("/public/js/tree-layout.js");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^"\n]*$/gm, "");
  assert.ok(!/Math\.random/.test(code), "布局引擎不得使用 Math.random");
});

// ============ 11. 首页所有新闻仍然存在 ============
test("11. 首页所有新闻仍然存在（一条不少、一条不重）", () => {
  assert.equal(G.leaves.length, ITEMS.length, `叶片数应等于新闻总数 ${ITEMS.length}`);
  const ids = new Set(G.leaves.map((l) => l.id));
  assert.equal(ids.size, ITEMS.length, "不得重复");
  for (const it of ITEMS) assert.ok(ids.has(it.id), `缺少 ${it.id}`);
  // 每个来源的叶片数 = 该来源的条目数
  for (const c of G.categories) {
    const mine = G.leaves.filter((l) => l.ci === G.categories.indexOf(c)).length;
    assert.equal(mine, c.count, `${c.name} 叶片数应为 ${c.count}，实际 ${mine}`);
  }
});

// ============ 12. source route 不受影响 ============
test("12. source route 不受影响（仍用扇形模式，仍是一棵树）", () => {
  const name = "微博";
  const model = S.buildSourceTreeModel(ITEMS, name);
  assert.equal(model.length, 1);
  const g = L.layoutTree(model, { ...L.LAYOUT_DEFAULTS, mode: "fan" });
  assert.ok(g.trunk && g.trunk.h > 0, "有树干");
  assert.ok(g.sources.length >= 2, "仍有多条分枝");
  assert.ok(g.leaves.length > 0 && g.leaves.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y)));
  // 只含该来源
  const ids = new Set(g.leaves.map((l) => l.id));
  const mine = ITEMS.filter((x) => x.source === name);
  assert.equal(ids.size, mine.length);
  assert.ok(mine.every((x) => ids.has(x.id)));
  // 路由往返
  assert.equal(R.parseRoute(R.sourceHref(name)).view, "source");
  assert.equal(S.resolveSource(R.parseRoute(R.sourceHref(name)).key, ITEMS), name);
});

// ============ 13. detail route 不受影响 ============
test("13. detail route 不受影响", () => {
  const id = ITEMS[0].id;
  const r = R.parseRoute(R.detailHref(id));
  assert.equal(r.view, "detail");
  assert.equal(r.id, id);
  assert.equal(R.parseRoute("/detail/abc123").view, "detail");
  assert.equal(R.parseRoute("/").view, "main");
  // app.js 里叶片点击仍然进详情、来源节点点击仍然进来源树
  const app = read("/public/js/app.js");
  assert.ok(/tree\.onOpen\s*=\s*\(item\)\s*=>\s*openDetail\(item\.id\)/.test(app));
  assert.ok(/tree\.onOpenSource\s*=\s*\(key\)\s*=>\s*goSource\(key\)/.test(app));
  // 首页用 crown-bare（无叶片骨架，Stage 3.3 用户要求）、来源页用 fan
  assert.ok(
    /mode:\s*state\.source\s*\?\s*"fan"\s*:\s*"crown-bare"/.test(app),
    "首页无叶片树冠 / 来源页扇形模式"
  );
});

// ============ 附加：树干视觉重量与 LOD ============
test("附加. 树干具备视觉重量，且默认 LOD 只给结构", () => {
  const b = bboxOf(G);
  assert.ok(G.trunk.h / b.h > 0.12, `树干高度应占整树 > 12%，实际 ${(G.trunk.h / b.h * 100).toFixed(1)}%`);
  assert.ok(G.trunk.baseW >= 80, `树干底部宽度应 >= 80，实际 ${G.trunk.baseW}`);
  // 主枝明显比新闻连接枝粗（渲染层：11px vs 3px）
  const tv = read("/public/js/tree-view.js");
  assert.ok(/cls: "limb/.test(tv), "渲染出主枝");
  const css = read("/public/style.css");
  const limbW = Number((css.match(/\.limb \{[\s\S]*?stroke-width:\s*([\d.]+)/) || [])[1] || 0);
  const spineW = Number((css.match(/\.spine \{[\s\S]*?stroke-width:\s*([\d.]+)/) || [])[1] || 0);
  assert.ok(limbW >= spineW * 3, `主枝描边(${limbW}) 应明显粗于连接枝(${spineW})`);
  const f = L.computeFit(G.bbox, 1440, 784, L.LAYOUT_DEFAULTS);
  assert.ok(f.s > 0.3, `默认 fit 缩放应 > 0.3（旧版 0.226），实际 ${f.s.toFixed(3)}`);
  // 放大后标题自然出现
  assert.equal(L.lodLevel(f.s), 1, "默认 LOD 1（只给结构）");
  assert.equal(L.lodLevel(0.6), 0, "放大到 0.6 后显示标题");
});
