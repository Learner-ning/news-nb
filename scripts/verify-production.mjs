#!/usr/bin/env node
// 生产环境上线校验：确认 newstree.dpdns.org 上跑的确实是 Stage 3.5 之后的版本。
//
// 用法：
//   node scripts/verify-production.mjs
//   node scripts/verify-production.mjs --origin https://newstree.dpdns.org
//
// 设计原则：所有判据都来自生产端**真实响应**（HTTP 状态码 / 响应体特征），
// 不做「推测式通过」。任何一项拿不到证据就报 FAIL 或 UNKNOWN，不报 PASS。

const args = process.argv.slice(2);
const originArg = args.indexOf("--origin");
const ORIGIN = (originArg >= 0 ? args[originArg + 1] : "https://newstree.dpdns.org").replace(/\/$/, "");

const results = [];
let pass = 0;
let fail = 0;
let unknown = 0;

function record(name, status, detail) {
  results.push({ name, status, detail });
  if (status === "PASS") pass++;
  else if (status === "FAIL") fail++;
  else unknown++;
}

async function req(path, init) {
  const url = ORIGIN + path;
  try {
    const r = await fetch(url, { redirect: "manual", ...init });
    const text = await r.text();
    return { ok: true, status: r.status, text, headers: r.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function check(name, cond, detail) {
  record(name, cond ? "PASS" : "FAIL", detail);
}

// ---------- 1. 静态资源：是否已是新版前端 ----------
const index = await req("/");
if (!index.ok) {
  record("首页可访问", "FAIL", index.error);
} else {
  check("首页 HTTP 200", index.status === 200, `status=${index.status}`);
  check(
    "首页带 data-env（Stage 3.5 环境属性）",
    /data-env="(day|night)"/.test(index.text),
    /data-env="(day|night)"/.test(index.text) ? "命中 data-env" : "未命中：仍是旧版首页"
  );
}

const treeLayout = await req("/js/tree-layout.js");
if (!treeLayout.ok) {
  record("tree-layout.js 可访问", "FAIL", treeLayout.error);
} else {
  check(
    "布局引擎 tree-layout.js 已上线",
    treeLayout.status === 200,
    `status=${treeLayout.status} size=${treeLayout.text.length}`
  );
}

const css = await req("/style.css");
if (!css.ok) {
  record("style.css 可访问", "FAIL", css.error);
} else {
  const hasEnv = /body\[data-env="night"\]/.test(css.text);
  const hasVar = /--bg-card\s*:/.test(css.text);
  check("style.css 含语义变量 --bg-card", hasVar, hasVar ? "命中" : "未命中：仍是旧版样式");
  check("style.css 含 body[data-env=\"night\"]", hasEnv, hasEnv ? "命中" : "未命中：仍是旧版样式");
}

// ---------- 2. API：是否已是 Stage 2 之后的瘦身 + warming 版本 ----------
const health = await req("/api/health");
let healthJson = null;
if (!health.ok) {
  record("/api/health 可访问", "FAIL", health.error);
} else {
  try {
    healthJson = JSON.parse(health.text);
  } catch {
    /* 交给下面的判据报错 */
  }
  check("/api/health 返回 ok", healthJson?.ok === true, healthJson ? `itemCount=${healthJson.itemCount}` : "响应不是 JSON");
  check(
    "/api/health 带 warming 字段（新 Worker）",
    healthJson ? Object.prototype.hasOwnProperty.call(healthJson, "warming") : false,
    healthJson && Object.prototype.hasOwnProperty.call(healthJson, "warming")
      ? `warming=${healthJson.warming}`
      : "无 warming 字段：仍是旧 Worker"
  );
}

const news = await req("/api/news");
let newsJson = null;
if (!news.ok) {
  record("/api/news 可访问", "FAIL", news.error);
} else {
  try {
    newsJson = JSON.parse(news.text);
  } catch {
    /* ignore */
  }
  // 冷启动时新 Worker 会返回 202 + warming:true（缓存为空、后台抓取中），这是预期行为
  const acceptable = news.status === 200 || news.status === 202;
  check("/api/news 状态 200/202", acceptable, `status=${news.status} items=${newsJson?.items?.length ?? "?"}`);
  if (Array.isArray(newsJson?.items) && newsJson.items.length) {
    const first = newsJson.items[0];
    check(
      "列表条目已瘦身（不含正文 content）",
      !Object.prototype.hasOwnProperty.call(first, "content"),
      Object.prototype.hasOwnProperty.call(first, "content") ? "仍带 content：旧 API" : `字段数=${Object.keys(first).length}`
    );
    check(
      "列表条目含 heatScore（真实热度）",
      typeof first.heatScore === "number",
      `heatScore=${first.heatScore}`
    );

    const detail = await req(`/api/news/${first.id}`);
    let detailJson = null;
    try {
      detailJson = JSON.parse(detail.text);
    } catch {
      /* ignore */
    }
    check(
      "详情接口按需返回完整条目（含 content）",
      detail.status === 200 && typeof detailJson?.content === "string",
      `status=${detail.status} contentLen=${detailJson?.content?.length ?? "?"}`
    );

    const spa = await req(`/detail/${first.id}`);
    check(
      "SPA 深链 /detail/:id 回落首页",
      spa.status === 200 && /<div id="app"|data-env=/.test(spa.text),
      `status=${spa.status}`
    );
  } else {
    record("列表条目字段检查", "UNKNOWN", "列表为空（冷启动抓取中），无法取样");
  }
}

// ---------- 3. 强制刷新节流（新 Worker 独有行为） ----------
const r1 = await req("/api/news?refresh=1");
const r2 = await req("/api/news?refresh=1");
let j1 = null;
let j2 = null;
try {
  j1 = JSON.parse(r1.text);
  j2 = JSON.parse(r2.text);
} catch {
  /* ignore */
}
if (j1 && j2) {
  const throttleSeen = j1.throttled === true || j2.throttled === true;
  check(
    "refresh 节流生效（60s 内不重复抓取）",
    throttleSeen,
    `第一次 throttled=${j1.throttled} 第二次 throttled=${j2.throttled}`
  );
} else {
  record("refresh 节流检查", "UNKNOWN", "两次 refresh 响应不是 JSON");
}

// ---------- 输出 ----------
const pad = (s, n) => String(s).padEnd(n, " ");
console.log(`\n生产上线校验：${ORIGIN}\n${"-".repeat(72)}`);
for (const r of results) {
  console.log(`${pad(r.status, 8)}${pad(r.name, 42)}${r.detail ?? ""}`);
}
console.log("-".repeat(72));
console.log(`PASS ${pass} / FAIL ${fail} / UNKNOWN ${unknown}`);

if (fail > 0) {
  console.log("\n结论：生产环境**尚未**跑到目标版本（或存在回归），见上面 FAIL 项。");
  process.exitCode = 1;
} else if (unknown > 0) {
  console.log("\n结论：没有 FAIL，但有项目缺少证据（多为冷启动），建议稍后复跑。");
} else {
  console.log("\n结论：生产环境已上线目标版本。");
}
