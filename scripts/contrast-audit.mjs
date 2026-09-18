// ============================================================
// WCAG 对比度审计（Stage 3.5 补充验收）
// ------------------------------------------------------------
// 为什么需要它：Stage 3.5 的记录里，「DAY 下文字是否清晰」这一条只做到了
// 「目视核对 + 抽样像素」，没有可量化的达标依据。本脚本把这件事变成数字。
//
// 方法（全部基于**真实渲染像素**，不是推算）：
//   1. 正常截一张图 A
//   2. 把所有被测文字元素设为 visibility:hidden（保留布局），再截一张图 B
//      → B 在同一坐标上的像素就是「纯背景」，不会混入字形
//   3. 文字色取 getComputedStyle（HTML 用 color，SVG 用 fill），若带 alpha 则与背景合成
//   4. 按 WCAG 2.1 计算对比度：(L1+0.05)/(L2+0.05)
//
// 判定：AA 普通文字 ≥ 4.5:1；大文字（≥24px，或 ≥18.66px 且 bold）≥ 3:1
//
// 用法：node scripts/contrast-audit.mjs
// ============================================================
import { spawn } from "node:child_process";

const PORT = Number(process.env.CDP_PORT) || 9226;
const BASE = process.env.SHOT_BASE || "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];
const findChrome = () => {
  for (const p of CHROME_CANDIDATES) if (fsExists(p)) return p;
  throw new Error("找不到浏览器");
};
import fs from "node:fs";
const fsExists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// ---------- 每个视图要审计的文字元素 ----------
// label 用于报告；sel 是选择器；maxRatio 可选（超过则说明「太接近」也算问题）
const TARGETS = {
  tree: [
    [".brand", "品牌 NEWS TREE"],
    [".brand .brand-sub", "品牌副标 新闻树"],
    [".top-stats .ts b", "统计数值"],
    [".top-stats .ts i", "统计标签"],
    [".cat-btn.active", "分类按钮（选中）"],
    [".cat-btn", "分类按钮（普通）"],
    [".env-btn.active", "DAY/NIGHT（选中）"],
    [".env-btn", "DAY/NIGHT（未选）"],
    [".dock-title", "左侧面板标题"],
    [".dock-btn.active", "左侧按钮（选中）"],
    [".dock-btn", "左侧按钮（普通）"],
    [".tree-hint", "底部提示"],
    [".sn-name", "来源名（树上）"],
    [".sn-count", "来源条数"],
    [".sn-abbr", "来源缩写（徽标内）"],
    [".cat-tag .ct-text", "分类标签"]
  ],
  list: [
    [".lv-title", "列表标题"],
    [".lv-meta", "列表元信息"],
    [".ss-name", "来源区域名"],
    [".ss-count", "来源区域条数"],
    [".ss-tag", "来源分类标签"],
    [".ss-enter", "进入新闻树按钮"],
    [".nc-title", "卡片标题"],
    [".nc-src", "卡片来源"],
    [".nc-time", "卡片时间"],
    [".nc-heat", "卡片热度"],
    [".nc-cat", "卡片分类"],
    [".sort-pill.active", "排序（选中）"],
    [".sort-pill", "排序（普通）"],
    [".cat-btn.active", "分类按钮（选中）"]
  ],
  board: [
    [".lv-title", "热榜标题"],
    [".lv-meta", "热榜元信息"],
    [".hot-plat", "平台分组标题"],
    [".b-rank.top1", "排名 1"],
    [".b-rank.top2", "排名 2"],
    [".b-rank.top3", "排名 3"],
    [".board-row:nth-child(n+5) .b-rank", "排名 4+"],
    [".b-main .ri-title", "热榜标题行"],
    [".b-meta", "热榜元信息"],
    [".b-heat b", "热度数值"],
    [".plat-chip.active", "平台筛选（选中）"],
    [".plat-chip", "平台筛选（普通）"]
  ],
  detail: [
    [".back-btn", "返回按钮"],
    [".detail-tag", "详情分类标签"],
    [".detail-title", "详情标题"],
    [".detail-meta", "详情元信息"],
    [".detail-body", "详情正文"],
    [".btn-primary", "主按钮"],
    [".btn-secondary", "次按钮"]
  ],
  source: [
    [".sb-back", "返回全部新闻源"],
    [".sb-name", "来源名（顶栏）"],
    [".sb-count", "来源条数（顶栏）"],
    [".sb-hint", "顶栏提示"],
    [".leaf-title", "新闻叶片标题"]
  ]
};

const VIEWS = [
  { key: "tree", url: "/?mode=tree&env=%ENV%", label: "首页树" },
  { key: "list", url: "/?mode=list&env=%ENV%", label: "列表" },
  { key: "board", url: "/?mode=board&env=%ENV%", label: "热榜" },
  { key: "detail", url: null, label: "新闻详情" },   // id 运行时补
  { key: "source", url: "/source/Solidot?env=%ENV%", label: "来源页" }
];

// ---------- CDP ----------
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP 超时 " + method)); } }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    // 页面里的异常不会自己冒出来，必须显式检查 —— 否则只会看到「JSON.parse 拿到 [object Object]」
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("页面异常: " + (d.exception?.description || d.exception?.value || d.text || JSON.stringify(d)));
    }
    return r.result?.value;
  }
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch { /* 未就绪 */ }
    await sleep(250);
  }
  throw new Error("连不上调试端口");
}

// ---------- 页面内计算（对比度 / 取样） ----------
const PAGE_HELPERS = `
function __lum(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function __ratio(fg, bg) {
  const l1 = __lum(fg[0], fg[1], fg[2]), l2 = __lum(bg[0], bg[1], bg[2]);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function __parse(s) {
  const m = String(s).match(/rgba?\\(([^)]+)\\)/);
  if (!m) return null;
  const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function __over(fg, bg) {
  const a = fg.a;
  return [fg.r * a + bg[0] * (1 - a), fg.g * a + bg[1] * (1 - a), fg.b * a + bg[2] * (1 - a)];
}
function __canvas(b64) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      res(c);
    };
    img.src = 'data:image/png;base64,' + b64;
  });
}
function __px(ctx, x, y) { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; }
/** 在元素内取 5 个点，返回出现次数最多的颜色。
    取样点从边缘内缩，避开圆角/描边；文字已被设为透明，所以拿到的是纯背景。 */
function __bgAt(ctx, r) {
  const ix = Math.max(5, r.width * 0.28), iy = Math.max(5, r.height * 0.28);
  const pts = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + ix, r.top + iy],
    [r.left + r.width - ix, r.top + iy],
    [r.left + ix, r.top + r.height - iy],
    [r.left + r.width - ix, r.top + r.height - iy]
  ].map(([x, y]) => [Math.round(Math.min(Math.max(x, 0), ctx.canvas.width - 1)), Math.round(Math.min(Math.max(y, 0), ctx.canvas.height - 1))]);
  const counts = new Map();
  for (const [x, y] of pts) {
    const k = __px(ctx, x, y).join(',');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null, bn = -1;
  for (const [k, n] of counts) if (n > bn) { bn = n; best = k; }
  return best.split(',').map(Number);
}
`;

async function auditView(cdp, view, env, detailId) {
  const url = view.url ? BASE + view.url.replace("%ENV%", env) : `${BASE}/detail/${encodeURIComponent(detailId)}?env=${env}`;
  await cdp.send("Page.navigate", { url });
  await sleep(4200);

  // 数据就绪检查
  for (let i = 0; i < 25; i++) {
    const ok = await cdp.eval(`(() => {
      const t = window.__newsTree; if (!t) return false;
      const s = t.state(); if (!s.items) return false;
      ${view.key === "list" ? "if (!document.querySelector('#news-list .ncard')) return false;" : ""}
      ${view.key === "board" ? "if (!document.querySelector('#board-list .board-row')) return false;" : ""}
      ${view.key === "detail" ? "if (!document.querySelector('.detail-title, .detail-body')) return false;" : ""}
      ${view.key === "tree" ? "if (!document.querySelector('.sn-name')) return false;" : ""}
      ${view.key === "source" ? "if (!document.querySelector('.leaf-title')) return false;" : ""}
      return true;
    })()`);
    if (ok) break;
    await sleep(200);
  }
  await sleep(600);

  const shotA = await cdp.send("Page.captureScreenshot", { format: "png" });

  // 收集几何 + 前景色（在隐藏之前）
  const targets = JSON.stringify(TARGETS[view.key].map(([sel, label]) => ({ sel, label })));
  const geo = await cdp.eval(`(() => {
    const out = [];
    for (const { sel, label } of ${targets}) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, label, missing: true }); continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) { out.push({ sel, label, offscreen: true }); continue; }
      const cs = getComputedStyle(el);
      const isSvg = el.namespaceURI && el.namespaceURI.includes('svg');
      const raw = isSvg ? cs.fill : cs.color;
      const size = parseFloat(cs.fontSize) || 14;
      const weight = Number(cs.fontWeight) || 400;
      out.push({ sel, label, rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        fg: raw, size, weight, isSvg });
    }
    return JSON.stringify(out);
  })()`);

  // 只把「文字」变透明（HTML 用 color、SVG 用 fill），**保留元素自身的背景**。
  // 注意：不能用 visibility:hidden —— 那会把元素自己的背景一起藏掉，
  // 于是取样到的是元素后面的页面，凡是「自带背景的按钮/胶囊」都会测出假失败。
  await cdp.eval(`(() => {
    for (const { sel } of ${targets}) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const isSvg = el.namespaceURI && el.namespaceURI.includes('svg');
      el.style.setProperty(isSvg ? 'fill' : 'color', 'transparent', 'important');
    }
    return true;
  })()`);
  await sleep(350);
  const shotB = await cdp.send("Page.captureScreenshot", { format: "png" });

  const rows = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const A = await __canvas(${JSON.stringify(shotA.data)});
    const B = await __canvas(${JSON.stringify(shotB.data)});
    const ac = A.getContext('2d'), bc = B.getContext('2d');
    const items = JSON.parse(${JSON.stringify(geo)});
    const out = [];
    for (const it of items) {
      if (it.missing) { out.push({ ...it, note: '元素不存在' }); continue; }
      if (it.offscreen) { out.push({ ...it, note: '不在首屏' }); continue; }
      const bg = __bgAt(bc, it.rect);
      const fgRaw = __parse(it.fg);
      if (!fgRaw) { out.push({ ...it, note: '无法解析前景色 ' + it.fg }); continue; }
      const fg = __over(fgRaw, bg);
      // 大文字判定：>=24px，或 >=18.66px 且 bold(>=700)
      const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
      const ratio = __ratio(fg, bg);
      out.push({ sel: it.sel, label: it.label, size: Math.round(it.size), weight: it.weight,
        large, ratio: Math.round(ratio * 100) / 100,
        fg: fg.map(Math.round).join(','), bg: bg.join(',') });
    }
    return JSON.stringify(out);
  })()`);

  // 恢复
  await cdp.eval(`(() => {
    for (const { sel } of ${targets}) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.style.removeProperty('color');
      el.style.removeProperty('fill');
    }
    return true;
  })()`);

  return JSON.parse(rows);
}

// ---------- 主流程 ----------
const chrome = spawn(findChrome(), [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
  "--no-sandbox", "--hide-scrollbars", "--no-first-run", "--window-size=1366,768", "about:blank"
], { stdio: "ignore" });

const all = [];
try {
  const cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

  const listJson = await (await fetch(BASE + "/api/news")).json();
  const detailId = listJson.items?.[0]?.id;
  if (!detailId) throw new Error("拿不到详情 id");

  for (const env of ["day", "night"]) {
    for (const view of VIEWS) {
      const rows = await auditView(cdp, view, env, detailId);
      all.push({ env, view: view.label, rows });
      const bad = rows.filter((r) => r.ratio != null && r.ratio < (r.large ? 3 : 4.5));
      console.log(`${env.toUpperCase().padEnd(5)} ${view.label.padEnd(6)} 检查 ${rows.length} 项，未达标 ${bad.length} 项`);
      for (const r of rows) {
        if (r.ratio == null) continue;
        const need = r.large ? 3 : 4.5;
        const flag = r.ratio >= need ? "ok  " : "FAIL";
        if (flag === "FAIL") console.log(`      ${flag} ${r.label.padEnd(18)} ${String(r.ratio).padStart(6)}:1  需≥${need}  fg=${r.fg} bg=${r.bg} ${r.size}px/${r.weight}`);
      }
    }
  }
} finally {
  chrome.kill();
}

// 汇总
const flat = all.flatMap((g) => g.rows.filter((r) => r.ratio != null).map((r) => ({ env: g.env, view: g.view, ...r })));
const fails = flat.filter((r) => r.ratio < (r.large ? 3 : 4.5));
console.log(`\n════════ 汇总 ════════`);
console.log(`总计检查 ${flat.length} 项（含重复元素），未达标 ${fails.length} 项`);
if (fails.length) {
  console.log("\n未达标明细：");
  for (const f of fails) {
    console.log(`  ${f.env.toUpperCase()} · ${f.view} · ${f.label} → ${f.ratio}:1（需 ≥${f.large ? 3 : 4.5}）fg=${f.fg} bg=${f.bg} ${f.size}px/${f.weight}`);
  }
}
fs.writeFileSync(".review/contrast-report.json", JSON.stringify(all, null, 1));
console.log("\n明细已写入 .review/contrast-report.json");
process.exitCode = fails.length ? 2 : 0;
