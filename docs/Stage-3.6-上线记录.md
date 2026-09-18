# Stage 3.6 上线记录 · 把 Stage 3~3.5 的成果发布到 newstree.dpdns.org

> 交付诚实性：本记录里**所有「生产如何如何」的结论都来自对生产域名的真实 HTTP 请求**（`L2 实测`），
> 截图/像素类结论沿用 Stage 3.5 的 `L1 实拍`。**推送尚未完成，因此「上线后生产状态」一节为空，不做任何推断式填写。**

- 阶段：Stage 3.6（上线）
- 日期：2026-09-18
- 规范来源：`F:\3.6上线.md`
- 上线对象：`https://newstree.dpdns.org`（GitHub `Learner-ning/news-nb` → Cloudflare Workers Static Assets）

---

## 0. 关于规范文件的一处偏差（先说清楚）

`F:\3.6上线.md` 的正文与 `F:\3.4.5.md` **逐字节完全相同**：

```
1524e19145408345a8e619ce6db0fe55  F:\3.6上线.md
1524e19145408345a8e619ce6db0fe55  F:\3.4.5.md
```

也就是说正文内容是「Stage 3.5 DAY/NIGHT 全站主题统一」的规范，而那一阶段**已于 2026-09-18 执行完毕**
（见 `docs/Stage-3.5-DAY-NIGHT全站主题统一记录.md`）。文件正文里**没有新的功能要求**。

因此本次按文件名的语义执行：**上线** —— 把 Stage 3 ~ 3.5 的全部成果合并进 `main` 并发布到生产。
该判断已与用户确认（用户选择「合并到 main 并推送上线」）。

---

## 1. 当前状态

| 项 | 状态 |
|---|---|
| 本地提交 | ✅ 已完成，`main` 已快进到 `6268ded` |
| 本地校验 | ✅ 测试 69/69、语法自检全通过、构建自检可跑 |
| 推送到 GitHub | ⏳ **未完成** —— 沙箱内 `github.com` 的 git 通道不可用（见 §5） |
| 生产发布 | ⏳ 未发生（生产仍是旧版本，见 §4） |
| 上线后复验 | ⏳ 未执行 |

**回滚锚点**：上线前的 `main` = `2178421`，已打标签 `pre-launch-2026-09-18`。

---

## 2. 上线内容

`main` 从 `2178421` 快进到 `6268ded`，共 **11 个提交**，其中本次新增 2 个：

| 提交 | 内容 |
|---|---|
| `f8c09eb` | `feat(ui): Stage 3.3~3.5 —— 无叶片树冠 + 新闻树 UI 视觉重构 + DAY/NIGHT 全站主题统一` |
| `6268ded` | `docs: Stage 0~3.5 交付记录、验收截图与可量化验收工具归档` |
| （此前已在分支上）`135f78a` … `a0e9e40` | Stage 3 / 3.1 / 3.2 / 3.2.1 与 Stage 2 的性能改造（API 瘦身、抓取与请求解耦） |

用户可见的变化：

- **首页是一棵真正的树**：树干 → 分类主枝 → 来源分枝 → 新闻节点，节点带分类色徽标
- **三种布局**：树 / 列表 / 热榜（`?mode=tree|list|board`）
- **DAY / NIGHT 全站环境**：树、列表、热榜、来源页、详情页统一继承，不再有「浅色背景 + 深蓝卡片」
- **深链可用**：`/source/:key`、`/detail/:id`、刷新、前进后退（修复 `parseRoute()` 缺参导致全部回落首页）
- **首屏更快**：`/api/news` 不再携带正文（正文占整包约 64%），详情页按需取

---

## 3. 上线前本地校验（L2 实测）

```
node --test test/source-navigation.test.mjs test/tree-layout.test.mjs \
              test/tree-geometry-stage3.2.1.test.mjs test/tree-bare-geometry.test.mjs
→ # tests 69 / # pass 69 / # fail 0

node --check  public/js/*.js src/index.js server.js lib/news-core.mjs scripts/*.mjs
→ 14/14 OK

node scripts/build-selfcheck.mjs
→ 已生成 docs/stage3.3-首页无叶片-自检.html（209 条真实新闻 / 15 个来源 / 592 KB）
```

工作区在上线提交后**干净**（无未提交改动）。

---

## 4. 生产基线实测（上线**前**）

工具：`node scripts/verify-production.mjs`（新增，判据全部来自生产端真实响应）。
原始输出存档：`.review/prod-baseline-before-launch.txt`。

```
PASS    首页 HTTP 200                               status=200
FAIL    首页带 data-env（Stage 3.5 环境属性）            未命中：仍是旧版首页
FAIL    布局引擎 tree-layout.js 已上线                 status=404
FAIL    style.css 含语义变量 --bg-card               未命中：仍是旧版样式
FAIL    style.css 含 body[data-env="night"]        未命中：仍是旧版样式
PASS    /api/health 返回 ok                         itemCount=200
FAIL    /api/health 带 warming 字段（新 Worker）       无 warming 字段：仍是旧 Worker
PASS    /api/news 状态 200/202                      status=200 items=200
FAIL    列表条目已瘦身（不含正文 content）                仍带 content：旧 API
PASS    列表条目含 heatScore（真实热度）                  heatScore=0.391
PASS    详情接口按需返回完整条目（含 content）              status=200 contentLen=364
FAIL    SPA 深链 /detail/:id 回落首页                  status=404
FAIL    refresh 节流生效（60s 内不重复抓取）              throttled=undefined
------------------------------------------------------------------------
PASS 5 / FAIL 8
```

**生产首页实拍对照**：`<body data-theme="night">`、8081 字节、无 `tree-layout` 引用
（本地新版：`<body data-theme="day" data-env="day">`、11853 字节）。
结论：生产跑的是 **Stage 3 之前的旧版本**。

### 4.1 顺带发现一个**现存的生产缺陷**

`GET https://newstree.dpdns.org/detail/abc123` → `404`，`Content-Type: text/plain`，body 长度 9 = `Not Found`
—— 这是 **Worker 自己返回的 404**（`src/index.js` 末尾那句 `new Response("Not Found", { status: 404 })`），
说明「SPA 深链回落」在生产上**没有生效**（该回落代码在 `4a12cd3` 就已进入主线，生产版本应当包含它）。

可能的成因（**尚未定论，不做断言**）：

1. 生产部署实际未带上 `assets.binding`（`env.ASSETS` 为空 → 直接落到 404 分支）；
2. 或 Cloudflare 项目侧的 Build configuration 与仓库内 `wrangler.jsonc` 不一致。

→ **上线后必须复验这一条**。若仍 404，按 `DEPLOY.md` 检查
Cloudflare 项目 `Settings → Builds & deployments → Build configuration`（`npx wrangler deploy` / `public`）。

---

## 5. 推送（这一步需要在本机执行）

沙箱环境的 `github.com` git 通道不可用，实测两种报错：

```
$ git ls-remote origin
fatal: unable to access '…': CONNECT tunnel failed, response 502

$ git push origin main
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

且本机没有 `gh` CLI、没有 `GITHUB_TOKEN` 环境变量、git 凭据助手（`helper-selector`）里也没有 GitHub 凭据。

**在本机终端执行即可**（会由 Git Credential Manager 弹窗/浏览器完成一次授权）：

```bash
cd "D:\wr new\新闻树"
git push origin main
```

推送后 Cloudflare 会按 `main` 自动构建发布（`npx wrangler deploy`，见 `DEPLOY.md`）。

---

## 6. 上线后复验清单（待执行）

```bash
node scripts/verify-production.mjs
```

期望：**13 项全 PASS**（冷启动时 `/api/news` 允许返回 `202 + warming:true`，属预期）。
必须人工确认的两条：

1. `SPA 深链 /detail/:id 回落首页` —— 见 §4.1，这是本次最可能「推了但没修好」的一条；
2. `refresh 节流生效` —— 证明生产确实换了新 Worker，而不是 CDN 缓存了旧文件。

另外建议手工过一遍：DAY/NIGHT 切换、树/列表/热榜切换、`?mode=list` 直达、`?env=day` 直达。

---

## 7. 回滚方案

**常规回滚（推荐）**：在 GitHub 上 revert `f8c09eb`、`6268ded` 两个提交并推 `main`，
Cloudflare 会重新发布到旧版本。

**紧急回滚（本机执行）**：

```bash
cd "D:\wr new\新闻树"
git reset --hard pre-launch-2026-09-18      # 回到 2178421
git push --force-with-lease origin main
```

`pre-launch-2026-09-18` 标签在本地已创建，指向上线前的 `main`。

---

## 8. 未验证 / 已知限制

| 项 | 说明 |
|---|---|
| **推送与生产发布** | 未完成，本记录不含任何「上线成功」的结论 |
| `/detail/:id` 生产 404 | 成因未定论（§4.1），需上线后复验 |
| Cloudflare 冷启动 | Worker 内存缓存为 isolate 级，冷启动首个请求会拿到 `202 + warming:true`，前端靠轮询补齐；真正的边缘缓存留到 Stage 4 |
| 移动端 | 390×844 已截图，但首页树标签在竖屏下仍需双指放大（Stage 3.4 已记录的限制，本次未处理） |
| 对比度审计覆盖面 | 90 项覆盖主要文字元素，不含 hover/focus 态、空状态、错误提示、骨架屏 |
| 色盲可辨性 | 未做 |

---

## 附：本次新增的工具

| 工具 | 用途 |
|---|---|
| `scripts/verify-production.mjs` | 生产上线校验：13 项判据全部基于生产端真实响应，无证据则报 FAIL/UNKNOWN，不报 PASS |
| `scripts/shots.mjs` | 19 个场景的真实浏览器截图（CDP 驱动 Chrome） |
| `scripts/contrast-audit.mjs` | WCAG 对比度审计（真实渲染像素，90 项） |
| `scripts/build-selfcheck.mjs` | 离线单文件自检页 |
| `scripts/review-server.mjs` | 人工审查用本地服务 |
