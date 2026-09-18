// 生成静态自检页：把真实数据快照 + 布局引擎内联进单个 HTML，
// 无需启动任何服务器，双击即可用浏览器审查。
//
// 为什么需要它：本项目的审查环境无法常驻进程（node server.js 会被回收），
// 所以「可人工审查」必须有一个不依赖服务器的形态作为兜底。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const snapPath = path.join(rootDir, ".review", "snapshot.json");
const outPath = path.join(rootDir, "docs", "stage3.3-首页无叶片-自检.html");

const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));

// 把三个 ESM 模块各自包进独立作用域后再拼接：
// 它们之间存在同名声明（helpers.clamp 与 tree-layout.clamp），
// 直接顺序拼接会 SyntaxError（Identifier 'clamp' has already been declared）。
// 做法：每个模块包成 IIFE 并把它的导出挂到一个命名空间对象上，
// 再把模块内的裸引用（如 textWidth / LAYOUT_DEFAULTS）重写到对应命名空间。
function strip(src) {
  return src
    .replace(/^\s*import\s+[^;]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s+(?:async\s+)?(const|let|var|function|class)\b/gm, "$1")
    .replace(/^\s*export\s+async\s+(function)\b/gm, "$1")
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "");
}

/** 收集某个模块的顶层导出名 */
function exportNames(src) {
  const out = new Set();
  const re = /^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  // export { a, b as c }
  const re2 = /^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm;
  while ((m = re2.exec(src))) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const as = seg.split(/\s+as\s+/);
      out.add((as[1] || as[0]).trim());
    }
  }
  return [...out].filter(Boolean);
}

/** 某个模块自身声明的顶层名字（这些不能被改写成 H.*） */
function ownDecls(src) {
  const out = new Set();
  const re = /^\s*(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/** 把裸引用的 helper 名改写成 H.name（跳过本模块自己声明的名字） */
function rewriteHelpers(src, helperNames) {
  const own = ownDecls(src);
  let out = src;
  for (const n of helperNames) {
    if (own.has(n)) continue;
    const re = new RegExp(`(?<![\\w$.])${n}(?![\\w$])`, "g");
    out = out.replace(re, `H.${n}`);
  }
  return out;
}

const helpersSrc = fs.readFileSync(path.join(rootDir, "public", "js", "helpers.js"), "utf8");

/** 生成一个 IIFE 模块：把导出名收集起来返回 */
function buildModule(ns, rawSrc, helperNames) {
  // 先收集导出名（在剥掉 export 之前）
  const names = exportNames(rawSrc);
  // 剥掉 import / export 关键字
  let body = strip(rawSrc);
  // 再改写对 helper 的裸引用（此时 body 里已无 export，声明可直接识别）
  if (helperNames) body = rewriteHelpers(body, helperNames);
  return `const ${ns} = (() => {\n${body}\nreturn { ${names.join(", ")} };\n})();`;
}

const helperNames = exportNames(helpersSrc);

// news-store.js 里只有 buildSourceModel 这一支是无 DOM 依赖的纯逻辑；
// 其余（loadNews/saveCache/…）依赖 fetch 与 localStorage，不能进静态页。
// 因此按「函数边界」精确抽取 dominantTag + buildSourceModel，而不是整模块打包。
const storeRaw = fs.readFileSync(path.join(rootDir, "public", "js", "news-store.js"), "utf8");
function sliceFn(src, startRe, endRe) {
  const s = src.search(startRe);
  if (s < 0) throw new Error("找不到片段起始：" + startRe);
  const rest = src.slice(s);
  const e = rest.search(endRe);
  if (e < 0) throw new Error("找不到片段结束：" + endRe);
  return rest.slice(0, e);
}
const storeSlice =
  sliceFn(storeRaw, /\/\*\* 某个来源的主导分类/, /\/\*\* 该来源的全部条目/) +
  "\n";
// buildSourceModel 片段里对 state.items 的兜底引用换成空数组（静态页始终显式传入 FLAT）
const storeFixed = storeSlice.replace(/items \|\| state\.items/g, "items || []");
const storeNames = exportNames(storeSlice);

const bundle = [
  buildModule("H", helpersSrc, null),
  buildModule("TL", fs.readFileSync(path.join(rootDir, "public", "js", "tree-layout.js"), "utf8"), helperNames),
  buildModule("NS_", storeFixed, helperNames)
].join("\n");

const dataJson = JSON.stringify({ updatedAt: snap.updatedAt, items: snap.items });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stage 3.3 自检 · 首页无叶片骨架 + Apple 风格</title>
<style>
  :root{--ink:#1d1d1f;--ink2:#6e6e73;--ink3:#86868b;--line:rgba(0,0,0,.09);--blue:#0071e3}
  *{box-sizing:border-box}
  body{margin:0;background:#f5f5f7;color:var(--ink);
    font-family:"SF Pro Display",-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased}
  header{padding:30px 32px 18px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.72);backdrop-filter:blur(18px);position:sticky;top:0;z-index:10}
  h1{margin:0 0 6px;font-size:26px;font-weight:600;letter-spacing:-.02em}
  .sub{font-size:13px;color:var(--ink2)}
  .wrap{padding:24px 32px 60px;max-width:1400px}
  .meta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
  .chip{font-size:12px;padding:6px 12px;border-radius:99px;background:rgba(0,0,0,.045);color:var(--ink2)}
  .chip b{color:var(--ink);font-weight:600}
  .chip.ok{background:rgba(0,113,227,.09);color:var(--blue)}
  .chip.warn{background:rgba(255,159,10,.13);color:#b25000}
  h2{font-size:17px;font-weight:600;margin:34px 0 4px;letter-spacing:-.01em}
  .h2sub{font-size:12.5px;color:var(--ink3);margin-bottom:14px}
  .panel{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.05);overflow:hidden}
  #stage{position:relative;height:640px;background:linear-gradient(180deg,#f5f5f7,#fff 46%,#f5f5f7)}
  svg{width:100%;height:100%;display:block}
  .src-node{cursor:pointer}
  .sn-bg{fill:#fff;stroke:rgba(0,0,0,.10);stroke-width:1;transition:.18s;
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.07))}
  .sn-name{fill:var(--ink);font-weight:600;letter-spacing:-.01em}
  .sn-count{fill:var(--ink3);font-weight:500}
  .src-node:hover .sn-bg,.src-node.active .sn-bg{
    fill:color-mix(in srgb,var(--c) 7%,#fff);
    stroke:color-mix(in srgb,var(--c) 70%,transparent);stroke-width:1.6;
    filter:drop-shadow(0 4px 12px color-mix(in srgb,var(--c) 22%,transparent))}
  .src-node:hover .sn-name,.src-node.active .sn-name{fill:color-mix(in srgb,var(--c) 78%,#1d1d1f)}
  .limb{stroke:var(--c);stroke-width:7;stroke-linecap:round;opacity:.7;fill:none}
  .limb.on{opacity:1;stroke-width:10}
  .trunk{fill:url(#trunk-grad);opacity:.92}
  .bark-line{stroke:rgba(120,96,72,.32);stroke-width:2.2;fill:none}
  .ground-shadow{fill:rgba(0,0,0,.10);filter:blur(7px)}
  .peek{position:absolute;z-index:5;width:320px;padding:16px 18px 14px;
    background:rgba(255,255,255,.86);border:1px solid rgba(0,0,0,.07);border-radius:18px;
    box-shadow:0 12px 40px rgba(0,0,0,.14);backdrop-filter:saturate(180%) blur(24px);
    pointer-events:none;opacity:0;transform:translateY(4px) scale(.985);
    animation:pk .18s cubic-bezier(.2,.8,.3,1) forwards}
  @keyframes pk{to{opacity:1;transform:none}}
  .peek.hidden{display:none}
  .pk-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
  .pk-name{font-size:16px;font-weight:600;letter-spacing:-.01em}
  .pk-count{font-size:12px;color:var(--ink3)}
  .pk-list{list-style:none;margin:0;padding:0;display:grid;gap:9px}
  .pk-item{padding-left:11px;position:relative;display:grid;gap:3px}
  .pk-item:before{content:"";position:absolute;left:0;top:6px;width:3px;height:3px;border-radius:50%;background:var(--ink3);opacity:.6}
  .pk-t{font-size:13px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .pk-time{font-size:11px;color:var(--ink3)}
  .pk-foot{margin-top:12px;padding-top:11px;border-top:1px solid var(--line);font-size:12px;font-weight:500;color:var(--blue)}
  .hint{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;font-size:11.5px;color:var(--ink2);
    background:rgba(255,255,255,.72);border:1px solid rgba(0,0,0,.06);padding:6px 14px;border-radius:99px;
    backdrop-filter:blur(18px);pointer-events:none;white-space:nowrap}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line)}
  th{font-weight:500;color:var(--ink3);font-size:12px;background:rgba(0,0,0,.02)}
  td.num{font-variant-numeric:tabular-nums}
  .pass{color:#1a7f37;font-weight:600}.fail{color:#d1242f;font-weight:600}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:rgba(0,0,0,.05);padding:2px 6px;border-radius:5px}
  ul.notes{font-size:13px;line-height:1.75;color:var(--ink2);padding-left:20px}
  ul.notes b{color:var(--ink)}
</style>
</head>
<body>
<header>
  <h1>Stage 3.3 · 首页无叶片骨架 + Apple 风格 自检</h1>
  <div class="sub">本页不依赖任何服务器：真实数据快照 + 真实布局引擎，全部内联。直接用浏览器打开即可审查。</div>
</header>
<div class="wrap">
  <div class="meta" id="meta"></div>

  <h2>① 首页形态（真实数据）</h2>
  <div class="h2sub">预期：只有树干 + 主枝 + 新闻源节点；<b>没有任何新闻标题</b>。悬停节点 → 预览该来源最新 3 条真实新闻。</div>
  <div class="panel">
    <div id="stage">
      <svg id="svg" viewBox="0 0 1200 640" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="trunk-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#6b5541"/>
            <stop offset="55%" stop-color="#8d7358"/>
            <stop offset="100%" stop-color="#a89078"/>
          </linearGradient>
        </defs>
        <g id="world"></g>
      </svg>
      <div class="peek hidden" id="peek">
        <div class="pk-head"><span class="pk-name" id="pk-name"></span><span class="pk-count" id="pk-count"></span></div>
        <ul class="pk-list" id="pk-list"></ul>
        <div class="pk-foot" id="pk-foot"></div>
      </div>
      <div class="hint">悬停新闻源看预览 · 点击进入它的新闻树（真实站内行为）</div>
    </div>
  </div>

  <h2>② 几何不变量自检（脚本判定，非肉眼）</h2>
  <div class="h2sub">这些是「首页不显示新闻」在几何层必须同时成立的条件，任何一条不成立都会导致视觉缺陷。</div>
  <div class="panel"><table id="checks"><thead><tr><th>检查项</th><th>实测</th><th>结论</th></tr></thead><tbody></tbody></table></div>

  <h2>③ 每个来源的真实数据量</h2>
  <div class="h2sub">下方「条数」与树上节点的角标必须一一对应。</div>
  <div class="panel"><table id="srcs"><thead><tr><th>新闻源</th><th>条数</th><th>主导分类</th></tr></thead><tbody></tbody></table></div>

  <h2>④ 审查须知</h2>
  <ul class="notes">
    <li><b>点击新闻源会跳走</b>：本页是静态快照，跳转目标是真实站内路由（<code>/source/来源名</code>）。要验证「点进去才出现新闻」，请启动本地服务：<code>node scripts/review-server.mjs</code>（默认 4173 端口）。</li>
    <li><b>本页不能替代 L1 实拍证据</b>：按《交付诚实性规范》，视觉结论需要截图佐证。本页提供的是可复核的<em>结构与数值</em>证据（L2 实测 + L3 代码），截图仍需由你在浏览器里完成。</li>
    <li><b>数据快照时间</b>：<span id="snaptime"></span>，来源 <span id="snapsrc"></span>。</li>
  </ul>
</div>

<script type="module">
${bundle}

const SNAP = ${dataJson};
const FLAT = SNAP.items;

// ---------- 真实模型 ----------
const model = NS_.buildSourceModel(FLAT);
document.getElementById("snaptime").textContent = SNAP.updatedAt || "未知";
document.getElementById("snapsrc").textContent = ".review/snapshot.json（由 lib/news-core.mjs 实时抓取后落盘）";

// ---------- 元信息 ----------
const srcSet = new Set(FLAT.map(x => x.source));
const tagSet = new Set(FLAT.map(x => x.tag));
const metaEl = document.getElementById("meta");
[["数据来源", srcSet.size + " 个真实新闻源"],["新闻条目", FLAT.length + " 条"],["分类", [...tagSet].join(" / ")],["布局模式","crown-bare（无叶片）"]]
  .forEach(([k,v]) => { const d=document.createElement("span"); d.className="chip"; d.innerHTML=k+" · <b>"+v+"</b>"; metaEl.appendChild(d); });

// ---------- 渲染首页骨架（复用真实布局引擎） ----------
const OPTS = Object.assign({}, TL.LAYOUT_DEFAULTS, { mode: "crown-bare", skipLeaves: true });
const g = TL.layoutTree(model, OPTS);
const world = document.getElementById("world");

// 自适应：等比缩放让整棵树落进 viewBox
const bb = g.bbox;
const VB_W = 1200, VB_H = 640;
const treeW = bb.maxX - bb.minX, treeH = bb.maxY - bb.minY;
const pad = 46;
const sc = Math.min((VB_W - pad*2) / treeW, (VB_H - pad*2) / treeH, 1.6);
const ox = VB_W/2 - ((bb.minX + bb.maxX)/2) * sc;
const oy = VB_H - pad - bb.maxY * sc;
const T = (x,y) => [x*sc + ox, y*sc + oy];
const P = pts => pts.map(([x,y]) => { const [a,b]=T(x,y); return a+","+b; }).join(" ");
world.setAttribute("transform", "translate(" + ox + "," + oy + ") scale(" + sc + ")");

const NS = "http://www.w3.org/2000/svg";
const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) { if (a[k]!=null) e.setAttribute(k, a[k]); } return e; };

// 树干
const t = g.trunk, bw = t.baseW/2, tw = t.topW/2, h = t.h;
world.appendChild(el("ellipse", { cx:0, cy:6, rx:bw*2.1, ry:12, class:"ground-shadow" }));
world.appendChild(el("path", { d: ["M "+(-bw)+" 0",
  "C "+(-bw*.62)+" "+(-h*.34)+", "+(-tw-6)+" "+(-h*.72)+", "+(-tw)+" "+(-h),
  "L "+tw+" "+(-h),
  "C "+(tw+6)+" "+(-h*.72)+", "+(bw*.62)+" "+(-h*.34)+", "+bw+" 0", "Z"].join(" "), class:"trunk" }));
for (const b of t.bark) world.appendChild(el("path", {
  d: "M "+b.offset+" -8 C "+(b.offset*.7)+" "+(-h*.42)+", "+(b.offset*.24)+" "+(-h*.74)+", "+(b.offset*.1)+" "+(-h+6), class:"bark-line" }));

// 主枝
g.limbs.forEach((lb, li) => {
  world.appendChild(el("path", {
    d: "M "+lb.p0.x+" "+lb.p0.y+" Q "+lb.p1.x+" "+lb.p1.y+" "+lb.p2.x+" "+lb.p2.y,
    class:"limb", "data-limb": li, style:"--c:"+lb.color }));
});

// 来源节点
const latestOf = key => FLAT.filter(x => x.source === key)
  .sort((a,b) => Number(b.time||b.publishedAt||0) - Number(a.time||a.publishedAt||0))
  .slice(0,3);

g.categories.forEach(c => {
  const wl = c.w || 120, hh = c.h || 40;
  const grp = el("g", { class:"src-node", "data-src": c.key, style:"--c:"+c.color });
  grp.appendChild(el("rect", { x:c.node.x-wl/2, y:c.node.y-hh/2, width:wl, height:hh, rx:hh/2, class:"sn-bg" }));
  const nm = el("text", { x:c.node.x, y:c.node.y+5, "text-anchor":"middle", class:"sn-name", "font-size":16 });
  nm.textContent = c.name; grp.appendChild(nm);
  const ct = el("text", { x:c.node.x, y:c.node.y+hh/2+15, "text-anchor":"middle", class:"sn-count", "font-size":11.5 });
  ct.textContent = c.count + " 条"; grp.appendChild(ct);
  world.appendChild(grp);
});

// ---------- 悬停预览 ----------
const peek = document.getElementById("peek");
const svgEl = document.getElementById("svg");
world.addEventListener("pointerover", e => {
  const grp = e.target.closest?.(".src-node");
  if (!grp) return;
  world.querySelectorAll(".src-node.active").forEach(n => n.classList.remove("active"));
  world.querySelectorAll(".limb.on").forEach(n => n.classList.remove("on"));
  grp.classList.add("active");
  const key = grp.getAttribute("data-src");
  const lb = world.querySelector('.limb[data-limb="' + world.querySelectorAll(".src-node").length + '"]');
  const idx = [...world.querySelectorAll(".src-node")].indexOf(grp);
  const lim = world.querySelector('.limb[data-limb="' + (g.categories[idx] ? g.categories[idx].limb : -1) + '"]');
  if (lim) lim.classList.add("on");
  const cat = g.categories[idx];
  const items = latestOf(key);
  document.getElementById("pk-name").textContent = cat.name;
  document.getElementById("pk-count").textContent = cat.count + " 条";
  const ul = document.getElementById("pk-list"); ul.innerHTML = "";
  items.forEach(it => {
    const li = document.createElement("li"); li.className = "pk-item";
    const a = document.createElement("span"); a.className="pk-t"; a.textContent = it.title || "(无标题)";
    const b2 = document.createElement("span"); b2.className="pk-time";
    b2.textContent = it.time ? new Date(Number(it.time)).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
    li.append(a,b2); ul.appendChild(li);
  });
  if (!items.length) { const li=document.createElement("li"); li.className="pk-item"; li.textContent="该来源暂无可用新闻"; ul.appendChild(li); }
  document.getElementById("pk-foot").textContent = "点击进入「" + cat.name + "」的新闻树 →";
  // 定位到屏幕坐标
  const r = grp.getBoundingClientRect(), sr = svgEl.getBoundingClientRect();
  let x = r.right - sr.left + 12, y = r.top - sr.top - 6;
  const pw = 320, ph = peek.offsetHeight || 180;
  if (x + pw > sr.width - 12) x = Math.max(12, r.left - sr.left - pw - 12);
  if (y + ph > sr.height - 12) y = Math.max(12, sr.height - 12 - ph);
  peek.style.left = x + "px"; peek.style.top = y + "px";
  peek.classList.remove("hidden");
});
world.addEventListener("pointerout", e => {
  const to = e.relatedTarget?.closest?.(".src-node");
  if (!to) { peek.classList.add("hidden"); world.querySelectorAll(".src-node.active").forEach(n=>n.classList.remove("active")); world.querySelectorAll(".limb.on").forEach(n=>n.classList.remove("on")); }
});

// ---------- 几何自检 ----------
const cats = g.categories;
let overlap = 0;
for (let i=0;i<cats.length;i++) for (let j=i+1;j<cats.length;j++) {
  const a=cats[i], b=cats[j];
  if (Math.abs(a.x-b.x) < (a.w+b.w)/2 - 2 && Math.abs(a.y-b.y) < (a.h+b.h)/2 - 2) overlap++;
}
let worstSpine = 0, worstName = "";
for (const c of cats) {
  const lp = c.limbPoint || {};
  const dx = Math.abs(c.x-lp.x), dy = Math.abs(c.y-lp.y);
  const sp = (dx<3||dy<3) ? 0 : Math.hypot(dx,dy);
  if (sp > worstSpine) { worstSpine = sp; worstName = c.name; }
}
let maxR=0, minR=Infinity;
for (const c of cats) { const r=Math.hypot(c.x, c.y-g.apex.y); if(r>maxR)maxR=r; if(r<minR)minR=r; }
const radiusRatio = minR>0 ? maxR/minR : 0;
const treeWd = g.bbox.maxX-g.bbox.minX, treeHt = g.bbox.maxY-g.bbox.minY;

const checks = [
  ["不生成任何叶片（leaves === 0）", "leaves = " + g.leaves.length + " / totalLeaves = " + g.totalLeaves, g.leaves.length===0 && g.totalLeaves===0],
  ["来源节点数量与输入一致", cats.length + " / " + model.length, cats.length===model.length],
  ["来源节点互不重叠（矩形盒不相交）", overlap + " 对重叠", overlap===0],
  ["节点沿主枝分散（不是同一个圆）", "半径比 = " + radiusRatio.toFixed(2), radiusRatio > 1.25],
  ["枝脊短且方向明确（无斜穿）", "最差 " + worstSpine.toFixed(0) + "px" + (worstName?"（"+worstName+"）":""), worstSpine < 5],
  ["包围盒由骨架决定（宽高受控）", treeWd.toFixed(0) + " × " + treeHt.toFixed(0), treeWd < 4200 && treeHt < 3200],
  ["树干站立（apex 在顶部）", "trunkH = " + g.trunk.h.toFixed(0), g.trunk.h > 0 && g.apex.y < 0],
];
const tb = document.querySelector("#checks tbody");
checks.forEach(([name, val, ok]) => {
  const tr = document.createElement("tr");
  tr.innerHTML = "<td>"+name+"</td><td class='num'>"+val+"</td><td class='"+(ok?"pass":"fail")+"'>"+(ok?"✓ 通过":"✗ 未通过")+"</td>";
  tb.appendChild(tr);
});

// ---------- 来源表 ----------
const sb = document.querySelector("#srcs tbody");
[...model].sort((a,b)=>b.count-a.count).forEach(m => {
  const tr = document.createElement("tr");
  tr.innerHTML = "<td>"+m.name+"</td><td class='num'>"+m.count+"</td><td>"+(m.tag||"-")+"</td>";
  sb.appendChild(tr);
});
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log("已生成：" + path.relative(rootDir, outPath));
console.log("  内联数据：" + snap.items.length + " 条真实新闻 / " + new Set(snap.items.map(x=>x.source)).size + " 个来源");
console.log("  文件大小：" + (fs.statSync(outPath).size/1024).toFixed(0) + " KB");
