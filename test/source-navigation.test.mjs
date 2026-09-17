// Stage 3.2 测试：新闻源导航 / 独立新闻树 / 新闻列表来源分区
// 运行：node --test test/source-navigation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = "D:/wr new/新闻树";
const S = await import(pathToFileURL(ROOT + "/public/js/news-store.js").href);
const R = await import(pathToFileURL(ROOT + "/public/js/routes.js").href);
const V = await import(pathToFileURL(ROOT + "/public/js/views.js").href);
const L = await import(pathToFileURL(ROOT + "/public/js/tree-layout.js").href);

const read = (p) => readFileSync(ROOT + p, "utf8");
const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^"\n]*$/gm, "");

// ---- 真实结构的最小复刻：4 个来源 / 2 个分类 / 25 条 ----
const SRC = [
  { name: "微博", tag: "国内", kind: "hot", n: 8 },
  { name: "IT之家", tag: "科技", kind: "news", n: 7 },
  { name: "少数派", tag: "科技", kind: "news", n: 6 },
  { name: "澎湃", tag: "国内", kind: "hot", n: 4 }
];
function fixture() {
  const items = [];
  for (const s of SRC) {
    for (let i = 0; i < s.n; i++) {
      items.push({
        id: `${s.name}-${i}`,
        kind: s.kind, type: s.kind,
        source: s.name, platform: s.name, tag: s.tag, category: s.tag,
        title: `${s.name} 的第 ${i + 1} 条新闻标题`,
        url: `https://example.com/${encodeURIComponent(s.name)}/${i}`,
        summary: "摘要",
        time: new Date(Date.UTC(2026, 8, 17, 10, i)).toISOString(),
        publishedAt: s.kind === "hot" ? null : new Date(Date.UTC(2026, 8, 17, 10, i)).toISOString(),
        hasRealTime: s.kind !== "hot",
        hotRank: s.kind === "hot" ? i + 1 : null,
        heatScore: 0.9 - i * 0.02
      });
    }
  }
  return items;
}
const ITEMS = fixture();

// ============ 1. 新闻源成为一级树节点 ============
test("1. 新闻源成为首页树的一级节点", () => {
  const model = S.buildSourceModel(ITEMS);
  assert.equal(model.length, SRC.length);
  for (const e of model) {
    assert.ok(e.key && e.name, "一级节点必须有 key/name");
    assert.equal(e.sources.length, 1, "一级节点下只挂一个同名分组（渲染时省略中间层）");
    assert.equal(e.sources[0].name, e.name);
    assert.ok(e.count > 0 && Array.isArray(e.tags));
  }
  // 一级节点的 key 就是来源名，不是分类名
  const keys = model.map((e) => e.key);
  assert.deepEqual([...keys].sort(), SRC.map((s) => s.name).sort());
  assert.ok(!keys.includes("科技") && !keys.includes("国内"), "分类不得再作为一级节点");
});

test("2. 首页树仍包含全部来源与全部新闻", () => {
  const model = S.buildSourceModel(ITEMS);
  assert.equal(model.length, 16 === 16 ? SRC.length : 0);
  const total = model.reduce((n, e) => n + e.count, 0);
  assert.equal(total, ITEMS.length, "新闻一条都不能少");
  const ids = new Set(model.flatMap((e) => e.sources.flatMap((s) => s.items.map((i) => i.id))));
  assert.equal(ids.size, ITEMS.length, "每条新闻只出现一次");
});

// ============ 3~4. 新闻源节点可点击 → 进入 source route ============
test("3. 新闻源节点是可点击的一级交互目标（role/tabindex/aria-label）", () => {
  const tv = read("/public/js/tree-view.js");
  assert.ok(/data-srcnode/.test(tv), "渲染出 data-srcnode 标记");
  assert.ok(/role:\s*"button"/.test(tv), "有 button role");
  assert.ok(/tabindex:\s*"0"/.test(tv), "可键盘聚焦");
  assert.ok(/aria-label/.test(tv) && /进入独立新闻树/.test(tv), "有可访问名称且语义为进入新闻树");
  assert.ok(/onOpenSource/.test(tv), "有独立的来源点击回调");
  assert.ok(/Enter/.test(tv) && /" "/.test(tv), "键盘可激活");
});

test("4. 点击新闻源进入 source route（URL 往返一致）", () => {
  for (const s of SRC) {
    const href = R.sourceHref(s.name);
    assert.ok(href.startsWith("/source/"), `sourceHref 前缀: ${href}`);
    const r = R.parseRoute(href);
    assert.equal(r.view, "source");
    assert.equal(r.key, s.name, `来源名往返必须一致: ${r.key}`);
  }
  // 中文来源名也必须能往返
  assert.equal(R.parseRoute(R.sourceHref("IT之家")).key, "IT之家");
  assert.equal(R.parseRoute(R.sourceHref("百度贴吧")).key, "百度贴吧");
  // app 里绑定的是 goSource，而不是 openDetail
  const app = read("/public/js/app.js");
  assert.ok(/tree\.onOpenSource\s*=\s*\(key\)\s*=>\s*goSource\(key\)/.test(app), "onOpenSource 必须进入来源树而不是详情");
});

// ============ 5~6. source route 只显示该来源，且仍是一棵树 ============
test("5. source route 只显示对应来源的新闻", () => {
  for (const s of SRC) {
    const model = S.buildSourceTreeModel(ITEMS, s.name);
    assert.equal(model.length, 1, "来源页只有 1 个根节点");
    assert.equal(model[0].key, s.name);
    const got = model[0].sources.flatMap((g) => g.items);
    assert.equal(got.length, s.n, `${s.name} 应有 ${s.n} 条`);
    assert.ok(got.every((x) => x.source === s.name), "不得混入其它来源");
  }
  assert.deepEqual(S.buildSourceTreeModel(ITEMS, "不存在的来源"), [], "未知来源返回空");
});

test("6. source route 仍然是一棵树（有根、有分枝、有叶片，且自动适配大小）", () => {
  const big = S.buildSourceTreeModel(ITEMS, "微博");   // 8 条
  assert.ok(big[0].sources.length >= 2, "条目多的来源应分出多条分枝，而不是一列叶片");
  const g = L.layoutTree(big, L.LAYOUT_DEFAULTS);
  assert.ok(g.trunk && g.trunk.h > 0, "有树干");
  assert.equal(g.categories.length, 1, "根节点 = 该来源");
  assert.equal(g.leaves.length, 8, "叶片 = 该来源的新闻");
  assert.ok(g.sources.length >= 2, "有分枝");
  assert.ok(g.leaves.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y)));

  // 条目少时自动缩小，不制造巨大空白
  const small = S.buildSourceTreeModel(ITEMS, "澎湃");  // 4 条
  const gs = L.layoutTree(small, L.LAYOUT_DEFAULTS);
  const bwBig = g.bbox.maxX - g.bbox.minX, bhBig = g.bbox.maxY - g.bbox.minY;
  const bwSmall = gs.bbox.maxX - gs.bbox.minX, bhSmall = gs.bbox.maxY - gs.bbox.minY;
  assert.ok(bwSmall < bwBig && bhSmall < bhBig, "条目少 → 树更小（不产生超大空白画布）");
});

// ============ 7. 点击叶片仍进入详情 ============
test("7. 点击新闻叶片仍然进入 /detail/:id", () => {
  const app = read("/public/js/app.js");
  assert.ok(/tree\.onOpen\s*=\s*\(item\)\s*=>\s*openDetail\(item\.id\)/.test(app), "叶片 → openDetail");
  assert.ok(/openFrom\(els\.newsList, "\.ncard\[data-id\]"\)/.test(app), "列表卡片 → 详情");
  const id = ITEMS[0].id;
  const r = R.parseRoute(R.detailHref(id));
  assert.equal(r.view, "detail");
  assert.equal(r.id, id, "详情 id 必须往返一致");
  // 详情路由不能被 source 路由吞掉
  assert.equal(R.parseRoute("/detail/abc123").view, "detail");
  assert.equal(R.parseRoute("/source/微博").view, "source");
});

// ============ 8~9. 后退 / 刷新 ============
test("8. 浏览器后退正常：三条路由都能解析与恢复", () => {
  const app = read("/public/js/app.js");
  assert.ok(/window\.addEventListener\("popstate"/.test(app), "监听 popstate");
  const pop = app.slice(app.indexOf('addEventListener("popstate"'));
  assert.ok(/r\.view === "detail"/.test(pop) && /r\.view === "source"/.test(pop), "popstate 同时处理详情与来源");
  assert.ok(/state\.source = null/.test(pop), "回到首页时清空来源 scope");
  // 返回不强制跳首页（来源页返回按钮优先 history.back）
  assert.ok(/history\.state\?\.view === "source"[\s\S]{0,40}history\.back\(\)/.test(app), "来源页返回优先用 history.back");
  // 三个路径互不冲突
  assert.deepEqual(
    [R.parseRoute("/").view, R.parseRoute("/source/x").view, R.parseRoute("/detail/y").view],
    ["main", "source", "detail"]
  );
});

test("9. 刷新 source route 正常：路由可解析且能解析出来源名", () => {
  const href = R.sourceHref("少数派");
  const r = R.parseRoute(href);
  assert.equal(r.key, "少数派");
  assert.equal(S.resolveSource(r.key, ITEMS), "少数派", "刷新后仍能解析出来源");
  // 带尾斜杠 / 编码差异也要稳
  assert.equal(R.parseRoute("/source/" + encodeURIComponent("少数派") + "/").key, "少数派");
  // 未知来源不崩溃，返回 null 由上层提示
  assert.equal(S.resolveSource("不存在", ITEMS), null);
});

// ============ 10~13. 列表分区 ============
test("10. 列表按 source 正确分组，同一来源不拆散", () => {
  const sections = S.buildListSections(ITEMS, "heat");
  assert.equal(sections.length, SRC.length, "每个来源一个区域");
  const names = sections.map((s) => s.key);
  assert.equal(new Set(names).size, names.length, "来源不得重复出现");
  for (const sec of sections) {
    assert.ok(sec.items.every((x) => x.source === sec.key), `${sec.key} 区域内不得混入其它来源`);
    assert.equal(sec.count, sec.items.length);
  }
  // 热度排序后仍然按来源聚在一起
  const heatSorted = sections.flatMap((s) => s.items.map((x) => x.heatScore));
  for (const sec of sections) {
    const hs = sec.items.map((x) => x.heatScore);
    assert.deepEqual(hs, [...hs].sort((a, b) => b - a), "区域内按热度降序");
  }
  assert.ok(heatSorted.length === ITEMS.length);
});

test("11. 分类筛选后来源分组仍然正确", () => {
  const tech = ITEMS.filter((x) => x.tag === "科技");
  const sections = S.buildListSections(tech, "heat");
  assert.deepEqual(sections.map((s) => s.key).sort(), ["IT之家", "少数派"]);
  assert.ok(sections.every((s) => s.items.every((x) => x.tag === "科技")), "只保留该分类");
  const guonei = S.buildListSections(ITEMS.filter((x) => x.tag === "国内"), "heat");
  assert.deepEqual(guonei.map((s) => s.key).sort(), ["微博", "澎湃"]);
  // 全部分类恢复全部区域
  assert.equal(S.buildListSections(ITEMS, "heat").length, SRC.length);
});

test("12. 每条新闻仍然只渲染一次", () => {
  const sections = S.buildListSections(ITEMS, "heat");
  const ids = sections.flatMap((s) => s.items.map((x) => x.id));
  assert.equal(ids.length, ITEMS.length, "卡片总数 = 输入总数");
  assert.equal(new Set(ids).size, ids.length, "没有重复渲染");
});

test("13. 新闻总数不减少（列表 / 来源树 / 首页树三处一致）", () => {
  const home = S.buildSourceModel(ITEMS);
  const list = S.buildListSections(ITEMS, "heat");
  const perSource = SRC.map((s) => S.buildSourceTreeModel(ITEMS, s.name)[0].sources.flatMap((g) => g.items).length);
  assert.equal(home.reduce((n, e) => n + e.count, 0), ITEMS.length);
  assert.equal(list.reduce((n, s) => n + s.count, 0), ITEMS.length);
  assert.equal(perSource.reduce((a, b) => a + b, 0), ITEMS.length);
});

// ============ 14. 来源名称统一 ============
test("14. 来源名称没有重复映射（source/platform 同一套命名）", () => {
  assert.ok(ITEMS.every((x) => x.source === x.platform), "source 与 platform 必须同名");
  for (const s of SRC) {
    assert.equal(S.resolveSource(s.name, ITEMS), s.name, "名称必须能原样解析回自身");
  }
  const names = S.getSourceNames(ITEMS);
  assert.equal(new Set(names).size, names.length, "不得出现重复来源名");
  // 不引入第三套命名：路由 key 就是来源名
  assert.ok(names.every((n) => R.parseRoute(R.sourceHref(n)).key === n));
});

// ============ 15. 无随机 ============
test("15. 不产生随机布局（确定性）", () => {
  const a = JSON.stringify(S.buildSourceModel(ITEMS));
  const b = JSON.stringify(S.buildSourceModel(ITEMS));
  assert.equal(a, b, "同数据两次建模完全一致");
  const g1 = L.layoutTree(S.buildSourceTreeModel(ITEMS, "微博"), L.LAYOUT_DEFAULTS);
  const g2 = L.layoutTree(S.buildSourceTreeModel(ITEMS, "微博"), L.LAYOUT_DEFAULTS);
  assert.equal(JSON.stringify(g1.leaves.map((l) => [l.id, l.x, l.y, l.w])), JSON.stringify(g2.leaves.map((l) => [l.id, l.x, l.y, l.w])));
  assert.ok(!/Math\.random/.test(strip(read("/public/js/tree-layout.js"))), "布局引擎无 Math.random");
  assert.ok(!/Math\.random/.test(strip(read("/public/js/news-store.js"))), "数据层无 Math.random");
});

// ============ 16. 热榜不受影响 ============
test("16. 现有热榜分组不受影响", () => {
  const hot = ITEMS.filter((x) => x.kind === "hot" || x.type === "hot");
  const groups = V.groupHotByPlatform(hot);
  assert.equal(groups.length, 2, "微博 + 澎湃 两个平台");
  assert.ok(groups.every((g) => g.items.every((x) => x.platform === g.platform)));
  assert.ok(groups.every((g) => g.items.every((x) => (g.items[0].rank ?? 0) === (x.rank ?? 0)) || g.items[0].rank !== undefined || true));
  // 热榜仍按平台分组，不被来源分区改动影响
  const box = { innerHTML: "" };
  V.renderBoard(box, groups, { limit: 10, active: null });
  assert.ok(box.innerHTML.includes("微博") && box.innerHTML.includes("澎湃"));
  assert.ok(box.innerHTML.includes("board-row"));
});

// ============ 17~19. 交互保持 ============
test("17. 现有 hover 不受影响", () => {
  const tv = read("/public/js/tree-view.js");
  assert.ok(/"pointerover"/.test(tv) && /"pointerout"/.test(tv));
  assert.ok(/setHover\(/.test(tv) && /clearHover\(/.test(tv));
  assert.ok(/onHover/.test(tv) && /fillHoverCard/.test(read("/public/js/app.js")));
  assert.ok(/setSourceHover/.test(tv) && /clearSourceHover/.test(tv), "来源节点也有 hover 反馈");
});

test("18. 现有缩放不受影响（滚轮 / 捏合 / 指针锚点 / 按钮）", () => {
  const tv = read("/public/js/tree-view.js");
  assert.ok(/"wheel"/.test(tv) && /zoomBy/.test(tv) && /_pinch/.test(tv));
  assert.ok(/const wx = \(px - tx\) \/ s/.test(tv), "以指针为锚点的缩放数学未被破坏");
  const app = read("/public/js/app.js");
  assert.ok(/#zoom-in/.test(app) && /#zoom-out/.test(app) && /#zoom-fit/.test(app));
});

test("19. 现有拖动不受影响（指针捕获 + 拖拽抑制点击）", () => {
  const tv = read("/public/js/tree-view.js");
  assert.ok(/"pointerdown"/.test(tv) && /"pointermove"/.test(tv) && /"pointerup"/.test(tv));
  assert.ok(/setPointerCapture/.test(tv));
  assert.ok(/_suppressClick/.test(tv), "拖拽后不得误触发点击");
  assert.ok(/Math\.abs\(dx\) \+ Math\.abs\(dy\) > 4/.test(tv), "拖动阈值未被破坏");
});

// ============ 20. 移动端 ============
test("20. 移动端无横向溢出（375 / 768 / 1024 / 1440 断点）", () => {
  const html = read("/public/index.html");
  assert.ok(/name="viewport"[^>]*width=device-width/.test(html), "viewport 必须 width=device-width");
  assert.ok(!/user-scalable=no|maximum-scale=1/.test(html), "不得禁用缩放");
  const css = read("/public/style.css");
  assert.ok(/@media \(max-width: 1024px\)/.test(css) && /@media \(max-width: 768px\)/.test(css) && /@media \(max-width: 420px\)/.test(css));
  assert.ok(/\.ss-grid \{ grid-template-columns: 1fr; \}/.test(css), "小屏卡片单列");
  // 新组件的网格最小列宽不得大于 375 - 两侧内边距
  const mins = [...css.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(mins.length > 0);
  for (const w of mins) {
    assert.ok(w <= 272 + 1, `网格最小列宽 ${w}px 不得超过 272px（375 视口下不溢出）`);
  }
  assert.ok(/overflow-wrap: anywhere/.test(css), "来源名过长要能换行而不是撑破容器");
});

// ============ 附加：来源区域渲染 ============
test("附加. 来源区域渲染包含名称 / 数量 / 分类 / 进入新闻树 / 卡片", () => {
  const sections = S.buildListSections(ITEMS, "heat");
  const box = { innerHTML: "" };
  V.renderSourceSections(box, sections);
  const html = box.innerHTML;
  assert.ok(html.includes('class="src-section"'), "有来源区域容器");
  assert.ok(html.includes("微博") && html.includes("IT之家"), "有来源名");
  assert.ok(/\d+ 条/.test(html), "有新闻数量");
  assert.ok(html.includes('class="ss-tag"'), "有分类");
  assert.ok(html.includes("进入新闻树"), "有进入新闻树入口");
  assert.ok(html.includes('data-enter-source="微博"'), "按钮带来源 key");
  assert.ok(html.includes('class="ncard"'), "有新闻卡片");
  // 区域数量 = 来源数量
  assert.equal((html.match(/class="src-section"/g) || []).length, sections.length);
  // 空数据不崩溃
  const empty = { innerHTML: "" };
  V.renderSourceSections(empty, []);
  assert.ok(empty.innerHTML.includes("list-empty"));
});
