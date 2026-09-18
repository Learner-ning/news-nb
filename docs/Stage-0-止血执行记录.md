# Stage 0 · 止血执行记录

> 执行时间：2026-09-16 21:25 ~ 21:30（GMT+8）
> 执行依据：`F:\新闻树阶段0止血执行提示词.md`
> 仓库：`Learner-ning/news-nb`　分支：`main`　生产域名：`https://newstree.dpdns.org`
> 状态：**已完成并通过全部验证**　｜　未进入 Stage 1

---

## 0. 执行摘要

| # | 交付项 | 结果 |
|---|---|---|
| 1 | git status | 执行前 3 个文件 `M`；执行后工作区无未提交修改（未跟踪文件未动） |
| 2 | commit hash | `7cd56c0a7b7d48c783cc52099e4cced539c2eced`（短 `7cd56c0`） |
| 3 | push 是否成功 | ✅ `a12475c..7cd56c0  main -> main` |
| 4 | GitHub HEAD | `7cd56c0a7b7d48c783cc52099e4cced539c2eced`（与本地一致） |
| 5 | 线上 `/api/health` | `ok=true, itemCount=214`，失败源 1 个（哔哩哔哩 HTTP 412） |
| 6 | 3 条热榜抽查 | **3/3 满足** `publishedAt===null` 且 `hasRealTime===false` |
| 7 | 是否可进入 Stage 1 | **可以**（一项外部待确认事项见 §6） |

---

## 1. 目标与边界

**目标**：把本地已完成的 `fakeTimeAgo` / `hasRealTime` 修复提交并推送到 GitHub，使线上代码与本地代码一致。

**严格限制（全部遵守）**：不修改其他代码、不新增功能、不重构、不改 UI、不改布局、不改新闻源、不改热度算法（见 §6 说明）、不改缓存、不改部署配置、不删除文件。

**执行方式**：只对 3 个已修改文件执行 `git add -- <3 个明确路径>`，未使用 `git add -A`，因此未跟踪文件（`.workbuddy-ai/`、`fix-verification.html`、`news-tree-review-report.md`、1.6 MB 壁纸 PNG、`优化部署.md`、体检报告）全部保持未跟踪状态，未被提交。

---

## 2. 改动内容

改动规模：**3 files changed, 64 insertions(+), 20 deletions(-)**

| 文件 | 增删 | 内容 |
|---|---|---|
| `lib/news-core.mjs` | +40 / −12 | 删除 `fakeTimeAgo()`；RSS 与热搜不再伪造发布时间；新增 `hasRealTime` 标记；`calculateHeatScore()` 增加 `hasRealTime` 分支 |
| `public/js/helpers.js` | +18 / −2 | 新增 `timeLabel()`；`timeAgo()` / `fmtFull()` 补非法日期防御 |
| `public/js/views.js` | +6 / −6 | 导入与 4 个调用点从 `timeAgo` 切换为 `timeLabel` |

### 2.1 `lib/news-core.mjs`

**① 删除伪造时间函数**

```diff
-function fakeTimeAgo(now, rank) {
-  return new Date(now - (rank + 1) * 60 * 1000).toISOString();
-}
+// 注意：这里绝不能伪造发布时间。
+// 热搜接口不返回发布时间，RSS 也可能缺 pubDate；用「榜单排名/条目序号」倒推一个
+// 「N 分钟前」会同时造成两个后果：
+//   1) UI 展示假的相对时间，误导用户；
+//   2) calculateHeatScore 的时间衰减项（占 30% 权重）被系统性抬高，热度排序失真。
+// 所以：没有真实发布时间的条目 publishedAt = null，时间衰减项改由 hasRealTime 分支处理。
```

**② RSS 条目：只在解析到真实 `pubDate` 时赋值**

```diff
-    const publishedAt = e.isoDate || fakeTimeAgo(now, i);
+    // 仅在解析到真实发布日期时才赋值，否则保持 null
+    const publishedAt = e.isoDate || null;
...
       publishedAt,
+      hasRealTime: Boolean(publishedAt),
```

**③ 热搜条目：`publishedAt` 置 `null`**

```diff
-    publishedAt: fakeTimeAgo(now, rank),
+    // 热搜接口不提供发布时间；置 null 而不是伪造「刚刚」。
+    // 排名信息已由 rank / hotRank 承载，热度计算走 hasRealTime=false 分支。
+    publishedAt: null,
+    hasRealTime: false,
```

**④ 热度算法：新增 `hasRealTime` 分支**

```diff
-  let ageH = 24;
-  try {
-    const t = new Date(item.publishedAt || item.time);
-    if (!isNaN(t.getTime())) ageH = Math.max(0, (now - t.getTime()) / 36e5);
-  } catch {}
-  const fresh = Math.exp(-ageH / 12);
+  let fresh = 0.5;
+  const hasRealTime = item.hasRealTime === true;
+  if (hasRealTime) {
+    let ageH = 24;
+    try {
+      const t = new Date(item.publishedAt || item.time);
+      if (!isNaN(t.getTime())) ageH = Math.max(0, (now - t.getTime()) / 36e5);
+    } catch {}
+    fresh = Math.exp(-ageH / 12);
+  }
...
-  const raw = 0.3 * fresh + 0.28 * quality + 0.14 * rankBonus + 0.18 * dup + 0.08 * catFreq + kw;
+  const freshWeight = hasRealTime ? 0.3 : 0.12;
+  const rankWeight = hasRealTime ? 0.14 : 0.14 + (0.3 - 0.12);
+
+  const raw =
+    freshWeight * fresh +
+    0.28 * quality +
+    rankWeight * rankBonus +
+    0.18 * dup +
+    0.08 * catFreq +
+    kw;
```

**⑤ `collectAll()` 输出透传 `hasRealTime`**

```diff
       time: it.publishedAt || it.time || null,
+      hasRealTime: it.hasRealTime === true,
```

### 2.2 `public/js/helpers.js`

**① `timeAgo()` 补非法日期防御**（不再渲染 `NaN 天前`）

```diff
 export function timeAgo(t) {
   if (!t) return "";
-  const d = Date.now() - new Date(t).getTime();
+  const ms = new Date(t).getTime();
+  if (isNaN(ms)) return "";
+  const d = Date.now() - ms;
```

**② 新增 `timeLabel()`**

```diff
+/**
+ * 时间标签：优先真实发布时间；无真实时间的热榜条目回退为「热榜第 N 位」。
+ * 绝不展示伪造的相对时间。
+ */
+export function timeLabel(x) {
+  if (!x) return "";
+  const rel = timeAgo(x.time || x.publishedAt);
+  if (rel) return rel;
+  if (x.hotRank) return `热榜第 ${x.hotRank} 位`;
+  return "时间未知";
+}
```

**③ `fmtFull()` 补非法日期防御**

```diff
 export function fmtFull(t) {
   if (!t) return "";
   try {
-    return new Date(t).toLocaleString("zh-CN", {
+    const d = new Date(t);
+    if (isNaN(d.getTime())) return "";
+    return d.toLocaleString("zh-CN", {
```

### 2.3 `public/js/views.js`

**① 导入替换**

```diff
-import { esc, timeAgo, fmtFull, colorFor } from "./helpers.js";
+import { esc, timeLabel, fmtFull, colorFor } from "./helpers.js";
```

**② 四个调用点全部替换为 `timeLabel()`**

| 调用点 | 位置 | 改动 |
|---|---|---|
| 列表卡片 | `card()` | `${timeAgo(x.time)}` → `${esc(timeLabel(x))}` |
| 热榜行 | `hotRow()` | `${timeAgo(x.time)}` → `${esc(timeLabel(x))}` |
| 详情页相对时间 | `renderDetail()` | `${timeAgo(item.time)}` → `${esc(timeLabel(item))}` |
| 详情页完整时间 | `renderDetail()` | 改为条件渲染，无有效时间时不输出空 `<span>` |
| 悬停卡 | `fillHoverCard()` | `timeAgo(item.time)` → `timeLabel(item)` |

```diff
-      <span>${timeAgo(item.time)}</span>
-      <span>${fmtFull(item.time)}</span>
+      <span>${esc(timeLabel(item))}</span>
+      ${fmtFull(item.time) ? `<span>${esc(fmtFull(item.time))}</span>` : ""}
```

### 2.4 diff 归属核对结论

逐行核对后确认：**三个文件的全部改动都属于 `fakeTimeAgo` / `hasRealTime` 这一轮已有修复，无夹带内容**（未出现布局、UI、源、缓存、部署配置的任何改动）。

唯一需要你知情的一点见 §6。

---

## 3. 本地验证（14 项全 PASS）

**语法检查**：`node --check` 通过 —— `lib/news-core.mjs`、`public/js/helpers.js`、`public/js/views.js`、`server.js`、`src/index.js`。

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 全项目已无 `fakeTimeAgo` 残留（扫 8 个源码文件） | PASS |
| 2 | 真实抓取一轮 | 129 条，耗时 21.5 s，失败源 7 个 |
| 3 | 热搜条目 `publishedAt` 非 null 的数量 = 0 | PASS（70 条热搜，实际 0） |
| 4 | 热搜条目 `hasRealTime !== false` 的数量 = 0 | PASS（实际 0） |
| 5 | 热搜条目仍带 `hotRank`/`rank` | PASS（rank=1,2,3…） |
| 6 | 有真实时间的新闻 `hasRealTime` 全为 true | PASS（45 条，违规 0） |
| 7 | 无时间的新闻 `hasRealTime` 全为 false | PASS（14 条） |
| 8 | 无「未来时间」条目 | PASS（实际 0） |
| 9 | 热榜名次仍有区分度 | PASS（rank1=0.372 → rank5=0.360 → rank10=0.344 → rank15=0.329） |
| 10 | 热度榜首不再被无真实时间条目垄断 | PASS（前 20 名中热搜 **0** 条） |
| 11 | `timeLabel()` 热搜 → 「热榜第 N 位」 | PASS |
| 12 | `timeLabel()` 无时间无排名 → 「时间未知」 | PASS |
| 13 | `timeLabel()` 真实时间 → 相对时间（2 小时前） | PASS |
| 14 | 非法时间不渲染 NaN / 空值返回空串 | PASS |

参考数据：热搜平均热度 **0.357**，有真实时间的新闻平均热度 **0.454**（修复前二者被伪造时间拉到同一水平）。

---

## 4. 提交与推送

```
git add -- lib/news-core.mjs public/js/helpers.js public/js/views.js
git commit -F - <<'EOF'
fix(data): 停止伪造发布时间，热度改用 hasRealTime 分支
...
EOF
git push origin main
```

**commit**：

```
7cd56c0  fix(data): 停止伪造发布时间，热度改用 hasRealTime 分支
 lib/news-core.mjs    | 52 ++++++++++++++++++++++++++++++++++++++++------------
 public/js/helpers.js | 20 ++++++++++++++++++--
 public/js/views.js   | 12 ++++++------
 3 files changed, 64 insertions(+), 20 deletions(-)
```

**push 输出**：

```
To https://github.com/Learner-ning/news-nb.git
   a12475c..7cd56c0  main -> main
```

**HEAD 一致性**：

```
git ls-remote origin refs/heads/main → 7cd56c0a7b7d48c783cc52099e4cced539c2eced
本地 git rev-parse HEAD            → 7cd56c0a7b7d48c783cc52099e4cced539c2eced
```

---

## 5. 线上验证

### 5.1 `/api/health`

```json
{
  "ok": true,
  "itemCount": 214,
  "updatedAt": "2026-09-16T13:27:44.865Z",
  "errors": [{ "source": "哔哩哔哩", "message": "HTTP 412" }]
}
```

### 5.2 线上静态资源 vs 本地文件（sha256，归一化 CRLF 后比对）

| 文件 | 本地 | 线上 | 结果 |
|---|---|---|---|
| `js/helpers.js` | 3109 B / `62d02043f924` | 3109 B / `62d02043f924` | 一致 |
| `js/views.js` | 6413 B / `ece9d3b32854` | 6413 B / `ece9d3b32854` | 一致 |
| `js/app.js` | 16807 B / `47631def8a8c` | 16807 B / `47631def8a8c` | 一致 |
| `js/tree-view.js` | 16936 B / `aa5b9788ac3a` | 16936 B / `aa5b9788ac3a` | 一致 |
| `js/news-store.js` | 3209 B / `c82a6294ac46` | 3209 B / `c82a6294ac46` | 一致 |
| `style.css` | 28088 B / `63357f0705c8` | 28088 B / `63357f0705c8` | 一致 |
| `index.html` | 7132 B / `ea83d621ed7c` | 7132 B / `ea83d621ed7c` | 一致 |

**7/7 逐字节一致** → 线上与本地代码内容完全一致。

### 5.3 随机抽查 3 条热榜数据（固定种子，可复现）

线上返回：214 条（热搜 90 / 新闻 124），失败源 1 个（哔哩哔哩 HTTP 412）。

| # | 来源 · 名次 | 标题 | `publishedAt` | `hasRealTime` | `time` |
|---|---|---|---|---|---|
| 1 | 微博 第2位 | 硕士考试第一名因专升本被取消资格 | `null` ✓ | `false` ✓ | `null` ✓ |
| 2 | 百度贴吧 第11位 | 扎心!吧友锐评体制内牢九门 | `null` ✓ | `false` ✓ | `null` ✓ |
| 3 | 今日头条 第4位 | 亚运会U23国足2-1逆转朝鲜 | `null` ✓ | `false` ✓ | `null` ✓ |

**抽查结论：3/3 满足 `publishedAt === null` 且 `hasRealTime === false`。**

### 5.4 全量反向对照

| 检查 | 结果 |
|---|---|
| 90 条热搜中 `publishedAt` 非 null 的 | **0 条** |
| 110 条有真实发布时间的新闻中 `hasRealTime !== true` 的 | **0 条** |

---

## 6. 风险与遗留事项

### 6.1 需要你知情的一点：diff 包含热度算法的时间衰减分支

`calculateHeatScore()` 的改动（无真实时间时 `fresh` 取中性值 0.5、权重由 0.30 降至 0.12，让出的权重转给 `rankBonus`）**属于本轮 `hasRealTime` 机制本身**，不是新改的热度算法 —— 若不改这里，"不伪造时间"会造成热榜条目新鲜度全部归零、排名区分度丢失。

已按"本轮已有修复"处理并提交。若你认为这超出了"热度算法不动"的边界，可执行回滚（见 §7）后拆分重做。

### 6.2 无法从公开接口确认构建触发来源

线上在我 push 之前/之后表现一致（均为修复后行为）。可能的原因：

- 本次 push 触发的 Cloudflare 构建已完成（历史构建耗时约 25 s，时间上完全来得及）；或
- 此前已通过本机 `npx wrangler deploy` 手动部署过修复版本（本地 `node_modules` 中装有 wrangler）。

线上响应头无 `last-modified`，无法从外部区分。**建议在 Cloudflare 面板 → 项目 → Deployments 确认最新构建对应的 commit 是否为 `7cd56c0`。**

### 6.3 其他遗留（不属于 Stage 0 范围，仅记录）

- 工作区仍有 6 个未跟踪项（`.workbuddy-ai/`、`fix-verification.html`、`news-tree-review-report.md`、1.6 MB 壁纸 PNG、`优化部署.md`、体检报告），`.gitignore` 未覆盖前两项 —— 属体检报告 P2-8，待后续阶段处理。
- 源稳定性抖动仍在（本地 7 个失败 / 线上 1 个失败）—— 属 P1-3，待 Stage 4。

---

## 7. 回滚方法（如需）

```bash
# 查看本次提交
git show 7cd56c0 --stat

# 方式一：保留改动、撤销提交（回到暂存区）
git reset --soft 7cd56c0^

# 方式二：完整回滚并推送
git revert 7cd56c0
git push origin main
```

注意：`git revert` 会让线上回到"伪造时间戳"版本，**不建议**，除非要拆分重做。

---

## 8. 下一步（Stage 1 预告，未执行）

Stage 1 = 数据正确性，三项改动，均在数据层、风险低、可单测：

| # | 改动 | 文件 | 验收标准 |
|---|---|---|---|
| 1 | `stripHtml()` 解码顺序修复（先解码 → 再删标签 → 再解码）+ 截断移到清洗之后 + 抽取 `image` | `lib/news-core.mjs` | 209 条中 `summary`/`content` 含 `<标签>` 的条目 = 0；`content` 不以未闭合标签结尾 = 0 条 |
| 2 | 热度权重归一化（各项先归一到 0~1，权重和 = 1；来源权重线性展开；`dup` 与去重联动） | `lib/news-core.mjs` | heatScore 不同取值数 ≥ 条目数 × 0.7（当前 53/209） |
| 3 | 叶片宽度统一到 `textWidth()`（删除 `leafWidthFor` 死算法，语义边界断句） | `public/js/tree-view.js`、`news-store.js` | 叶片标题平均显示比例 ≥ 80%（当前 55%） |

**等你的指令后再开始。**

---

*本记录对应的代码改动已提交为 `7cd56c0` 并推送至 `main`；本地验证 14 项、线上验证 3 类全部通过。*
