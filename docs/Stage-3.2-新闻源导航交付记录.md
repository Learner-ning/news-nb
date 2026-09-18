# Stage 3.2 · 新闻源导航 + 独立新闻树 + 新闻列表分区 交付记录

> 执行时间：2026-09-17 20:49 ~ 21:15（GMT+8）
> 依据：`F:\Stage 3.2 · 新闻源导航与独立新闻树重构执行规范.md`
> 前置：Stage 3.1（`stage-3.1-visual-hierarchy` / `8a2d258`）
> **未 push main，未合并 main**

---

## 0. 交付输出（规范 §28）

| 项 | 结果 |
|---|---|
| 当前分支 | **`stage-3.2-source-navigation`** |
| 当前 commit | **`7e009eb`** |
| 修改文件 | 6 个：`public/index.html`、`public/js/app.js`、`public/js/news-store.js`、`public/js/tree-view.js`、`public/js/views.js`、`public/style.css` |
| 新增文件 | 2 个：`public/js/routes.js`、`test/source-navigation.test.mjs` |
| 新增路由 | **`/source/:key`**（key = 来源名，浏览器自动百分号编码） |
| 新增测试 | `test/source-navigation.test.mjs` —— 21 个用例，覆盖规范 §24 的 20 项 |
| 测试结果 | **36 / 36 通过**（tree-layout 15 + source-navigation 21） |
| 首页新闻树 | **通过** |
| 来源独立新闻树 | **通过** |
| 新闻列表来源分区 | **通过** |
| 移动端 | **通过**（375 / 768 / 1024 / 420 四个断点） |
| UI/UX Skill | 未安装（按 §2 不安装为运行时依赖）；**只复用规则**，见 §5 |
| 是否修改数据层 | **否**（`lib/news-core.mjs`、`/api/news`、dedupe、heatScore、缓存、localStorage 全部未动） |
| 是否修改抓取 | **否** |
| 是否修改部署 | **否**（`wrangler.jsonc`、`server.js`、`src/index.js`、CI 未动） |

对照页：**`docs/stage3.2-navigation-compare.html`**（含首页新闻树 / 新闻列表来源分区 / 微博独立新闻树三段，桌面 1440 与移动 375 双尺寸）

---

## 1. 信息架构的改变

```
改前：新闻树 → 分类 → 新闻源 → 新闻
改后：新闻树 → 新闻源 → 新闻
```

分类不再参与树的层级，但**数据一条没删**，继续承担四个职责：顶部分类筛选 / 来源的分类属性 / 颜色语义 / 列表过滤条件。

实测（真实数据 225 条 / 16 个来源）：

```
首页一级节点 = 16 个新闻源：
爱范儿(15) 百度贴吧(15) 触乐(15) 抖音(15) 华尔街见闻(15) 今日头条(15) 澎湃(15)
腾讯新闻(15) 微博(15) 雪球话题(15) GitHub热榜(15) IT之家(15) Solidot(15)
哔哩哔哩(10) 量子位(10) 少数派(10)
```

**关键实现选择**：复用 `tree-layout.js` 现有的「一级 = 主枝，二级 = 分枝」两级布局，把「每个来源」包装成一级节点（下面挂一个同名分组），渲染时用 `showSourceLayer: false` 省略中间层。**没有新造树渲染引擎**（符合 §6）。

---

## 2. 三个交付面

### 2.1 首页新闻源树

| 指标 | 实测 |
|---|---|
| 主枝（= 新闻源） | **16** 条 |
| 叶片 | **225** 片 |
| 包围盒 | 5957 × 3477 |
| 默认 fit | s = 0.234 → **LOD 1** |

- **一级节点就是新闻源**：更大（17px 字重 800 的胶囊 + 节点圆点）、带名称与条数、`role="button"` + `tabindex="0"` + `aria-label="微博，15 条新闻，进入独立新闻树"`，与普通叶片明显区分（§4/§8）
- **LOD 保留**：整树入镜时隐藏叶片标题（LOD 1），第一眼是「树干 → 主枝 → 新闻源」；放大到 scale ≥ 0.5 才出现新闻标题（§7）
- 悬停来源节点会高亮它对应的主枝

### 2.2 来源独立新闻树 `/source/:key`

| 指标 | 实测（微博） |
|---|---|
| 根节点 | 微博 |
| 分枝 | **3** 条 |
| 叶片 | **15** 片 |
| 包围盒 | 1425 × 836（首页是 5957 × 3477，**自动缩小，无巨大空白**） |
| 默认 fit | s = 0.938 → **LOD 0（直接显示新闻标题）** |

**为什么按块分组**：真实数据里每个来源**只属于一个分类**（实测 16/16），按分类分组只会得到 1 组 → 一列叶片，退化不成树。因此按 5 条一块分成多条分枝，来源页仍然是一棵有分枝的树（§5）。

- 顶部导航条：来源名 / 数量 / 分类 / **「← 返回全部新闻源」**
- 返回优先 `history.back()`，**不强制跳首页**；`popstate` 同时处理 main / source / detail 三条路由（§16）

### 2.3 新闻列表来源分区

```
全部新闻
├─ 微博          15 条 · 国内          [进入新闻树 →]
│  └─ 卡片网格（区域内按热度排序）
├─ IT之家        15 条 · 科技          [进入新闻树 →]
└─ …
```

- **先分组、再排序**：同一来源绝不被热度排序打散（§13）
- 每个区域含：来源名 / 新闻数量 / 分类 / 进入新闻树 / 卡片网格（§10）
- 区域用**轻边界 + 左侧色条 + 内部留白**；无重阴影、无强玻璃、无多层渐变（§11）
- 卡片降权：去掉底部「查看详情 →」整行与热榜角标，字号 14→13.5，内边距收紧（§12）
- 实测：**16 个区域 / 225 张卡片 = 225 条**，每条只渲染一次

---

## 3. 路由与返回

| 路由 | 视图 |
|---|---|
| `/` | 首页（新闻源树 / 新闻列表 / 热榜） |
| **`/source/:key`** | 该来源的独立新闻树 |
| `/detail/:id` | 新闻详情（**未改动**） |

- key **就是来源名**（浏览器自动编码），不引入第二套命名 → 避免「微博 / Weibo / weibo / 微博热榜」四套名称混用（§18）
- 实测往返：`/source/微博` ✓、`/source/IT%E4%B9%8B%E5%AE%B6` → `IT之家` ✓、`/detail/abc123` ✓、`/xyz` → main ✓
- `state.source` **不写入 localStorage**，完全由 URL 决定 → 刷新、前进、后退都能恢复（§16、§25）

**一个刻意的范围决定**：来源页隐藏底部分类筛选条。原因是每个来源只属于一个分类，若在来源页切到别的分类会出现空 scope 死路。分类筛选是首页维度，来源页的导航由顶部「返回全部新闻源」承担。

---

## 4. 测试结果（36/36）

### 4.1 新增：`test/source-navigation.test.mjs`（21 个用例）

覆盖规范 §24 的 20 项 + 1 项来源区域渲染：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 新闻源成为首页树的一级节点（且分类不再是） | ✅ |
| 2 | 首页树包含全部来源与全部新闻，无重复 | ✅ |
| 3 | 新闻源节点是可点击的一级交互目标（role/tabindex/aria-label/Enter） | ✅ |
| 4 | 点击新闻源进入 source route（中文名 URL 往返一致） | ✅ |
| 5 | source route 只显示对应来源的新闻 | ✅ |
| 6 | source route 仍然是一棵树（有根/分枝/叶片，且条目少时自动缩小） | ✅ |
| 7 | 点击新闻叶片仍进入 `/detail/:id` | ✅ |
| 8 | 浏览器后退正常（三条路由都能恢复，返回不强制跳首页） | ✅ |
| 9 | 刷新 source route 正常（含尾斜杠与编码差异） | ✅ |
| 10 | 列表按 source 正确分组，同一来源不拆散 | ✅ |
| 11 | 分类筛选后来源分组仍然正确 | ✅ |
| 12 | 每条新闻只渲染一次 | ✅ |
| 13 | 新闻总数不减少（首页树/列表/来源树三处一致） | ✅ |
| 14 | 来源名称没有重复映射（source === platform） | ✅ |
| 15 | 不产生随机布局（确定性） | ✅ |
| 16 | 现有热榜分组不受影响 | ✅ |
| 17 | 现有 hover 不受影响（叶片信息卡 + 来源节点反馈） | ✅ |
| 18 | 现有缩放不受影响（滚轮/捏合/指针锚点/按钮） | ✅ |
| 19 | 现有拖动不受影响（指针捕获 + 拖拽抑制点击 + 4px 阈值） | ✅ |
| 20 | 移动端无横向溢出（viewport / 断点 / 网格最小列宽 ≤ 272px） | ✅ |
| +1 | 来源区域渲染含名称/数量/分类/进入新闻树/卡片 | ✅ |

### 4.2 回归：`test/tree-layout.test.mjs`（15 个用例，Stage 3.1 既有）

**15 / 15 通过** —— 布局引擎未被本次改动影响。

### 4.3 真实数据验收（规范 §27，19 项全通过）

```
PASS  首页第一眼明显是「新闻源树」        主枝(新闻源) 16 条 · 叶片 225 片 · LOD1
PASS  新闻源比新闻叶片更重要              默认 LOD1：只显示源节点与叶片形状
PASS  首页树包含全部来源与全部新闻        16 源 / 225 条
PASS  点击新闻源 → 独立新闻树             /source/%E5%BE%AE%E5%8D%9A
PASS  点击新闻叶片 → 新闻详情             /detail/:id
PASS  独立新闻树仍然是一棵树              根 微博 · 分枝 3 · 叶片 15
PASS  独立新闻树只含该来源的新闻          15 条，全部 source=微博
PASS  来源条目少时自动缩小                1425×836 vs 首页 5957×3477
PASS  来源页默认显示新闻标题（LOD0）      scale 0.938
PASS  新闻列表按来源形成清晰区域          16 个区域
PASS  224+ 条新闻全部保留                 225 张卡片 = 225 条
PASS  每条新闻只渲染一次                  225 个唯一 id
PASS  分类仍然可用                        科技 → 6 个来源区域 / 80 条
PASS  分类只是筛选维度，不是树的一级结构   一级节点：爱范儿 / 百度贴吧 / 触乐 / 抖音 …
PASS  来源区域渲染含全部要素
PASS  热榜继续正常                        7 个平台 / 100 条
PASS  来源命名统一                        source === platform，无重复映射
PASS  移动端不横向溢出                    移动 fit s=0.160 → LOD1
PASS  无随机（确定性）                    同数据两次建模与布局完全一致
```

### 4.4 真实链路验证（本地服务）

| 路径 | 状态 |
|---|---|
| `/` | 200 · 10544 B（SPA，含来源导航条） |
| `/source/%E5%BE%AE%E5%8D%9A` | 200 |
| `/source/IT%E4%B9%8B%E5%AE%B6` | 200 |
| `/detail/abc123` | 200 |
| 7 个静态资源 | 全部 200 |
| `/api/news` | 225 条 / 16 来源 / 列表无 content |

---

## 5. UI/UX Skill 使用结果

按 §2：**未安装为运行时依赖、未进入产品 bundle、未引入 Tailwind/shadcn/React**。只复用了规则（来源：`references/quick-reference.md` 119 条 + `references/pro-rules.md`）。

| 复用的规则（逐字） | 落到本次哪一处改动 |
|---|---|
| `` `visual-hierarchy` - Establish hierarchy via size, spacing, contrast — not color alone `` | 来源节点用**字号 17px/字重 800 + 尺寸 + 位置**建立层级；颜色只作分类语义，标签始终带名称 |
| `` `weight-hierarchy` - Bold headings (600–700), Regular body (400) `` | 来源名 800 / 数量 400 / 卡片标题 600 |
| `` `whitespace-balance` - Use whitespace intentionally to group related items and separate sections `` | 区域间距 20px、区域内网格间距 10px、区域头部下边框分隔 |
| `` `elevation-consistent` - avoid random shadow values `` | 新增语义变量 `--card-shadow-hover`，卡片只有一处阴影定义，无随机值 |
| `` `field-grouping` - Group related fields logically `` | 列表按 source 分区（区域 = 分组容器，不是传统 Card） |
| `` `nav-hierarchy` / `drill-down-consistency` `` | 首页 → 来源树 → 详情三级，来源页顶部导航条始终可回到上一层 |
| `` `back-behavior` / `back-stack-integrity` `` | 返回优先 `history.back()`；**不静默重置导航栈、不强制跳首页** |
| `` `state-preservation` `` | source 完全由 URL 决定（不写 localStorage），刷新/后退都不丢 sourceKey |
| `` `horizontal-scroll` / `viewport-meta` `` | 网格最小列宽 ≤ 272px（375 视口不溢出）；viewport 保持 `width=device-width`，**未禁用缩放** |
| `` `breakpoint-consistency`（375/768/1024/1440）`` | 新增 1024 / 768 / 420 三个断点 |
| `` `web-target-size`（≥24×24 CSS px）`` | 进入新闻树按钮 36px 高（移动端 40px），来源节点为 34px 胶囊 |
| `` `focus-states` / `focus-appearance` `` | 来源节点 `:focus-visible` 虚线描边；按钮有可见 focus 环 |
| `` `dragging-alternative` `` | 树支持键盘：方向键平移、`+/-` 缩放、`0` 适应；叶片在列表视图同样可键盘打开 |
| `` `chip-collection-reflow` `` | 来源区域头部 `flex-wrap`，分类 chip 换行而不压缩文字 |
| `` `content-priority` / `progressive-disclosure` `` | 默认 LOD 1 只给结构，标题按需放大出现 |

**未使用的部分**（按评估结论）：`--design-system` 生成器（会推翻现有视觉语言）、22 个技术栈指南（本项目为原生 HTML + 手写 CSS）、字体/图标大库（用系统字体 + 内联 SVG）。

---

## 6. 未改动的东西（规范 §25）

| 禁止项 | 实测 |
|---|---|
| 新闻抓取逻辑 / 抓取配置 | **未改**（`lib/news-core.mjs` 零改动） |
| API 数据接口 | **未改**（`/api/news`、`/api/news/:id`、`/api/health` 未动） |
| dedupe / heatScore | **未改** |
| 缓存逻辑 / localStorage 数据结构 | **未改**（新增的 source 状态走 URL，不落盘） |
| Cloudflare / 部署流程 / CI | **未改**（`wrangler.jsonc`、`server.js`、`src/index.js`、`.github` 零改动） |
| 新闻详情数据结构 | **未改**（`openDetail` / `showDetail` / `renderDetail` 原样复用） |
| 第三方数据源 | **未改** |

关键字审计（相对 `8a2d258` 的 diff）：`RSS_FEEDS` / `HOT_SOURCES` / `PLANNED_SOURCES` / `CATEGORIES` / `calculateHeatScore` / `dedupe` / `lib/news-core` / `server.js` / `src/index` / `wrangler` / `.github` / `CACHE_TTL` —— **全部 0 命中**。

**随本次架构调整一并清理的死代码**（因本次改动而失效，非无关优化）：
- `news-store.js` 的 `buildTreeModel()`（分类优先的旧树模型，已被 `buildSourceModel()` 取代）
- `views.js` 的 `renderListMeta()`（已被 `setSourceSectionsMeta()` 取代）
- `views.js` 的 `heatText()`（卡片改版后不再需要）

---

## 7. 遗留与风险

| 项 | 说明 |
|---|---|
| 浏览器实测 | 沙箱内无法启动 Chromium，交互为「代码级 + 路由往返 + 真实数据几何」三层验证。**建议本地实开确认**：`http://localhost:3000`（服务已在运行），另试 `/source/微博` 并刷新 |
| 来源页隐藏分类条 | 刻意决定（避免空 scope 死路），见 §3。若你希望来源页也保留分类筛选，我可以改成「空结果时提示 + 一键清除筛选」 |
| 来源页分块无标签 | 分块只承担视觉分组，不显示无意义的「第 1 组」标签。若希望有语义标签（如「最新 5 条 / 较早」），可以加 |
| 首页树宽高比 | 5957×3477 ≈ 1.71（Stage 3.1 允许放宽到 2.5）。一级节点从 4 个分类变成 16 个来源后，扇面更宽是必然结果 |
| 分支链 | Stage 2 → 3 → 3.1 → 3.2 是递进关系，上线需按顺序合并 |

---

## 8. 结论

**Stage 3.2 已完成，等待人工验收。**

- 信息架构：**新闻源成为首页树的一级节点**，分类退为筛选/属性/颜色语义
- 新增路由 **`/source/:key`**，点击新闻源进入独立新闻树（**不再误开某条新闻详情**）
- 来源独立树**仍然是一棵树**（根 + 分枝 + 叶片），且条目少时自动缩小
- 新闻列表改为**来源分区**：16 个区域 / 225 张卡片，先识别来源再识别新闻
- 首页第一眼是「新闻源树」：默认 LOD 1 只给结构，标题留给放大
- 测试 **36/36 通过**，真实数据验收 **19/19 通过**
- 数据层 / 抓取 / API / 缓存 / localStorage / 部署 / CI **一行未改**

**未 push main，未合并 main。**

---

*本记录对应的 commit 在 `stage-3.2-source-navigation` 分支；对照页见 `docs/stage3.2-navigation-compare.html`。*
