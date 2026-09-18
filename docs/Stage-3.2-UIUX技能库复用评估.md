# Stage 3.2 · `ui-ux-pro-max-skill` 复用评估

> 评估时间：2026-09-17
> 评估对象：https://github.com/nextlevelbuilder/ui-ux-pro-max-skill （MIT）
> 评估目的：Stage 3.2 §1 要求 —— 先检查该 Skill 能否使用，并判定哪些能力可被本项目直接复用
> 当前项目：`D:\wr new\新闻树`（原生 ES Module + 手写 CSS，无框架、无 Tailwind；Express 本地 + Cloudflare Workers）

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 是否已安装？ | **否**。用户级 `~/.workbuddy-ai/skills/` 只有 `minimax-pdf / perplexity / task-alignment / travel-planning`；项目级 `.workbuddy-ai/skills/` 不存在；本会话可调用技能清单里也没有它 |
| 能否使用？ | **能用，但建议「文档级复用」，不要装成技能**。硬依赖 Python 3.x —— 本机 **Python 3.13.14 已就绪** ✅ |
| 可直接复用的核心资产 | **`references/quick-reference.md`（119 条 UX 规则全文，24.5 KB）+ `references/pro-rules.md`（含交付前检查清单）** —— 纯 Markdown，零依赖，正好覆盖 Stage 3.2 的 7 个设计重点 |
| 建议不要用的部分 | `--design-system` 生成设计系统（会推翻现有视觉语言，与「禁止 SaaS Dashboard 风格」冲突）、22 个技术栈指南（本项目一个都不匹配）、字体/图标大数据库（747 KB + 824 KB，本项目用系统字体 + 内联 SVG） |
| 最有价值的间接收获 | 它的 `.mcp.json`（Playwright + Chrome DevTools MCP）和 `scripts/design-audit.mjs`（多视口截图审计）—— **正好补上本项目一直缺的「真实浏览器验收」能力** |

---

## 一、技能库实际构成（它不止 1 个技能，而是 7 个）

很多人以为它是一个技能，实际仓库里有 7 个独立 skill：

| 技能目录 | 内容 | 对本项目 |
|---|---|---|
| **`ui-ux-pro-max`** | 核心：Python 搜索引擎 + 17 个 CSV 知识库 + 22 个技术栈 CSV + 2 个参考文档 | ✅ **主目标** |
| **`design-system`** | 三层 token 架构（primitive / semantic / component）+ 校验脚本 | ⚠️ 只取 token 架构思路 |
| `ui-styling` | Tailwind / shadcn / canvas 设计系统 + 70 个 TTF 字体 | ❌ 本项目不用 Tailwind/shadcn |
| `design` | Logo / CIP / 社交图 / 图标生成 | ❌ 无关 |
| `slides` / `banner-design` / `brand` | 幻灯片 / 横幅 / 品牌规范 | ❌ 无关 |

**`ui-ux-pro-max` 的数据规模**（来自其 SKILL.md frontmatter）：

> 79 searchable styles (50 active), 192 product palettes and reasoning profiles, 74 font pairings, 119 UX guidelines, 105 icons, 17 GSAP presets, 25 chart types, and 22 stacks.

**它的 10 个优先级分类**（决定了它能回答什么问题）：

| 优先级 | 分类 | Impact | Domain |
|---|---|---|---|
| 1 | Accessibility | CRITICAL | `ux` |
| 2 | Touch & Interaction | CRITICAL | `ux` |
| 3 | Performance | HIGH | `ux` |
| 4 | Style Selection | HIGH | `style` `product` |
| 5 | Layout & Responsive | HIGH | `ux` |
| 6 | Typography & Color | MEDIUM | `typography` `color` |
| 7 | Animation | MEDIUM | `ux` `gsap` |
| 8 | Forms & Feedback | MEDIUM | `ux` |
| 9 | **Navigation Patterns** | **HIGH** | `ux` |
| 10 | Charts & Data | LOW | `chart` |

---

## 二、可直接复用的能力（按价值排序）

### ★★★ 1. `references/quick-reference.md` —— 119 条 UX 规则全文

**具体用途**：一份按 10 个优先级分类、逐条编号的 UI/UX 规则清单，每条都带来源标准（Apple HIG / Material Design / WCAG 2.2）。格式统一：

```
- `rule-name` - 描述说明（来源标准）
```

**为什么可直接复用**：纯 Markdown，不依赖 Python、不依赖任何运行时；内容与具体框架无关（stack-agnostic），原生 HTML/CSS 项目同样适用。

**适用场景 → 对应 Stage 3.2 的哪一条要求**：

| Stage 3.2 要求 | 该文件里的对应规则（逐字引用） |
|---|---|
| §3 点击新闻源进入独立新闻树、支持后退 | `` `back-behavior` - Back navigation must be predictable and consistent; preserve scroll/state (Apple HIG, MD)``<br>`` `back-stack-integrity` - Never silently reset the navigation stack or unexpectedly jump to home``<br>`` `state-preservation` - Navigating back must restore previous scroll position, filter state, and input`` |
| §3/§11 两个层级（源页 vs 详情页）不能混 | `` `nav-hierarchy` - Primary nav (tabs/bottom bar) vs secondary nav (drawer/settings) must be clearly separated (MD)``<br>`` `drill-down-consistency` - Drill-down interactions must maintain a clear back-path and hierarchy breadcrumb``<br>`` `avoid-mixed-patterns` - Don't mix Tab + Sidebar + Bottom Nav at the same hierarchy level`` |
| §6 首页第一眼是「新闻源树」 | `` `visual-hierarchy` - Establish hierarchy via size, spacing, contrast — not color alone``<br>`` `weight-hierarchy` - Use font-weight to reinforce hierarchy: Bold headings (600–700), Regular body (400), Medium labels (500)`` |
| §8 来源区域是分组容器，不要重边框/阴影/玻璃堆叠 | `` `whitespace-balance` - Use whitespace intentionally to group related items and separate sections; avoid visual clutter (Apple HIG)``<br>`` `elevation-consistent` - Use a consistent elevation/shadow scale for cards, sheets, modals; **avoid random shadow values**``<br>`` `field-grouping` - Group related fields logically (fieldset/legend or visual grouping) (MD)`` |
| §9 降低单张新闻卡片视觉重量 | `` `content-priority` - Show core content first on mobile; fold or hide secondary content``<br>`` `scale-feedback` - Subtle scale (0.95–1.05) on press for tappable cards/buttons; restore on release (HIG, MD)`` |
| §10 分类筛选（chip 行为） | `` `chip-collection-reflow` - Wrap the collection before shrinking labels; make a `+n` overflow summary an operable disclosure instead of hiding values`` |
| §16 移动端不横向溢出 | `` `horizontal-scroll` - No horizontal scroll on mobile; ensure content fits viewport width``<br>`` `viewport-meta` - width=device-width initial-scale=1 (**never disable zoom**)``<br>`` `breakpoint-consistency` - Use systematic breakpoints (e.g. 375 / 768 / 1024 / 1440)``<br>`` `gesture-conflicts` - Avoid horizontal swipe on main content; prefer vertical scroll`` |
| §5 新闻源节点更大、更高视觉权重、可点击 | `` `web-target-size` - Web pointer targets need 24×24 CSS px or a documented exception; do not substitute native units (WCAG 2.2 AA)``<br>`` `focus-states` - Visible focus rings on interactive elements (2–4px; Apple HIG, MD)``<br>`` `focus-appearance` - Verify focus indicator area and 3:1 state contrast`` |
| 树视图的拖拽 / 缩放 | `` `dragging-alternative` - Every author-controlled drag action needs a single-pointer and keyboard alternative (WCAG 2.2 AA)``<br>`` `keyboard-shortcuts` - Preserve system and a11y shortcuts; offer keyboard alternatives for drag-and-drop`` |
| 列表 224 条的性能 | `` `virtualize-lists` - Virtualize lists with 50+ items to improve memory efficiency and scroll performance``<br>`` `stagger-sequence` - Stagger list/grid item entrance by 30–50ms per item; avoid all-at-once or too-slow reveals`` |
| 首页 LOD 分级（远处只见源树） | `` `progressive-disclosure` - Reveal complex options progressively; don't overwhelm users upfront (Apple HIG)`` |
| 中文标题排版 | `` `line-length-control` - Mobile 35–60 chars per line; desktop 60–75 chars`` |
| 间距节奏 | `` `spacing-scale` - Use 4pt/8dp incremental spacing system (Material Design)`` |

**集成方式（推荐）**：
1. 把该文件下载到项目外或项目内的**只读参考目录**（见 §5 方案对比），文件名建议 `ux-rules-quick-reference.md`，并在文件头注明来源与 MIT 许可。
2. 在 Stage 3.2 动 UI 之前，逐条对照上表；**只把命中的规则写进提交信息/报告**，不要全文抄进代码注释。
3. **不要**把它变成运行时依赖（不 import、不打包）。

---

### ★★★ 2. `references/pro-rules.md` —— 交付前检查清单（canonical checklist）

**具体用途**：一份「交付前必须逐项确认」的清单，含 Process / Visual Quality / Interaction / Light-Dark / Layout / Accessibility 六组。

**重要限定（原文明确写了）**：

> **Scope notice:** everything below targets native/mobile app UI. For web/desktop interaction patterns, use `references/quick-reference.md` (stack-agnostic) instead — these tables assume touch targets, safe areas, and platform gesture conventions that don't apply 1:1 to desktop web.

所以本项目**只能取其中与 web 重叠的部分**，例如：

> - [ ] Pressed-state visuals do not shift layout bounds or cause jitter
> - [ ] Semantic theme tokens are used consistently (no ad-hoc per-screen hardcoded colors)
> - [ ] Dividers/borders and interaction states are distinguishable in both modes
> - [ ] Color is not the only indicator
> - [ ] Sticky UI and overlays do not obscure keyboard focus
> - [ ] Dragging and swipe-only interactions have button/keyboard alternatives

**适用场景**：Stage 3.2 交付前的自检（尤其「来源区域边界在深色下是否可见」「分类色不能是唯一区分手段」这两条 —— 后者正好呼应本项目「分类 = 颜色语义」的设计）。

**集成方式**：抽成一份**本项目专用的 8–10 项交付清单**，写进 Stage 3.2 的验收报告；不要原样照搬原生 App 的 safe-area / 44pt 条目（那是移动原生场景）。

---

### ★★ 3. `design-system` 技能的 token 架构参考

**具体用途**：三层 token 架构的方法论（4 个 reference 文件）：

```
references/primitive-tokens.md    → 原始值（色阶、字号、间距刻度）
references/semantic-tokens.md     → 语义层（surface / text-primary / border-subtle …）
references/component-tokens.md    → 组件层（card-bg / card-border / chip-bg …）
references/token-architecture.md  → 分层原则与命名规范
```

**为什么对本项目有价值**：项目 `public/style.css` 现在有 `--c` / `--line` / `--muted` / `--glass` / `--accent` / `--ink` / `--bg0` 等变量，但**没有分层** —— 组件里仍在混用「语义名」和「原始值」（例如 `rgba(150,180,255,.16)` 这种裸值散落在多处）。Stage 3.2 要新增「来源区域容器」「来源标题行」「来源进入按钮」等组件，正好需要一层组件 token。

**适用场景**：Stage 3.2 §8 新增来源区域容器时，把它的边框/内边距/背景抽成组件 token，而不是就地写死颜色。

**集成方式**：**只取架构思路，不引入其脚本**（`generate-tokens.cjs` / `validate-tokens.cjs` 是 Tailwind/JSON 导向的，本项目用不到）。在 `style.css` 顶部把现有变量整理成「原始 → 语义」两段并加注释即可，**不要大改**（Stage 3.2 §13 限定这是纯 UI 阶段）。

---

### ★★ 4. `.mcp.json` + `scripts/design-audit.mjs` —— 真实浏览器验收能力

**具体用途**：
- `.mcp.json` 配置 **Playwright MCP + Chrome DevTools MCP**
- `scripts/design-audit.mjs` 做**多视口截图 + 启发式审计**（其 `stack/examples/juniper-audit/` 有真实运行产物：报告 + 6 张视口截图）

**为什么这是本项目最该拿的东西**：本项目从 Stage 0 到 3.1，我**每一轮都在报告里写同一句话**——「沙箱内 `agent-browser` 不可用，交互只做了代码级 + 静态验证，建议你本地实开确认」。Stage 3.2 §17 又要求输出「首页新闻树截图 / 新闻列表截图 / 新闻源独立树截图」。**这个缺口正好被它补上**。

**适用场景**：Stage 3.2 验收时，对 `/`、`/source/weibo`、`/detail/:id` 三个页面在 375 / 768 / 1024 / 1440 四个断点截图，并检查横向溢出、对比度、点击目标尺寸。

**集成方式**（两条路，任选）：
- **A（推荐，零侵入）**：把它的 `.mcp.json` 里的 Playwright 配置**借鉴**到 `~/.workbuddy-ai/mcp.json`（用户级，不动项目），这样本会话就能真正截图验收。
- **B（不推荐）**：把 `design-audit.mjs` 拷进项目 —— 它是为它自己的 stack 写的，依赖较多，进项目会污染架构（违反 Stage 3.2 §1「不要擅自修改项目架构」）。

---

### ★ 5. `--domain ux` 查询脚本（开发期可选）

**具体用途**：对具体 UI 问题做精确查询，而不是靠记忆。`data/ux-guidelines.csv`（27.5 KB，119 条）是它的数据源。

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "back behavior" --domain ux
python .claude/skills/ui-ux-pro-max/scripts/search.py "horizontal scroll" --domain ux
python .claude/skills/ui-ux-pro-max/scripts/search.py "chip badge overflow nowrap" --domain ux
```

**为什么可用**：本机 Python 3.13.14 ✅；脚本**仅用标准库、不联网**（原文：「Requires Python 3.x, no external dependencies」）。

**适用场景**：Stage 3.2 开发中遇到具体判断（「来源区域之间留多少间距合适」「chip 换行怎么处理」）时查一次，比翻 24 KB 的 Markdown 快。

**集成方式**：**开发期工具，不进产品**。若采用，需先把 `scripts/` + `data/` 下载到项目外的参考目录（例如 `F:\ui-ux-ref\`），用绝对路径调用。

---

## 三、需要适配、不能直接用的部分

| 资产 | 为什么不能直接用 | 怎么用 |
|---|---|---|
| `--stack html-tailwind`（16.5 KB） | 本项目**不用 Tailwind**，是手写 CSS。该文件大量内容是 Tailwind class 名与 `tailwind.config` 片段 | 只取其中的**语义部分**（响应式断点、溢出处理、nowrap 策略），忽略 class 名 |
| `--domain color`（192 调色板）/ `typography`（74 字体配对） | 本项目已确立深色主题 + 分类色语义 + 系统中文字体栈；整体替换会破坏现有视觉语言 | 仅在**新增新闻源需要分配颜色**时，作为「来源颜色语义」的参考色源；不与现有分类色冲突 |
| `--design-system`（生成设计系统） | **风险最高的一项**。它是为新项目生成整套视觉方向的；本项目已有成熟语言，且 Stage 3.2 明确「禁止做成普通 SaaS Dashboard 风格」「保持实验性、探索式、视觉化信息浏览器的定位」。跑它会**推翻现有设计** | **不要跑**。只把它当作「检查清单来源」。若确实想用，必须先跑 `--dry-run` 并逐条对照现有语言 |
| `--domain chart`（25 种图表） | 本项目的树是自定义 SVG，热榜是列表，不接图表库 | 基本不需要；若日后要加「来源分布」统计图再说 |
| `design-system/scripts/*.cjs`、`ui-styling/scripts/*.py` | Tailwind / shadcn / JSON token 导向，本项目无对应载体 | 不用 |

---

## 四、明确不适用的部分

| 资产 | 原因 |
|---|---|
| `design/`（logo / CIP / 社交图 / 图标生成）、`slides/`、`banner-design/`、`brand/` | 与本项目无关 |
| 22 个技术栈中的 21 个（React / Next.js / Vue / Nuxt / Svelte / Astro / Angular / Laravel / SwiftUI / React Native / Flutter / Jetpack Compose / JavaFX / WPF / WinUI / UWP / Avalonia / Uno / shadcn / threejs / nuxt-ui） | 本项目一个都不匹配 |
| `--domain gsap`（17 个 GSAP 预设） | 本项目无 GSAP；且 Stage 3.2 明确「不要增加装饰」 |
| `data/google-fonts.csv`（747 KB）、`data/google-font-licenses.json`（433 KB）、`data/phosphor-icons-upstream.json`（824 KB） | 本项目用系统中文字体栈 + 内联 SVG 图标，不需要 |
| `ui-styling/canvas-fonts/`（70+ 个 TTF，约 6 MB） | 同上 |

**一个必须点明的技术风险**：该技能 Step 1 要求「detect stack from `package.json` deps」并且「**Never assume a stack**」。本项目的 `package.json` 只有 `express` / `wrangler` 这类非 UI 依赖，**它的自动 stack 检测会落空或误判**。如果真按它的流程走，需要在 Step 1 手工声明「原生 HTML + 手写 CSS」——而它没有这个 stack，最接近的 `html-tailwind` 会带来 Tailwind 假设。**这是它对本项目最大的适配缺口。**

---

## 五、推荐集成方案（三选一）

| 方案 | 做法 | 侵入性 | 推荐度 |
|---|---|---|---|
| **A. 文档级复用（推荐）** | 只把 `quick-reference.md` + `pro-rules.md` 下载到项目外的参考目录（如 `F:\ui-ux-ref\`）；Stage 3.2 动 UI 前对照 §2 的映射表；不装技能、不改项目 | **零** | ★★★ |
| **B. 项目内只读文档** | 同 A，但落到 `docs/design/` 并在文件头注明来源与 MIT；好处是随仓库走、团队可见 | 极低（只增文档） | ★★ |
| **C. 安装成技能** | `uipro init --ai codebuddy`（它原生支持 CodeBuddy 形态）或 `--ai universal` → `.agents/skills/` | **高**：会写入技能目录、引入 6 MB+ 字体与 1.6 MB+ 数据；且 Stage 3.2 §1 明确「如果项目中没有 Skill 集成，则**不要擅自修改项目架构**」 | ★ |

**我的建议：A 或 B，不选 C。** 理由：
1. 本项目最需要的只是 **119 条规则 + 一份交付清单**，占整个仓库不到 2% 的体积，却贡献了 90% 的可用价值。
2. 该技能的核心卖点是「为新项目生成设计系统」—— 本项目**不需要生成**，只需要**校验**。
3. 装它会引入 22 个用不上的 stack、70 个字体、1.6 MB 图标库，以及一个会误判的 stack 检测步骤。

**另外单独建议**：把它的 **Playwright MCP 配置思路**用到用户级 `~/.workbuddy-ai/mcp.json` —— 这是唯一能让本项目**真正完成 Stage 3.2 §17 截图要求**的路径。

---

## 六、对 Stage 3.2 的净收益

| Stage 3.2 §1 列出的设计重点 | 该技能能提供什么 | 净收益 |
|---|---|---|
| design-system | 三层 token 架构思路（primitive/semantic/component） | **中** —— 帮本项目把散落的 CSS 变量收成两层 |
| ui-styling | Tailwind/shadcn 参考 | **低** —— 本项目不用 |
| ux | **119 条规则全文** | **高** |
| responsive layout | 断点清单 375/768/1024/1440 + `horizontal-scroll` / `viewport-meta` / `mobile-first` | **高** |
| navigation | **14 条导航规则 + 5 条返回行为规则** | **高** —— 正好对应 §3/§11 的 source route 与「返回全部新闻源」 |
| card/group hierarchy | `whitespace-balance` / `elevation-consistent` / `field-grouping` / `visual-hierarchy` | **高** —— 正好对应 §8「来源区域是分组容器，不是传统 Card」 |
| accessibility | `web-target-size` / `focus-states` / `focus-appearance` / `dragging-alternative` / `aria-labels` | **中高** —— 补上树的拖拽与叶片点击目标 |

**一句话**：这个技能库对本项目是**「规则手册」价值，不是「生成器」价值**。用它的清单去校验，不要用它的生成器去重建。

---

## 七、下一步

评估完成。按 Stage 3.2 §1 的要求，**当前项目没有 Skill 集成，因此我没有擅自安装或修改项目架构**。

请确认两件事，我再继续：

1. **集成方式**：选 A（项目外参考目录）、B（项目内 `docs/design/`）还是 C（安装成技能）？我建议 **B** —— 随仓库走、团队可见、零运行时侵入。
2. **是否开始 Stage 3.2 实现**：若开始，我会建分支 `stage-3.2-source-navigation`，按 §2–§12 重构信息架构（新闻源升为一级节点 + `/source/:key` 独立新闻树 + 列表按来源分区），并按 §15 补齐 12 项测试。

---

*评估依据：仓库 README、`.claude/skills/ui-ux-pro-max/SKILL.md`、`references/quick-reference.md`、`references/pro-rules.md`、git tree 清单；以及本项目 `package.json` / `public/` 目录结构的实际核查。*
