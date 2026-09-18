// ============================================================
// 浏览器视觉验收截图（Stage 3.4 §10）
// ------------------------------------------------------------
// 为什么需要它：规范明确要求「必须以实际浏览器视觉结果作为验收依据」，
// 只跑单元测试不算完成。本脚本用 Chrome DevTools Protocol 驱动真实浏览器：
//   · 指定视口尺寸（1366×768 / 1920×1080 / 移动端）
//   · 等待真实数据渲染完成（不是固定 sleep）
//   · 真实鼠标 hover（触发预览卡）—— 这是 --screenshot 命令行做不到的
//   · 截整页 PNG 落盘，作为可复核的 L1 证据
//
// 用法：
//   node scripts/shots.mjs                 # 全部场景
//   node scripts/shots.mjs day-1366        # 只跑匹配的场景
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const outDir = path.join(rootDir, "docs", "验收截图");
const BASE = process.env.SHOT_BASE || "http://localhost:4173";
const PORT = Number(process.env.CDP_PORT) || 9222;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error("找不到 Chrome / Edge 可执行文件");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 极简 CDP 客户端（Node 22 自带 WebSocket，无需 puppeteer） ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }
      }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }
}

async function connectPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        return new CDP(ws);
      }
    } catch { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  throw new Error("无法连接到 Chrome 调试端口");
}

// ---------- 场景定义（§10 的 10 项检查） ----------
// 关键：布局模式通过 URL 直接进入 —— 列表/热榜用 ?mode=list|board，
// 详情用 /detail/:id，来源页用 /source/:key。每个场景都在 day / night 各拍一张。
const MODES = [
  { k: "tree", q: "?mode=tree", label: "首页树" },
  { k: "list", q: "?mode=list", label: "列表" },
  { k: "board", q: "?mode=board", label: "热榜" }
];
const SCENES = [
  ...["day", "night"].flatMap((env) =>
    MODES.map((m) => ({
      name: `${env}-${m.k}-1366`, w: 1366, h: 768,
      url: `/${m.q}&env=${env}`,
      desc: `${env.toUpperCase()} + ${m.label}`
    }))
  ),
  ...["day", "night"].map((env) => ({
    name: `${env}-source-page-1366`, w: 1366, h: 768,
    url: `/source/Solidot?env=${env}`, desc: `${env.toUpperCase()} + 来源页`,
    waitSource: true
  })),
  ...["day", "night"].map((env) => ({
    name: `${env}-detail-1366`, w: 1366, h: 768,
    url: `/detail/__FIRST__?env=${env}`, desc: `${env.toUpperCase()} + 新闻详情`,
    firstDetail: true
  })),
  {
    name: "day-hover-1366", w: 1366, h: 768, url: "/?mode=tree&env=day",
    desc: "首页 DAY · 悬停新闻源（预览卡）", hover: true
  },
  { name: "day-1920", w: 1920, h: 1080, url: "/?mode=tree&env=day", desc: "首页 DAY · 1920×1080" },
  { name: "night-1920", w: 1920, h: 1080, url: "/?mode=tree&env=night", desc: "首页 NIGHT · 1920×1080" },
  { name: "day-mobile-390", w: 390, h: 844, url: "/?mode=tree&env=day", desc: "首页 DAY · 移动端", mobile: true },
  { name: "night-mobile-390", w: 390, h: 844, url: "/?mode=tree&env=night", desc: "首页 NIGHT · 移动端", mobile: true },

  // —— 变体预设（dawn→day / ocean→night）必须也继承正确的环境 ——
  { name: "dawn-variant-1366", w: 1366, h: 768, url: "/?mode=tree&env=dawn", desc: "变体预设 dawn（应继承 DAY 环境）" },
  { name: "ocean-variant-1366", w: 1366, h: 768, url: "/?mode=tree&env=ocean", desc: "变体预设 ocean（应继承 NIGHT 环境）" },

  // —— 自定义背景图 + 压暗层：验证「压暗只在设了图片时生效」这条路径 ——
  // setup 里用 canvas 现画一张亮色渐变当背景图（离线、无外部依赖），
  // 然后写进 localStorage 并重新加载 —— 这样才真的走了一遍用户的设图流程。
  {
    name: "day-photo-1366", w: 1366, h: 768, url: "/?mode=list&env=day",
    desc: "DAY + 自定义亮背景图（压暗层应生效）",
    setup: `(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 64, 64);
      g.addColorStop(0, '#ffd9a0'); g.addColorStop(.5, '#8fd3ff'); g.addColorStop(1, '#ffb3d9');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      localStorage.setItem('nt.bg', JSON.stringify({ theme: 'day', photo: c.toDataURL('image/png'), dim: 0.45 }));
      return true;
    })()`
  },
  {
    name: "night-photo-1366", w: 1366, h: 768, url: "/?mode=list&env=night",
    desc: "NIGHT + 自定义亮背景图（压暗层应生效）",
    setup: `(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 64, 64);
      g.addColorStop(0, '#ffd9a0'); g.addColorStop(.5, '#8fd3ff'); g.addColorStop(1, '#ffb3d9');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      localStorage.setItem('nt.bg', JSON.stringify({ theme: 'night', photo: c.toDataURL('image/png'), dim: 0.45 }));
      return true;
    })()`
  }
];

/** 等真实数据渲染完成：轮询调试 API，直到当前视图真的有内容 */
async function waitReady(cdp, sc) {
  // 判定依据取自 URL 而不是场景名 —— 名字是给人看的，改个名不该影响就绪判定
  const u = sc.url || "";
  const wantList = u.includes("mode=list");
  const wantBoard = u.includes("mode=board");
  const wantDetail = u.includes("/detail/");
  const wantSource = u.includes("/source/");
  for (let i = 0; i < 60; i++) {
    const ok = await cdp.eval(`(() => {
      const t = window.__newsTree;
      if (!t) return false;
      const s = t.state();
      ${wantSource ? "if (!s.source) return false;" : ""}
      if (!s.items) return false;
      ${wantList ? "if (!document.querySelector('#news-list .ncard, #news-list .row-item')) return false;" : ""}
      ${wantBoard ? "if (!document.querySelector('#board-list .board-row')) return false;" : ""}
      ${wantDetail ? "if (!document.querySelector('#detail-content .detail-title, #detail-content .detail-body')) return false;" : ""}
      ${!wantList && !wantBoard && !wantDetail ? `const g = t.tree && t.tree.geom; if (!(g && g.categories && g.categories.length)) return false;` : ""}
      return true;
    })()`);
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

/** 取第一条新闻的 id（详情页场景需要真实 id） */
async function firstDetailId() {
  const r = await fetch(BASE + "/api/news");
  const j = await r.json();
  return (j.items && j.items[0] && j.items[0].id) || null;
}

async function shoot(cdp, sc, ctx) {
  let url = sc.url;
  if (sc.firstDetail) {
    if (!ctx.detailId) { console.log(`  ⚠ ${sc.name}：拿不到详情 id，跳过`); return { ...sc, ready: false }; }
    url = url.replace("__FIRST__", encodeURIComponent(ctx.detailId));
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: sc.w, height: sc.h, deviceScaleFactor: 1, mobile: Boolean(sc.mobile)
  });
  await cdp.send("Page.navigate", { url: BASE + url });
  await sleep(500);
  // 需要预置状态（例如写入 localStorage 的自定义背景图）的场景：
  // 先让页面把 origin 建立起来，跑 setup，再重新加载一次走完整启动流程。
  if (sc.setup) {
    await cdp.eval(sc.setup);
    await cdp.send("Page.navigate", { url: BASE + url });
    await sleep(900);
  }
  const ready = await waitReady(cdp, sc);
  await sleep(800); // 让入场动画（grow-on / 淡入）走完

  let hoverInfo = "";
  if (sc.hover) {
    // 真实鼠标移动到某个来源节点的**徽标圆心**上（用调试 API 拿它的屏幕坐标）。
    // 注意：必须瞄准徽标而不是节点盒中心 —— 盒中心可能落在名称文字上，
    // 而文字是 pointer-events:none，鼠标事件会穿透，预览卡不会弹出来。
    const pos = await cdp.eval(`(() => {
      const t = window.__newsTree, g = t.tree.geom;
      const c = g.categories[Math.min(3, g.categories.length - 1)];
      const r = document.querySelector('#tree-svg').getBoundingClientRect();
      const v = t.tree.view;
      const badgeY = c.node.y - 24;            // 与 tree-view 的 SN_BADGE_R 布局一致
      return {
        x: r.left + c.node.x * v.s + v.tx,
        y: r.top + badgeY * v.s + v.ty,
        name: c.name
      };
    })()`);
    if (pos && Number.isFinite(pos.x)) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x - 40, y: pos.y, buttons: 0 });
      await sleep(140);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y, buttons: 0 });
      await sleep(700); // 等预览卡展开
      const active = await cdp.eval(
        `document.querySelector('.src-node.active')?.getAttribute('data-srcnode') || ''`
      );
      const peek = await cdp.eval(
        `(() => { const p = document.getElementById('peek-card');
           return p && !p.classList.contains('hidden') ? (p.querySelector('#pk-name')?.textContent || '') : ''; })()`
      );
      hoverInfo = `  hover→ ${pos.name}${active ? " ✓高亮" : " ✗未高亮"}${peek ? " ✓预览卡:" + peek : " ✗无预览卡"}`;
    }
  }

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${sc.name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ✓ ${sc.name.padEnd(24)} ${String(sc.w + "×" + sc.h).padEnd(10)} ${ready ? "数据就绪" : "⚠ 数据未就绪"} ${kb}KB${hoverInfo}`);
  return { ...sc, file, ready };
}

// ---------- 主流程 ----------
const filter = process.argv[2];
const scenes = filter ? SCENES.filter((s) => s.name.includes(filter)) : SCENES;
if (!scenes.length) {
  console.error("没有匹配的场景：" + filter);
  process.exit(1);
}

const chrome = spawn(findChrome(), [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
  "--no-sandbox", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--force-device-scale-factor=1", "--window-size=1366,768", "about:blank"
], { stdio: "ignore" });

let results = [];
try {
  const cdp = await connectPage();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  console.log(`浏览器视觉验收（共 ${scenes.length} 个场景）\n`);
  const ctx = { detailId: await firstDetailId() };
  for (const sc of scenes) results.push(await shoot(cdp, sc, ctx));
  // 收尾：清掉测试期间写进 localStorage 的自定义背景图，避免影响后续人工审查
  await cdp.eval(`(() => { localStorage.removeItem('nt.bg'); return true; })()`);
} finally {
  chrome.kill();
}

const bad = results.filter((r) => !r.ready);
console.log(`\n完成：${results.length} 张，输出目录 docs/验收截图/`);
if (bad.length) {
  console.log("⚠ 以下场景数据未就绪（截图可能不完整）：" + bad.map((b) => b.name).join(", "));
  process.exitCode = 2;
}
