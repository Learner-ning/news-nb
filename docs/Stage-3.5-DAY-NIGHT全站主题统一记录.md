# Stage 3.5 交付记录 · DAY / NIGHT 全站主题统一

> 验收依据：**真实浏览器截图**（Chrome DevTools Protocol 驱动，19 张，全部落在 `docs/验收截图/`）。
> 另有**像素级取样**作为客观证据，见 §3。

- 阶段：Stage 3.5
- 日期：2026-09-18
- 数据：`.review/snapshot.json`（209 条真实新闻 / 15 个真实来源）
- 规范来源：`F:\3.4.5.md`

---

## 1. 结论

问题**不是调色**，而是两层结构性缺陷：

1. **主题与布局耦合** —— 列表/热榜/详情把颜色写死在组件里（`#101c38`、`#0f1a33`、`#d2ddf2`…），
   与 DAY/NIGHT 无关，所以 DAY 下列表必然是深蓝卡片。
2. **背景压暗层无条件生效** —— 这是本次挖出的**真正让 DAY 发灰的根因**（§3）。

改完后：

| 检查 | 结果 |
|---|---|
| DAY + 列表 | 卡片纯白 `rgb(255,255,255)`、标题 `rgb(27,26,23)`、底 `rgb(229,236,241)` ✅ |
| NIGHT + 列表 | 卡片 `rgb(17,26,44)`、标题 `rgb(233,237,245)`、底 `rgb(9,14,28)` ✅ |
| 树 / 列表 / 热榜 / 来源页 / 详情 是否继承同一环境 | 是（截图 19 张逐张核对）✅ |
| 切换 DAY/NIGHT 是否全站同步 | 是（`data-env` 一个属性驱动全部语义变量）✅ |
| WCAG AA 对比度 | **90 项检查 0 未达标**（真实渲染像素实测，见 §7）✅ |

---

## 2. 主题架构重做

### 2.1 环境与布局解耦

```
DAY / NIGHT            = 全站颜色环境  → <body data-env="day|night">
树 / 列表 / 热榜 / 来源页 / 详情 = 信息布局模式 → state.mode / 路由
```

- `data-env` 由 `applyBg()` 统一写入，**任何布局模式都不再决定颜色**。
- 旧的 `data-theme` 保留给设置面板里的两个变体预设：`dawn → day`、`ocean → night`
  （`ENV_OF` 映射），因此预设切换也不会破坏环境一致性。
- 布局模式可以用 URL 直接指定，便于审查与分享：`?mode=tree|list|board`（**不写回 localStorage**，
  否则审查完 `?mode=board` 之后下次打开首页会莫名停在热榜）。

### 2.2 统一语义变量层

规范要求的变量全部落地，并分别在 `body[data-env="day"]` / `body[data-env="night"]` 定义：

| 变量 | DAY | NIGHT |
|---|---|---|
| `--bg-main` | `#f3f0e9` | `#070b14` |
| `--bg-surface` | `#ffffff` | `#0d1424` |
| `--bg-card` | `#ffffff` | `#111a2c` |
| `--text-primary` | `#1b1a17` | `#e9edf5` |
| `--text-secondary` | `#5d574f` | `#a8b3c6` |
| `--text-muted` | `#8a837a` | `#7d8798` |
| `--border` | `rgba(27,26,23,.13)` | `rgba(233,237,245,.13)` |
| `--shadow` / `--shadow-lift` | 极克制 / `0 6px 18px rgba(27,26,23,.10)` | `0 1px 2px rgba(0,0,0,.4)` / `0 8px 24px rgba(0,0,0,.5)` |
| `--accent` | `#8c2f22` | `#6ea8fe` |

补充的同族变量：`--bg-card-hover`、`--bg-chip`、`--bg-chip-hover`、`--text-on-accent`、
`--border-strong`、`--track`（进度条轨道）、`--rank-1/2/3`、`--hot`、`--heat`。
旧变量名 `--ink` / `--muted` / `--line` 保留为别名，避免大面积改名引入回归。

### 2.3 关键陷阱：`--card-surface` 的 CSS 变量链

Stage 3.2 在 `:root` 里写了：

```css
--card-surface: color-mix(in srgb, #101c38 68%, transparent);
```

**CSS 自定义属性在「声明它的元素」上完成替换**，所以 `:root` 上算出来的就是深蓝色，
再继承给所有后代 —— 于是 `body[data-env="day"]` 怎么改都盖不住列表卡片。
本次把这些变量（`--src-surface` / `--card-surface` / `--card-line` / `--card-shadow-hover` /
`--src-line` / `--src-line-strong`）**从 `:root` 挪进 `data-env` 块**，随环境一起变。
尺寸类变量（`--src-radius` 等）与颜色无关，继续留在 `:root`。

### 2.4 清理掉的写死颜色

| 位置 | 原值 | 现在 |
|---|---|---|
| `.ncard` / `.row-item` / `.card` 卡片底 | `#101c38` / `#0f1a33` | `var(--bg-card)` |
| `.detail-body` 正文 | `#d2ddf2`（浅色字） | `var(--text-primary)` |
| `.card .foot` | `#8ea0c2` | `var(--text-secondary)` |
| `.b-bar` / `.hc-bar` 轨道 | `rgba(255,255,255,.12)` | `var(--track)` |
| 排名 `1/2/3` | `#ffd166` / `#dfe7f5` / `#eea36f` | `var(--rank-1/2/3)` |
| `.b-hot` / `.nc-heat` / `.b-dup` / `.hc-dup` / `.nc-hotrank` | 写死暖色 | `var(--hot)` / `var(--heat)` / `var(--rank-1)` |
| `.sort-pill.active` / `.plat-chip.active` / `.btn-primary` / `.bs-theme.active` / `.hc-open` / `.dock-btn.active` / `.cat-btn.active` | `#04201c` / `#03231e` / `#061218` | `var(--text-on-accent)` |
| 一堆 `rgba(150,180,255,…)` 蓝调底 | 写死 | `var(--bg-chip)` / `var(--bg-chip-hover)` |
| 卡片 hover 阴影 | `0 10px 26px rgba(0,0,0,.35)` | `var(--shadow-lift)` |

另外补了 **DAY 专属**的一层（因为分类色是为深底挑的，直接放浅底对比度不够）：
叶片 / 分类标签 / 来源点 / 来源名 / 连线 / 来源页导航条 / 来源区域卡片 / 热榜分组标题
在 DAY 下都换成「浅底 + 墨字 / 墨线 + 分类色点缀」。

---

## 3. 本次挖出的真正根因：背景压暗层

**现象**：改完卡片颜色后，DAY 列表的卡片已经是纯白，但整页仍然发灰发脏，白卡片也看不出对比。

**定位过程**：不是靠看，而是**截图像素级取样** —— 用 CDP 截图后在页面里画进 canvas，
按元素坐标读 `getImageData`：

```
修复前  DAY + 列表：卡片像素 = 255,255,255（白 ✅）  页面底 = 150,156,163（中灰 ❌）
修复后  DAY + 列表：卡片像素 = 255,255,255（白 ✅）  页面底 = 229,236,241（浅纸 ✅）
```

`#f3f0e9` = (243,240,233)，叠加 `rgba(3,8,18,.35)` 后正是 (159,157,153) 量级 —— 与实测吻合。

**根因**：`#bg::before` 是「给用户自定义背景图片压暗」用的层，却**无条件生效**，
把预设背景一起压暗了。改为只在 `body[data-photo="1"]`（真的设了背景图片）时生效。

这一条同时解释了 Stage 3.4 遗留的「DAY 不够明亮」的观感问题。

---

## 4. 浏览器实际验收结果（§10 的 10 项）

**工具**：`scripts/shots.mjs`（CDP 驱动真实 Chrome；设视口 → 轮询等真实数据就绪 → 真实鼠标事件 → 截图）。
**命令**：`npm run shots` 或 `node scripts/shots.mjs`。

| # | 场景 | 截图 | 结果 |
|---|---|---|---|
| 1 | DAY + 首页树 | `day-tree-1366.png` | ✅ 浅纸背景、树干可见、分类标签可读 |
| 2 | NIGHT + 首页树 | `night-tree-1366.png` | ✅ 近黑底、节点为光源 |
| 3 | **DAY + 列表** | `day-list-1366.png` | ✅ **白卡片 + 深标题 + 中灰来源/时间** |
| 4 | **NIGHT + 列表** | `night-list-1366.png` | ✅ 深蓝灰卡片 + 近白标题 |
| 5 | **DAY + 热榜** | `day-board-1366.png` | ✅ 白行 + 高对比排名（金/银/铜）+ 可见热度条 |
| 6 | **NIGHT + 热榜** | `night-board-1366.png` | ✅ 暗行 + 亮强调色排名 |
| 7 | DAY + 来源页 | `day-source-page-1366.png` | ✅ fan 模式 + 浅色叶片（浅底深字） |
| 8 | NIGHT + 来源页 | `night-source-page-1366.png` | ✅ 深色叶片 |
| 9 | DAY + 新闻详情 | `day-detail-1366.png` | ✅ 深色标题 + 可读正文（原 `#d2ddf2` 已修） |
| 10 | NIGHT + 新闻详情 | `night-detail-1366.png` | ✅ |

附加：`day-hover-1366.png`（悬停预览卡）、`day-1920.png` / `night-1920.png`、`day-mobile-390.png` / `night-mobile-390.png`。

规范要求「特别保存」的四张：`day-list.png` / `night-list.png` / `day-hot.png` / `night-hot.png`
→ 本项目沿用既有命名，对应文件为
`day-list-1366.png`、`night-list-1366.png`、`day-board-1366.png`、`night-board-1366.png`
（本项目把「热榜」视图命名为 `board`，`-1366` 后缀标明视口）。

### 4.1 逐条回答规范的重点检查

| 检查项 | 结果 | 依据 |
|---|---|---|
| DAY 下所有文字是否清晰 | ✅ | `day-list-1366.png` / `day-board-1366.png` / `day-detail-1366.png` |
| DAY 下卡片是否仍然暗 | ❌ 不暗了 | 像素实测卡片 = `rgb(255,255,255)` |
| DAY 下是否存在深色文字 + 深色背景 | ❌ 不存在 | 像素实测底 = `rgb(229,236,241)`、字 = `rgb(27,26,23)` |
| NIGHT 下是否仍有足够文字对比度 | ✅ | 像素实测卡片 = `rgb(17,26,44)`、字 = `rgb(233,237,245)` |
| 切换树/列表/热榜后主题是否一致 | ✅ | 19 张截图同一环境下面板/控制条/背景完全一致 |
| 切换 DAY/NIGHT 时整个页面是否同步变化 | ✅ | 单一 `data-env` 驱动；详情页也保留 DAY/NIGHT 开关 |

---

## 5. 顺带改掉的两处可用性问题

1. **详情页现在保留底部 DAY/NIGHT 开关**。原来 `showDetail()` 把整条底栏隐藏了，
   于是详情页无法切换环境 —— 而「DAY/NIGHT 是全站环境」，不该在某个视图里失效。
   现在详情页只收起「分类」（详情页没有分类筛选），环境开关与工具按钮保留。
2. **`?mode=` 不写回 localStorage**。URL 参数只对本次加载生效。

---

## 6. 测试

```
node --test test/source-navigation.test.mjs test/tree-bare-geometry.test.mjs \
              test/tree-layout.test.mjs test/tree-geometry-stage3.2.1.test.mjs
→ # tests 69 / # pass 69 / # fail 0
```

CSS 结构自检：花括号 534 / 534 平衡；环境变量块内无裸 hex 残留（脚本扫描）。

---

## 7. 补充验收：WCAG 对比度审计（把「目视核对」变成数字）

初版记录里「DAY 下文字是否清晰」这一条只做到了目视 + 抽样像素，没有可量化依据。
补做了 `scripts/contrast-audit.mjs`：**基于真实渲染像素**计算 WCAG 2.1 对比度。

### 方法

1. 正常截一张图 A
2. 把被测文字设为**透明**（HTML 用 `color`、SVG 用 `fill`），**保留元素自身背景**，再截一张图 B
   → B 在同一坐标上的像素就是纯背景
3. 前景色取 `getComputedStyle`，带 alpha 时与背景合成
4. 对比度 = `(L1+0.05)/(L2+0.05)`；判定 AA：普通文字 ≥ 4.5:1，大文字（≥24px 或 ≥18.66px 粗体）≥ 3:1

> **方法上的一个坑（值得记下来）**：第一版用 `visibility: hidden` 隐藏元素，
> 结果**把元素自身的背景也一起藏掉了**，取样到的是元素后面的页面 ——
> 凡是「自带背景的按钮/胶囊」全部测出假失败（一次报了 24 项，实际只有 3 项是真的）。
> 改用 `color/fill: transparent` 后结果才可信。

### 结果：90 项检查，0 项未达标

| 视图 | DAY | NIGHT |
|---|---|---|
| 首页树 | 16 项全过 | 16 项全过 |
| 列表 | 14 项全过 | 14 项全过 |
| 热榜 | 12 项全过 | 12 项全过 |
| 新闻详情 | 7 项全过 | 7 项全过 |
| 来源页 | 5 项全过 | 5 项全过 |

### 审计抓出的 3 个真实缺陷（已修）

| 缺陷 | 实测 | 修复 |
|---|---|---|
| **DAY 左侧面板选中按钮**：白字浅底 | 1.33:1 | **这是我在 Stage 3.5 自己引入的**：我给 `.dock-btn.active` 加了 `color: var(--text-on-accent)`（白），但 Stage 3.4 早已把它的背景从 `--accent` 改成「11% 淡色底」。改为 `--text-primary` |
| **DAY 卡片时间**：`--text-muted` 在白底上偏浅 | 3.74:1（需 4.5） | `--text-muted` `#8a837a` → `#736d64` |
| **DAY 热榜排名 1**：`--rank-1` 在行底上偏浅 | 2.81:1（需 3.0） | `--rank-1` `#a8760c` → `#8a5f08`（`--rank-2/3` 一并压深） |

明细见 `.review/contrast-report.json`。复跑命令：`node scripts/contrast-audit.mjs`。

---

## 8. 补充验收：之前标注「未验证」的三项已闭环

| 原「未验证」项 | 现在 | 证据 |
|---|---|---|
| 自定义背景图 + DAY 的压暗路径 | ✅ 已实拍 + 像素实测 | 背景图设为**纯白**再截：未设图时左缘像素 `236,238,238`（浅纸）；设图 + `dim=45%` 时 `139,143,147`（被压暗）→ **压暗层只在设了图片时生效，两个分支都对**。截图 `day-photo-1366.png` / `night-photo-1366.png` |
| `dawn` / `ocean` 变体预设是否继承正确环境 | ✅ 已实拍 + 语义实测 | `?env=dawn` → `env=day`、`?env=ocean` → `env=night`；`--bg-main/--bg-card/--text-primary/--accent` 与主环境**逐项相同**（实测值见下）。截图 `dawn-variant-1366.png` / `ocean-variant-1366.png` |
| WCAG 对比度 | ✅ 已量化 | 见 §7：90 项 0 未达标 |

变体预设的实测变量对照（`--bg-main / --bg-card / --text-primary / --accent`）：

```
?env=day     env=day    #f3f0e9 / #ffffff / #1b1a17 / #8c2f22
?env=dawn    env=day    #f3f0e9 / #ffffff / #1b1a17 / #8c2f22   ← 与 day 完全一致
?env=night   env=night  #070b14 / #111a2c / #e9edf5 / #6ea8fe
?env=ocean   env=night  #070b14 / #111a2c / #e9edf5 / #6ea8fe   ← 与 night 完全一致
```

> 附带发现：`ocean` 与 `night` 的截图 **md5 完全相同**；`dawn` 与 `day` 有 **0.17% 的像素差异**
> （1751 / 1,049,088，单通道差值多为 2~4/255，集中在树冠边缘）。语义变量实测完全一致，
> 因此环境继承是正确的 —— 该差异是模糊光晕层的抗锯齿噪声，肉眼不可见。**未进一步追查，如实记录。**

---

## 9. 测试与工具

```
node --test test/source-navigation.test.mjs test/tree-bare-geometry.test.mjs \
              test/tree-layout.test.mjs test/tree-geometry-stage3.2.1.test.mjs
→ # tests 69 / # pass 69 / # fail 0
```

| 工具 | 用途 |
|---|---|
| `node scripts/shots.mjs` | 19 个场景的浏览器截图（含变体预设、自定义背景图、hover、多视口） |
| `node scripts/contrast-audit.mjs` | WCAG 对比度审计（10 个视图×环境，90 项） |
| `node scripts/review-server.mjs` | 人工审查用的本地服务 |

CSS 结构自检：花括号 534 / 534 平衡；环境变量块内无裸 hex 残留。

---

## 10. 未验证 / 已知限制

| 项 | 说明 |
|---|---|
| 移动端触屏 | 390×844 已截图（DAY / NIGHT），但**真机触屏手势未验证**；首页树标签在竖屏下仍需双指放大（Stage 3.4 已记录，本次未处理） |
| `dawn` 的 0.17% 像素差异 | 已确认语义变量一致，判定为抗锯齿噪声；**未追查到具体成因** |
| 对比度审计的覆盖面 | 90 项覆盖了主要文字元素，但**不是全量**：未覆盖 hover/focus 态、空状态、错误提示、骨架屏 |
| 滚动到深处的表现 | 列表/热榜只截了首屏 |
| 色盲可辨性 | 未做（分类色靠色相区分，未验证色觉障碍下的可辨识度） |
| 详情页的 DAY/NIGHT 开关 | 已保留并生效，但**未在详情页实拍切换过程**（只截了两个环境的静态结果） |
