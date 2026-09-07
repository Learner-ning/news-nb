# NewsNow Bold

受 NewsNow 信息聚合思路启发的简洁、响应式新闻聚合站。

## 运行

这是本地 Node 服务，**关掉终端或重启电脑后 `http://localhost:3000` 会打不开**（`ERR_CONNECTION_REFUSED`）。每次要用，先保证服务在跑。

**最省事：** 双击 `打开新闻站.bat`（已在运行则直接打开浏览器，否则先启动再打开）。

想开机自动打开：再双击一次 `安装开机自启.bat`。取消自启时，删除「启动」文件夹里的 `NewsNow Bold` 快捷方式即可。

或手动：

1. 安装 Node.js 20+
2. `npm install`
3. `npm start`
4. 浏览器打开 `http://localhost:3000`

可选环境变量：

- `PORT`：服务端口（默认 `3000`）
- `CACHE_TTL_MS`：RSS 缓存时长，毫秒（默认 `300000`，即 5 分钟）
- `FEED_TIMEOUT_MS`：单个 RSS 请求超时，毫秒（默认 `20000`）

## 功能

- RSS 新闻聚合（Solidot / IT之家 / 少数派）+ 重点扩展（量子位AI / 触乐游戏 / 爱范儿科技）
- **主流平台热搜**：腾讯新闻 / 头条 / 抖音 / B站 / 微博（每平台 Top15，服务端抓取公开热榜）
- **热度评分与去重**：`heatScore` 综合 时间衰减/来源权重/榜单名次/多源重复/分类热度/关键词热度；同一事件多源报道自动合并并加权
- **交互式新闻树**：二维 SVG 树（树干 → 主枝(分类) → 分枝(来源) → 新闻叶片），由真实数据动态生成、布局稳定；叶片视觉权重随热度变化
- **树 / 列表 / 热榜** 三视图（左侧切换），共用同一份新闻数据与跳转逻辑
- 树与列表只显示新闻标题；点击标题进入站内详情页，详情含「阅读原文」直达原文/平台页；热榜为全站 TOP20（热度排序）
- 列表支持 热度 / 时间 两种排序；树支持按分类切换并重排
- 树模式交互：悬停（标题/来源/时间/热度）进详情、整树拖拽、滚轮/双指缩放、一键适应
- 真实分类导航（全部 / 综合 / 科技 / 数码 / AI / 游戏 / 腾讯 / 头条 / 抖音 / B站 / 微博），切换自动重排
- 背景与外观：多主题 + 用户上传图片背景
- 部署：本地 Express 或 Cloudflare Workers(Static Assets)，见 `DEPLOY.md`
- 响应式布局（桌面优先，兼容平板与手机）

## 目录结构

```text
.
├── public/                # 前端静态资源
│   ├── index.html
│   ├── style.css
│   ├── favicon.svg
│   └── js/                # 前端模块（原生 ES Modules，无框架）
│       ├── app.js         # 入口：树/列表/热榜、分类、详情、刷新、路由
│       ├── news-store.js  # 数据层：API 获取、缓存、新闻→树模型
│       ├── tree-view.js   # 树布局 + SVG 渲染 + 交互（悬停/拖拽/缩放/动画）
│       ├── views.js       # 列表、热榜、详情、悬停卡
│       └── helpers.js     # 公共工具
├── src/index.js           # Cloudflare Worker：/api/* + SPA 深链回落
├── lib/news-core.mjs      # 统一抓取/去重/热度引擎（本地 server 与 Worker 共用）
├── server.js              # 本地开发 Express 服务
├── wrangler.jsonc         # Cloudflare Worker Static Assets 配置
├── package.json
├── DEPLOY.md              # GitHub → Cloudflare 自动部署说明
└── README.md
```

## API

- `GET /api/news?source=all|综合|科技|数码|腾讯|头条|抖音|B站|微博` — 新闻列表（平台热搜条目数若源站变化会随之增减）
- `GET /api/news?refresh=1` — 强制刷新缓存
- `GET /api/news/:id` — 单条详情
- `GET /api/health` — 健康检查与源错误摘要

每条新闻的 `id` 为其来源唯一键的 SHA1 前 12 位。

> 热搜数据来自各平台公开热榜/搜索接口，接口可能随平台策略调整而失效；微博需要先访问主站再拉取热搜。RSS 与热搜任一部分失败不影响其余部分展示。

## 说明

新闻源 RSS 可能因第三方站点调整而失效。生产环境建议替换为稳定且获授权的新闻 API/RSS。
