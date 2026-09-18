# Stage 3.3 交付记录 · 首页无叶片骨架 + Apple 风格 + 可人工审查

> 本记录遵循 `docs/交付诚实性规范.md` 的等级口径。凡本环境无法取得的证据，一律显式标注**未验证**，不以推断替代实拍。

- 阶段：Stage 3.3
- 日期：2026-09-17
- 数据快照：`.review/snapshot.json`（209 条真实新闻 / 15 个真实来源，采集于 2026-09-17T14:52:21Z）
- 改动文件：`public/js/tree-layout.js`、`public/js/tree-view.js`、`public/js/app.js`、`public/js/views.js`、`public/js/news-store.js`、`public/style.css`、`public/index.html`、`test/tree-bare-geometry.test.mjs`（新增）、`test/tree-geometry-stage3.2.1.test.mjs`（断言更新）、`scripts/review-server.mjs`（新增）、`scripts/build-selfcheck.mjs`（新增）

---

## 1. 需求

> 「主页面的树可以不显示新闻，我现在想要只有点击到新闻源，才显示，ui 做的漂亮大气一些可以类似 apple 官网的那种风格。然后给我一个可人工审查的本地服务器」

拆成三条：

| # | 需求 | 落地方式 |
|---|---|---|
| R1 | 首页树不显示新闻；点进新闻源才显示 | 新增布局模式 `crown-bare`（几何层不产出叶片） |
| R2 | UI 大气，接近 apple.com 风格 | 新增 Apple 视觉体系（浅色 / 深色两套），并设为默认主题 |
| R3 | 提供可人工审查的本地服务器 | `scripts/review-server.mjs`（快照优先，离线可跑） |

---

## 2. 规范一致性声明（含一处明确偏离）

**已识别偏离：Stage 3.2.1 规范 §13 与本需求冲突。**

- §13（LOD）原文要求远距离视图呈现「树干 / 主枝 / **新闻源** / **叶片形状**」，即首页应在缩小时仍能看到叶片形状的聚合。
- 本需求要求首页**完全不出现新闻**，与该条直接冲突。
- 规范 §9「不要让叶片集合形成新的主体」在语义上**支持**本需求（叶片不应在首页成为主体）。
- 用户明确提出了该需求，因此按用户指令执行，并在此备案。

**处理方式**：不静默覆盖。此偏离按 `docs/交付诚实性规范.md` §6 记录在本文件中，作为 Stage 3.2.1 §13 的口径变更依据。§13 的其余部分（近/中距离呈现规则）不适用于首页 `crown-bare`，仍适用于来源页 `fan` 模式（该模式行为未改动）。

---

## 3. R1｜首页无叶片

### 3.1 做法

新增布局模式 `crown-bare`，由 `layoutTree()` 分发：

```js
const bare = o.skipLeaves ? true : o.mode === "crown-bare";
if (bare) return layoutTreeCrownBare(entries, o);
```

关键点：**在几何层不产出叶片**，而不是渲染时过滤。原因：叶片簇的 AABB 外推会继续放大包围盒，`computeFit` 会把纯骨架缩成一小团并留下大片空白。必须在布局阶段就不产生叶片。

### 3.2 几何不变量（脚本判定）

| 不变量 | 依据 | 实测（真实 15 来源） |
|---|---|---|
| 不生成任何叶片 | L2 实测 | `leaves = 0`，`totalLeaves = 0` |
| 来源节点互不重叠 | L2 实测 | 重叠对数 **0** |
| 节点沿主枝分散（非同一圆） | L2 实测 | 半径比 **2.39**（阈值 > 1.25） |
| 枝脊短且方向明确 | L2 实测 | 最差 **0.0px**（阈值 < 5px） |
| 包围盒由骨架决定 | L2 实测 | 2478 × 1656（阈值 w<4200, h<3200） |
| 确定性（同输入同输出） | L2 实测 | 单测 `deepEqual` 通过 |

数值来源：`scripts/build-selfcheck.mjs` 内联逻辑实跑 + `node --test test/tree-bare-geometry.test.mjs`。

### 3.3 规模扫描（2 → 80 个来源）

| n | 枝数 | 重叠 | 最差枝脊 | 半径比 |
|---|---|---|---|---|
| 1 | 1 | 0 | 0px | 1.00 |
| 2 | 1 | 0 | 0px | 2.47 |
| 4 | 2 | 0 | 0px | 3.22 |
| 6 | 2 | 0 | 0px | 3.27 |
| 12 | 5 | 0 | 0px | 2.47 |
| 16 | 7 | 0 | 0px | 2.47 |
| 22 | 9 | 0 | 0px | 3.18 |
| 30 | 11 | 0 | 0px | 3.98 |
| 40 | 15 | 0 | 0px | 5.28 |
| 60 | 21 | 0 | 0px | 7.48 |
| 80 | 27 | 0 | 0px | 9.87 |

真实规模（15 来源）位于 12–16 区间，各项指标健康。n>30 时半径比上升（节点跨度扩大），属预期；本项目实际来源数远小于该区间。

### 3.4 交互行为

- 首页：悬停来源节点 → 弹出该来源**最新 3 条真实新闻**的预览卡；点击 → 进入 `/source/:key`。
- 来源页：`fan` 模式，行为**未改动**，仍正常显示叶片。

---

## 4. R2｜Apple 风格

### 4.1 落地内容

- 新增语义层变量（`--ap-*`）：背景 `#f5f5f7` / `#fff`、正文 `#1d1d1f`、次级 `#6e6e73`、描边 `rgba(0,0,0,.08)`、强调 `#0071e3`。
- 字体栈：`SF Pro Display` → `-apple-system` → `Helvetica Neue` → `PingFang SC`。
- 字重整体下调（正文 400、标题 600），字距收紧（`letter-spacing: -.01em`）。
- 组件：来源节点改为 Apple 卡片质感（白底 + 极淡描边 + 轻投影）；悬停时用**源色描边**点缀，而不是大面积填充。
- 新增两套主题：`apple`（浅色，默认）、`apple-dark`（深色）。原 `night`/`dawn`/`ocean` 保留可选。

### 4.2 证据

| 结论 | 等级 | 证据 |
|---|---|---|
| 主题变量与规则已写入 | L3 代码 | `public/style.css` Stage 3.3 段落 |
| 默认主题已切换为 `apple` | L3 代码 | `app.js` `loadBg()` 默认值与白名单 |
| 主题按钮已提供 | L3 代码 | `index.html` `.bs-themes` 两个新按钮 |
| **实际视觉效果「像 apple.com」** | **未验证（需 L1 实拍）** | 本环境无法启动浏览器 → 无截图 |

**诚实声明**：R2 的「漂亮大气、接近 Apple 风格」属于**视觉类结论**，按 §4.1 门槛表要求 **L1 实拍**。当前环境无法截图，因此该结论**未经验证**。请在你的浏览器中打开 §6 的地址自行确认。

---

## 5. R3｜可人工审查

### 5.1 两条路径

**路径 A：本地服务器（推荐，真实站内行为）**

```bash
node scripts/review-server.mjs          # 默认 4173 端口
PORT=5000 node scripts/review-server.mjs
node scripts/review-server.mjs --refresh   # 重新抓取并覆盖快照
```

特性：优先读 `.review/snapshot.json`（**离线可跑**）；抓取失败自动回退快照；带 `/api/review/meta` 明确标注数据来源。

**路径 B：静态自检页（零依赖兜底）**

`docs/stage3.3-首页无叶片-自检.html` —— 真实数据 + 真实布局引擎全部内联，**双击即可打开，不需要任何服务器**。

### 5.2 为什么需要路径 B

**本环境的进程会被回收，无法常驻 `node server.js` / `review-server.mjs`。** 实测：启动后日志正常打印「已启动」，随后所有请求返回 `os error 10061 目标计算机积极拒绝`，`ps` 中已无该进程。

因此「可人工审查」必须有一个不依赖常驻进程的形态。路径 B 即为此而做。

### 5.3 证据

| 结论 | 等级 | 证据 |
|---|---|---|
| 真实数据可抓取 | L2 实测 | `collectAll()` → `items: 224`（一次）/ 快照 209 条 / 15 来源 |
| 审查服务器代码可运行 | L2 实测 | 启动日志正常输出「使用快照：209 条」 |
| 审查服务器**可常驻** | **未验证（环境受限）** | 进程被回收，无可用端口 → 请在你自己机器上验证 |
| 静态自检页逻辑正确 | L2 实测 | 内联脚本实跑输出：0 叶片 / 0 重叠 / 0px 枝脊 / 模式 `crown-bare` |
| 静态自检页**在浏览器中的渲染** | **未验证（需 L1 实拍）** | 本环境无法启动浏览器 |

---

## 6. 测试

```
node --test test/source-navigation.test.mjs \
              test/tree-layout.test.mjs \
              test/tree-geometry-stage3.2.1.test.mjs \
              test/tree-bare-geometry.test.mjs
```

**结果：`# tests 65 / # pass 65 / # fail 0`（L2 实测）**

其中：
- 新增 `test/tree-bare-geometry.test.mjs`：15 项，全通过。
- `test/tree-geometry-stage3.2.1.test.mjs` 第 13 项断言由 `"crown"` 更新为 `"crown-bare"`——这是**因需求变更而更新断言**，不是放宽标准。

---

## 7. 顺带修复的既存缺陷

审查过程中发现 `public/js/news-store.js` 的 `dominantTag()` 引用了**未定义变量 `TAG_PRIORITY`**，会导致 `buildSourceModel()` 抛 `ReferenceError`。已改为使用 `helpers.js` 的 `orderTags()`（保持平局顺序确定性）。

此项为独立缺陷，与 R1/R2/R3 无关，但会影响首页正常渲染，故一并修复。

---

## 8. 未完成 / 待确认

| 项 | 状态 |
|---|---|
| 视觉效果的 L1 实拍（首页 / 来源页 / 四断点） | **未完成** —— 环境无法截图，需你本地补 |
| 审查服务器在你机器上的常驻验证 | **未完成** —— 需你本地 `node scripts/review-server.mjs` 验证 |
| `docs/` 与 `.workbuddy-ai/` 的 git 提交 | **未提交** —— 沿用 Stage 纪律（不推 main），等你确认 |
| Stage 3.2.1 §13 口径正式修订 | **已备案未改文件** —— 见 §2，需你决定是否回写规范正文 |
