# Stage 3.7 交付记录：五项问题修复与来源扩充

> 触发：用户在 `@scene#16:"网站开发"` 中提出 5 项问题/需求（1 处移动端 bug、1 项新功能、1 处交互 bug、1 项列表改版、1 项来源扩充）。
> 证据分级遵循 `docs/交付诚实性规范.md`：**L1 实拍 > L2 实测 > L3 代码 > L4 推理**；视觉结论必须有 L1 截图。
> 分支：`main`（延续 Stage 3.6 上线线）。**未推送**（用户未要求提交/推送）。

---

## 0. 一句话结论

5 项全部完成，端到端验收 **29/29 PASS**（真实浏览器证据），单元测试 **69/69 PASS**，
对比度审计 **80/80 达标**，19 张标准验收截图全部「数据就绪」。

| # | 需求 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | 手机端底部分类标签栏滑动失效 | ✅ 修复 | 容器宽 126px→**219px**；真实触摸滑动 scrollLeft 前进；L1 截图 |
| 2 | 热榜新增「总榜」 | ✅ 新增 | 跨 12 个来源、50 行、热度降序；L1 截图 |
| 3 | 叶片悬停/点击/触摸 + 卡片不消失 | ✅ 修复 | 移入卡片标题/按钮后卡片仍可见；触摸 tap 先显示再进详情；L1 截图 |
| 4 | 列表改为可竖向滚动的来源长条并按时间排序 | ✅ 改版 | 27 条长条、竖向可滚、默认时间排序、无横向溢出；L1 截图 |
| 5 | 新增可靠新闻源 | ✅ 新增 11 个 | 源 9→**20**（RSS），条目 ~212→**370**；逐个实测可达 |

---

## 1. 需求 1：手机端底部分类标签栏横向滑动失效

### 1.1 根因（L2 实测，不是猜的）

先怀疑是 CSS 缺 `overflow-x` —— 实测发现 **`overflow-x: auto` 一直都在**，CSS 层没问题。
于是写诊断脚本量真实几何（390×844 移动视口）：

| 底栏子元素 | 占用宽度 |
|---|---|
| `.cat-bar-hint`（「分类」二字） | 23px |
| **`#cat-scroll`（标签列表）** | **126px** ← 只够放约 1 个标签 |
| `.env-toggle`（DAY/NIGHT） | 109px |
| `.bar-tools`（🎨 ↻） | 74px |
| 内边距 28px + 间隙 30px | 58px |

**根因**：`.cat-bar` 是 flex row，`#cat-scroll` 与三个「固定宽度兄弟」抢空间。
窄屏下固定兄弟吃掉 264px，标签列表只剩 126px。技术上是「能滚」，但滑动面只有一根手指宽、
且无任何「还有更多标签」的视觉提示 ⇒ 用户感知就是「只能看到前几个」。

### 1.2 修复

1. **宽度优先级重排**（`public/style.css`）：窄屏（≤700px）隐藏「分类」装饰字、
   压缩 DAY/NIGHT 与工具按钮；超窄屏（≤430px）再压一档，并把标签自身 padding 收小。
2. **显式声明手势归属**：`.cat-scroll { touch-action: pan-x; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }`
3. **右缘渐隐提示**：`mask-image` 渐变暗示「右侧还有标签」；滑到最右时加 `.at-end` 去掉渐隐，
   避免最后一个标签看起来被切了一半。由 `syncCatScrollEdge()`（app.js）在 scroll/resize 时维护。

### 1.3 证据

- L2：`#cat-scroll` clientWidth **126px → 219px**（390 视口）/ **96px → 169px**（360 视口）；
  真实 `Input.dispatchTouchEvent` 拖动后 `scrollLeft=54`；滑到最右末标签「财经」
  right=225 ≤ 容器 right=227（完整可见）。
- L1：`docs/验收截图/catbar-390.png`（滑动前，见右缘渐隐）、`catbar-390-end.png`（滑到最右，露出 影视/财经）、
  `verify-r1-catbar-end-390.png`。

---

## 2. 需求 2：热度榜新增「总榜」

### 2.1 设计

原热榜只展示 `kind=hot`（平台热搜）并按平台分组。**总榜**回答的是另一个问题：
「全网此刻最热的是哪几条」——因此把**全部新闻**（RSS 资讯 + 平台热搜）按统一 `heatScore`
跨来源排名，不再按平台分组。

- chip 位置：「**总榜**」放在平台 chips 最前面，默认仍进「全部平台」。
- 实现：`views.js#renderBoardOverall` / `setBoardOverallMeta`；`app.js#renderBoard` 增加 `OVERALL_KEY` 分支。
- 排序键：`heatScore` 降序 → 时间降序 → id（三级稳定排序，保证确定性）。

### 2.2 证据

- L2：chip 列表含「总榜」；点击后渲染 **50 行**、涉及 **12 个不同来源**、热度严格降序（前 3 = 64/55/54）；
  meta 文案「全部来源 370 条 · 按统一热度分值排名」。
- L1：`docs/验收截图/board-overall-1366.png`、`verify-r2-board-overall-1366.png`。

---

## 3. 需求 3：叶片悬停/点击/触摸交互 + 悬浮卡不消失

### 3.1 两个根因

1. **卡片消失**：`svg` 上的 `pointerout` 委托只检查 `relatedTarget.closest('[data-leaf]')`。
   鼠标从叶片移到 `position:fixed` 的悬浮卡上时，`relatedTarget` 在卡片内、不是叶片
   ⇒ 判定为「已离开」⇒ `clearHover()` ⇒ 卡片瞬间消失，用户来不及点「查看详情」。
2. **移动端点叶片**：`pointerout` 会在手指抬起后紧接触发，卡片刚出就闪没；
   且 tap 直接跳详情，用户看不到这条新闻是什么。

### 3.2 修复

1. **卡片免疫**：`tree.isPointerIntoCard(node)` 由 app.js 注入，判定指针是否落入
   `#hover-card` / `#peek-card`；是则不收起。另在卡片上挂 `pointerleave`（真正离开才收起）。
2. **触屏分层交互**：`tree.isTouch()` 判定触屏设备（`hover:none` 或 `coarse`+`maxTouchPoints>0`）。
   触屏上第一次点叶片 → **先显示新闻卡**（写 `_tappedLeaf`），再点同一片 → 进详情；
   触屏的 `pointerout` 直接忽略（收起改由「点空白 / 卡片 pointerleave」驱动）。
3. **卡片夹回视口**：`positionHoverCard` / `positionPeekCard` 原先只做单向避让，
   触屏 click 坐标可能为 0 或贴边 ⇒ 卡片一半在屏外。现统一 `Math.max/min` 夹取到视口内
   （卡片比视口还宽时居中）。

### 3.3 证据（L2 + L1）

- L2 桌面：悬停叶片「索尼公布《战神：劳菲》游戏预购奖励，…」→ 卡片显示完整标题；
  鼠标移到**卡片标题**上 → 卡片仍可见；移到**「查看详情」按钮**上 → 仍可见。
- L2 移动：tap 1 → 卡片显示且**完整落在视口内**（路径仍是 `/source/IT之家`）；
  tap 2 同一片 → 跳到 `/detail/ae826271bb55` 且详情渲染。
- L1：`docs/验收截图/leaf-hover-card-1366.png`、`mobile-tap-leaf-390.png`、
  `verify-r3-leaf-hover-1366.png`、`verify-r3-mobile-tap-390.png`。

---

## 4. 需求 4：列表改为「可竖向滑动的来源长条」并按时间排序

### 4.1 设计

原列表是「来源区域 + 卡片网格」（`.src-section` + `.ss-grid`），把每条新闻都铺成卡片。
改为：**一个来源 = 一条横向长条矩形**（`.src-bar`），彼此上下堆叠，整列由 `.list-view` 竖向滚动。

- 条头：左侧色条 + 来源名 + 「N 条 · 最新 X」+ 分类标签 + 「展开全部」+「进入新闻树」。
- 条内：默认预览该来源**最新 3 条**（时间 · 标题 · 热度），点「展开全部」在原地展开（上限 60 行，
  更多请进该来源树）。
- 排序：**来源之间按「该来源最新一条的时间」倒序**；默认排序 pill 改为「时间」。
- 清理：删除死代码 `sourceSection` / `renderSourceSections` / `card`（避免两套并行实现）。

### 4.2 证据

- L2：27 条 `.src-bar`、每条 3 行 `.sb-row`、旧 `.ss-grid` 已不存在；
  `scrollHeight=6345 > clientHeight=646`（竖向可滚）；`overflowX=false`；
  默认 pill = 「时间」；meta「27 个来源 · 370 条 · 按来源最新时间排序」；
  条序实测「刚刚 → 5 分钟前 → 9 分钟前 → 16 分钟前」递减。
- L1：`docs/验收截图/list-bars-1366.png`、`list-bars-390.png`、`night-list-1366.png`、
  `verify-r4-list-bars-1366.png`。

---

## 5. 需求 5：新增可靠新闻源

### 5.1 方法：先实测，再纳入（不伪造）

写了探针脚本对 **39 个候选 feed** 逐个真实请求，判据 = `HTTP 200` + 内容是合法 XML + 含 `<item>/<entry>`。
**只有三项全过的才写进 `RSS_FEEDS`**；失败的**全部**登记进 `PLANNED_SOURCES` 并注明失败原因，不占位冒充。

### 5.2 新增的 11 个源（全部实测可达）

| 来源 | 分类 | 实测条目 | 备注 |
|---|---|---|---|
| 中国新闻网 | 国内 | 30 | scroll-news |
| 人民网·要闻 | 国内 | 100 | — |
| 新华网·时政 | 国内 | 300 | — |
| 环球时报 | 国内 | 50 | — |
| InfoQ中文 | 科技 | 20 | — |
| 钛媒体 | 科技 | 17 | — |
| 界面新闻 | 财经 | 30 | — |
| 豆瓣影评 | 影视 | 20 | 影评长文归影视 |
| 机核 | 影视 | 20 | 游戏/亚文化归影视 |
| 游研社 | 影视 | 12 | 游戏文化归影视 |
| GitHub周榜 | 科技 | 18 | 与既有日榜互补 |

### 5.3 实测失败（已登记 `PLANNED_SOURCES`，共 18 条）

体育类 RSS 几乎全军覆没（新浪/网易/央视/腾讯/虎扑/懂球帝 **均实测失败**：404 / 403 / 非 RSS），
故「体育」分类**仍靠平台热榜覆盖**，不伪造 RSS 来源。另有澎湃、联合早报、观察者网、BBC中文、
V2EX、虎嗅、cnBeta、品玩、CSDN、财新、第一财经、证券时报等，失败原因逐条记在源码注释里，
避免下次重复试。

### 5.4 附带修复（必要，非「顺手优化」）

源从 9 增到 20 后总量达 370 条，而列表接口硬编码 `slice(0, 260)` ⇒ **排在后面的来源会被整段截掉**
（列表「来源长条」会缺几个来源，属功能性错误）。故把 `server.js` 与 `src/index.js` 的上限
**260 → 400**（两处同步，保持一致），并加注释说明原因。

### 5.5 证据

- L2：`collectAll()` 端到端 **370 条 / 0 错误**；`/api/news` 返回 **27 个来源 / 370 条**；
  8 个抽样新源全部在场。
- 源数：RSS 源 **9 → 20**（+11），并含 7 个平台热榜源。

---

## 6. 验收汇总

### 6.1 端到端验收（真实浏览器）

`node scripts/verify-stage37.mjs`（新增脚本，五项需求逐条判据，拿不到证据报 FAIL/UNKNOWN）：

```
合计 29 项：PASS 29 / FAIL 0
```

> 过程中曾出现 1 项 FAIL，经查是**测试自身假失败**：叶片标题被 `truncateByWidth` 截断并加
> 「…」，与卡片完整标题做全等比较必然不等。已修正为「去尾部省略号后互为前缀」判定，
> **不是产品问题**（诚实记录，避免把测试瑕疵当成功能缺陷）。

### 6.2 单元测试

`npm test` → **69 / 69 PASS**（4 个测试文件）。其中 `test/source-navigation.test.mjs`
的两条用例随设计变更同步更新：
- 「列表卡片 → 详情」→「列表来源长条行 → 详情」（断言选择器改为 `.sb-row`）；
- 「来源区域渲染」→「来源长条渲染」（断言 `.src-bar` / `.sb-row`，并新增「旧网格已移除」检查）。

### 6.3 对比度审计（可量化视觉验收）

`SHOT_BASE=... node scripts/contrast-audit.mjs` → **80 项检查，未达标 0 项**（DAY/NIGHT × 5 视图）。
新增的来源长条、总榜、标签栏均未引入对比度回归。

### 6.4 截图（L1）

`SHOT_BASE=... node scripts/shots.mjs` → **19 张全部「数据就绪」**。
同步修正了 `shots.mjs` 的列表就绪判据（原先等 `.ncard`，现等 `.src-bar`）。

---

## 7. 改动文件清单

| 文件 | 改动 |
|---|---|
| `public/style.css` | 标签栏窄屏优先级 + `touch-action`/渐隐；新增 `.src-bar` 全套样式与窄屏适配；删旧 `.ss-grid` 依赖 |
| `public/index.html` | `#news-list` 加 `sb-wrap` 类；排序 pill 默认「时间」 |
| `public/js/app.js` | `OVERALL_KEY` + `renderBoard` 总榜分支；`syncCatScrollEdge`；`expandedBars`/`toggleSourceBar`；`tree.isPointerIntoCard`/`isTouch`；卡片 pointerleave；触屏点空白收起 |
| `public/js/views.js` | 新增 `renderBoardOverall`/`setBoardOverallMeta`/`renderSourceBars`/`setSourceBarsMeta`/`srcBar`；`positionHoverCard`/`positionPeekCard` 视口夹取；删死代码 |
| `public/js/news-store.js` | `buildListSections` 分区之间按最新时间倒序 |
| `public/js/tree-view.js` | `pointerout` 触屏忽略 + 卡片免疫；触屏 tap 分层交互；`_lastPointerEvent`/`_tappedLeaf`/`isTouch` |
| `lib/news-core.mjs` | `RSS_FEEDS` +11 个实测可达源；`PLANNED_SOURCES` 补 18 条实测失败记录 |
| `server.js` / `src/index.js` | 列表条数上限 260 → 400（两处同步） |
| `scripts/verify-stage37.mjs` | 新增：五项需求端到端验收脚本 |
| `scripts/shots.mjs` | 列表就绪判据 `.ncard` → `.src-bar` |
| `test/source-navigation.test.mjs` | 2 条用例随设计变更同步更新 |

---

## 8. 未做 / 遗留

- **未推送 / 未合并**：用户未要求提交，按纪律不 push。
- **体育类 RSS 仍缺失**：实测 6 个候选源全部不可达，已如实登记；体育暂由平台热榜覆盖。
- **数据层纪律说明**：本次只动了「源配置（新增源）」与「列表接口上限」两处，
  抓取管线 / dedupe / heatScore / 缓存 / 路由 / 详情结构均未改；
  接口上限调整是为修复「新增源被截断」这个由需求 5 直接引出的功能错误，属必要联动。
