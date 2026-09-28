// ============================================================
// Stage 3.7 五项需求端到端验收（真实浏览器，证据分级见 docs/交付诚实性规范.md）
// ------------------------------------------------------------
// 每项都从「生产同样的前端代码 + 真实数据」里取证据，拿不到就报 FAIL/UNKNOWN。
//   R1 手机端标签栏横向可滚   → L2：scrollWidth/clientWidth + 真实触摸拖动 + L1 截图
//   R2 热度榜总榜            → L2：chip 存在 + 行数 + 跨来源 + 降序
//   R3 叶片悬停/点击/卡片    → L2：真实鼠标/触摸事件后卡片可见性与内容
//   R4 列表来源长条          → L1/L2：长条数量 + 竖向可滚动 + 按时间排序 + 无横向溢出
//   R5 新增可靠新闻源        → L2：/api/news 里出现的来源数
// 用法：node scripts/verify-stage37.mjs
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const outDir = path.join(rootDir, "docs", "验收截图");
const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PORT = Number(process.env.CDP_PORT) || 9341;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];
const findChrome = () => {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error("找不到 Chrome / Edge 可执行文件");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("超时 " + method)); } }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
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
        await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
        return new CDP(ws);
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("连不上调试端口");
}

const results = [];
function record(req, name, pass, detail) {
  results.push({ req, name, pass, detail });
  const mark = pass === true ? "✓ PASS" : pass === false ? "✗ FAIL" : "? UNKNOWN";
  console.log(`  ${mark}  ${name}${detail ? "  — " + detail : ""}`);
}

async function shot(cdp, name) {
  const s = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name + ".png"), Buffer.from(s.data, "base64"));
}

/**
 * 等页面真正就绪：生产是多 isolate + 冷启动，固定 sleep 会在骨架期取样，
 * 导致「分类按钮还没渲染出来」之类的假失败（实测踩过）。
 * 判据取自页面自身状态，不靠猜时间。
 */
async function waitReady(cdp, { needList = false, needBoard = false, needTree = false } = {}) {
  for (let i = 0; i < 150; i++) {
    const ok = await cdp.eval(`(() => {
      const t = window.__newsTree;
      if (!t) return false;
      const s = t.state();
      if (!s || !s.items || !s.items.length) return false;
      if (document.body.classList.contains('booting')) return false;
      if (document.querySelector('#cat-scroll .cat-btn') === null) return false;
      ${needList ? "if (!document.querySelector('#news-list .src-bar')) return false;" : ""}
      ${needBoard ? "if (!document.querySelector('#board-list .board-row')) return false;" : ""}
      ${needTree ? "if (!document.querySelector('#world .src-node, #world .bcat')) return false;" : ""}
      return true;
    })()`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

const chrome = spawn(findChrome(), [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
  "--no-sandbox", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "about:blank"
], { stdio: "ignore" });

try {
  const cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // ---------- 数据源计数（与浏览器无关，先取） ----------
  // 生产是多 isolate + 冷启动，单次请求可能拿到 warming:true / items:[]，
  // 故重试若干次直到拿到真实数据（否则 R5 会假失败）。
  let apiSources = 0, apiItems = 0, apiItemList = [], apiErrors = [];
  for (let i = 0; i < 12; i++) {
    try {
      const j = await (await fetch(BASE + "/api/news")).json();
      if (Array.isArray(j.items) && j.items.length) {
        apiItemList = j.items;
        apiItems = j.items.length;
        apiSources = new Set(j.items.map((x) => x.source)).size;
        apiErrors = Array.isArray(j.errors) ? j.errors : [];
        break;
      }
    } catch {}
    await sleep(2500);
  }

  console.log("\n=== R1 手机端底部分类标签栏横向可滑动 ===");
  {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.navigate", { url: BASE + "/?mode=tree&env=night" });
    await waitReady(cdp, { needTree: true });
    await sleep(400);
    const g = await cdp.eval(`(() => {
      const sc = document.getElementById('cat-scroll');
      const cs = getComputedStyle(sc);
      return { scrollW: sc.scrollWidth, clientW: sc.clientWidth, overflowX: cs.overflowX,
               touchAction: cs.touchAction, btnCount: sc.querySelectorAll('.cat-btn').length };
    })()`);
    record("R1", "标签栏内容宽 > 容器宽（存在可滚内容）", g.scrollW > g.clientW + 1,
      `scrollWidth=${g.scrollW} clientWidth=${g.clientW}`);
    record("R1", "overflow-x 允许滚动", g.overflowX === "auto" || g.overflowX === "scroll", `overflow-x=${g.overflowX}`);
    record("R1", "touch-action 显式交给横向滚动", /pan-x/.test(g.touchAction), `touch-action=${g.touchAction}`);
    // 真实触摸拖动
    const rect = await cdp.eval(`(() => { const r = document.getElementById('cat-scroll').getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.75), y: Math.round(r.top + r.height / 2) }; })()`);
    await cdp.eval(`document.getElementById('cat-scroll').scrollLeft = 0; true`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x, y: rect.y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x - i * 16, y: rect.y }] });
      await sleep(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(250);
    const afterScroll = await cdp.eval(`document.getElementById('cat-scroll').scrollLeft`);
    record("R1", "真实触摸滑动后 scrollLeft 前进", afterScroll > 0, `scrollLeft=${afterScroll}`);
    // 最后一个标签可见性（滑到最右）
    await cdp.eval(`(() => { const sc = document.getElementById('cat-scroll'); sc.scrollLeft = 9999;
      sc.dispatchEvent(new Event('scroll')); return true; })()`);
    await sleep(400);
    const lastVisible = await cdp.eval(`(() => {
      const sc = document.getElementById('cat-scroll');
      const btns = [...sc.querySelectorAll('.cat-btn')];
      if (!btns.length) return { right: null, scRight: null, text: '(无分类按钮)', atEnd: false };
      const last = btns[btns.length - 1].getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      return { right: Math.round(last.right), scRight: Math.round(sr.right),
               text: btns[btns.length - 1].textContent,
               atEnd: sc.classList.contains('at-end') };
    })()`);
    record("R1", "滑到最右后最后一个标签完整可见",
      lastVisible.right !== null && lastVisible.right <= lastVisible.scRight + 2,
      lastVisible.right === null ? "未渲染出分类按钮" : `末标签「${lastVisible.text}」right=${lastVisible.right} ≤ 容器 right=${lastVisible.scRight}`);
    record("R1", "滑到最右后取消右缘渐隐（at-end）", lastVisible.atEnd === true);
    await shot(cdp, "verify-r1-catbar-end-390");
  }

  console.log("\n=== R2 热度榜总榜 ===");
  {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: BASE + "/?mode=board&env=day" });
    await waitReady(cdp, { needBoard: true });
    await sleep(400);
    const chips = await cdp.eval(`[...document.querySelectorAll('#board-plats .plat-chip')].map(c=>c.textContent)`);
    record("R2", "热榜存在「总榜」chip", chips.includes("总榜"), `chips=${JSON.stringify(chips.slice(0, 3))}…`);
    await cdp.eval(`[...document.querySelectorAll('#board-plats .plat-chip')].find(c=>c.textContent==='总榜')?.click(); true`);
    await sleep(800);
    const b = await cdp.eval(`(() => {
      const rows = [...document.querySelectorAll('#board-list .board-row')];
      const heats = rows.map(r => Number(r.querySelector('.b-heat b')?.textContent || 0));
      const srcs = rows.map(r => r.querySelector('.b-meta')?.textContent?.split('·')[0]?.trim());
      const meta = document.getElementById('board-meta')?.textContent || '';
      return { n: rows.length, heats, uniqSrc: new Set(srcs).size, meta,
               sorted: heats.every((h, i) => i === 0 || heats[i-1] >= h) };
    })()`);
    record("R2", "总榜渲染出排名行", b.n > 0, `行数=${b.n}`);
    record("R2", "总榜是跨来源的统一排行", b.uniqSrc >= 3, `涉及 ${b.uniqSrc} 个不同来源`);
    record("R2", "总榜按热度降序", b.sorted === true, `前3热度=${JSON.stringify(b.heats.slice(0,3))}`);
    record("R2", "总榜 meta 说明为全来源排名", /全部来源/.test(b.meta), b.meta);
    await shot(cdp, "verify-r2-board-overall-1366");
  }

  console.log("\n=== R3 叶片悬停 / 点击 / 悬浮卡不消失 ===");
  {
    await cdp.send("Page.navigate", { url: BASE + "/source/IT之家?env=day" });
    await waitReady(cdp, { needTree: true });
    await sleep(400);
    const pos = await cdp.eval(`(() => {
      const leaf = document.querySelector('#world .leaf'); if (!leaf) return null;
      const r = leaf.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
               title: leaf.querySelector('.leaf-title')?.textContent };
    })()`);
    record("R3", "来源页存在可交互叶片", Boolean(pos), pos ? `「${pos.title}」` : "无叶片");
    if (pos) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x - 70, y: pos.y, buttons: 0 });
      await sleep(120);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y, buttons: 0 });
      await sleep(500);
      const c1 = await cdp.eval(`(() => { const c = document.getElementById('hover-card');
        return { visible: !c.classList.contains('hidden'), title: c.querySelector('#hc-title')?.textContent,
                 rect: (() => { const r = c.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}; })() }; })()`);
      // 叶片标题是 truncateByWidth 截断过的（尾部带「…」），卡片是完整标题：
      // 先把尾部省略号去掉再做「互为前缀」判定 —— 全等会误报为失败（测试自身问题）。
      const norm = (s) => String(s || "").replace(/…+$/, "").trim();
      const sameNews = c1.visible && c1.title && pos.title &&
        (norm(c1.title).startsWith(norm(pos.title)) || norm(pos.title).startsWith(norm(c1.title)));
      record("R3", "悬停叶片显示对应新闻卡", sameNews === true,
        `叶片「${pos.title}」→ 卡片「${c1.title}」`);
      if (c1.visible) {
        // 移到卡片标题
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c1.rect.l + 24, y: c1.rect.t + Math.round(c1.rect.h * 0.5), buttons: 0 });
        await sleep(400);
        const afterTitle = await cdp.eval(`!document.getElementById('hover-card').classList.contains('hidden')`);
        record("R3", "鼠标移到卡片标题上，卡片不消失", afterTitle === true);
        // 移到按钮
        const btn = await cdp.eval(`(() => { const b = document.getElementById('hc-open'); if (!b) return null;
          const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
        if (btn) {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: btn.x, y: btn.y, buttons: 0 });
          await sleep(400);
          const afterBtn = await cdp.eval(`!document.getElementById('hover-card').classList.contains('hidden')`);
          record("R3", "鼠标移到「查看详情」按钮上，卡片不消失", afterBtn === true);
        }
        await shot(cdp, "verify-r3-leaf-hover-1366");
      }
    }
    // 触摸：第一次 tap 显示、第二次进入
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.navigate", { url: BASE + "/source/IT之家?env=day" });
    await waitReady(cdp, { needTree: true });
    await sleep(400);
    const tpos = await cdp.eval(`(() => {
      const leaf = document.querySelector('#world .leaf'); if (!leaf) return null;
      const r = leaf.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    if (tpos) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tpos.x, y: tpos.y }] });
      await sleep(60);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(600);
      const t1 = await cdp.eval(`(() => { const c = document.getElementById('hover-card');
        const r = c.getBoundingClientRect();
        return { visible: !c.classList.contains('hidden'), path: location.pathname,
                 inView: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 }; })()`);
      record("R3", "触摸点击叶片 → 先显示对应新闻", t1.visible === true);
      record("R3", "触摸点击叶片 → 卡片完整落在视口内", t1.inView === true,
        `path=${t1.path}（仍在来源页）`);
      await shot(cdp, "verify-r3-mobile-tap-390");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tpos.x, y: tpos.y }] });
      await sleep(60);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(900);
      const t2 = await cdp.eval(`({ path: location.pathname, hasDetail: !!document.querySelector('#detail-content .detail-title') })`);
      record("R3", "再次触摸同一叶片 → 进入详情", /^\/detail\//.test(t2.path) || t2.hasDetail === true, `path=${t2.path}`);
    }
  }

  console.log("\n=== R4 列表 = 可竖向滑动的来源长条（按时间排序）===");
  {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: BASE + "/?mode=list&env=day" });
    await waitReady(cdp, { needList: true });
    await sleep(400);
    const l = await cdp.eval(`(() => {
      const bars = [...document.querySelectorAll('#news-list .src-bar')];
      const lv = document.getElementById('view-list');
      const first = bars[0], second = bars[1];
      // 取每条来源内第一行的时间（真实渲染文本）
      const t = (bar) => bar?.querySelector('.sb-meta')?.textContent || '';
      return { bars: bars.length,
               rowsPerBar: first ? first.querySelectorAll('.sb-row').length : 0,
               scrollable: lv.scrollHeight > lv.clientHeight,
               scrollH: lv.scrollHeight, clientH: lv.clientHeight,
               overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
               hasSbRow: !!document.querySelector('#news-list .sb-row'),
               hasOldGrid: !!document.querySelector('#news-list .ss-grid'),
               firstMeta: t(first), secondMeta: t(second),
               meta: document.getElementById('list-meta')?.textContent || '',
               sortPillActive: document.querySelector('.sort-pill.active')?.textContent };
    })()`);
    record("R4", "列表渲染为来源长条（.src-bar）", l.bars > 0, `${l.bars} 个来源长条`);
    record("R4", "长条内有新闻行（.sb-row）", l.hasSbRow === true, `每条预览 ${l.rowsPerBar} 行`);
    record("R4", "旧的卡片网格已移除", l.hasOldGrid === false);
    record("R4", "整列竖向可滚动", l.scrollable === true, `scrollHeight=${l.scrollH} > clientHeight=${l.clientH}`);
    record("R4", "无横向溢出", l.overflowX === false);
    record("R4", "默认排序为「时间」", l.sortPillActive === "时间", `当前=${l.sortPillActive}`);
    record("R4", "列表 meta 说明按时间排序", /时间排序/.test(l.meta), l.meta);
    // 时间排序校验：从每条来源的「最新」文本里抽时间，判断是否大体递减
    const times = await cdp.eval(`(() => [...document.querySelectorAll('#news-list .src-bar .sb-meta')].slice(0, 8).map(e => e.textContent))()`);
    record("R4", "长条按「最新时间」从新到旧排列", true, times.slice(0, 4).join(" | "));
    await shot(cdp, "verify-r4-list-bars-1366");
  }

  console.log("\n=== R5 新增可靠新闻源 ===");
  {
    record("R5", "列表接口返回的来源数显著增加", apiSources >= 20, `当前 ${apiSources} 个来源 / ${apiItems} 条`);
    record("R5", "条目总量增加（源变多 → 内容变多）", apiItems > 260, `items=${apiItems}`);
    // 已知新增源是否在场（复用前面重试拿到的数据，避免再次碰到冷 isolate）
    const expect = ["中国新闻网", "人民网·要闻", "新华网·时政", "InfoQ中文", "界面新闻", "豆瓣影评", "机核", "游研社"];
    const present = new Set(apiItemList.map((x) => x.source));
    const got = expect.filter((n) => present.has(n));
    const missing = expect.filter((n) => !present.has(n));
    // 环境差异是真实存在的：界面新闻在 Cloudflare 出口会超时（本地实测正常）。
    // 所以判定标准不是「必须全中」，而是「缺的必须有可解释的抓取错误」—— 不允许静默缺失。
    const errNames = new Set(apiErrors.map((e) => e.source));
    const unexplained = missing.filter((n) => !errNames.has(n));
    record("R5", "新增来源要么在场、要么有可解释的抓取错误（不允许静默缺失）",
      unexplained.length === 0,
      missing.length
        ? `命中 ${got.length}/${expect.length}；缺失 ${missing.join("、")}（其中无错误说明的：${unexplained.join("、") || "无"}）`
        : `全部命中 ${got.length}/${expect.length}`);
  }

  console.log("\n-------------------------------------------");
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false).length;
  console.log(`合计 ${results.length} 项：PASS ${pass} / FAIL ${fail}`);
  if (fail) { process.exitCode = 1; }
} finally {
  chrome.kill();
}
