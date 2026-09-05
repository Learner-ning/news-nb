# NewsNow Bold

受 NewsNow 信息聚合思路启发的简洁、响应式新闻聚合站。

## 运行

1. 安装 Node.js 20+
2. `npm install`
3. `npm start`
4. 浏览器打开 `http://localhost:3000`

可选环境变量：

- `PORT`：服务端口（默认 `3000`）
- `CACHE_TTL_MS`：RSS 缓存时长，毫秒（默认 `300000`，即 5 分钟）
- `FEED_TIMEOUT_MS`：单个 RSS 请求超时，毫秒（默认 `20000`）

## 功能

- RSS 新闻聚合（Solidot / IT之家 / 少数派）
- 点击新闻卡片进入站内详情页
- 详情页可「阅读原文」或复制链接
- 综合 / 科技 / 数码筛选
- 浏览器前进/后退支持 `/detail/:id`
- 列表内存缓存，详情页复用同一缓存，避免重复拉取 RSS
- 响应式布局

## 目录结构

```text
.
├── public/           # 前端静态资源
│   ├── index.html
│   ├── app.js
│   └── style.css
├── server.js         # Express + RSS 聚合 API
├── package.json
└── README.md
```

## API

- `GET /api/news?source=all|综合|科技|数码` — 新闻列表
- `GET /api/news?refresh=1` — 强制刷新缓存
- `GET /api/news/:id` — 单条详情
- `GET /api/health` — 健康检查与源错误摘要

每条新闻的 `id` 为原文 URL 的 SHA1 前 12 位。

## 说明

新闻源 RSS 可能因第三方站点调整而失效。生产环境建议替换为稳定且获授权的新闻 API/RSS。
