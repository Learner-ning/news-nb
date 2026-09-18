# NewsNow Bold（新闻树）代码与体验审查报告

> 审查日期：2026-09-15
> 审查范围：`server.js`、`src/index.js`、`lib/news-core.mjs`、`public/` 全部前端资源、构建与部署配置
> 说明：本报告**仅做分析，不对项目做任何实际修改**

---

## 一、项目现状分析

### 1.1 项目定位与规模

| 项目 | 内容 |
|---|---|
| 名称 | NewsNow Bold（页面品牌名「NOW·新闻树」） |
| 类型 | 新闻聚合站（RSS + 平台热搜），核心特色是可视化 SVG 新闻树 |
| 灵感来源 | `ourongxing/newsnow`（README 与 `优化部署.md` 均提及） |
| 生产域名 | `https://newstree.dpdns.org` |
| 仓库 | `Learner-ning/news-nb`，分支 `main` |

代码规模（不含 `node_modules`）：

| 文件 | 行数 | 职责 |
|---|---:|---|
| `lib/news-core.mjs` | 492 | 抓取 / 解析 / 去重 / 热度评分（全站唯一数据引擎） |
| `public/js/app.js` | 531 | 入口：三视图切换、分类、详情、路由、背景外观 |
| `public/js/tree-view.js` | 486 | 树布局 + SVG 渲染 + 悬停/拖拽/缩放交互 |
| `public/js/views.js` | 170 | 列表卡片 / 热榜 / 详情 / 悬停卡 |
| `public/js/news-store.js` | 115 | 前端数据层 + 树模型构建 |
| `public/js/helpers.js` | 95 | 工具函数 |
| `public/index.html` | 178 | 骨架结构 |
| `public/style.css` | 634 | 全部样式 |
| `server.js` | 78 | 本地 Express 服务 |
| `src/index.js` | 75 | Cloudflare Worker 入口 |
| **合计** | **2854** | |

依赖仅 `express@^5.1.0`（`devDependencies` 实际含 `wrangler`），前端零框架、零构建步骤，全部为原生 ES Modules。

### 1.2 架构分层

整体是清晰的三层结构，这是项目最大的优点：

```
前端视图层 (public/js)  ──  app.js / tree-view.js / views.js / news-store.js
        │  HTTP /api/news, /api/news/:id, /api/health
服务端双实现           ──  server.js (Express, 本地)  ／  src/index.js (Worker, 生产)
        │  import
统一数据引擎           ──  lib/news-core.mjs
        │  fetch
数据源                 ──  9 个 RSS 源 + 7 个平台热搜源（另登记 7 个预留源）
```

**设计上做对的地方**：

1. **数据/布局/渲染分离**：`TreeView.layout()` 是纯几何计算，`build()` 只负责渲染，`attach()` 只管交互。三者边界清楚。
2. **无随机性**：树位置完全由数据驱动，同一批数据生成同一棵树，满足 `优化部署.md` 中「禁止随机坐标」的要求。
3. **单一数据引擎**：本地与生产共用 `lib/news-core.mjs`，避免了两套抓取逻辑。
4. **源适配器注册表**：`RSS_FEEDS` / `HOT_SOURCES` 用配置数组描述源，`enabled` / `weight` / `category` 可调，`PLANNED_SOURCES` 诚实地登记了已知不可达的源而**不伪造数据**。
5. **热度算法独立成函数**：`calculateHeatScore()` 不在 UI 组件里，符合原始需求。

---

### 1.3 代码质量问题

按严重程度排序。

#### 🔴 P0-1：热搜时间戳是伪造的，且污染热度算法 —— ✅ 已修复（2026-09-15）

> **修复状态**：已实施。修改文件 `lib/news-core.mjs`、`public/js/helpers.js`、`public/js/views.js`。

`lib/news-core.mjs:166`：

```js
function fakeTimeAgo(now, rank) {
  return new Date(now - (rank + 1) * 60 * 1000).toISOString();
}
```

调用点有两处：

- `hotEntry()` 第 218 行 —— 热榜接口**不返回发布时间**，于是用「榜单排名」伪造时间：第 1 名 = 1 分钟前，第 10 名 = 10 分钟前。
- `buildRssItems()` 第 175 行 —— RSS 解析不到 `pubDate` 时，按「条目序号」伪造时间。

**三重后果**：

1. **UI 展示假信息**。`helpers.js` 的 `timeAgo()` 会把伪造时间渲染成「刚刚」「3 分钟前」，用户被误导。
2. **热度算法失真**（更严重）。`calculateHeatScore()` 第 396 行：
   ```js
   const fresh = Math.exp(-ageH / 12);
   ```
   `fresh` 占最终得分的 30% 权重。伪造时间让**所有热榜条目和缺日期的 RSS 条目拿到接近满分的新鲜度**（`ageH` 近似为 0），热度被系统性抬高，跨源排序失去可比性。
3. **违反自身设计约束**。`优化部署.md` 明确要求「不要简单按照爬取先后排序」「新闻位置必须稳定、可预测」，而当前实现实质上仍是用序号冒充时间。

**建议修法**：热搜条目 `publishedAt` 置为 `null`（或 `fetchedAt`），在 `calculateHeatScore()` 中为「无发布时间」单独分支——只依赖榜单名次 + 来源权重 + 去重加成；UI 侧时间标签显示为「热榜第 N 位」而非相对时间。

**实际修复方案**：

1. **删除 `fakeTimeAgo()`**，在 `hotEntry()` 与 `buildRssItems()` 中改为 `publishedAt: null`，并新增 `hasRealTime` 布尔标记贯穿全链路（源条目 → `dedupe()` → `collectAll()` 输出 → API `items`）。
2. **`calculateHeatScore()` 增加分支**：`hasRealTime === true` 时时间衰减项权重维持 `0.30`、榜单名次权重 `0.14`；否则时间衰减项取中性值（`fresh = 0.5`）且权重降至 `0.12`，让出的 `0.18` 全部转给 `rankBonus`，使热榜条目**仍按排名区分强弱**而不再凭虚假新鲜度抢占前排。
3. **UI 侧新增 `timeLabel(x)`**（`helpers.js`）：优先渲染真实相对时间；无真实时间且有 `hotRank` 时显示「热榜第 N 位」；两者皆无显示「时间未知」。`timeAgo()` / `fmtFull()` 补上非法日期防御，不再让 `Invalid Date` 渲染成「NaN 天前」。`views.js` 中卡片、热榜行、悬停卡、详情页四处调用点全部改用 `timeLabel()`。

**验证结果**（真实抓取 207 条）：

| 检查项 | 结果 |
|---|---|
| 热搜条目 `publishedAt === null` 且 `hasRealTime === false` | 违规 0 条（共 82 条热搜） |
| 真实新闻保留 `hasRealTime === true` | 110 条有时间 / 15 条无时间 |
| 热榜排名区分度仍在 | rank1=0.371、rank5=0.359、rank10=0.344 |
| 时间衰减对真实新闻仍生效 | 0h=0.576、6h=0.457、24h=0.316、72h=0.276 |
| **热度榜首 10 名构成** | **全部为有真实时间戳的新闻**（修复前被伪造「刚刚」的热搜条目占据） |

#### 🔴 P0-2：README 承诺的环境变量不存在

`README.md` 第 24 行写明支持 `FEED_TIMEOUT_MS` 环境变量，但 `lib/news-core.mjs:12` 是硬编码：

```js
const REQUEST_TIMEOUT_MS = 15000;
```

用户按文档配置该变量**完全无效**，且无任何提示。这是文档与实现的直接冲突。

#### 🟠 P1-1：服务端逻辑双份重复

`server.js:27-68` 与 `src/index.js:26-46` 实现了几乎逐行对应的 API 逻辑（路由匹配、`source` 过滤、`slice(0,260)` 截断、错误封装、404 文案），差异仅有：

- 缓存 TTL：`server.js` 用 `CACHE_TTL_MS`（默认 5 分钟）；`src/index.js:9` 硬编码 `120000`（2 分钟）
- `server.js` 有 `stale` 兜底返回机制（第 18-20 行），Worker 版**没有**——生产环境的降级能力弱于本地开发环境，方向反了

任何 API 变更需改两处，是最典型的技术债漂移点。**建议**：把路由分发与响应封装下沉到 `lib/news-core.mjs`（或新建 `lib/api.mjs`），两边只做「取出 URL → 调用 → 返回 Response」的薄适配。

#### 🟠 P1-2：手写正则解析 XML，鲁棒性不足

`parseFeedXml()`（第 121-155 行）用正则匹配 `<item>` / `<entry>`。已知会失败或出错的场景：

- CDATA 内嵌套 `]]>`、多层命名空间前缀（`<media:content>` 等）处理依赖 `[a-zA-Z0-9-]*:` 模式，非标准前缀会漏匹配
- `tag()` 用**非贪婪**匹配，若内容里含同名标签会产生截断
- 无 XML 实体完整支持、无编码探测（GBK 站点会乱码）
- `<link>` 自闭合与属性顺序未做严格处理

虽然「零依赖适配 Worker」的取舍可以理解，但应在函数上方明确标注**已知局限**，并补上针对真实 feed 样本的单测。

#### 🟠 P1-3：零测试、零 lint、零类型检查

`package.json` 只有 `start` / `dev` 两个脚本：

```json
"scripts": { "start": "node server.js", "dev": "node --watch server.js" }
```

没有 `test`、`lint`、`typecheck`，也没有 CI workflow。而项目**配置了 `git push` 自动部署到生产域名**——一次手误提交就会直接影响线上。

最可惜的是，四个纯函数**极其容易单测却完全没有覆盖**：

| 函数 | 位置 | 可测性 |
|---|---|---|
| `calculateHeatScore` | `news-core.mjs:387` | 纯函数，输入 item+ctx 输出数值 |
| `titleSimilarity` | `news-core.mjs:338` | 纯函数，已 export |
| `dedupe` | `news-core.mjs:348` | 纯函数 |
| `parseFeedXml` | `news-core.mjs:121` | 纯函数，已 export |

#### 🟡 P2-1：死代码与冗余实现

| 位置 | 问题 |
|---|---|
| `helpers.js:77` `slugify()` | 全项目无引用 |
| `helpers.js:22` `fmtClock()` | 全项目无引用 |
| `helpers.js:81` `el()` | 全项目无引用 |
| `news-store.js:99` `leafWidthFor()` | 无引用；`tree-view.js:83` 的 `leafW()` 是另一套算法 |
| `news-store.js:105` `leafMeta()` | 无引用 |
| `views.js:5` `heatText()` vs `views.js:150` | 同一热度文案在两处重复实现 |
| `helpers.js:52` `seenTag` Map | 按访问顺序分配颜色，**跨会话不稳定**；且与 `orderTags` 的优先顺序未对齐 |
| `style.css` | 纯追加式堆叠，`.card` / `.lg-cards` / `.row-item` / `.b-dup` / `.hc-dup` / `.leaf-meta` 等已被后续版本覆盖或废弃，估计 100+ 行无效规则 |

#### 🟡 P2-2：魔法数字散落各处

`slice(0, 260)`（两处）、`HOT_PER_SOURCE = 15`、`RSS_PER_FEED = 15`、相似度阈值 `0.94`、`norm.length >= 10`、`TTL = 120000`、`REQUEST_TIMEOUT_MS = 15000`、`CAT_GAP = 150`、`CLUSTER_GAP = 62`、`ROW_STEP = 96`、`HEAT_KEYS` 数组……全部硬编码。

其中 `CATEGORIES`（`news-core.mjs:18`）、`TAG_ORDER`（`helpers.js:60`）、`TAG_PRIORITY`（`news-store.js:96`）**三处定义了分类顺序且取值不一致**：

```js
// news-core.mjs:18
export const CATEGORIES = ["科技", "体育", "国内", "影视", "财经"];
// helpers.js:60
const TAG_ORDER = ["科技", "体育", "国内", "影视", "财经"];
// news-store.js:96
const TAG_PRIORITY = ["综合", "科技", "数码", "AI", "财经", "国际", "国内", "体育", "娱乐"];
```

新增分类时必须记得改三处，否则排序行为不一致。**建议合并为前端从 API 获取的单一份配置**。

#### 🟡 P2-3：静默吞异常

`app.js` 中大量空 `catch`：`loadBg()`(59)、`save()`(93)、`saveBg()`(97)、状态初始化(65/68/71/74/77)、`fileToDataUrl` 调用处(492)、背景图片探测(127)……共 10 余处。用户上传图片失败、背景 URL 无效、`localStorage` 写满时**界面毫无反馈**，表现为「点了没反应」。

#### 🟡 P2-4：密钥与敏感信息 —— ✅ 通过

已核查：`.gitignore` 排除 `.env` / `.env.*` / `*.log`；`wrangler.jsonc` 无 secret；源码中无任何 Token/API Key；`DEPLOY.md` 明确声明「本仓库不含任何 Token/Secret」。**此项无问题**。

> 注：`lib/news-core.mjs:35` 的微博源使用了 `warmup: "https://weibo.com/"` 预热以获取游客 Cookie，属于运行时行为，不涉及硬编码凭据。但需知晓该通道随时可能失效。

---

### 1.4 用户体验与交互流程问题

#### 🔴 UX-1：首屏加载存在明显断层

`app.js:510` 的 `boot()` 直接 `await initData()`。冷启动需并行抓取 **16 个源**（9 RSS + 7 热搜），实测耗时通常在 3~10 秒。

这段时间内：

- 树区域因 `svg.classList.toggle("no-tree", ...)` → `visibility: hidden` 而**完全空白**
- 顶栏只有一句静态文案「正在连接…」
- **没有骨架屏、没有进度指示、没有「先展示旧数据再更新」策略**

对比：NewsNow 采用客户端 `cacheSources` Map + TanStack Query `placeholderData`，第二次访问**立刻出内容**（见 2.2 节）。

#### 🔴 UX-2：树交互在触摸端近乎不可用

- 信息卡**只由 `pointerover` 触发**（`tree-view.js:433`），触摸设备上原生 hover 语义不成立
- 操作提示 `tree-hint` 在 `max-width: 860px` 时被 `display: none`（`style.css:462`）——**移动端用户完全不知道可以拖拽和缩放**
- `touch-action: none` 加在整个 SVG 上（`style.css:206`），会与浏览器自身的双指缩放冲突
- 侧边 dock 在窄屏遮挡树的左侧内容，**没有做窄屏默认折叠**

#### 🟠 UX-3：冗余与失效的控件

| 控件 | 问题 |
|---|---|
| `#zoom-fit` / `#zoom-reset` | `app.js:383-384` 两个按钮绑的是**同一个函数** `tree.fit(true)`，功能完全等同，属冗余 UI |
| `#tree-hint` | 移动端隐藏 |
| `.leaf-meta` 样式 | 对应的 DOM 已不再渲染（叶片改为纯标题） |

#### 🟠 UX-4：缩放后叶片不可读

树宽度随数据量线性膨胀（`CAT_GAP=150`、`CLUSTER_GAP=62`，分类与源越多树越宽）。`fit()` 为保证整树入镜会把缩放 `s` 压得很小，**叶片文字变成不可读的色块**，而这恰恰是「新闻树」最核心的浏览方式。

缺少**语义缩放**：scale 低于阈值时应隐藏文字或做聚类聚合，而不是硬缩。

#### 🟠 UX-5：「热榜」与「列表/树」数据高度重叠且无视觉区分

`buildTreeModel()`（`news-store.js:61`）不区分 `kind`，热榜条目同样进入树和列表。于是同一条微博热搜会在三个视图里各出现一次，而**叶片、卡片上没有任何标识区分「热搜」与「新闻」**。

`README` 把「共用同一数据源」当作设计选择说明，但从用户视角看这是信息重复而非信息组织。

#### 🟡 UX-6：核心功能缺位

一个新闻聚合站通常必备的下列能力**全部缺失**：

| 能力 | 状态 | 备注 |
|---|---|---|
| 关键词搜索 | ❌ | 无搜索框 |
| 收藏 / 稍后读 | ❌ | `localStorage` 已在用，实现成本极低 |
| 已读标记 | ❌ | 无法区分看过没看过 |
| 分页 / 无限滚动 | ❌ | 硬 `slice(0, 260)`，超出直接消失 |
| 源健康度面板 | ❌ | `errors` 数组已拿到，只在顶栏显示「部分源不可用」，不告诉用户**哪个源**坏了 |
| 详情页连续浏览 | ❌ | 无「上一条/下一条」，必须返回列表重新定位 |
| 自动刷新 | ❌ | 只能手动点，新闻站通常 5~15 分钟自动拉取 |
| 深浅色跟随系统 | ❌ | 无 `prefers-color-scheme` |
| PWA / 离线 | ❌ | 无 manifest、无 Service Worker |
| 快捷键 | ❌ | 无 `j/k`、`/` 搜索、`Esc` 等 |

#### 🟡 UX-7：主题切换名不副实

`body[data-theme="dawn"]`（`style.css:28`）只把 `--bg0` / `--bg1` 调亮：

```css
body[data-theme="dawn"] { --bg0: #27476f; --bg1: #6489bd; --ink: #fdf6ff; }
```

但卡片背景仍是深蓝（`color-mix(in srgb, #101c38 92%, transparent)`），`--ink` 仍是近白。**所谓「明亮晨曦」实际还是深色卡片 + 深色背景**，三套主题观感差异有限，缺少真正的浅色主题。

用户上传浅色背景图时，浅色叶片文字会糊在浅色底上，只能靠手动拖「背景压暗」滑块兜底。

#### 🟡 UX-8：状态反馈不完整

- 刷新按钮只有旋转动画，**不 disable**。虽然 `loadNews()` 有 `state.loading` 守卫，但视觉上不支持「已点击」的语义
- 刷新时不清空旧状态，「X 条 · HH:MM 更新」在加载过程中仍显示上一轮数字
- 无错误 Toast / 提示条，失败与成功的区分仅靠顶栏一小段灰字

#### 🟡 UX-9：键盘可访问性缺口

列表与热榜支持 `Enter` / `Space`（`app.js:398-406`），但：

- **树视图叶片完全无法键盘访问** —— SVG `<g>` 没有 `tabindex`、没有方向键导航、没有焦点样式
- 折叠面板缺 `aria-expanded` / `aria-controls`
- 背景设置面板是 `role="dialog"` 但**无焦点陷阱**、无 `Esc` 关闭、无 `aria-modal`

---

## 二、对比分析

选取 4 个同类项目对比。其中 `ourongxing/newsnow` 是本项目的直接灵感来源与事实上的参照基准。

### 2.1 对比对象概览

| 维度 | **本项目** NewsNow Bold | **NewsNow** | **DailyHotApi** | **TrendRadar** | **RSS-Aggregator** |
|---|---|---|---|---|---|
| 定位 | 可视化新闻树聚合站 | 热榜聚合阅读器 | 热榜纯 API | 热榜分析 + 推送 | 自托管 RSS 阅读器 |
| Star | — | ~21.5k | ~5k+ | ~10k+（含 Fork） | 新兴 |
| 语言 | JavaScript（原生 ESM） | TypeScript | TypeScript | Python | Python |
| 框架 | 无（零依赖前端） | React 19 + Nitro | Fastify / Hono | 无（脚本） | Flask |
| 服务端 | Express 5 / CF Worker | Nitro（多运行时） | Node / Vercel | GitHub Actions / Docker | Flask + APScheduler |
| 数据库 | ❌ 纯内存 | ✅ db0 (SQLite/D1) | ❌ 内存 | ❌ 文件输出 | ✅ SQLite/PG |
| 源数量 | 9 RSS + 7 热榜 | **66** | 40+ | 11（借 NewsNow API） | 用户自加 |
| 测试 | ❌ 无 | ✅ Vitest | 部分 | ❌ | ❌ |
| 前端构建 | 无构建 | Vite + UnoCSS | — | — | — |
| 交互形态 | **SVG 树（独有）** | 卡片网格 + 拖拽 | 无 UI | 网页 + 推送 | 经典列表 |

---

### 2.2 NewsNow —— 本项目最直接的参照系

这是本项目在 `优化部署.md` 里明确对标的项目。差距集中在**工程体系**而非功能创意。

#### 可借鉴点 1：源的文件级隔离与自动发现

NewsNow 的 `server/sources/` 下**一个源一个文件**，通过 Nitro 的 glob import 自动注册：

```ts
import * as x from "glob:./sources/{*.ts,**/index.ts}"
```

新增源只需**丢一个文件进去，不改任何注册表**。相比之下，本项目所有源都在 `news-core.mjs` 一个 492 行的文件里（`RSS_FEEDS` + `HOT_SOURCES` + `parseHot()` 中 7 个 `else if` 分支）。

**影响**：本项目新增一个热搜源的解析逻辑，必须在 `parseHot()` 那 90 行的 `if/else` 链里再加一个分支，函数会持续膨胀。

#### 可借鉴点 2：双时间窗口缓存 + 源级 interval

NewsNow 用**两个独立常量**控制两件事（源码注释原文）：

> `interval` 刷新间隔，对于缓存失效也要执行的。本质上表示本来内容更新就很慢，这个间隔内可能内容压根不会更新。
> 而 `TTL` 缓存失效时间，在时间范围内，就算内容更新了也要用这个缓存。

TTL 全局 30 分钟，`interval` **逐源标级**：微博热搜 2 分钟、华尔街见闻 5 分钟、多数热榜 10 分钟、Solidot 这类日更站 1 小时。

**本项目现状**：单一全局 `CACHE_TTL_MS`，且两个服务端实现取值不同（5 分钟 vs 2 分钟）。**所有源被同等对待** —— 日更的 Solidot 和秒级的微博热搜用同一个刷新周期，既浪费请求又不够实时。

#### 可借鉴点 3：抓取失败时用旧缓存兜底

NewsNow 在 `catch` 块里直接返回数据库中的历史数据，「只要数据库里还有一份，前端就永远有东西可看」。

**本项目现状**：
- `server.js:18-20` **有**这层兜底（`stale: true`）
- `src/index.js` **没有** —— 生产环境一旦某个源全挂且缓存已冷，用户直接看到空页

即：**本地开发环境的容错能力优于生产环境**，方向是反的。

#### 可借鉴点 4：客户端响应缓存

NewsNow 的卡片用 `cacheSources` Map 缓存响应，Query 配置为：

```ts
staleTime: Infinity, refetchOnMount: false, refetchOnReconnect: false,
refetchOnWindowFocus: false, retry: false, placeholderData: prev => prev
```

配合 `IntersectionObserver` 懒加载（`once: true`），**第二次打开秒出内容，首屏只加载可视区卡片**。

**本项目现状**：`news-store.js` 的 `state` 是纯内存，刷新页面即清空，每次都全量重新抓取 16 个源 → 对应前面 UX-1 的首屏空白问题。

#### 可借鉴点 5：排名变化指示器

NewsNow 的 `hottest` 类型列表会**对比上一次抓取结果，显示名次升降**（`extra.diff`），并有 5 秒自动隐藏动画。

**本项目现状**：只有静态 `热榜#N`，**无法感知「某条热搜正在上升」** —— 而这恰恰是热榜类产品最有价值的信息。服务端已有 `fetchedAt`，实现成本不高（需引入历史快照存储）。

#### 可借鉴点 6：可腐烂架构（Rotting Architecture）

这是 NewsNow 最值得学习的设计哲学（引自技术博客分析）：

> 它承认每一个源都会死，然后把「死」设计成系统的**常规状态**。源与源之间文件级隔离，死了不影响邻居。缓存让死亡有潜伏期，回退让死亡有尸体可用，双窗口让大部分死亡根本不会被用户看见。

判据是「**影响半径**」：一个源死掉，影响半径应限于它自己那一个文件。

**本项目现状**：`collectAll()` 用 `Promise.all` + 逐源 `try/catch`，**这一点做对了**，单源失败不影响整体。但源定义与解析逻辑耦合在同一个大文件里，影响半径被放大到「改一处要动公共文件」。

#### 可借鉴点 7：命令面板搜索（⌘K）

NewsNow 用 `cmdk` 提供 ⌘K 命令面板搜索，并将源码元数据预生成为 `shared/pinyin.json` **支持拼音检索**。

**本项目现状**：无任何搜索。

#### 本项目**优于** NewsNow 的地方

也应客观看到，本项目在三处做得比参照项目更好：

1. **新闻树是原创的信息组织方式**。NewsNow 是卡片网格，本项目用「分类→来源→新闻」的树形结构表达信息层级，是真正的差异化创新。
2. **零依赖、零构建**。整个前端没有 npm 依赖、没有构建步骤，`git push` 即部署，运维成本远低于 NewsNow 的 Vite + Nitro + UnoCSS 体系。
3. **不伪造数据**。`PLANNED_SOURCES` 诚实登记已知不可达的源（知乎 401、虎扑 404、懂球帝 403）并明确写在不抓取列表里。相比之下 NewsNow 源码中**直接硬编码了一颗共享的微博游客 Cookie**（`server/sources/weibo.ts`），这是更激进也更脆弱的做法。

---

### 2.3 DailyHotApi —— 纯 API 的接口设计参照

| 维度 | DailyHotApi 做法 | 本项目现状 |
|---|---|---|
| 接口形态 | 每个热榜源一个独立路由，如 `/weibo`、`/zhihu` | 单一 `/api/news?source=`，靠 query 过滤 |
| RSS 输出 | ✅ 支持 `?rss` 参数输出 RSS | ❌ 只输出 JSON |
| 缓存 | 统一缓存中间件，TTL 可配置 | 两套独立缓存实现，TTL 不一致 |
| 错误处理 | 标准化错误响应结构 | 只有 `{ error: string }`，无错误码 |

**可借鉴**：

1. **RSS 输出能力**。加一个 `?format=rss` 参数，本项目立刻可以被其他 RSS 阅读器订阅 —— 从「一个网站」变成「一个数据源」，获得外部集成能力。实现成本很低（`news-core.mjs` 已有完整的解析侧代码，逆向序列化即可）。
2. **标准错误结构**。当前错误只有一段中文字符串，客户端无法程序化区分「源失效」与「网络超时」。

---

### 2.4 TrendRadar —— 主动推送与增量追踪参照

TrendRadar 与本项目定位不同（它是「分析 + 推送」工具，不是浏览站），但两点设计值得吸收：

#### 1. 增量模式与首次发现时间

TrendRadar 的 `incremental` 模式记录每条热点的**首次发现时间、出现时间范围、出现次数**：

```
关键词 | [平台名] | [排名] | - 12时30分 - | [12:30 ~ 14:00] | (4 次)
```

**本项目现状**：只有 `fetchedAt`（抓取时间），**无历史追踪**。因此无法回答「这条热搜已经挂了 6 小时了」或「这是今天新冒出来的」——而这正是判断信息价值的关键维度。

#### 2. 关键词过滤语法

TrendRadar 支持三种语法：普通词（或）、`+必须词`（与）、`!过滤词`（非），并支持空行分隔多词组独立统计。

**本项目现状**：`HEAT_KEYS` 数组（`news-core.mjs:382`）硬编码了 20 个词用于热度加权，用户**无法自定义关注词，也无法屏蔽不想看的内容**。

#### 3. 多渠道推送

企业微信 / 飞书 / 钉钉 / Telegram，支持分批推送（应对消息长度限制）。

**本项目现状**：无任何推送能力。不过这与「浏览站」定位相符，可作为可选扩展。

---

### 2.5 RSS-Aggregator —— 阅读器完备性参照

这是经典 RSS 阅读器的功能基线，可用作「缺什么」的清单：

| 功能 | RSS-Aggregator | 本项目 |
|---|---|---|
| 关键词搜索（标题+摘要+正文） | ✅ | ❌ |
| 按源筛选 / 仅看未读 | ✅ | ❌ |
| OPML 导入导出 | ✅ | ❌ |
| 全文抓取（`BeautifulSoup` 补全摘要） | ✅ | ❌（仅用 RSS 自带 description） |
| 逐源自定义更新间隔（最小 5 分钟） | ✅ | ❌（全局统一 TTL） |
| 邮件通知 | ✅ | ❌ |
| 持久化存储（SQLite / PostgreSQL） | ✅ | ❌（纯内存，重启即失） |
| 中英双语界面 | ✅（i18n 模块） | ❌（仅中文） |
| Docker 部署 | ✅ | ❌（有 Express/Worker，但无 Dockerfile） |

**最值得借鉴的两点**：

1. **OPML 导入导出** —— 让用户能把已有的 RSS 订阅生态带进来，是自托管阅读器的标准能力。
2. **全文抓取** —— 本项目详情页内容质量受限于 RSS 自带摘要。`item.content` 对热搜条目甚至是模板拼接的说明文字（`news-core.mjs:203-204`），详情页价值有限。抓取原文正文能实质提升详情页质量。

---

### 2.6 差距总结

| 类别 | 差距等级 | 核心差距 |
|---|---|---|
| **工程体系** | 🔴 大 | 无测试、无 lint、无类型检查、无 CI，却已配置自动部署到生产 |
| **数据可靠性** | 🔴 大 | 伪造时间戳污染热度算法；两套服务端实现能力不对等 |
| **缓存策略** | 🟠 中 | 单一全局 TTL，无源级 interval，无客户端缓存，无浏览器端持久化 |
| **功能完备性** | 🟠 中 | 搜索/收藏/已读/分页/自动刷新/推送全缺 |
| **首屏与性能** | 🟠 中 | 无骨架屏、无懒加载、无缓存复用，冷启动 3~10 秒空白 |
| **可访问性** | 🟠 中 | 树视图无键盘访问，触摸端 hover 语义不成立，ARIA 不完整 |
| **可扩展性** | 🟡 小 | 源定义集中在一个大文件，新增源需改公共代码 |
| **信息组织** | 🟢 优势 | SVG 新闻树是原创亮点，同类项目无一具备 |
| **运维成本** | 🟢 优势 | 零依赖零构建，显著优于 NewsNow 的完整工具链 |

---

## 三、优化建议

按优先级分四个批次。P0 为**正确性问题**，建议优先修复。

### P0 · 正确性修复（建议立即处理）

| # | 建议 | 涉及文件 | 要点 |
|---|---|---|---|
| 1 | ✅ **已修复** 停止伪造时间戳 | `lib/news-core.mjs` | 已删除 `fakeTimeAgo()`；热搜条目与缺日期 RSS 的 `publishedAt` 置 `null`；新增 `hasRealTime` 标记贯穿全链路 |
| 2 | ✅ **已修复** 热度算法增加「无时间」分支 | `lib/news-core.mjs:387` | 已实现：无真实时间时 `fresh` 取中性值 0.5 且权重降至 0.12，让出的 0.18 转给 `rankBonus` |
| 3 | ✅ **已修复** UI 时间标签适配 | `public/js/views.js`、`helpers.js` | 已新增 `timeLabel()`；四处调用点已替换；`timeAgo`/`fmtFull` 补非法日期防御 |
| 4 | **修正 README 与实现不一致** | `lib/news-core.mjs` 或 `README.md` | 二选一：让 `REQUEST_TIMEOUT_MS` 读取 `FEED_TIMEOUT_MS`，或从 README 删除该变量说明 |
| 5 | **Worker 补充 stale 兜底** | `src/index.js` | 对齐 `server.js:18-20` 的降级逻辑，抓取失败且有旧缓存时返回 `stale: true` 而非空数组 |
| 6 | **合并三处分类顺序定义** | `news-core.mjs` / `helpers.js` / `news-store.js` | 统一为单一来源（建议 API 返回分类配置），消除三份不一致的 `CATEGORIES` / `TAG_ORDER` / `TAG_PRIORITY` |

### P1 · 工程体系补强

| # | 建议 | 要点 |
|---|---|---|
| 7 | **引入测试** | 用 Node 内置 `node:test`（零新依赖，契合项目风格）覆盖 `calculateHeatScore` / `titleSimilarity` / `dedupe` / `parseFeedXml` / `normTitle` 五个纯函数。为 `parseFeedXml` 准备真实 feed 样本（含 CDATA、Atom、命名空间、GBK） |
| 8 | **抽取共享 API 层** | 新建 `lib/api.mjs` 收敛路由分发 + 响应封装 + 错误结构；`server.js` 与 `src/index.js` 只保留运行时适配（约 20 行）。消除双份逻辑漂移 |
| 9 | **引入 lint + format** | ESLint + Prettier（或 `oxlint`，更快）。加一个 `npm run check` 串联 lint + test |
| 10 | **加最小 CI** | GitHub Actions：`push` 时跑 `npm run check`，失败则阻断（注意：当前是 push 即自动部署，CI 是唯一的防线） |
| 11 | **环境变量收敛** | 建立 `lib/config.mjs` 集中读取 `PORT` / `CACHE_TTL_MS` / `FEED_TIMEOUT_MS` / `MAX_ITEMS`，并统一本地与 Worker 的默认值 |
| 12 | **清理死代码** | 删除 `slugify` / `fmtClock` / `el` / `leafWidthFor` / `leafMeta`；合并两套叶片宽度算法；合并 `heatText` 重复实现；清理 `style.css` 中已废弃规则 |

### P2 · 用户体验提升

| # | 建议 | 要点 |
|---|---|---|
| 13 | **骨架屏 + 缓存优先渲染** | 首屏立即渲染树/列表骨架；用 `localStorage` 持久化上次结果（约 260 条 JSON，需评估体积），有缓存时**先渲染旧数据**再后台更新，彻底消除 3~10 秒空白 |
| 14 | **源级 interval** | 给每个源加 `interval` 字段（微博热搜 2min、快讯类 5min、多数热榜 10min、日更站 60min），替代当前全局统一 TTL。这是 NewsNow 已验证的方案 |
| 15 | **触摸端交互改造** | 叶片点击 → 弹出信息卡（而非依赖 hover）；小屏**默认折叠**侧栏并在树容器内保留操作提示；评估 `touch-action` 是否从全局改为 `pan-x pan-y` 以保留页面滚动 |
| 16 | **语义缩放** | scale 低于阈值（如 0.5）时隐藏叶片文字、只渲染色块轮廓；低于更低阈值时按来源聚类为单个节点。保证缩小时仍是可读的信息密度图 |
| 17 | **区分热搜与新闻** | 叶片/卡片上加轻量标识（如小角标 📈 或不同边框样式）；列表视图加「仅看新闻 / 仅看热搜」筛选 |
| 18 | **补常用功能** | 搜索框（前端过滤 + 高亮）→ 收藏/稍后读（`localStorage`）→ 已读标记 → 无限滚动或分页。按此顺序，因为后续功能依赖前面 |
| 19 | **详情页连续浏览** | 加「上一条/下一条」按钮 + `←/→` 键，基于当前列表顺序。消除「返回后需重新定位」的挫败感 |
| 20 | **自动刷新** | 默认 5 分钟自动拉取（可关）；页面 `visibilitychange` 到前台时触发一次；刷新按钮在加载中 disable 并显示状态 |
| 21 | **统一状态反馈** | 加轻量 Toast 组件，用于：刷新成功/失败、复制链接、背景图加载失败、localStorage 写入失败。同步替换 10 余处空 `catch` |
| 22 | **清理冗余控件** | `#zoom-fit` 与 `#zoom-reset` 合并为一个；或让「重置」恢复初始缩放比、「适应」仅重新居中 |
| 23 | **源健康面板** | 用已有的 `errors` 数组，在背景设置面板或独立入口中展示「哪个源失败、原因是什么、最后一次成功时间」 |
| 24 | **真正的浅色主题** | 新增 light 主题需把卡片背景、`--ink`、边框一起调整，而非只改 `--bg0/--bg1`；加 `prefers-color-scheme` 自动跟随；自定义背景图时**自动调整压暗值**（检测图片平均亮度） |

### P3 · 架构演进（中长期）

| # | 建议 | 要点 |
|---|---|---|
| 25 | **源适配器文件化** | 参照 NewsNow，把每个源的解析函数拆成独立模块（如 `lib/sources/weibo.mjs`），用一个注册表 `import`。把 `parseHot()` 里 90 行的 `if/else` 链拆开，让「一个源腐坏」的影响半径限于单文件 |
| 26 | **引入持久化** | 当前纯内存，重启即失、无法做历史对比。可选：Cloudflare D1 / KV，或 Docker 部署时挂 SQLite。**这是「排名变化指示器」和「增量追踪」的前置条件** |
| 27 | **排名变化与增量追踪** | 有了持久化后，记录每条的 `firstSeenAt` / `lastSeenAt` / `occurrences` / `rankDiff`，实现 NewsNow 的排名升降指示器与 TrendRadar 的增量模式 |
| 28 | **关键词自定义** | 把硬编码的 `HEAT_KEYS` 改为用户可配置的关注词/屏蔽词（参考 TrendRadar 的 `+必须词` / `!过滤词` 语法） |
| 29 | **RSS 输出能力** | 加 `?format=rss`，让本站可被其他阅读器订阅，获得外部集成生态 |
| 30 | **全文抓取** | 对详情页质量提升显著（尤其热搜条目当前只有模板文案）。需注意反爬与版权边界 |
| 31 | **Docker 部署** | 参照 `RSS-Aggregator` 补 `Dockerfile` + `docker-compose.yml`，降低非 Cloudflare 用户的部署门槛 |
| 32 | **PWA** | 加 manifest + Service Worker，支持安装到桌面与离线查看已缓存内容 |
| 33 | **可访问性专项** | 树叶片支持键盘导航（方向键遍历 + `Enter` 打开 + 焦点环）；背景面板加焦点陷阱与 `Esc` 关闭；补 `aria-expanded` / `aria-controls` / `aria-live`（状态变化播报） |

---

### 建议落地顺序

```
第一批（正确性，1~2 天）
  P0 全部 6 项  ── 修复伪造时间戳 → 热度算法分支 → UI 适配 → 文档修正 → Worker 兜底 → 分类统一

第二批（工程防线，2~3 天）
  7 测试 → 8 API 层抽取 → 9 lint → 10 CI
  ── 有 CI 之后，后续所有改动才有安全网

第三批（体验，1 周）
  13 骨架屏+缓存优先  → 14 源级 interval  → 15 触摸端  → 16 语义缩放
  → 21 统一状态反馈  → 22 清理冗余控件  → 18 搜索/收藏/已读

第四批（架构，视投入而定）
  26 持久化  →  25 源文件化  →  27 排名变化/增量  →  28 关键词  →  32 PWA
```

---

### 一句话结论

本项目的**产品创意（SVG 新闻树）在同类项目中独一无二**，且零依赖零构建的取舍带来了极低的运维成本 —— 这两点是真实优势。

主要短板集中在**工程可靠性**（伪造时间戳污染核心算法、无任何测试却已自动部署生产）和**阅读体验完备性**（无搜索、无缓存复用、首屏 3~10 秒空白、触摸端交互缺失）。

**最优先的一件事**：修掉 `fakeTimeAgo()`。它不只是显示问题 —— 它在系统性地扭曲整个站点的热度排序，而热度排序是这个产品的核心信息组织逻辑。

> ✅ **已于 2026-09-15 完成修复**（详见 1.3 节 P0-1）。修复后热度榜前 10 名已全部变为带真实时间戳的新闻，热搜条目按榜单名次独立排序，不再抢占前排。
