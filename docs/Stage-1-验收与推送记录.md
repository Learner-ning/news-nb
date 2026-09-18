# Stage 1 · 验收与推送记录

> 执行时间：2026-09-16 22:22 ~ 22:32（GMT+8）
> 执行依据：`F:\新闻树 Stage 1 验收并推送提示词.md`
> 方案：**C —— 接受 heatScore 的真实并列**，不人为增加随机噪声，不改 `HOT_SOURCES` 平台权重（平台权重差异化留到 Stage 5）
> 状态：**Stage 1 已完成，两个 commit 已推送并线上生效**

---

## 0. 执行摘要（对应提示词要求的 8 项输出）

| # | 输出项 | 结果 |
|---|---|---|
| 1 | 两个 commit 是否已成功 push | ✅ `7cd56c0..2178421  main -> main`，exit 0 |
| 2 | GitHub main HEAD | `2178421150aece61253703b92ca9b26957e7034f` |
| 3 | 本地 HEAD | `2178421150aece61253703b92ca9b26957e7034f`（**与远端一致** ✅） |
| 4 | git status | 无未提交修改；仅未跟踪文件（未动） |
| 5 | `/api/health` | `ok=true, itemCount=199~214`，失败源 1~2 个（B站 412 / 触乐 aborted） |
| 6 | `/api/news` 数据验证 | 214 条（热榜 90 / 新闻 124），HTML 0、image 68、heatScore 0.073~0.575 |
| 7 | HTML / image / heatScore 最终验收 | **11/11 PASS**（8 项硬指标全过） |
| 8 | 结论 | **Stage 1 已完成，等待进入 Stage 2** |

---

## 1. 两个 commit 确认

| commit | 标题 | 改动文件 | 增删 |
|---|---|---|---|
| `70e00f4` | fix(data): HTML 清洗顺序修正 + 正文截断后置 + 图片抽取 | `lib/news-core.mjs` | +37 / −12 |
| `2178421` | refactor(data): 热度权重归一化（权重和严格=1）+ 叶片宽度统一到 textWidth | `lib/news-core.mjs`、`public/js/tree-view.js`、`public/js/news-store.js` | +89 / −49 |

两个 commit 相对 Stage 0（`7cd56c0`）合计：**3 个文件、+126 / −61**。

---

## 2. 改动范围审计：无 Stage 2 / 3 / 4 夹带

对 `git diff 7cd56c0..HEAD` 逐项搜索禁止范围关键字，命中行数全部为 0：

| 禁止项 | diff 命中 | 禁止项 | diff 命中 |
|---|---|---|---|
| `RSS_FEEDS`（新闻源） | 0 | `rowCap`（布局） | 0 |
| `HOT_SOURCES`（新闻源） | 0 | `ROW_TOP` / `ROW_STEP` / `ROW_GAP` | 0 |
| `PLANNED_SOURCES` | 0 | `CLUSTER_GAP` / `CAT_GAP` / `X_MARGIN` / `PILL_H` | 0 |
| `CATEGORIES`（分类） | 0 | `layout(` / `fit(` / `LOD` | 0 |
| `localStorage` | 0 | `radial` / `particle` | 0 |
| `CACHE_TTL` / `TTL`（缓存） | 0 | `skeleton` / `骨架`（Stage 2） | 0 |
| `wrangler` / `.github`（Cloudflare / CI） | 0 | `style.css`（CSS 清理） | 0 |
| `server.js` / `src/index`（API 架构） | 0 | — | — |

**强证据**：`layout()` 函数体与 Stage 0 版本**逐字节相同**（md5 均为 `ee72922267258a9aba8ba599b354fa90`），全部几何常量逐项比对一致：

```
一致  PILL_H = 44      一致  ROW_TOP = 84      一致  ROW_STEP = 96
一致  ROW_GAP = 12     一致  CLUSTER_GAP = 62  一致  CAT_GAP = 150
一致  X_MARGIN = 120   一致  rowCap = cats.length <= 1 ? 1020 : 560
```

---

## 3. 最终验收结果（11 项全 PASS）

真实抓取：210 条 / 15.6 s / 失败源 1 个（GitHub热榜）

| # | 检查项 | 结果 | 判定 |
|---|---|---|---|
| 1 | HTML 标签残留 = 0 | summary 0 / content 0 | PASS |
| 2 | 未闭合标签 = 0 | content 0 / summary 0 | PASS |
| 3 | CDATA / XML 标记残留 = 0 | 0 条 | PASS |
| 4 | image 非空 > 0 | 54 条，URL 全部合法 http(s) 54/54 | PASS |
| 5 | 叶片平均标题显示比例 ≥ 80% | **88.0%**（最差 36%） | PASS |
| 5b | 叶片宽度统一使用 `textWidth` | 已无「字符数×2.8」旧算法 | PASS |
| 6 | heatScore 权重和 = 1 | withTime 1.00 / noTime 1.00 | PASS |
| 7 | heatScore 保持 0~1 | 范围 0.072 ~ 0.570 | PASS |
| 8 | 无条目饱和到 1.0 | 0 条 | PASS |
| A | 热榜 `publishedAt` 仍为 null 且 `hasRealTime` 仍为 false | 100 条热榜，违规 0 条 | PASS |
| B | 有真实时间的新闻 `hasRealTime` 仍为 true | 110 条，违规 0 条 | PASS |

**参考指标（非硬指标，方案 C 下不强行达标）**：heatScore 不同值 118/210 = 56%；叶片宽度 平均 265 / 最大 340；Top20 构成 新闻 8 / 热榜 12。

---

## 4. 推送结果

```
git push origin main
To https://github.com/Learner-ning/news-nb.git
   7cd56c0..2178421  main -> main
PUSH_EXIT=0
```

**HEAD 一致性核对**：

| 位置 | commit |
|---|---|
| 本地 HEAD | `2178421150aece61253703b92ca9b26957e7034f` |
| GitHub main（`git ls-remote` 实查） | `2178421150aece61253703b92ca9b26957e7034f` |

**✅ 两者一致。**

**git status**：

```
## main...origin/main [gone]
?? .workbuddy-ai/          ?? docs/
?? fix-verification.html   ?? news-tree-review-report.md
?? 【哲风壁纸】党徽…png     ?? 优化部署.md
?? 新闻树-第一阶段体检与整改方案.md
```

> `[gone]` 说明：沙箱内 `.git/refs/remotes/` 为空且无法写入（`git fetch` 报 `[new branch] main -> origin/main` 但引用未落盘），因此 git 认为上游引用不存在。这**纯属本地引用状态问题**，不影响推送结果 —— 权威的 `git ls-remote` 已确认远端 main 等于本地 HEAD。未跟踪文件全部保持原样，未被提交。

---

## 5. 线上验证

### 5.1 `/api/health`

```json
{"ok":true,"itemCount":199,"updatedAt":"2026-09-16T14:26:41.331Z",
 "errors":[{"source":"触乐","message":"The operation was aborted"},
           {"source":"哔哩哔哩","message":"HTTP 412"}]}
```

### 5.2 部署已生效

线上静态资源与本地文件 **sha256 逐字节一致**：

| 文件 | 本地 | 线上 | 结果 |
|---|---|---|---|
| `js/tree-view.js` | `84e37b1be416` | `84e37b1be416` | 一致 |
| `js/news-store.js` | `ae58082e9133` | `ae58082e9133` | 一致 |

`updatedAt` 为 `14:27 UTC`（= 22:27 CST），即推送后立即构建完成。

### 5.3 `/api/news` 数据验证

```
条目 214 | 热榜 90 | 新闻 124 | updatedAt 2026-09-16T14:27:14.352Z | stale false
失败源: [{"source":"哔哩哔哩","message":"HTTP 412"}]
```

| 验证项 | 结果 |
|---|---|
| **HTML 清洗** | summary 含标签 **0**、content 含标签 **0**、未闭合标签 **0**、CDATA 残留 **0** |
| 正文样例尾部 | `…该系统将在约 8200 万年后发生并合，最终大概率形成一颗更大质量的中子星。`（干净纯文本，无标签） |
| **image** | 非空 **68** 条，URL 全部合法 **68/68**；来源：IT之家 / 爱范儿 / GitHub热榜 / 触乐 / 华尔街见闻 / 雪球话题（含 entity 转义源 IT之家 ✅） |
| **heatScore** | 范围 **0.073 ~ 0.575**，不同值 **119**，饱和到 1.0 的 **0** 条 |
| **热榜 publishedAt / hasRealTime** | 90 条热榜中违规 **0** 条 |
| 有真实时间的新闻 | 110 条中 `hasRealTime !== true` 的 **0** 条 |

**线上 heatScore Top5**（新闻与热榜混合，不再由单一来源垄断）：

| # | heat | 类型 | 来源 · 标题 |
|---|---|---|---|
| 1 | 0.575 | 新闻 | IT之家 · 华为发布《智能世界 2035》最新报告… |
| 2 | 0.570 | 热榜#1 | 抖音 · U23国足2:1战胜朝鲜U23 |
| 3 | 0.564 | 新闻 | IT之家 · 苹果 iOS 27 正式版更新汇总：60 项升级… |
| 4 | 0.562 | 热榜#2 | 腾讯新闻 · U23国足开门红！亚运会首胜朝鲜，吴曦世界波… |
| 5 | 0.560 | 新闻 | IT之家 · 英伟达、谷歌、Emerald AI 发起成立 AI 能源管理联盟… |

**抽查 3 条热榜**：

| 来源 · 名次 | 标题 | publishedAt | hasRealTime | heatScore |
|---|---|---|---|---|
| 微博 第2位 | 小伙记录母亲最后14天的视频火了 | `null` ✅ | `false` ✅ | 0.487 |
| 百度贴吧 第11位 | 南方医科大学博士跳楼身亡 | `null` ✅ | `false` ✅ | 0.283 |
| 今日头条 第4位 | 亚运会U23国足2-1逆转朝鲜 | `null` ✅ | `false` ✅ | 0.517 |

**抽查 1 条详情（`/api/news/:id`）**：状态 200；标题「文石推出 Boox Palma 3 电纸书阅读器…」；`image` 有值（`img.ithome.com`）；`content` 含标签 **false**，长度 339；`hasRealTime` true；`heatScore` 0.46。

---

## 6. 方案 C 的正式记录

| 项 | 内容 |
|---|---|
| 决策 | 接受 heatScore 的真实并列 |
| 依据 | 热榜部分条目**输入完全相同**（同 rank、同平台权重档位、无关键词命中、无多源合并），得到相同 heatScore 属于真实数学结果，不视为算法错误 |
| 未做 | 未加入随机噪声；未修改 `HOT_SOURCES` 平台权重 |
| 现状 | heatScore 不同值 118~119 / 210~224 = **52%~56%**（未达 70%） |
| 后续 | 平台权重差异化并入 **Stage 5（新闻源生态）** 处理 |
| 参考 | 新闻（有真实发布时间）侧唯一率已达 **79%**，热榜侧受输入限制 |

---

## 7. 遗留与备注

| 项 | 说明 |
|---|---|
| 本地 dev 服务 | 冒烟测试启动的 `server.js` 仍在监听 3000 端口（`pkill` / `taskkill` / PowerShell 均未能终止，疑似沙箱权限限制）。不影响线上，如介意可手动结束 node 进程 |
| 远端分支 | 远端存在一个旧分支 `学习者-宁-补丁-1`（`ff7b232`，2026-08-16「Add files via upload」），与本次改动**无关**，未触碰 |
| 数据波动 | 每轮抓取的源成功率不同（本轮 210 条 / 1 源失败；线上 214 条 / 1 源失败），指标会小幅浮动（叶片比例 88.0%~88.7%、热度不同值 117~119） |
| 未进入 Stage 2 | 按要求停止，未做首屏/载荷/缓存/localStorage/骨架屏的任何改动 |

---

## 8. 结论

**Stage 1 已完成，等待进入 Stage 2。**

- 两个 commit 已推送，本地与 GitHub main HEAD 一致（`2178421`）
- 线上已生效：HTML 清洗、image 抽取、heatScore 归一化、叶片宽度统一全部验证通过
- 8 项硬指标 11/11 PASS；未达标项（heatScore 不同值数量）按方案 C 接受，留待 Stage 5

Stage 2 预告（未执行）：列表接口去 `content`（468 KB → 约 170 KB）、抓取与请求解耦、localStorage 缓存优先渲染、骨架屏、`refresh` 节流。

---

*本记录对应的两个 commit 已推送至 `main`；本地与线上验收均可复现。*
