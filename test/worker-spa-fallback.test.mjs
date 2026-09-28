// ============================================================
// Cloudflare Worker：SPA 深链回落（回归用例）
// ------------------------------------------------------------
// 背景（2026-09-28 定位并修复）：
//   生产 newstree.dpdns.org 上 /source/:key 与 /detail/:id 一直返回 404
//   （body = "Not Found"，9 字节）。此前被记为「Cloudflare 面板配置问题」，
//   实际是 Worker 自身的代码缺陷：
//
//   Static Assets 的 html_handling 会把 `/index.html` **307 归一化到 `/`**
//   （实测：GET /index.html → 307, Location: /）。
//   而 Workers 里**入站 Request 的 redirect 默认是 "manual"**，
//   `new Request(url, request)` 会继承该模式 ⇒ `env.ASSETS.fetch("/index.html")`
//   拿到的是 3xx 而不是 200 ⇒ 原代码的 `if (idx.ok)` 为 false ⇒ 落到末尾
//   的 `new Response("Not Found", 404)`。
//
//   影响面：站内跳转全走 history.pushState（不请求服务器），所以「点击没问题」，
//   但分享/收藏/刷新/直接访问深链一律 404。
//
// 本用例用 mock 的 ASSETS 绑定在 Node 里复现该场景，锁住修复。
// 对照实验（wrangler dev --local，同环境）：
//   原始代码 /source/Solidot → 404, 9B "Not Found"
//   修复代码 /source/Solidot → 200, 11861B（完整 index.html）
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(pathToFileURL(path.join(ROOT, "src/index.js")).href)).default;

const INDEX_HTML = "<!doctype html><html lang=\"zh-CN\"><body>新闻树</body></html>";

/**
 * 模拟 Cloudflare Static Assets。
 * @param {Object} opts
 *   indexRedirect: true  → /index.html 返回 307 到 /（真实生产行为）
 *                  false → /index.html 直接 200
 *   noBinding: true      → 不提供 ASSETS 绑定
 */
function mockEnv({ indexRedirect = true, noBinding = false } = {}) {
  const calls = [];
  if (noBinding) return { calls, env: {} };
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(req) {
          const u = new URL(req.url);
          calls.push({ path: u.pathname, redirect: req.redirect });
          if (u.pathname === "/index.html") {
            if (indexRedirect) return new Response(null, { status: 307, headers: { Location: "/" } });
            return new Response(INDEX_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
          }
          if (u.pathname === "/") {
            return new Response(INDEX_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
          }
          return new Response("nope", { status: 404 });
        }
      }
    }
  };
}

const ctx = { waitUntil() {} };

// ============ 1. 核心回归：/index.html 的 307 必须被处理 ============
test("Worker 深链回落：/index.html 返回 307 时仍须拿到 SPA 壳（原缺陷的回归）", async () => {
  const { env, calls } = mockEnv({ indexRedirect: true });
  const res = await worker.fetch(new Request("https://x.dpdns.org/source/Solidot"), env, ctx);
  assert.equal(res.status, 200, "深链必须 200，不能是 Worker 自己的 404");
  const body = await res.text();
  assert.match(body, /<!doctype html>/i, "必须返回 index.html 内容");
  assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  // 关键：请求 /index.html 时不能沿用入站的 redirect: manual 而不处理结果
  assert.ok(calls.length >= 1, "应调用过 ASSETS");
});

test("Worker 深链回落：/detail/:id 同样 200", async () => {
  const { env } = mockEnv();
  const res = await worker.fetch(new Request("https://x.dpdns.org/detail/abc123"), env, ctx);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<!doctype html>/i);
});

test("Worker 深链回落：中文来源 key 也 200", async () => {
  const { env } = mockEnv();
  const res = await worker.fetch(
    new Request("https://x.dpdns.org/source/" + encodeURIComponent("少数派")), env, ctx
  );
  assert.equal(res.status, 200);
});

// ============ 2. 兼容：/index.html 不重定向时也要能工作 ============
test("Worker 深链回落：/index.html 直接 200 的配置同样可用", async () => {
  const { env } = mockEnv({ indexRedirect: false });
  const res = await worker.fetch(new Request("https://x.dpdns.org/source/Solidot"), env, ctx);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<!doctype html>/i);
});

// ============ 3. /api/* 不能被 SPA 回落吞掉 ============
test("Worker：/api/* 走 API 逻辑，不触碰 ASSETS", async () => {
  const { env, calls } = mockEnv();
  const res = await worker.fetch(new Request("https://x.dpdns.org/api/health"), env, ctx);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(calls.length, 0, "API 请求不应经过 ASSETS");
});

test("Worker：未知 /api/ 子路径返回 JSON 404（而不是 HTML 壳）", async () => {
  const { env } = mockEnv();
  const res = await worker.fetch(new Request("https://x.dpdns.org/api/unknown"), env, ctx);
  assert.equal(res.status, 404);
  assert.match(res.headers.get("Content-Type") || "", /application\/json/);
});

// ============ 4. 无 ASSETS 绑定时应优雅 404（不抛异常） ============
test("Worker：缺少 ASSETS 绑定时优雅 404，不抛异常", async () => {
  const { env } = mockEnv({ noBinding: true });
  const res = await worker.fetch(new Request("https://x.dpdns.org/source/Solidot"), env, ctx);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not Found");
});

// ============ 5. 静态源码守卫：禁止再写裸 /index.html fetch ============
test("Worker 源码：不得再出现「直接 fetch /index.html 且只判 ok」的写法", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(path.join(ROOT, "src/index.js"), "utf8");
  assert.ok(/spaShell/.test(src), "应存在 spaShell 辅助函数");
  assert.ok(/redirect:\s*"manual"/.test(src), "应显式声明 redirect 模式并手动处理 3xx");
  assert.ok(/status >= 300 && res\.status < 400/.test(src), "应处理 3xx（Location 跟随）");
  // 反面断言：不允许出现把 /index.html 直接丢给 ASSETS 且不做 3xx 处理的老写法
  assert.ok(
    !/const idx = await env\.ASSETS\.fetch\(new Request\(new URL\("\/index\.html"/.test(src),
    "老写法（裸 /index.html + idx.ok）必须已被移除"
  );
});
