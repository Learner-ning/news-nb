// ============================================================
// 人工审查服务器（Stage 3.3）
// ------------------------------------------------------------
// 目的：让「人」能在本机打开一个真实数据的页面，用眼睛检查
//       首页无叶片骨架 + Apple 风格 + 点进来源才出现新闻 是否成立。
//
// 与 server.js 的区别（刻意分开，避免污染生产入口）：
//   · 优先读 .review/snapshot.json —— 离线也能跑，审查不依赖网络
//   · 快照不存在时才尝试实时抓取，并把结果落盘成快照
//   · 默认只读：不带 ?live=1 就绝不发起网络请求（结果可复现）
//   · 额外提供 /review-status 页面 + /api/review/meta 元信息，说明数据来源
//
// 用法：
//   node scripts/review-server.mjs            # 默认 4173 端口
//   PORT=5000 node scripts/review-server.mjs  # 自定义端口
//   node scripts/review-server.mjs --refresh  # 强制重新抓取并覆盖快照
// ============================================================
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAll, toListItem } from "../lib/news-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const reviewDir = path.join(rootDir, ".review");
const snapPath = path.join(reviewDir, "snapshot.json");

const args = new Set(process.argv.slice(2));
const forceRefresh = args.has("--refresh");

// ---------- 快照读取 ----------
function readSnapshot() {
  try {
    if (!fs.existsSync(snapPath)) return null;
    const raw = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    if (!raw || !Array.isArray(raw.items)) return null;
    return raw;
  } catch (e) {
    console.warn("[review] 快照解析失败：" + e.message);
    return null;
  }
}

function writeSnapshot({ items, updatedAt, errors }) {
  fs.mkdirSync(reviewDir, { recursive: true });
  const snap = {
    updatedAt,
    fetchedAt: Date.now(),
    itemCount: items.length,
    errors: errors || [],
    items
  };
  fs.writeFileSync(snapPath, JSON.stringify(snap));
  return snap;
}

// ---------- 数据来源决策 ----------
// mode: "snapshot" | "live"
let cache = null;
let mode = "snapshot";
let snapshotMtime = null;

async function bootstrap() {
  const existing = readSnapshot();
  if (existing && !forceRefresh) {
    cache = existing;
    mode = "snapshot";
    snapshotMtime = fs.statSync(snapPath).mtime.toISOString();
    console.log(`[review] 使用快照：${existing.items.length} 条（采集于 ${existing.updatedAt}）`);
    return;
  }
  console.log("[review] " + (forceRefresh ? "强制刷新" : "无快照") + " → 尝试实时抓取…");
  try {
    const r = await collectAll();
    const snap = writeSnapshot(r);
    cache = snap;
    mode = "live";
    snapshotMtime = new Date().toISOString();
    console.log(`[review] 抓取成功：${r.items.length} 条，已写入 .review/snapshot.json`);
  } catch (e) {
    if (existing) {
      // 抓取失败但有旧快照 → 退回快照，保证审查仍可进行
      cache = existing;
      mode = "snapshot";
      snapshotMtime = fs.statSync(snapPath).mtime.toISOString();
      console.warn("[review] 实时抓取失败，回退到既有快照：" + (e.message || e));
    } else {
      cache = { items: [], errors: [{ source: "bootstrap", message: e.message || "抓取失败" }], updatedAt: null, itemCount: 0 };
      console.error("[review] 无快照且抓取失败：" + (e.message || e));
    }
  }
}

const app = express();

// ---------- 审查元信息（页面据此显示「数据来自哪里」） ----------
app.get("/api/review/meta", (_req, res) => {
  res.json({
    mode,
    snapshotPath: path.relative(rootDir, snapPath).replace(/\\/g, "/"),
    snapshotMtime,
    itemCount: cache ? cache.items.length : 0,
    updatedAt: cache ? cache.updatedAt : null,
    fetchedAt: cache ? cache.fetchedAt : null,
    errors: (cache && cache.errors) || [],
    sourceCount: cache ? new Set(cache.items.map((x) => x.source)).size : 0
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    review: true,
    mode,
    itemCount: cache ? cache.items.length : 0,
    updatedAt: cache ? cache.updatedAt : null,
    warming: false,
    errors: (cache && cache.errors) || []
  });
});

app.get("/api/news", (req, res) => {
  const source = req.query.source || "all";
  const items = cache ? cache.items : [];
  const list = source === "all" ? items : items.filter((x) => x.tag === source);
  res.json({
    updatedAt: cache ? cache.updatedAt : null,
    stale: mode === "snapshot",
    warming: false,
    throttled: false,
    errors: (cache && cache.errors) || [],
    items: list.slice(0, 260).map(toListItem)
  });
});

app.get("/api/news/:id", (req, res) => {
  const items = cache ? cache.items : [];
  const found = items.find((x) => x.id === req.params.id);
  if (!found) return res.status(404).json({ error: "新闻不存在（快照里没有这条）" });
  res.json(found);
});

app.use(express.static(publicDir));

// SPA 深链（/source/:key、/detail/:id）
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT) || 4173;

bootstrap().finally(() => {
  app.listen(port, () => {
    console.log("");
    console.log("  新闻树 · 人工审查服务已启动");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  首页（无叶片骨架）: http://localhost:${port}/`);
    console.log(`  审查元信息        : http://localhost:${port}/api/review/meta`);
    console.log(`  数据来源          : ${mode === "snapshot" ? "本地快照（离线可复用）" : "实时抓取"}`);
    console.log(`  快照条目          : ${cache ? cache.items.length : 0}`);
    console.log("  ─────────────────────────────────────────────");
    console.log("  审查要点：");
    console.log("   1. 首页只有树干 + 主枝 + 新闻源节点，没有任何新闻标题");
    console.log("   2. 悬停某个新闻源 → 弹出该来源最新 3 条真实新闻的预览");
    console.log("   3. 点击新闻源 → 才进入它的新闻树，这时才出现新闻叶片");
    console.log("   4. 右上角 ⚙ 可切换 Apple 明亮 / 深色主题");
    console.log("");
  });
});
